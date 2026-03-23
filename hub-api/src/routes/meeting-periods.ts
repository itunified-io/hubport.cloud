/**
 * Meeting period lifecycle routes — open, publish, lock, reopen.
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { audit } from "../lib/policy-engine.js";
import prisma from "../lib/prisma.js";

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
}
