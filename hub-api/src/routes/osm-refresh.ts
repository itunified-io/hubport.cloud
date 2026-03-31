/**
 * OSM Refresh routes — queue and monitor OSM address refresh jobs.
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { osmRefreshQueue, isRedisAvailable } from "../lib/bull.js";

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
}
