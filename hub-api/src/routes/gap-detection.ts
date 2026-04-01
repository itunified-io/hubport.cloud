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
  //
  // Strategy: Use the congregation boundary bbox for a SINGLE Overpass
  // query, then distribute buildings to territories via point-in-polygon.
  // This avoids N separate Overpass calls that cause 504 timeouts.
  //
  app.post<{ Body: RunBodyType }>(
    "/territories/gap-detection/run",
    {
      preHandler: requirePermission(PERMISSIONS.GAP_DETECTION_RUN),
      schema: { body: RunBody },
    },
    async (request, reply) => {
      const publisherId = request.user?.sub ?? "system";

      // Load territories to scan
      const allTerritories = await prisma.territory.findMany({
        select: { id: true, number: true, boundaries: true, type: true },
      });

      // Find congregation boundary for the Overpass bbox
      const congBoundary = allTerritories.find(
        (t) => t.type === "congregation_boundary" && t.boundaries,
      );

      // Resolve which territories to scan
      let targetTerritories = allTerritories.filter(
        (t) => t.type === "territory" && t.boundaries,
      );

      // If specific IDs requested, filter to those
      const requestedIds = request.body.territoryIds;
      if (requestedIds && requestedIds.length > 0) {
        const idSet = new Set(requestedIds);
        targetTerritories = targetTerritories.filter((t) => idSet.has(t.id));
      }

      if (targetTerritories.length === 0) {
        return reply.code(400).send({ error: "No territories with boundaries found" });
      }

      // Determine bbox: prefer congregation boundary, else union of target territories
      let bbox: { south: number; west: number; north: number; east: number } | null = null;

      if (congBoundary) {
        bbox = bboxFromGeoJSON(congBoundary.boundaries);
      }

      if (!bbox) {
        // Fallback: compute union bbox from all target territories
        let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
        for (const t of targetTerritories) {
          const b = bboxFromGeoJSON(t.boundaries);
          if (!b) continue;
          if (b.south < south) south = b.south;
          if (b.north > north) north = b.north;
          if (b.west < west) west = b.west;
          if (b.east > east) east = b.east;
        }
        if (south < Infinity) bbox = { south, west, north, east };
      }

      if (!bbox) {
        return reply.code(400).send({ error: "Could not compute bounding box" });
      }

      // Single Overpass query for the entire area
      let allBuildings: OverpassBuilding[];
      try {
        allBuildings = await queryBuildingsInBBox(bbox.south, bbox.west, bbox.north, bbox.east);
      } catch (err) {
        return reply.code(502).send({
          error: err instanceof Error ? err.message : "Overpass API failed",
        });
      }

      // Distribute buildings to territories via point-in-polygon
      const runResults: object[] = [];

      for (const territory of targetTerritories) {
        const run = await prisma.gapDetectionRun.create({
          data: {
            territoryId: territory.id,
            status: "running",
            startedAt: new Date(),
            runBy: publisherId,
          },
        });

        try {
          const insideBuildings = allBuildings.filter((b) =>
            isInsideBoundaries(b.lat, b.lng, territory.boundaries),
          );

          const [existingAddresses, ignoredBuildings] = await Promise.all([
            prisma.address.findMany({
              where: { territoryId: territory.id },
              select: { osmId: true },
            }),
            prisma.ignoredOsmBuilding.findMany({
              where: { territoryId: territory.id },
              select: { osmId: true },
            }),
          ]);

          const coveredOsmIds = new Set(
            existingAddresses.filter((a) => a.osmId).map((a) => a.osmId!),
          );
          const ignoredOsmIds = new Set(ignoredBuildings.map((b) => b.osmId));

          const gaps = insideBuildings.filter(
            (b) => !coveredOsmIds.has(b.osmId) && !ignoredOsmIds.has(b.osmId),
          );
          const coveredCount = insideBuildings.length - gaps.length;

          const resultGeoJson = {
            type: "FeatureCollection" as const,
            features: gaps.map((g) => ({
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

          const updatedRun = await prisma.gapDetectionRun.findUnique({
            where: { id: run.id },
            include: { territory: { select: { id: true, number: true, name: true } } },
          });
          if (updatedRun) runResults.push(updatedRun);
        } catch {
          await prisma.gapDetectionRun.update({
            where: { id: run.id },
            data: { status: "failed", completedAt: new Date() },
          });
        }
      }

      // Auto-prune: keep last 5 completed + 3 failed per territory
      const prunedIds = targetTerritories.map((t) => t.id);
      for (const tid of prunedIds) {
        for (const status of ["completed", "failed"] as const) {
          const keep = status === "completed" ? 5 : 3;
          const runs = await prisma.gapDetectionRun.findMany({
            where: { territoryId: tid, status },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          if (runs.length > keep) {
            const toDelete = runs.slice(keep).map((r) => r.id);
            await prisma.gapDetectionRun.deleteMany({
              where: { id: { in: toDelete } },
            });
          }
        }
      }

      return runResults;
    },
  );

  // ─── List runs (recent) ─────────────────────────────────────────
  app.get(
    "/territories/gap-detection/runs",
    {
      preHandler: requirePermission(PERMISSIONS.GAP_DETECTION_VIEW),
    },
    async () => {
      return prisma.gapDetectionRun.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          territory: { select: { id: true, number: true, name: true } },
        },
      });
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
