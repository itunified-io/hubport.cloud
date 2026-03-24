/**
 * Public talk scheduling routes.
 * Independent from midweek planning periods — related to weekend meetings.
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { audit } from "../lib/policy-engine.js";
import prisma from "../lib/prisma.js";
import { seedPublicTalks } from "../lib/seed-public-talks.js";

const IdParams = Type.Object({ id: Type.String({ format: "uuid" }) });
type IdParamsType = Static<typeof IdParams>;

const TalkBody = Type.Object({
  talkNumber: Type.Integer({ minimum: 1 }),
  title: Type.String({ minLength: 1 }),
  outline: Type.Optional(Type.String()),
});
type TalkBodyType = Static<typeof TalkBody>;

const ScheduleBody = Type.Object({
  meetingId: Type.String({ format: "uuid" }),
  speakerId: Type.String({ format: "uuid" }),
  publicTalkId: Type.Optional(Type.String({ format: "uuid" })),
  mode: Type.Optional(Type.Union([
    Type.Literal("local"),
    Type.Literal("incoming_guest"),
    Type.Literal("outgoing_guest"),
  ])),
  notes: Type.Optional(Type.String()),
});
type ScheduleBodyType = Static<typeof ScheduleBody>;

export async function publicTalkRoutes(app: FastifyInstance): Promise<void> {
  // ─── Talk Catalog ─────────────────────────────────────────────────

  // List all public talks
  app.get(
    "/public-talks",
    { preHandler: requirePermission(PERMISSIONS.PUBLIC_TALKS_VIEW) },
    async () => {
      return prisma.publicTalk.findMany({ orderBy: { talkNumber: "asc" } });
    },
  );

  // Create a public talk entry
  app.post<{ Body: TalkBodyType }>(
    "/public-talks",
    {
      preHandler: requirePermission(PERMISSIONS.PUBLIC_TALKS_EDIT),
      schema: { body: TalkBody },
    },
    async (request, reply) => {
      const talk = await prisma.publicTalk.create({ data: request.body });
      return reply.code(201).send(talk);
    },
  );

  // Seed / reimport public talk catalog from JSON
  app.post(
    "/public-talks/seed",
    { preHandler: requirePermission(PERMISSIONS.MANAGE_PUBLIC_TALKS) },
    async () => {
      return seedPublicTalks();
    },
  );

  // ─── Schedule ─────────────────────────────────────────────────────

  // List schedule entries
  app.get(
    "/public-talks/schedule",
    { preHandler: requirePermission(PERMISSIONS.PUBLIC_TALKS_VIEW) },
    async (request) => {
      const { upcoming } = request.query as { upcoming?: string };
      const where: Record<string, unknown> = {};
      if (upcoming === "true") {
        where.meeting = { date: { gte: new Date() } };
      }

      return prisma.publicTalkSchedule.findMany({
        where,
        include: {
          speaker: true,
          publicTalk: true,
          meeting: { select: { id: true, date: true, title: true, type: true } },
        },
        orderBy: { meeting: { date: "asc" } },
      });
    },
  );

  // Create schedule entry
  app.post<{ Body: ScheduleBodyType }>(
    "/public-talks/schedule",
    {
      preHandler: requirePermission(PERMISSIONS.PUBLIC_TALKS_EDIT),
      schema: { body: ScheduleBody },
    },
    async (request, reply) => {
      const schedule = await prisma.publicTalkSchedule.create({
        data: {
          meetingId: request.body.meetingId,
          speakerId: request.body.speakerId,
          publicTalkId: request.body.publicTalkId,
          mode: request.body.mode ?? "local",
          invitationState: "draft",
          notes: request.body.notes,
        },
        include: { speaker: true, publicTalk: true, meeting: true },
      });
      return reply.code(201).send(schedule);
    },
  );

  // Update schedule entry
  app.put<{ Params: IdParamsType; Body: ScheduleBodyType }>(
    "/public-talks/schedule/:id",
    {
      preHandler: requirePermission(PERMISSIONS.PUBLIC_TALKS_EDIT),
      schema: { params: IdParams, body: ScheduleBody },
    },
    async (request, reply) => {
      const existing = await prisma.publicTalkSchedule.findUnique({ where: { id: request.params.id } });
      if (!existing) return reply.code(404).send({ error: "Schedule entry not found" });
      return prisma.publicTalkSchedule.update({
        where: { id: request.params.id },
        data: request.body,
        include: { speaker: true, publicTalk: true, meeting: true },
      });
    },
  );

  // ─── Invitation Workflow ──────────────────────────────────────────

  // Send invitation
  app.post<{ Params: IdParamsType }>(
    "/public-talks/schedule/:id/invite",
    {
      preHandler: requirePermission(PERMISSIONS.PUBLIC_TALKS_EDIT),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const entry = await prisma.publicTalkSchedule.findUnique({ where: { id: request.params.id } });
      if (!entry) return reply.code(404).send({ error: "Not found" });
      if (entry.invitationState !== "draft") {
        return reply.code(409).send({ error: `Cannot invite from state '${entry.invitationState}'` });
      }

      const updated = await prisma.publicTalkSchedule.update({
        where: { id: request.params.id },
        data: { invitationState: "invited", invitedAt: new Date() },
      });
      await audit("public_talk.invite", request.user?.sub ?? "unknown", "PublicTalkSchedule", entry.id);
      return updated;
    },
  );

  // Confirm
  app.post<{ Params: IdParamsType }>(
    "/public-talks/schedule/:id/confirm",
    {
      preHandler: requirePermission(PERMISSIONS.PUBLIC_TALKS_EDIT),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const entry = await prisma.publicTalkSchedule.findUnique({ where: { id: request.params.id } });
      if (!entry) return reply.code(404).send({ error: "Not found" });
      if (entry.invitationState !== "invited") {
        return reply.code(409).send({ error: `Cannot confirm from state '${entry.invitationState}'` });
      }

      const updated = await prisma.publicTalkSchedule.update({
        where: { id: request.params.id },
        data: { invitationState: "confirmed", confirmedAt: new Date() },
      });
      await audit("public_talk.confirm", request.user?.sub ?? "unknown", "PublicTalkSchedule", entry.id);
      return updated;
    },
  );

  // Cancel
  app.post<{ Params: IdParamsType }>(
    "/public-talks/schedule/:id/cancel",
    {
      preHandler: requirePermission(PERMISSIONS.PUBLIC_TALKS_EDIT),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const entry = await prisma.publicTalkSchedule.findUnique({ where: { id: request.params.id } });
      if (!entry) return reply.code(404).send({ error: "Not found" });

      const updated = await prisma.publicTalkSchedule.update({
        where: { id: request.params.id },
        data: { invitationState: "cancelled", cancelledAt: new Date() },
      });
      await audit("public_talk.cancel", request.user?.sub ?? "unknown", "PublicTalkSchedule", entry.id);
      return updated;
    },
  );
}
