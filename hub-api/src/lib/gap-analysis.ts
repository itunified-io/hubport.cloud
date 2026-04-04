/**
 * Building-Centric Smart Resolve Engine
 *
 * Replaces the gap-polygon-based approach with building-centric resolution:
 * 1. Find uncovered residential buildings (from latest gap detection run)
 * 2. Assign each to nearest territory by boundary edge distance (PostGIS ST_Distance)
 * 3. Group into clusters per territory
 * 4. Expand via convex hull stretch (buildings + nearest edge points, buffered 15m)
 */

import { Prisma } from "@prisma/client";
import { clipToCongregation as clipToCongregationOnly } from "./postgis-helpers.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaLike = any;

// ─── Building severity classification ────────────────────────────────

export const ALLOWED_BUILDING_TYPES = new Set([
  // Residential (red)
  "house", "apartments", "residential", "detached", "semidetached_house", "terrace", "cabin",
  // Mixed (orange)
  "farm", "farm_auxiliary",
  // Non-residential (gray)
  "garage", "garages", "commercial", "industrial", "retail",
  "shed", "barn", "church", "public",
  "warehouse", "office", "school", "hospital", "hotel", "supermarket",
  "service", "construction", "boathouse", "cowshed", "ruins",
  "roof", "hut", "transformer_tower", "bridge", "bunker",
  "carport", "kiosk", "toilets", "pavilion", "greenhouse",
  // Uncertain (yellow)
  "yes", "unknown",
]);

export const RESIDENTIAL_TYPES_FULL = new Set([
  "house", "apartments", "residential", "detached", "semidetached_house", "terrace", "cabin",
]);
export const MIXED_TYPES_FULL = new Set(["farm", "farm_auxiliary"]);
export const IGNORABLE_TYPES_FULL = new Set([
  "garage", "garages", "commercial", "industrial", "retail",
  "shed", "barn", "church", "public",
  "warehouse", "office", "school", "hospital", "hotel", "supermarket",
  "service", "construction", "boathouse", "cowshed", "ruins",
  "roof", "hut", "transformer_tower", "bridge", "bunker",
  "carport", "kiosk", "toilets", "pavilion", "greenhouse",
]);

export type SeverityLevel = "high" | "medium" | "low" | "ignorable";

export function classifySeverity(
  effectiveType: string | undefined,
  effectiveHasAddress: boolean,
): SeverityLevel {
  if (!effectiveType || effectiveType === "unknown") return "low";
  if (RESIDENTIAL_TYPES_FULL.has(effectiveType)) return "high";
  if (MIXED_TYPES_FULL.has(effectiveType)) return "medium";
  if (effectiveType === "yes") return effectiveHasAddress ? "medium" : "low";
  if (IGNORABLE_TYPES_FULL.has(effectiveType)) return "ignorable";
  return "low";
}

// ─── Types ───────────────────────────────────────────────────────────

export interface ClusterBuilding {
  osmId: string;
  lat: number;
  lng: number;
  buildingType: string;
  streetAddress?: string;
  distanceM: number;
}

export interface BuildingCluster {
  territoryId: string;
  territoryNumber: string;
  territoryName: string;
  maxDistanceM: number;
  buildings: ClusterBuilding[];
}

export interface UnassignedBuilding {
  osmId: string;
  lat: number;
  lng: number;
  buildingType: string;
  streetAddress?: string;
}

export interface SmartResolveAnalysis {
  clusters: BuildingCluster[];
  unassigned: UnassignedBuilding[];
  thresholds: { maxDistanceM: number };
}

export interface ClusterExpandResult {
  territoryId: string;
  number: string;
  buildingCount: number;
  autoFixApplied: string[];
}

// ─── Analysis ────────────────────────────────────────────────────────

export async function runSmartResolveAnalysis(
  prisma: PrismaLike,
  options: { maxDistanceM?: number } = {},
): Promise<SmartResolveAnalysis> {
  const maxDist = options.maxDistanceM ?? 200;

  // Step 1: Load latest completed gap detection run
  const latestRun = await prisma.gapDetectionRun.findFirst({
    where: { status: "completed" },
    orderBy: { completedAt: "desc" },
    select: { id: true, resultGeoJson: true },
  });

  if (!latestRun?.resultGeoJson) {
    return { clusters: [], unassigned: [], thresholds: { maxDistanceM: maxDist } };
  }

  // Step 2: Extract uncovered buildings from run result
  const geojson = latestRun.resultGeoJson as {
    features?: Array<{
      properties?: { osmId?: string; buildingType?: string; streetAddress?: string };
      geometry?: { coordinates?: [number, number] };
    }>;
  };

  if (!geojson.features || geojson.features.length === 0) {
    return { clusters: [], unassigned: [], thresholds: { maxDistanceM: maxDist } };
  }

  // Step 3: Load building overrides for severity classification
  type OverrideRow = { osmId: string; overriddenType: string | null; overriddenAddress: string | null; triageStatus: string };
  const overrideRows: OverrideRow[] = await prisma.buildingOverride.findMany();
  const overrideMap = new Map<string, OverrideRow>(overrideRows.map((r) => [r.osmId, r]));

  // Step 4: Filter to residential buildings only (high + medium severity)
  const residentialBuildings: Array<{
    osmId: string; lat: number; lng: number;
    buildingType: string; streetAddress?: string;
  }> = [];

  for (const feature of geojson.features) {
    const props = feature.properties;
    const coords = feature.geometry?.coordinates;
    if (!props?.osmId || !coords) continue;

    const override = overrideMap.get(props.osmId);

    // Skip triaged-out buildings
    if (override?.triageStatus === "ignored" || override?.triageStatus === "needs_visit") {
      continue;
    }

    const effectiveType = override?.overriddenType ?? props.buildingType ?? "unknown";
    const effectiveHasAddress = (override?.overriddenAddress != null) || !!props.streetAddress;
    const severity = classifySeverity(effectiveType, effectiveHasAddress);

    // Include: confirmed_residential override OR high/medium severity
    const isResidential =
      override?.triageStatus === "confirmed_residential" ||
      severity === "high" ||
      severity === "medium";

    if (isResidential) {
      residentialBuildings.push({
        osmId: props.osmId,
        lng: coords[0],
        lat: coords[1],
        buildingType: effectiveType,
        streetAddress: props.streetAddress ?? undefined,
      });
    }
  }

  if (residentialBuildings.length === 0) {
    return { clusters: [], unassigned: [], thresholds: { maxDistanceM: maxDist } };
  }

  // Step 5: Spatially cluster nearby buildings (within 150m of each other)
  // so that a group of buildings in the same area all go to the same territory
  const CLUSTER_RADIUS_M = 150;
  const spatialGroups: typeof residentialBuildings[] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < residentialBuildings.length; i++) {
    if (assigned.has(i)) continue;
    const group = [residentialBuildings[i]!];
    assigned.add(i);

    // Find all buildings within CLUSTER_RADIUS_M of any building in this group
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < residentialBuildings.length; j++) {
        if (assigned.has(j)) continue;
        const b = residentialBuildings[j]!;
        const isNear = group.some((g) => {
          const dlat = (b.lat - g.lat) * 111_000;
          const dlng = (b.lng - g.lng) * 111_000 * Math.cos(b.lat * Math.PI / 180);
          return Math.sqrt(dlat * dlat + dlng * dlng) < CLUSTER_RADIUS_M;
        });
        if (isNear) {
          group.push(b);
          assigned.add(j);
          changed = true;
        }
      }
    }
    spatialGroups.push(group);
  }

  // Step 6: For each spatial group, find nearest territory using centroid
  const clusterMap = new Map<string, {
    territoryId: string; territoryNumber: string; territoryName: string;
    buildings: ClusterBuilding[];
  }>();
  const unassigned: UnassignedBuilding[] = [];

  for (const group of spatialGroups) {
    // Compute group centroid
    const centLat = group.reduce((s, b) => s + b.lat, 0) / group.length;
    const centLng = group.reduce((s, b) => s + b.lng, 0) / group.length;

    try {
      const nearest = await prisma.$queryRaw<Array<{
        id: string; number: string; name: string; distance_m: number;
      }>>`
        SELECT t.id, t.number, t.name,
          ST_Distance(
            ST_SetSRID(ST_MakePoint(${centLng}, ${centLat}), 4326)::geography,
            ST_MakeValid(ST_GeomFromGeoJSON(t.boundaries::text))::geography
          ) AS distance_m
        FROM "Territory" t
        WHERE t.type = 'territory'
          AND t.boundaries IS NOT NULL
          AND t.boundaries->>'coordinates' IS NOT NULL
          AND jsonb_typeof(t.boundaries->'coordinates') = 'array'
          AND ST_DWithin(
            ST_SetSRID(ST_MakePoint(${centLng}, ${centLat}), 4326)::geography,
            ST_MakeValid(ST_GeomFromGeoJSON(t.boundaries::text))::geography,
            ${maxDist}
          )
        ORDER BY distance_m ASC, t.number ASC
        LIMIT 1
      `;

      if (nearest.length === 0) {
        // All buildings in this group are unassigned
        for (const b of group) {
          unassigned.push({
            osmId: b.osmId, lat: b.lat, lng: b.lng,
            buildingType: b.buildingType, streetAddress: b.streetAddress,
          });
        }
        continue;
      }

      const match = nearest[0]!;

      // Now get per-building distance to this territory
      for (const b of group) {
        let distanceM = Math.round(match.distance_m); // fallback: centroid distance
        try {
          const bDist = await prisma.$queryRaw<Array<{ d: number }>>`
            SELECT ST_Distance(
              ST_SetSRID(ST_MakePoint(${b.lng}, ${b.lat}), 4326)::geography,
              ST_MakeValid(ST_GeomFromGeoJSON(
                (SELECT boundaries::text FROM "Territory" WHERE id = ${match.id})
              ))::geography
            ) AS d
          `;
          if (bDist[0]) distanceM = Math.round(bDist[0].d);
        } catch { /* use centroid distance */ }

        const clusterBuilding: ClusterBuilding = {
          osmId: b.osmId, lat: b.lat, lng: b.lng,
          buildingType: b.buildingType, streetAddress: b.streetAddress,
          distanceM,
        };

        const existing = clusterMap.get(match.id);
        if (existing) {
          existing.buildings.push(clusterBuilding);
        } else {
          clusterMap.set(match.id, {
            territoryId: match.id,
            territoryNumber: match.number,
            territoryName: match.name,
            buildings: [clusterBuilding],
          });
        }
      }
    } catch {
      for (const b of group) {
        unassigned.push({
          osmId: b.osmId, lat: b.lat, lng: b.lng,
          buildingType: b.buildingType, streetAddress: b.streetAddress,
        });
      }
    }
  }

  // Step 7: Build cluster list sorted by max distance
  const clusters: BuildingCluster[] = Array.from(clusterMap.values())
    .map((c) => ({
      territoryId: c.territoryId,
      territoryNumber: c.territoryNumber,
      territoryName: c.territoryName,
      maxDistanceM: Math.max(...c.buildings.map((b) => b.distanceM)),
      buildings: c.buildings,
    }))
    .sort((a, b) => a.maxDistanceM - b.maxDistanceM);

  return { clusters, unassigned, thresholds: { maxDistanceM: maxDist } };
}

// ─── Resolution: Expand territory to include buildings ──────────────

export async function resolveClusterExpand(
  prisma: PrismaLike,
  territoryId: string,
  buildingCoords: [number, number][],
): Promise<ClusterExpandResult> {
  const result = await prisma.$transaction(async (tx: PrismaLike) => {
    // Load current territory boundary
    const territory = await tx.territory.findUnique({
      where: { id: territoryId },
      select: { id: true, number: true, name: true, boundaries: true },
    });
    if (!territory?.boundaries) {
      throw new Error(`Territory ${territoryId} not found or has no boundary`);
    }

    const boundariesJson = JSON.stringify(territory.boundaries);

    // Build the ST_Collect array: building points + their nearest boundary edge points
    const collectItems: string[] = [];
    for (const [lng, lat] of buildingCoords) {
      // Building point
      collectItems.push(`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`);
      // Nearest point on territory boundary edge
      collectItems.push(
        `ST_ClosestPoint(ST_MakeValid(ST_GeomFromGeoJSON('${boundariesJson.replace(/'/g, "''")}')), ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326))`,
      );
    }

    // Convex hull stretch: hull of (buildings + edge points), buffered 15m, unioned with territory
    let expandedBoundaries: object;
    try {
      const expandResult = await tx.$queryRaw<Array<{ geojson: string }>>`
        SELECT ST_AsGeoJSON(
          ST_Union(
            ST_MakeValid(ST_GeomFromGeoJSON(${boundariesJson})),
            ST_Buffer(
              ST_ConvexHull(
                ST_Collect(ARRAY[${Prisma.raw(collectItems.join(", "))}])
              )::geography,
              15
            )::geometry
          )
        ) AS geojson
      `;
      if (!expandResult[0]?.geojson) {
        throw new Error("PostGIS expansion returned no result");
      }
      expandedBoundaries = JSON.parse(expandResult[0].geojson);
    } catch (err) {
      console.error(`[smart-resolve] PostGIS expansion failed for territory ${territory.number}:`, err instanceof Error ? err.message : err);
      throw err;
    }

    // Clip to congregation boundary only (no neighbor clip)
    const autoFixApplied: string[] = [];
    try {
      const congClip = await clipToCongregationOnly(tx, expandedBoundaries);
      if (congClip) {
        expandedBoundaries = congClip.clipped;
        if (congClip.wasModified) autoFixApplied.push("Clipped to congregation boundary");
      }
    } catch {
      // Use expanded polygon as-is
    }

    // Save previous boundary as version history
    const lastVersion = await tx.territoryBoundaryVersion.findFirst({
      where: { territoryId: territory.id },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const nextVersion = (lastVersion?.version ?? 0) + 1;

    await tx.territoryBoundaryVersion.create({
      data: {
        territoryId: territory.id,
        version: nextVersion,
        boundaries: territory.boundaries as any,
        changeType: "gap_expansion",
        changeSummary: `Previous boundary before smart resolve expansion (+${buildingCoords.length} buildings)`,
      },
    });

    // Update territory boundaries
    await tx.territory.update({
      where: { id: territory.id },
      data: {
        boundaries: expandedBoundaries,
        updatedAt: new Date(),
      },
    });

    console.log(`[smart-resolve] Territory ${territory.number} expanded with +${buildingCoords.length} buildings, autoFix: [${autoFixApplied.join(", ")}]`);

    return {
      territoryId: territory.id,
      number: territory.number,
      buildingCount: buildingCoords.length,
      autoFixApplied,
    };
  });

  return result;
}
