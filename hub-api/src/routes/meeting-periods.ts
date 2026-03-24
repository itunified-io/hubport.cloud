/**
 * Meeting period lifecycle routes — open, publish, lock, reopen.
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { audit } from "../lib/policy-engine.js";
import prisma from "../lib/prisma.js";
import { decrypt } from "../lib/crypto.js";
import { getEncryptionKey } from "../lib/vault-client.js";

const IdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});

type IdParamsType = Static<typeof IdParams>;

export async function meetingPeriodRoutes(app: FastifyInstance): Promise<void> {
  // List meeting periods
  app.get(
    "/meeting-periods",
    { preHandler: requirePermission(PERMISSIONS.MEETING_PERIODS_VIEW) },
    async (request) => {
      const { type, status } = request.query as { type?: string; status?: string };
      const where: Record<string, unknown> = {};
      if (type) where.type = type;
      if (status) where.status = status;

      return prisma.meetingPeriod.findMany({
        where,
        include: {
          meetings: {
            orderBy: { date: "asc" },
            select: { id: true, title: true, date: true, type: true, status: true },
          },
        },
        orderBy: { startDate: "desc" },
      });
    },
  );

  // Get single meeting period with full details
  app.get<{ Params: IdParamsType }>(
    "/meeting-periods/:id",
    {
      preHandler: requirePermission(PERMISSIONS.MEETING_PERIODS_VIEW),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const period = await prisma.meetingPeriod.findUnique({
        where: { id: request.params.id },
        include: {
          meetings: {
            orderBy: { date: "asc" },
            include: {
              workbookWeek: {
                include: { parts: { orderBy: { sortOrder: "asc" } } },
              },
              assignments: {
                include: {
                  slotTemplate: true,
                  workbookPart: true,
                  assignee: { select: { id: true, firstName: true, lastName: true, displayName: true } },
                  assistant: { select: { id: true, firstName: true, lastName: true, displayName: true } },
                },
                orderBy: { slotTemplate: { sortOrder: "asc" } },
              },
            },
          },
        },
      });
      if (!period) {
        return reply.code(404).send({ error: "Period not found" });
      }

      // Decrypt nested Publisher fields (assignee/assistant) — the encryption
      // extension only handles top-level Publisher queries, not nested includes
      await decryptNestedPublishers(period);

      return period;
    },
  );

  // Publish a meeting period (all draft meetings → published)
  app.post<{ Params: IdParamsType }>(
    "/meeting-periods/:id/publish",
    {
      preHandler: requirePermission(PERMISSIONS.MEETINGS_PUBLISH),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const period = await prisma.meetingPeriod.findUnique({
        where: { id: request.params.id },
      });
      if (!period) {
        return reply.code(404).send({ error: "Period not found" });
      }
      if (period.status !== "open" && period.status !== "draft") {
        return reply.code(409).send({
          error: `Cannot publish from status '${period.status}'`,
        });
      }

      const actorId = request.user?.sub ?? "unknown";
      const now = new Date();

      await prisma.$transaction([
        prisma.meetingPeriod.update({
          where: { id: period.id },
          data: {
            status: "published",
            publishedBy: actorId,
            publishedAt: now,
          },
        }),
        prisma.meeting.updateMany({
          where: { meetingPeriodId: period.id, status: "draft" },
          data: { status: "published", publishedBy: actorId, publishedAt: now },
        }),
      ]);

      await audit("meeting_period.publish", actorId, "MeetingPeriod", period.id);
      return { success: true, status: "published" };
    },
  );

  // Lock a meeting period
  app.post<{ Params: IdParamsType }>(
    "/meeting-periods/:id/lock",
    {
      preHandler: requirePermission(PERMISSIONS.MEETING_PERIODS_MANAGE),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const period = await prisma.meetingPeriod.findUnique({
        where: { id: request.params.id },
      });
      if (!period) {
        return reply.code(404).send({ error: "Period not found" });
      }
      if (period.status !== "published") {
        return reply.code(409).send({
          error: `Cannot lock from status '${period.status}' — must be published first`,
        });
      }

      const actorId = request.user?.sub ?? "unknown";
      const now = new Date();

      await prisma.$transaction([
        prisma.meetingPeriod.update({
          where: { id: period.id },
          data: { status: "locked", lockedBy: actorId, lockedAt: now },
        }),
        prisma.meeting.updateMany({
          where: { meetingPeriodId: period.id },
          data: { status: "locked" },
        }),
      ]);

      await audit("meeting_period.lock", actorId, "MeetingPeriod", period.id);
      return { success: true, status: "locked" };
    },
  );

  // Reopen a published/locked period (back to open)
  app.post<{ Params: IdParamsType }>(
    "/meeting-periods/:id/reopen",
    {
      preHandler: requirePermission(PERMISSIONS.MEETING_PERIODS_MANAGE),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const period = await prisma.meetingPeriod.findUnique({
        where: { id: request.params.id },
      });
      if (!period) {
        return reply.code(404).send({ error: "Period not found" });
      }
      if (period.status !== "published" && period.status !== "locked") {
        return reply.code(409).send({
          error: `Cannot reopen from status '${period.status}'`,
        });
      }

      const actorId = request.user?.sub ?? "unknown";

      await prisma.$transaction([
        prisma.meetingPeriod.update({
          where: { id: period.id },
          data: { status: "open" },
        }),
        prisma.meeting.updateMany({
          where: { meetingPeriodId: period.id },
          data: { status: "draft" },
        }),
      ]);

      await audit("meeting_period.reopen", actorId, "MeetingPeriod", period.id);
      return { success: true, status: "open" };
    },
  );

  // Delete a period (admin only — for cleanup of orphans/duplicates)
  app.delete<{ Params: IdParamsType }>(
    "/meeting-periods/:id",
    {
      preHandler: requirePermission(PERMISSIONS.WILDCARD),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const period = await prisma.meetingPeriod.findUnique({
        where: { id: request.params.id },
        include: { meetings: { select: { id: true } } },
      });
      if (!period) {
        return reply.code(404).send({ error: "Period not found" });
      }

      const actorId = request.user?.sub ?? "unknown";

      // Unlink meetings from this period (don't delete the meetings themselves)
      await prisma.meeting.updateMany({
        where: { meetingPeriodId: period.id },
        data: { meetingPeriodId: null },
      });

      await prisma.meetingPeriod.delete({ where: { id: period.id } });
      await audit("meeting_period.delete", actorId, "MeetingPeriod", period.id);
      return reply.code(204).send();
    },
  );

  // Cleanup: remove duplicate/empty periods
  app.post(
    "/meeting-periods/cleanup",
    { preHandler: requirePermission(PERMISSIONS.WILDCARD) },
    async (request) => {
      const actorId = request.user?.sub ?? "unknown";

      // Find periods with 0 meetings that have a duplicate (same sourceEditionId with meetings)
      const allPeriods = await prisma.meetingPeriod.findMany({
        include: { _count: { select: { meetings: true } } },
      });

      let removed = 0;
      const editionGroups = new Map<string, typeof allPeriods>();
      for (const p of allPeriods) {
        const key = p.sourceEditionId ?? p.id;
        if (!editionGroups.has(key)) editionGroups.set(key, []);
        editionGroups.get(key)!.push(p);
      }

      for (const [, group] of editionGroups) {
        if (group.length <= 1) continue;
        // Keep the one with the most meetings, delete the rest
        group.sort((a, b) => b._count.meetings - a._count.meetings);
        for (let i = 1; i < group.length; i++) {
          await prisma.meeting.updateMany({
            where: { meetingPeriodId: group[i].id },
            data: { meetingPeriodId: group[0].id },
          });
          await prisma.meetingPeriod.delete({ where: { id: group[i].id } });
          await audit("meeting_period.cleanup", actorId, "MeetingPeriod", group[i].id);
          removed++;
        }
      }

      return { cleaned: removed };
    },
  );
}

/* ---- Helpers ---- */

const PUBLISHER_ENCRYPTED_FIELDS = ["firstName", "lastName", "displayName", "email", "phone"];

/**
 * Decrypt Publisher PII fields in nested meeting period data.
 * The Prisma encryption extension only handles top-level Publisher queries;
 * nested includes (assignee/assistant inside assignments) bypass it.
 */
async function decryptNestedPublishers(period: Record<string, unknown>): Promise<void> {
  let key: Buffer | null = null;

  const meetings = period.meetings as Array<Record<string, unknown>> | undefined;
  if (!meetings) return;

  for (const meeting of meetings) {
    const assignments = meeting.assignments as Array<Record<string, unknown>> | undefined;
    if (!assignments) continue;

    for (const assignment of assignments) {
      for (const field of ["assignee", "assistant"] as const) {
        const pub = assignment[field] as Record<string, unknown> | null;
        if (!pub) continue;

        for (const pf of PUBLISHER_ENCRYPTED_FIELDS) {
          const val = pub[pf];
          if (typeof val === "string" && val.includes(":")) {
            try {
              if (!key) key = await getEncryptionKey();
              pub[pf] = decrypt(val, key);
            } catch {
              // Legacy unencrypted or non-matching pattern — leave as-is
            }
          }
        }
      }
    }
  }
}
