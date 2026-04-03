/**
 * Gap detection routes — find buildings inside the congregation boundary
 * (branch territory assignment) that are NOT covered by any territory.
 *
 * Algorithm:
 * 1. Get congregation boundary polygon
 * 2. Single Overpass query for all buildings in that bbox
 * 3. Filter to buildings actually inside the congregation boundary polygon
 * 4. For each building, check if it falls inside ANY territory polygon
 * 5. Buildings in the congregation area but outside all territories = gaps
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { queryBuildingsInBBox, type OverpassBuilding } from "../lib/osm-overpass.js";
import { bboxFromGeoJSON, isInsideBoundaries } from "../lib/geo.js";

// ─── Schemas ────────────────────────────────────────────────────────

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

const RunIdParams = Type.Object({
  runId: Type.String({ format: "uuid" }),
});
type RunIdParamsType = Static<typeof RunIdParams>;

const OsmIdParams = Type.Object({
  osmId: Type.String(),
});
type OsmIdParamsType = Static<typeof OsmIdParams>;

export async function gapDetectionRoutes(app: FastifyInstance): Promise<void> {
  // ─── Run gap detection ───────────────────────────────────────────
  //
  // Find buildings inside the congregation boundary that are NOT
  // covered by any territory polygon. Single Overpass query, then
  // point-in-polygon distribution.
  //
  app.post(
    "/territories/gap-detection/run",
    {
      preHandler: requirePermission(PERMISSIONS.GAP_DETECTION_RUN),
    },
    async (request, reply) => {
      const publisherId = request.user?.sub ?? "system";

      // Load all territories
      const allTerritories = await prisma.territory.findMany({
        select: { id: true, number: true, boundaries: true, type: true },
      });

      // Find congregation boundary (= branch territory assignment)
      const congBoundary = allTerritories.find(
        (t) => t.type === "congregation_boundary" && t.boundaries,
      );

      if (!congBoundary) {
        return reply.code(400).send({
          error: "No congregation boundary found. Import a branch territory assignment (KML) first.",
        });
      }

      const bbox = bboxFromGeoJSON(congBoundary.boundaries);
      if (!bbox) {
        return reply.code(400).send({ error: "Could not compute bounding box from congregation boundary" });
      }

      // Get all regular territories with boundaries
      const territories = allTerritories.filter(
        (t) => t.type === "territory" && t.boundaries,
      );

      // Create run record (linked to congregation boundary territory)
      const run = await prisma.gapDetectionRun.create({
        data: {
          territoryId: congBoundary.id,
          status: "running",
          startedAt: new Date(),
          runBy: publisherId,
        },
      });

      try {
        // Single Overpass query for the entire congregation area
        const allBuildings = await queryBuildingsInBBox(bbox.south, bbox.west, bbox.north, bbox.east);

        // Filter to buildings actually inside the congregation boundary polygon
        const buildingsInCongregation = allBuildings.filter((b) =>
          isInsideBoundaries(b.lat, b.lng, congBoundary.boundaries),
        );

        // Load ignored buildings
        const ignoredBuildings = await prisma.ignoredOsmBuilding.findMany({
          select: { osmId: true },
        });
        const ignoredOsmIds = new Set(ignoredBuildings.map((b) => b.osmId));

        // For each building, check if it falls inside ANY territory
        const gaps: OverpassBuilding[] = [];
        const covered: OverpassBuilding[] = [];

        for (const building of buildingsInCongregation) {
          // Skip ignored buildings
          if (ignoredOsmIds.has(building.osmId)) {
            covered.push(building); // count as covered
            continue;
          }

          const inAnyTerritory = territories.some((t) =>
            isInsideBoundaries(building.lat, building.lng, t.boundaries),
          );

          if (inAnyTerritory) {
            covered.push(building);
          } else {
            gaps.push(building);
          }
        }

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
            totalBuildings: buildingsInCongregation.length,
            coveredCount: covered.length,
            gapCount: gaps.length,
            resultGeoJson,
          },
        });

        const updatedRun = await prisma.gapDetectionRun.findUnique({
          where: { id: run.id },
          include: { territory: { select: { id: true, number: true, name: true } } },
        });

        return updatedRun;
      } catch (err) {
        await prisma.gapDetectionRun.update({
          where: { id: run.id },
          data: {
            status: "failed",
            completedAt: new Date(),
          },
        });

        return reply.code(502).send({
          error: err instanceof Error ? err.message : "Overpass API failed",
        });
      }
    },
  );

  // ─── List runs (recent) ─────────────────────────────────────────
  // Filters ignored buildings from resultGeoJson so the frontend
  // always receives an up-to-date feature set without re-running detection.
  app.get(
    "/territories/gap-detection/runs",
    {
      preHandler: requirePermission(PERMISSIONS.GAP_DETECTION_VIEW),
    },
    async () => {
      const [runs, ignoredRows] = await Promise.all([
        prisma.gapDetectionRun.findMany({
          orderBy: { createdAt: "desc" },
          take: 20,
          include: {
            territory: { select: { id: true, number: true, name: true } },
          },
        }),
        prisma.ignoredOsmBuilding.findMany({ select: { osmId: true } }),
      ]);

      if (ignoredRows.length === 0) return runs;

      const ignoredSet = new Set(ignoredRows.map((r) => r.osmId));

      return runs.map((run) => {
        const geo = run.resultGeoJson as {
          type: string;
          features: Array<{ properties: Record<string, unknown>; [k: string]: unknown }>;
        } | null;
        if (!geo?.features) return run;

        const filtered = geo.features.filter(
          (f) => !ignoredSet.has(f.properties?.osmId as string),
        );

        return {
          ...run,
          resultGeoJson: { ...geo, features: filtered },
          gapCount: filtered.length,
        };
      });
    },
  );

  // ─── Delete a run ───────────────────────────────────────────────
  app.delete<{ Params: RunIdParamsType }>(
    "/territories/gap-detection/runs/:runId",
    {
      preHandler: requirePermission(PERMISSIONS.GAP_DETECTION_RUN),
      schema: { params: RunIdParams },
    },
    async (request, reply) => {
      const { runId } = request.params;

      const run = await prisma.gapDetectionRun.findUnique({ where: { id: runId } });
      if (!run) {
        return reply.code(404).send({ error: "Run not found" });
      }

      await prisma.gapDetectionRun.delete({ where: { id: runId } });
      return reply.code(204).send();
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
}
