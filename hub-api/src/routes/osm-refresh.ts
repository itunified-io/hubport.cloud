/**
 * OSM Refresh routes — queue and monitor OSM address refresh jobs.
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { osmRefreshQueue, isRedisAvailable } from "../lib/bull.js";
import { bboxFromGeoJSON, isInsideBoundaries } from "../lib/geo.js";
import { queryBuildingsInBBox, type OverpassBuilding } from "../lib/osm-overpass.js";

// ─── Schemas ────────────────────────────────────────────────────────

const TerritoryIdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});
type TerritoryIdParamsType = Static<typeof TerritoryIdParams>;

const BulkRefreshBody = Type.Object({
  territoryIds: Type.Array(Type.String({ format: "uuid" }), { minItems: 1, maxItems: 50 }),
});
type BulkRefreshBodyType = Static<typeof BulkRefreshBody>;

/** Cooldown period — 5 minutes between refreshes for the same territory. */
const COOLDOWN_MS = 5 * 60 * 1000;

export async function osmRefreshRoutes(app: FastifyInstance): Promise<void> {
  // ─── Trigger OSM refresh for a territory ─────────────────────────
  app.post<{ Params: TerritoryIdParamsType }>(
    "/territories/:id/osm-refresh",
    {
      preHandler: requirePermission(PERMISSIONS.OSM_REFRESH),
      schema: { params: TerritoryIdParams },
    },
    async (request, reply) => {
      // Check Redis availability
      if (!isRedisAvailable() || !osmRefreshQueue) {
        return reply.code(503).send({
          error: "Service Unavailable",
          message: "Background job queue is not available. Redis may be down.",
        });
      }

      const territory = await prisma.territory.findUnique({
        where: { id: request.params.id },
      });
      if (!territory) {
        return reply.code(404).send({ error: "Territory not found" });
      }

      if (!territory.boundaries) {
        return reply.code(400).send({
          error: "Bad Request",
          message: "Territory has no boundaries. Draw boundaries first.",
        });
      }

      // Cooldown check
      const recentJob = await prisma.osmRefreshQueue.findFirst({
        where: {
          territoryId: request.params.id,
          createdAt: { gte: new Date(Date.now() - COOLDOWN_MS) },
        },
        orderBy: { createdAt: "desc" },
      });

      if (recentJob) {
        return reply.code(429).send({
          error: "Too Many Requests",
          message: "Please wait 5 minutes between refresh requests for the same territory.",
          retryAfter: Math.ceil((COOLDOWN_MS - (Date.now() - recentJob.createdAt.getTime())) / 1000),
        });
      }

      // Duplicate check — pending or processing
      const activeJob = await prisma.osmRefreshQueue.findFirst({
        where: {
          territoryId: request.params.id,
          status: { in: ["pending", "processing"] },
        },
      });

      if (activeJob) {
        return reply.code(409).send({
          error: "Conflict",
          message: "An OSM refresh is already queued or in progress for this territory.",
          jobId: activeJob.id,
        });
      }

      // Create queue record and enqueue job
      const queueRecord = await prisma.osmRefreshQueue.create({
        data: {
          territoryId: request.params.id,
          status: "pending",
        },
      });

      await osmRefreshQueue.add("osm-refresh", {
        territoryId: request.params.id,
        queueRecordId: queueRecord.id,
      });

      return reply.code(202).send(queueRecord);
    },
  );

  // ─── Bulk OSM refresh ────────────────────────────────────────────
  app.post<{ Body: BulkRefreshBodyType }>(
    "/territories/osm-refresh/bulk",
    {
      preHandler: requirePermission(PERMISSIONS.OSM_REFRESH),
      schema: { body: BulkRefreshBody },
    },
    async (request, reply) => {
      if (!isRedisAvailable() || !osmRefreshQueue) {
        return reply.code(503).send({
          error: "Service Unavailable",
          message: "Background job queue is not available. Redis may be down.",
        });
      }

      const results: { territoryId: string; status: string; jobId?: string; reason?: string }[] = [];

      for (const territoryId of request.body.territoryIds) {
        const territory = await prisma.territory.findUnique({
          where: { id: territoryId },
        });

        if (!territory) {
          results.push({ territoryId, status: "skipped", reason: "Territory not found" });
          continue;
        }

        if (!territory.boundaries) {
          results.push({ territoryId, status: "skipped", reason: "No boundaries" });
          continue;
        }

        // Check active job
        const activeJob = await prisma.osmRefreshQueue.findFirst({
          where: {
            territoryId,
            status: { in: ["pending", "processing"] },
          },
        });

        if (activeJob) {
          results.push({ territoryId, status: "skipped", reason: "Already queued", jobId: activeJob.id });
          continue;
        }

        // Cooldown check
        const recentJob = await prisma.osmRefreshQueue.findFirst({
          where: {
            territoryId,
            createdAt: { gte: new Date(Date.now() - COOLDOWN_MS) },
          },
          orderBy: { createdAt: "desc" },
        });

        if (recentJob) {
          results.push({ territoryId, status: "skipped", reason: "Cooldown active" });
          continue;
        }

        const queueRecord = await prisma.osmRefreshQueue.create({
          data: { territoryId, status: "pending" },
        });

        await osmRefreshQueue.add("osm-refresh", {
          territoryId,
          queueRecordId: queueRecord.id,
        });

        results.push({ territoryId, status: "queued", jobId: queueRecord.id });
      }

      return reply.code(202).send({ results });
    },
  );

  // ─── Get queue status (last 50 jobs) ─────────────────────────────
  app.get(
    "/territories/osm-refresh/queue",
    {
      preHandler: requirePermission(PERMISSIONS.OSM_REFRESH),
    },
    async () => {
      return prisma.osmRefreshQueue.findMany({
        take: 50,
        orderBy: { createdAt: "desc" },
        include: {
          territory: { select: { id: true, number: true, name: true } },
        },
      });
    },
  );

  // ─── Populate addresses from OSM (congregation-level) ────────────
  //
  // Single Overpass query for the congregation boundary, then
  // point-in-polygon distribution to individual territories.
  // Runs inline (no Redis/BullMQ required).
  //
  app.post(
    "/territories/osm-populate",
    {
      preHandler: requirePermission(PERMISSIONS.OSM_REFRESH),
    },
    async (request, reply) => {
      // 1. Find congregation boundary
      const allTerritories = await prisma.territory.findMany({
        select: { id: true, number: true, name: true, boundaries: true, type: true },
      });

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
        return reply.code(400).send({ error: "Could not compute bounding box from congregation boundary." });
      }

      const territories = allTerritories.filter(
        (t) => t.type === "territory" && t.boundaries,
      );

      // 2. Single Overpass query for entire congregation area
      const allBuildings = await queryBuildingsInBBox(bbox.south, bbox.west, bbox.north, bbox.east);

      // 3. Filter to buildings inside congregation polygon with addresses
      const addressableBuildings = allBuildings.filter(
        (b: OverpassBuilding) =>
          b.hasAddress && isInsideBoundaries(b.lat, b.lng, congBoundary.boundaries),
      );

      // 4. Load all existing addresses by osmId for dedup
      const existingAddresses = await prisma.address.findMany({
        where: { osmId: { not: null } },
        select: { id: true, osmId: true, territoryId: true, street: true, houseNumber: true },
      });
      const existingByOsmId = new Map(
        existingAddresses.filter((a) => a.osmId).map((a) => [a.osmId!, a]),
      );

      let addressesCreated = 0;
      let addressesUpdated = 0;
      let unassigned = 0;
      const territoriesAffected = new Set<string>();

      // 5. Assign each building to its territory via point-in-polygon
      for (const building of addressableBuildings) {
        const territory = territories.find((t) =>
          isInsideBoundaries(building.lat, building.lng, t.boundaries),
        );

        if (!territory) {
          unassigned++;
          continue;
        }

        territoriesAffected.add(territory.id);
        const existing = existingByOsmId.get(building.osmId);

        if (existing) {
          // Update if street/houseNumber changed or territory assignment changed
          if (
            existing.street !== building.street ||
            existing.houseNumber !== building.houseNumber ||
            existing.territoryId !== territory.id
          ) {
            await prisma.address.update({
              where: { id: existing.id },
              data: {
                territoryId: territory.id,
                street: building.street,
                houseNumber: building.houseNumber,
                lat: building.lat,
                lng: building.lng,
                buildingType: building.buildingType,
              },
            });
            addressesUpdated++;
          }
        } else {
          // Create new address
          await prisma.address.create({
            data: {
              territoryId: territory.id,
              osmId: building.osmId,
              lat: building.lat,
              lng: building.lng,
              street: building.street,
              houseNumber: building.houseNumber,
              buildingType: building.buildingType,
              source: "osm",
            },
          });
          addressesCreated++;
        }
      }

      return {
        totalBuildings: allBuildings.length,
        addressableBuildings: addressableBuildings.length,
        territoriesProcessed: territoriesAffected.size,
        addressesCreated,
        addressesUpdated,
        unassigned,
      };
    },
  );
}
