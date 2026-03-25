/**
 * Meeting CRUD routes — extended with planning-aware behavior.
 * Migrated from legacy requireRole() to permission-based guards.
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";

const MeetingBody = Type.Object({
  title: Type.String({ minLength: 1 }),
  type: Type.Union([
    Type.Literal("midweek"),
    Type.Literal("weekend"),
    Type.Literal("special"),
  ]),
  date: Type.String({ format: "date-time" }),
  startTime: Type.String({ pattern: "^\\d{2}:\\d{2}$" }),
  endTime: Type.Optional(Type.String({ pattern: "^\\d{2}:\\d{2}$" })),
  location: Type.Optional(Type.String()),
  notes: Type.Optional(Type.String()),
});

type MeetingBodyType = Static<typeof MeetingBody>;

const IdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});

type IdParamsType = Static<typeof IdParams>;

export async function meetingRoutes(app: FastifyInstance): Promise<void> {
  // List upcoming meetings — all users with meetings.view
  app.get(
    "/meetings",
    { preHandler: requirePermission(PERMISSIONS.MEETINGS_VIEW) },
    async (request) => {
      const { type, past } = request.query as { type?: string; past?: string };
      const where: Record<string, unknown> = {};
      if (type) where.type = type;
      if (past !== "true") {
        where.date = { gte: new Date() };
      }

      return prisma.meeting.findMany({
        where,
        include: {
          workbookWeek: { select: { theme: true, dateRange: true } },
          weekendStudyWeek: { select: { articleTitle: true } },
          _count: { select: { assignments: true } },
        },
        orderBy: { date: "asc" },
      });
    },
  );

  // Get one meeting with full assignment details
  app.get<{ Params: IdParamsType }>(
    "/meetings/:id",
    {
      preHandler: requirePermission(PERMISSIONS.MEETINGS_VIEW),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const meeting = await prisma.meeting.findUnique({
        where: { id: request.params.id },
        include: {
          workbookWeek: {
            include: { parts: { orderBy: { sortOrder: "asc" } } },
          },
          weekendStudyWeek: true,
          meetingPeriod: { select: { id: true, status: true, type: true } },
          assignments: {
            include: {
              slotTemplate: true,
              workbookPart: true,
              assignee: { select: { id: true, firstName: true, lastName: true, displayName: true } },
              assistant: { select: { id: true, firstName: true, lastName: true, displayName: true } },
            },
            orderBy: { slotTemplate: { sortOrder: "asc" } },
          },
          talkSchedules: {
            include: {
              speaker: true,
              publicTalk: true,
            },
          },
        },
      });
      if (!meeting) {
        return reply.code(404).send({ error: "Not found" });
      }
      return meeting;
    },
  );

  // Create meeting — meetings.edit permission
  app.post<{ Body: MeetingBodyType }>(
    "/meetings",
    {
      preHandler: requirePermission(PERMISSIONS.MEETINGS_EDIT),
      schema: { body: MeetingBody },
    },
    async (request, reply) => {
      const meeting = await prisma.meeting.create({
        data: {
          ...request.body,
          date: new Date(request.body.date),
          status: "draft",
        },
      });
      return reply.code(201).send(meeting);
    },
  );

  // Update meeting — meetings.edit permission
  app.put<{ Params: IdParamsType; Body: MeetingBodyType }>(
    "/meetings/:id",
    {
      preHandler: requirePermission(PERMISSIONS.MEETINGS_EDIT),
      schema: { params: IdParams, body: MeetingBody },
    },
    async (request, reply) => {
      const existing = await prisma.meeting.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Not found" });
      }
      if (existing.status === "locked") {
        return reply.code(409).send({ error: "Meeting is locked — cannot edit" });
      }
      const meeting = await prisma.meeting.update({
        where: { id: request.params.id },
        data: {
          ...request.body,
          date: new Date(request.body.date),
        },
      });
      return meeting;
    },
  );

  // Delete meeting — admin only (wildcard permission)
  app.delete<{ Params: IdParamsType }>(
    "/meetings/:id",
    {
      preHandler: requirePermission(PERMISSIONS.WILDCARD),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const existing = await prisma.meeting.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Not found" });
      }
      if (existing.status === "locked") {
        return reply.code(409).send({ error: "Meeting is locked — cannot delete" });
      }
      await prisma.meeting.delete({
        where: { id: request.params.id },
      });
      return reply.code(204).send();
    },
  );

  // Get assignments for a meeting
  app.get<{ Params: IdParamsType }>(
    "/meetings/:id/assignments",
    {
      preHandler: requirePermission(PERMISSIONS.MEETING_ASSIGNMENTS_VIEW),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const meeting = await prisma.meeting.findUnique({
        where: { id: request.params.id },
      });
      if (!meeting) {
        return reply.code(404).send({ error: "Meeting not found" });
      }

      return prisma.meetingAssignment.findMany({
        where: { meetingId: request.params.id },
        include: {
          slotTemplate: true,
          workbookPart: true,
          assignee: { select: { id: true, firstName: true, lastName: true, displayName: true } },
          assistant: { select: { id: true, firstName: true, lastName: true, displayName: true } },
        },
        orderBy: { slotTemplate: { sortOrder: "asc" } },
      });
    },
  );

  // Seed assignment slots for a meeting from slot templates
  app.post<{ Params: IdParamsType }>(
    "/meetings/:id/seed-slots",
    {
      preHandler: requirePermission(PERMISSIONS.MEETING_ASSIGNMENTS_EDIT),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const meeting = await prisma.meeting.findUnique({
        where: { id: request.params.id },
      });
      if (!meeting) {
        return reply.code(404).send({ error: "Meeting not found" });
      }

      // Get applicable slot templates
      const templates = await prisma.meetingSlotTemplate.findMany({
        where: {
          meetingType: { in: [meeting.type, "all"] },
          isActive: true,
        },
        orderBy: { sortOrder: "asc" },
      });

      // Check which slots already exist
      const existingSlots = await prisma.meetingAssignment.findMany({
        where: { meetingId: meeting.id },
        select: { slotTemplateId: true },
      });
      const existingSlotIds = new Set(existingSlots.map((s) => s.slotTemplateId));

      let created = 0;
      for (const template of templates) {
        if (!existingSlotIds.has(template.id)) {
          await prisma.meetingAssignment.create({
            data: {
              meetingId: meeting.id,
              slotTemplateId: template.id,
              status: "pending",
              source: "auto_seeded",
            },
          });
          created++;
        }
      }

      return { meetingId: meeting.id, slotsCreated: created };
    },
  );
}
