/**
 * Gap detection routes — find buildings without addresses in territories.
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { queryBuildingsInBBox, type OverpassBuilding } from "../lib/osm-overpass.js";

// ─── Schemas ────────────────────────────────────────────────────────

const RunBody = Type.Object({
  territoryIds: Type.Optional(
    Type.Array(Type.String({ format: "uuid" }), { minItems: 1, maxItems: 20 }),
  ),
});
type RunBodyType = Static<typeof RunBody>;

const IgnoreBody = Type.Object({
  buildings: Type.Array(
    Type.Object({
      territoryId: Type.String({ format: "uuid" }),
      osmId: Type.String(),
      reason: Type.String({ minLength: 1 }),
      notes: Type.Optional(Type.String()),
      lat: Type.Optional(Type.Number()),
      lng: Type.Optional(Type.Number()),
      streetAddress: Type.Optional(Type.String()),
      buildingType: Type.Optional(Type.String()),
    }),
    { minItems: 1, maxItems: 200 },
  ),
});
type IgnoreBodyType = Static<typeof IgnoreBody>;

const OsmIdParams = Type.Object({
  osmId: Type.String(),
});
type OsmIdParamsType = Static<typeof OsmIdParams>;

const ProposalBody = Type.Object({
  territoryIds: Type.Array(Type.String({ format: "uuid" }), { minItems: 1, maxItems: 20 }),
});
type ProposalBodyType = Static<typeof ProposalBody>;

/**
 * Compute bounding box from GeoJSON polygon boundaries.
 */
function bboxFromGeoJSON(boundaries: unknown): {
  south: number; west: number; north: number; east: number;
} | null {
  if (!boundaries || typeof boundaries !== "object") return null;
  const geo = boundaries as { type?: string; coordinates?: number[][][] | number[][][][] };
  if (!geo.coordinates) return null;

  let allCoords: number[][] = [];
  if (geo.type === "Polygon") {
    for (const ring of geo.coordinates as number[][][]) allCoords = allCoords.concat(ring);
  } else if (geo.type === "MultiPolygon") {
    for (const poly of geo.coordinates as number[][][][]) {
      for (const ring of poly) allCoords = allCoords.concat(ring);
    }
  } else {
    return null;
  }

  if (allCoords.length === 0) return null;

  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
  for (const [lng, lat] of allCoords as [number, number][]) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lng < west) west = lng;
    if (lng > east) east = lng;
  }
  return { south, west, north, east };
}

/**
 * Simple point-in-polygon test using ray casting.
 */
function pointInPolygon(lat: number, lng: number, polygon: number[][][]): boolean {
  for (const ring of polygon) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i]![0]!, yi = ring[i]![1]!;
      const xj = ring[j]![0]!, yj = ring[j]![1]!;
      const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

function isInsideBoundaries(lat: number, lng: number, boundaries: unknown): boolean {
  if (!boundaries || typeof boundaries !== "object") return false;
  const geo = boundaries as { type?: string; coordinates?: number[][][] | number[][][][] };
  if (geo.type === "Polygon") {
    return pointInPolygon(lat, lng, geo.coordinates as number[][][]);
  }
  if (geo.type === "MultiPolygon") {
    return (geo.coordinates as number[][][][]).some((poly) => pointInPolygon(lat, lng, poly));
  }
  return false;
}

export async function gapDetectionRoutes(app: FastifyInstance): Promise<void> {
  // ─── Run gap detection ───────────────────────────────────────────
  app.post<{ Body: RunBodyType }>(
    "/territories/gap-detection/run",
    {
      preHandler: requirePermission(PERMISSIONS.GAP_DETECTION_RUN),
      schema: { body: RunBody },
    },
    async (request, reply) => {
      const results: {
        territoryId: string;
        territoryNumber: string;
        totalBuildings: number;
        coveredCount: number;
        gapCount: number;
        gaps: { osmId: string; lat: number; lng: number; buildingType?: string; streetAddress?: string }[];
      }[] = [];

      // If no territoryIds provided, run on all territories with boundaries
      let ids = request.body.territoryIds;
      if (!ids || ids.length === 0) {
        const allTerritories = await prisma.territory.findMany({
          where: { type: "territory", boundaries: { not: null } },
          select: { id: true },
          take: 20,
        });
        ids = allTerritories.map((t) => t.id);
      }
      if (ids.length === 0) {
        return reply.code(400).send({ error: "No territories with boundaries found" });
      }

      for (const territoryId of ids) {
        const territory = await prisma.territory.findUnique({
          where: { id: territoryId },
        });

        if (!territory || !territory.boundaries) continue;

        const bbox = bboxFromGeoJSON(territory.boundaries);
        if (!bbox) continue;

        // Create run record
        const publisherId = request.user?.sub ?? "system";
        const run = await prisma.gapDetectionRun.create({
          data: {
            territoryId,
            status: "running",
            startedAt: new Date(),
            runBy: publisherId,
          },
        });

        try {
          // Fetch buildings from Overpass
          const buildings = await queryBuildingsInBBox(bbox.south, bbox.west, bbox.north, bbox.east);

          // Filter to buildings inside the territory polygon
          const insideBuildings = buildings.filter((b: OverpassBuilding) =>
            isInsideBoundaries(b.lat, b.lng, territory.boundaries),
          );

          // Get existing addresses and ignored buildings
          const [existingAddresses, ignoredBuildings] = await Promise.all([
            prisma.address.findMany({
              where: { territoryId },
              select: { osmId: true },
            }),
            prisma.ignoredOsmBuilding.findMany({
              where: { territoryId },
              select: { osmId: true },
            }),
          ]);

          const coveredOsmIds = new Set(existingAddresses.filter((a) => a.osmId).map((a) => a.osmId!));
          const ignoredOsmIds = new Set(ignoredBuildings.map((b) => b.osmId));

          // Find gaps: buildings not in addresses and not ignored
          const gaps = insideBuildings.filter(
            (b: OverpassBuilding) => !coveredOsmIds.has(b.osmId) && !ignoredOsmIds.has(b.osmId),
          );

          const coveredCount = insideBuildings.length - gaps.length;

          // Build GeoJSON result
          const resultGeoJson = {
            type: "FeatureCollection" as const,
            features: gaps.map((g: OverpassBuilding) => ({
              type: "Feature" as const,
              properties: {
                osmId: g.osmId,
                buildingType: g.buildingType,
                streetAddress: g.streetAddress,
              },
              geometry: {
                type: "Point" as const,
                coordinates: [g.lng, g.lat],
              },
            })),
          };

          // Update run record
          await prisma.gapDetectionRun.update({
            where: { id: run.id },
            data: {
              status: "completed",
              completedAt: new Date(),
              totalBuildings: insideBuildings.length,
              coveredCount,
              gapCount: gaps.length,
              resultGeoJson,
            },
          });

          results.push({
            territoryId,
            territoryNumber: territory.number,
            totalBuildings: insideBuildings.length,
            coveredCount,
            gapCount: gaps.length,
            gaps: gaps.map((g: OverpassBuilding) => ({
              osmId: g.osmId,
              lat: g.lat,
              lng: g.lng,
              buildingType: g.buildingType,
              streetAddress: g.streetAddress,
            })),
          });
        } catch (err) {
          await prisma.gapDetectionRun.update({
            where: { id: run.id },
            data: {
              status: "failed",
              completedAt: new Date(),
            },
          });
          throw err;
        }
      }

      // Auto-prune: keep last 3 completed + 3 failed per territory
      const territoryIds = [...new Set(request.body.territoryIds)];
      for (const tid of territoryIds) {
        for (const status of ["completed", "failed"]) {
          const runs = await prisma.gapDetectionRun.findMany({
            where: { territoryId: tid, status },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          if (runs.length > 3) {
            const toDelete = runs.slice(3).map((r) => r.id);
            await prisma.gapDetectionRun.deleteMany({
              where: { id: { in: toDelete } },
            });
          }
        }
      }

      return results;
    },
  );

  // ─── Batch ignore buildings ──────────────────────────────────────
  app.post<{ Body: IgnoreBodyType }>(
    "/territories/gap-detection/ignore",
    {
      preHandler: requirePermission(PERMISSIONS.GAP_DETECTION_RUN),
      schema: { body: IgnoreBody },
    },
    async (request, reply) => {
      const publisherId = request.user?.sub ?? "system";

      const created: string[] = [];
      const skipped: string[] = [];

      for (const b of request.body.buildings) {
        // Check for existing ignore
        const existing = await prisma.ignoredOsmBuilding.findFirst({
          where: { territoryId: b.territoryId, osmId: b.osmId },
        });

        if (existing) {
          skipped.push(b.osmId);
          continue;
        }

        await prisma.ignoredOsmBuilding.create({
          data: {
            territoryId: b.territoryId,
            osmId: b.osmId,
            reason: b.reason,
            notes: b.notes,
            lat: b.lat,
            lng: b.lng,
            streetAddress: b.streetAddress,
            buildingType: b.buildingType,
            ignoredBy: publisherId,
          },
        });
        created.push(b.osmId);
      }

      return reply.code(201).send({ created, skipped });
    },
  );

  // ─── Un-ignore a building ───────────────────────────────────────
  app.delete<{ Params: OsmIdParamsType }>(
    "/territories/gap-detection/ignore/:osmId",
    {
      preHandler: requirePermission(PERMISSIONS.GAP_DETECTION_RUN),
      schema: { params: OsmIdParams },
    },
    async (request, reply) => {
      // osmId can contain slashes (e.g., "way/123") — handle URL encoding
      const osmId = decodeURIComponent(request.params.osmId);

      const ignored = await prisma.ignoredOsmBuilding.findFirst({
        where: { osmId },
      });

      if (!ignored) {
        return reply.code(404).send({ error: "Ignored building not found" });
      }

      await prisma.ignoredOsmBuilding.delete({
        where: { id: ignored.id },
      });

      return reply.code(204).send();
    },
  );

  // ─── List ignored buildings ──────────────────────────────────────
  app.get(
    "/territories/gap-detection/ignored",
    {
      preHandler: requirePermission(PERMISSIONS.GAP_DETECTION_VIEW),
    },
    async () => {
      return prisma.ignoredOsmBuilding.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          territory: { select: { id: true, number: true, name: true } },
        },
      });
    },
  );

  // ─── Coverage proposals ──────────────────────────────────────────
  app.post<{ Body: ProposalBodyType }>(
    "/territories/gap-detection/proposals",
    {
      preHandler: requirePermission(PERMISSIONS.GAP_DETECTION_RUN),
      schema: { body: ProposalBody },
    },
    async (request) => {
      // Get latest completed run for each territory
      const proposals: {
        territoryId: string;
        territoryNumber: string;
        coveragePercent: number;
        gapCount: number;
        suggestion: string;
      }[] = [];

      for (const tid of request.body.territoryIds) {
        const latestRun = await prisma.gapDetectionRun.findFirst({
          where: { territoryId: tid, status: "completed" },
          orderBy: { createdAt: "desc" },
          include: { territory: { select: { number: true } } },
        });

        if (!latestRun || !latestRun.totalBuildings) continue;

        const coveragePercent = Math.round(
          ((latestRun.coveredCount ?? 0) / latestRun.totalBuildings) * 100,
        );

        let suggestion = "Coverage is good.";
        if (coveragePercent < 50) {
          suggestion = "Consider running an OSM refresh to import missing buildings.";
        } else if (coveragePercent < 80) {
          suggestion = "Some buildings are missing. Review gaps and add addresses.";
        } else if (coveragePercent < 95) {
          suggestion = "Nearly complete. Check remaining gaps for validity.";
        }

        proposals.push({
          territoryId: tid,
          territoryNumber: latestRun.territory.number,
          coveragePercent,
          gapCount: latestRun.gapCount ?? 0,
          suggestion,
        });
      }

      return proposals;
    },
  );

  // ─── Run history ─────────────────────────────────────────────────
  app.get(
    "/territories/gap-detection/history",
    {
      preHandler: requirePermission(PERMISSIONS.GAP_DETECTION_VIEW),
    },
    async () => {
      // Last 3 completed + 3 failed
      const [completed, failed] = await Promise.all([
        prisma.gapDetectionRun.findMany({
          where: { status: "completed" },
          orderBy: { createdAt: "desc" },
          take: 3,
          include: { territory: { select: { id: true, number: true, name: true } } },
        }),
        prisma.gapDetectionRun.findMany({
          where: { status: "failed" },
          orderBy: { createdAt: "desc" },
          take: 3,
          include: { territory: { select: { id: true, number: true, name: true } } },
        }),
      ]);

      return { completed, failed };
    },
  );
}
