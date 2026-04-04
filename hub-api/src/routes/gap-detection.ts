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
import {
  checkBuildingCoveragePostGIS,
  checkCongregationContainsPostGIS,
} from "../lib/postgis-helpers.js";
import { ALLOWED_BUILDING_TYPES } from "../lib/gap-analysis.js";

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

const TRIAGE_STATUSES = ["unreviewed", "confirmed_residential", "ignored", "needs_visit"] as const;

const OverrideBody = Type.Object({
  overriddenType: Type.Optional(Type.String()),
  overriddenAddress: Type.Optional(Type.String()),
  triageStatus: Type.Optional(Type.Union(TRIAGE_STATUSES.map(s => Type.Literal(s)))),
  notes: Type.Optional(Type.String()),
});
type OverrideBodyType = Static<typeof OverrideBody>;

const OverrideOsmIdParams = Type.Object({
  osmId: Type.String(),
});
type OverrideOsmIdParamsType = Static<typeof OverrideOsmIdParams>;

const BatchOverrideBody = Type.Object({
  overrides: Type.Array(
    Type.Object({
      osmId: Type.String(),
      overriddenType: Type.Optional(Type.String()),
      overriddenAddress: Type.Optional(Type.String()),
      triageStatus: Type.Optional(Type.Union(TRIAGE_STATUSES.map(s => Type.Literal(s)))),
      notes: Type.Optional(Type.String()),
    }),
    { minItems: 1, maxItems: 200 },
  ),
});
type BatchOverrideBodyType = Static<typeof BatchOverrideBody>;

const OverrideQuerystring = Type.Object({
  triageStatus: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 1000 })),
  offset: Type.Optional(Type.Number({ minimum: 0 })),
});
type OverrideQuerystringType = Static<typeof OverrideQuerystring>;

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

        // Filter to buildings inside the congregation boundary.
        // Use PostGIS ST_Contains for accuracy (handles holes, complex geometries).
        // Falls back to JS ray-casting if PostGIS is unavailable.
        let buildingsInCongregation: OverpassBuilding[];
        try {
          const congSet = await checkCongregationContainsPostGIS(
            prisma,
            allBuildings.map((b) => ({ osmId: b.osmId, lat: b.lat, lng: b.lng })),
            congBoundary.boundaries as object,
          );
          buildingsInCongregation = allBuildings.filter((b) => congSet.has(b.osmId));
        } catch {
          // PostGIS fallback
          buildingsInCongregation = allBuildings.filter((b) =>
            isInsideBoundaries(b.lat, b.lng, congBoundary.boundaries),
          );
        }

        // Load ignored buildings
        const ignoredBuildings = await prisma.ignoredOsmBuilding.findMany({
          select: { osmId: true },
        });
        const ignoredOsmIds = new Set(ignoredBuildings.map((b) => b.osmId));

        // Check which buildings fall inside ANY territory polygon.
        // Use PostGIS ST_Contains for accurate results with complex geometries
        // (holes from water clipping, auto-fix artifacts, etc.).
        const nonIgnored = buildingsInCongregation.filter((b) => !ignoredOsmIds.has(b.osmId));
        const gaps: OverpassBuilding[] = [];
        const covered: OverpassBuilding[] = [];

        // Count ignored as covered
        const ignoredCount = buildingsInCongregation.length - nonIgnored.length;

        try {
          const coveredSet = await checkBuildingCoveragePostGIS(
            prisma,
            nonIgnored.map((b) => ({ osmId: b.osmId, lat: b.lat, lng: b.lng })),
          );
          for (const building of nonIgnored) {
            if (coveredSet.has(building.osmId)) {
              covered.push(building);
            } else {
              gaps.push(building);
            }
          }
        } catch {
          // PostGIS fallback — use JS ray-casting
          const territories = allTerritories.filter(
            (t) => t.type === "territory" && t.boundaries,
          );
          for (const building of nonIgnored) {
            const inAnyTerritory = territories.some((t) =>
              isInsideBoundaries(building.lat, building.lng, t.boundaries),
            );
            if (inAnyTerritory) {
              covered.push(building);
            } else {
              gaps.push(building);
            }
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
            coveredCount: covered.length + ignoredCount,
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

  // ─── List building overrides ────────────────────────────────────
  app.get<{ Querystring: OverrideQuerystringType }>(
    "/territories/gap-detection/overrides",
    {
      preHandler: requirePermission(PERMISSIONS.GAP_DETECTION_VIEW),
      schema: { querystring: OverrideQuerystring },
    },
    async (request) => {
      const { triageStatus, limit = 200, offset = 0 } = request.query;
      const where = triageStatus ? { triageStatus } : {};

      const [overrides, total] = await Promise.all([
        prisma.buildingOverride.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.buildingOverride.count({ where }),
      ]);

      return { overrides, total };
    },
  );

  // ─── Create/update building override ────────────────────────────
  app.put<{ Params: OverrideOsmIdParamsType; Body: OverrideBodyType }>(
    "/territories/gap-detection/overrides/:osmId",
    {
      preHandler: requirePermission(PERMISSIONS.GAP_DETECTION_RUN),
      schema: { params: OverrideOsmIdParams, body: OverrideBody },
    },
    async (request, reply) => {
      const osmId = decodeURIComponent(request.params.osmId);
      const { overriddenType, overriddenAddress, triageStatus, notes } = request.body;
      const publisherId = request.user?.sub ?? "system";

      // Validate building type if provided
      if (overriddenType && !ALLOWED_BUILDING_TYPES.has(overriddenType)) {
        return reply.code(400).send({ error: `Invalid building type: ${overriddenType}` });
      }

      const override = await prisma.buildingOverride.upsert({
        where: { osmId },
        create: {
          osmId,
          overriddenType: overriddenType ?? null,
          overriddenAddress: overriddenAddress ?? null,
          triageStatus: triageStatus ?? "unreviewed",
          notes: notes ?? null,
          reviewedBy: publisherId,
          reviewedAt: new Date(),
        },
        update: {
          ...(overriddenType !== undefined && { overriddenType }),
          ...(overriddenAddress !== undefined && { overriddenAddress }),
          ...(triageStatus !== undefined && { triageStatus }),
          ...(notes !== undefined && { notes }),
          reviewedBy: publisherId,
          reviewedAt: new Date(),
        },
      });

      return override;
    },
  );

  // ─── Batch triage overrides ─────────────────────────────────────
  app.post<{ Body: BatchOverrideBodyType }>(
    "/territories/gap-detection/overrides/batch",
    {
      preHandler: requirePermission(PERMISSIONS.GAP_DETECTION_RUN),
      schema: { body: BatchOverrideBody },
    },
    async (request, reply) => {
      const publisherId = request.user?.sub ?? "system";

      // Validate all building types
      for (const item of request.body.overrides) {
        if (item.overriddenType && !ALLOWED_BUILDING_TYPES.has(item.overriddenType)) {
          return reply.code(400).send({ error: `Invalid building type: ${item.overriddenType}` });
        }
      }

      // Deduplicate: last entry wins
      const deduped = new Map<string, typeof request.body.overrides[0]>();
      for (const item of request.body.overrides) {
        deduped.set(item.osmId, item);
      }

      const results = await prisma.$transaction(
        Array.from(deduped.values()).map((item) =>
          prisma.buildingOverride.upsert({
            where: { osmId: item.osmId },
            create: {
              osmId: item.osmId,
              overriddenType: item.overriddenType ?? null,
              overriddenAddress: item.overriddenAddress ?? null,
              triageStatus: item.triageStatus ?? "unreviewed",
              notes: item.notes ?? null,
              reviewedBy: publisherId,
              reviewedAt: new Date(),
            },
            update: {
              ...(item.overriddenType !== undefined && { overriddenType: item.overriddenType }),
              ...(item.overriddenAddress !== undefined && { overriddenAddress: item.overriddenAddress }),
              ...(item.triageStatus !== undefined && { triageStatus: item.triageStatus }),
              ...(item.notes !== undefined && { notes: item.notes }),
              reviewedBy: publisherId,
              reviewedAt: new Date(),
            },
          }),
        ),
      );

      return { updated: results.length };
    },
  );

  // ─── Delete building override ───────────────────────────────────
  app.delete<{ Params: OverrideOsmIdParamsType }>(
    "/territories/gap-detection/overrides/:osmId",
    {
      preHandler: requirePermission(PERMISSIONS.GAP_DETECTION_RUN),
      schema: { params: OverrideOsmIdParams },
    },
    async (request, reply) => {
      const osmId = decodeURIComponent(request.params.osmId);

      // Idempotent: 204 whether override exists or not
      await prisma.buildingOverride.deleteMany({ where: { osmId } });
      return reply.code(204).send();
    },
  );
}
