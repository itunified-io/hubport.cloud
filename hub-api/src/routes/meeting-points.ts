import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";

// ─── Schemas ────────────────────────────────────────────────────────

const CampaignIdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});
type CampaignIdParamsType = Static<typeof CampaignIdParams>;

const MeetingPointIdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});
type MeetingPointIdParamsType = Static<typeof MeetingPointIdParams>;

const MeetingPointBody = Type.Object({
  conductorId: Type.String({ format: "uuid" }),
  assistantIds: Type.Optional(Type.Array(Type.String({ format: "uuid" }))),
  territoryIds: Type.Optional(Type.Array(Type.String({ format: "uuid" }))),
  name: Type.Optional(Type.String()),
  latitude: Type.Optional(Type.Number()),
  longitude: Type.Optional(Type.Number()),
  address: Type.Optional(Type.String()),
  dayOfWeek: Type.Optional(Type.String()),
  time: Type.Optional(Type.String()),
});
type MeetingPointBodyType = Static<typeof MeetingPointBody>;

const MeetingPointUpdateBody = Type.Object({
  conductorId: Type.Optional(Type.String({ format: "uuid" })),
  assistantIds: Type.Optional(Type.Array(Type.String({ format: "uuid" }))),
  territoryIds: Type.Optional(Type.Array(Type.String({ format: "uuid" }))),
  name: Type.Optional(Type.String()),
  latitude: Type.Optional(Type.Number()),
  longitude: Type.Optional(Type.Number()),
  address: Type.Optional(Type.String()),
  dayOfWeek: Type.Optional(Type.String()),
  time: Type.Optional(Type.String()),
});
type MeetingPointUpdateBodyType = Static<typeof MeetingPointUpdateBody>;

// ─── Routes ─────────────────────────────────────────────────────────

export async function meetingPointRoutes(app: FastifyInstance): Promise<void> {
  // Create meeting point within a campaign — CAMPAIGNS_MANAGE
  app.post<{ Params: CampaignIdParamsType; Body: MeetingPointBodyType }>(
    "/campaigns/:id/meeting-points",
    {
      preHandler: requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE),
      schema: { params: CampaignIdParams, body: MeetingPointBody },
    },
    async (request, reply) => {
      const campaign = await prisma.campaign.findUnique({
        where: { id: request.params.id, deletedAt: null },
      });
      if (!campaign) {
        return reply.code(404).send({ error: "Campaign not found" });
      }

      const meetingPoint = await prisma.campaignMeetingPoint.create({
        data: {
          campaignId: request.params.id,
          conductorId: request.body.conductorId,
          assistantIds: request.body.assistantIds ?? [],
          territoryIds: request.body.territoryIds ?? [],
          name: request.body.name,
          latitude: request.body.latitude,
          longitude: request.body.longitude,
          address: request.body.address,
          dayOfWeek: request.body.dayOfWeek,
          time: request.body.time,
        },
      });
      return reply.code(201).send(meetingPoint);
    },
  );

  // Update meeting point — CAMPAIGNS_MANAGE
  app.put<{ Params: MeetingPointIdParamsType; Body: MeetingPointUpdateBodyType }>(
    "/meeting-points/:id",
    {
      preHandler: requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE),
      schema: { params: MeetingPointIdParams, body: MeetingPointUpdateBody },
    },
    async (request, reply) => {
      const existing = await prisma.campaignMeetingPoint.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Meeting point not found" });
      }

      const data: Record<string, unknown> = {};
      if (request.body.conductorId !== undefined)
        data.conductorId = request.body.conductorId;
      if (request.body.assistantIds !== undefined)
        data.assistantIds = request.body.assistantIds;
      if (request.body.territoryIds !== undefined)
        data.territoryIds = request.body.territoryIds;
      if (request.body.name !== undefined) data.name = request.body.name;
      if (request.body.latitude !== undefined)
        data.latitude = request.body.latitude;
      if (request.body.longitude !== undefined)
        data.longitude = request.body.longitude;
      if (request.body.address !== undefined)
        data.address = request.body.address;
      if (request.body.dayOfWeek !== undefined)
        data.dayOfWeek = request.body.dayOfWeek;
      if (request.body.time !== undefined) data.time = request.body.time;

      const meetingPoint = await prisma.campaignMeetingPoint.update({
        where: { id: request.params.id },
        data,
      });
      return meetingPoint;
    },
  );

  // Delete meeting point — CAMPAIGNS_MANAGE
  app.delete<{ Params: MeetingPointIdParamsType }>(
    "/meeting-points/:id",
    {
      preHandler: requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE),
      schema: { params: MeetingPointIdParams },
    },
    async (request, reply) => {
      const existing = await prisma.campaignMeetingPoint.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Meeting point not found" });
      }
      await prisma.campaignMeetingPoint.delete({
        where: { id: request.params.id },
      });
      return reply.code(204).send();
    },
  );
}
