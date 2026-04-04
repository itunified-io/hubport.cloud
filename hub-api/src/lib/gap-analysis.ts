/**
 * Gap Analysis Engine — analyzes uncovered areas between territory polygons
 * and recommends resolution actions (new territory or neighbor expansion).
 *
 * Reuses existing gap detection patterns:
 * - Single Overpass query for congregation bbox (avoids rate limiting)
 * - PostGIS gap polygon computation via ST_Difference
 * - Point-in-polygon distribution via isInsideBoundaries
 */

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { computeGapPolygons, runAutoFixPipeline } from "./postgis-helpers.js";
import { queryBuildingsInBBox, type OverpassBuilding } from "./osm-overpass.js";
import { bboxFromGeoJSON, isInsideBoundaries } from "./geo.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaLike = any;

// ─── Building severity classification ────────────────────────────────

const RESIDENTIAL_TYPES = new Set([
  "house", "apartments", "residential", "detached", "semidetached_house", "terrace",
]);
const MEDIUM_TYPES = new Set(["farm"]);
const IGNORABLE_TYPES = new Set([
  "garage", "commercial", "industrial", "retail", "shed", "barn",
  "church", "public", "warehouse", "office", "school", "hospital",
  "hotel", "supermarket",
]);

function isResidential(building: OverpassBuilding): boolean {
  const type = building.buildingType ?? "unknown";
  if (RESIDENTIAL_TYPES.has(type)) return true;
  if (MEDIUM_TYPES.has(type)) return true;
  if (type === "yes" && building.hasAddress) return true;
  return false;
}

// ─── Shared severity classification (used by overrides + analysis) ───

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

export interface NeighborAssignment {
  territoryId: string;
  territoryNumber: string;
  territoryName: string;
  buildingCount: number;
  /** Building [lng, lat] coordinates assigned to this neighbor */
  buildingCoords: [number, number][];
}

export interface GapAnalysis {
  gapId: string;
  gapPolygon: object;
  areaMeter2: number;
  residentialCount: number;
  totalBuildingCount: number;
  recommendation: "new_territory" | "expand_neighbors";
  neighborAssignments: NeighborAssignment[];
}

export interface GapAnalysisResult {
  gaps: GapAnalysis[];
  thresholds: { minResidentialBuildings: number; minAreaM2: number };
}

export interface GapResolveNewTerritoryResult {
  territoryId: string;
  number: string;
  name: string;
  autoFixApplied: string[];
}

export interface GapResolveExpandResult {
  expanded: Array<{
    territoryId: string;
    number: string;
    autoFixApplied: string[];
  }>;
}

// ─── Analysis ────────────────────────────────────────────────────────

export async function runGapAnalysis(
  prisma: PrismaLike,
  options: { minResidentialBuildings?: number; minAreaM2?: number } = {},
): Promise<GapAnalysisResult> {
  const minRes = options.minResidentialBuildings ?? 8;
  const minArea = options.minAreaM2 ?? 5000;

  // Step 1: Compute gap polygons
  const gaps = await computeGapPolygons(prisma);
  if (!gaps || gaps.length === 0) {
    return { gaps: [], thresholds: { minResidentialBuildings: minRes, minAreaM2: minArea } };
  }

  // Step 2: Get congregation bbox for single Overpass query
  const congregation = await prisma.territory.findFirst({
    where: { type: "congregation_boundary", boundaries: { not: Prisma.DbNull } },
    select: { boundaries: true },
  });
  if (!congregation?.boundaries) {
    return { gaps: [], thresholds: { minResidentialBuildings: minRes, minAreaM2: minArea } };
  }

  const congBbox = bboxFromGeoJSON(congregation.boundaries);
  if (!congBbox) {
    return { gaps: [], thresholds: { minResidentialBuildings: minRes, minAreaM2: minArea } };
  }

  // Step 3: Single Overpass query + filter inside congregation
  const allBuildings = await queryBuildingsInBBox(congBbox.south, congBbox.west, congBbox.north, congBbox.east);
  const congBuildings = allBuildings.filter((b) =>
    isInsideBoundaries(b.lat, b.lng, congregation.boundaries),
  );

  // Step 4: Load ignored buildings
  const ignoredRows = await prisma.ignoredOsmBuilding.findMany({
    select: { osmId: true },
  });
  const ignoredIds = new Set(ignoredRows.map((r: { osmId: string }) => r.osmId));

  // Step 5: Get all territory boundaries for neighbor assignment
  const territories: Array<{ id: string; number: string; name: string; boundaries: unknown }> =
    await prisma.territory.findMany({
      where: {
        type: "territory",
        boundaries: { not: Prisma.DbNull },
      },
      select: { id: true, number: true, name: true, boundaries: true },
    });

  // Step 6: Distribute buildings into gaps
  const gapResults: GapAnalysis[] = [];

  for (const gap of gaps) {
    const gapBuildings = congBuildings.filter(
      (b) => !ignoredIds.has(b.osmId) && isInsideBoundaries(b.lat, b.lng, gap.geojson),
    );

    const residentialCount = gapBuildings.filter(isResidential).length;
    const totalBuildingCount = gapBuildings.length;

    // Decision engine
    const recommendation: "new_territory" | "expand_neighbors" =
      residentialCount >= minRes && gap.areaMeter2 >= minArea
        ? "new_territory"
        : "expand_neighbors";

    // Find adjacent territories (within 50m)
    let adjacentTerritories: typeof territories = [];
    try {
      const adjacentIds = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT t.id
        FROM "Territory" t
        WHERE t.boundaries IS NOT NULL
          AND t.type = 'territory'
          AND t.boundaries->>'coordinates' IS NOT NULL
          AND jsonb_typeof(t.boundaries->'coordinates') = 'array'
          AND ST_DWithin(
            ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(gap.geojson)}))::geography,
            ST_MakeValid(ST_GeomFromGeoJSON(t.boundaries::text))::geography,
            50
          )
        LIMIT 6
      `;
      const idSet = new Set(adjacentIds.map((r: { id: string }) => r.id));
      adjacentTerritories = territories.filter((t: { id: string }) => idSet.has(t.id));
    } catch {
      // PostGIS unavailable — fall back to empty
    }

    // Assign buildings to nearest neighbor (simple centroid distance)
    const assignments = new Map<string, { territory: typeof territories[0]; coords: [number, number][] }>();

    for (const building of gapBuildings) {
      let nearestId: string | null = null;
      let nearestDist = Infinity;

      for (const territory of adjacentTerritories) {
        const tBbox = bboxFromGeoJSON(territory.boundaries);
        if (!tBbox) continue;
        // Approximate distance using centroid
        const tCenterLat = (tBbox.south + tBbox.north) / 2;
        const tCenterLng = (tBbox.west + tBbox.east) / 2;
        const dist = Math.sqrt(
          Math.pow((building.lat - tCenterLat) * 111_000, 2) +
          Math.pow((building.lng - tCenterLng) * 111_000 * Math.cos(building.lat * Math.PI / 180), 2),
        );
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestId = territory.id;
        }
      }

      if (nearestId) {
        const existing = assignments.get(nearestId);
        if (existing) {
          existing.coords.push([building.lng, building.lat]);
        } else {
          const territory = adjacentTerritories.find((t: { id: string }) => t.id === nearestId)!;
          assignments.set(nearestId, { territory, coords: [[building.lng, building.lat]] });
        }
      }
    }

    const neighborAssignments: NeighborAssignment[] = Array.from(assignments.entries()).map(
      ([id, { territory, coords }]) => ({
        territoryId: id,
        territoryNumber: territory.number,
        territoryName: territory.name,
        buildingCount: coords.length,
        buildingCoords: coords,
      }),
    );

    gapResults.push({
      gapId: randomUUID(),
      gapPolygon: gap.geojson,
      areaMeter2: gap.areaMeter2,
      residentialCount,
      totalBuildingCount,
      recommendation,
      neighborAssignments,
    });
  }

  return {
    gaps: gapResults,
    thresholds: { minResidentialBuildings: minRes, minAreaM2: minArea },
  };
}

// ─── Resolution: Create new territory ────────────────────────────────

export async function resolveGapNewTerritory(
  prisma: PrismaLike,
  gapPolygon: object,
  name: string,
  number: string,
): Promise<GapResolveNewTerritoryResult> {
  // Run auto-fix pipeline on the gap polygon
  let finalBoundaries = gapPolygon;
  const autoFixApplied: string[] = [];

  try {
    const autoFix = await runAutoFixPipeline(prisma, gapPolygon, null);
    finalBoundaries = autoFix.clipped;
    autoFixApplied.push(...autoFix.applied);
  } catch (err: unknown) {
    // If PostGIS unavailable, use gap polygon as-is
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("does not exist") || (!msg.includes("st_") && !msg.includes("postgis"))) {
      throw err;
    }
  }

  const result = await prisma.$transaction(async (tx: PrismaLike) => {
    // Create territory
    const territory = await tx.territory.create({
      data: {
        number,
        name,
        type: "territory",
        boundaries: finalBoundaries,
      },
    });

    // Create boundary version v1
    await tx.territoryBoundaryVersion.create({
      data: {
        territoryId: territory.id,
        version: 1,
        boundaries: finalBoundaries as any,
        changeType: "gap_resolution",
        changeSummary: `Created from gap resolution${autoFixApplied.length > 0 ? ` (${autoFixApplied.join("; ")})` : ""}`,
      },
    });

    return territory;
  });

  return {
    territoryId: result.id,
    number: result.number,
    name: result.name,
    autoFixApplied,
  };
}

// ─── Resolution: Expand neighbors ────────────────────────────────────

export async function resolveGapExpandNeighbors(
  prisma: PrismaLike,
  assignments: Array<{ territoryId: string; buildingCoords: [number, number][] }>,
): Promise<GapResolveExpandResult> {
  const results = await prisma.$transaction(async (tx: PrismaLike) => {
    const expanded: GapResolveExpandResult["expanded"] = [];

    for (const assignment of assignments) {
      const territory = await tx.territory.findUnique({
        where: { id: assignment.territoryId },
        select: { id: true, number: true, name: true, boundaries: true },
      });
      if (!territory?.boundaries) continue;

      // Build point collection string for PostGIS
      const pointsWkt = assignment.buildingCoords
        .map(([lng, lat]) => `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`)
        .join(", ");

      // Expand territory polygon to include building points with 15m buffer
      let expandedBoundaries: object;
      try {
        const result = await tx.$queryRaw<Array<{ geojson: string }>>`
          SELECT ST_AsGeoJSON(
            ST_Union(
              ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(territory.boundaries)})),
              ST_Buffer(
                ST_Collect(ARRAY[${Prisma.raw(pointsWkt)}])::geography,
                15
              )::geometry
            )
          ) AS geojson
        `;
        if (!result[0]?.geojson) continue;
        expandedBoundaries = JSON.parse(result[0].geojson);
      } catch {
        // PostGIS issue — skip this territory
        continue;
      }

      // Run auto-fix pipeline
      const autoFixApplied: string[] = [];
      try {
        const autoFix = await runAutoFixPipeline(tx, expandedBoundaries, territory.id);
        expandedBoundaries = autoFix.clipped;
        autoFixApplied.push(...autoFix.applied);
      } catch {
        // Use expanded polygon as-is
      }

      // Save previous boundary version
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
          changeSummary: `Previous boundary before gap resolution expansion (+${assignment.buildingCoords.length} buildings)`,
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

      expanded.push({
        territoryId: territory.id,
        number: territory.number,
        autoFixApplied,
      });
    }

    return expanded;
  });

  return { expanded: results };
}
