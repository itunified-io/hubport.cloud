/**
 * Service Group Meeting routes — concrete scheduled instances of field
 * service at a meeting point, with signup, field groups, and location sharing.
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";

// ─── Schemas ────────────────────────────────────────────────────────

const CreateMeetingBody = Type.Object({
  meetingPointId: Type.String({ format: "uuid" }),
  date: Type.String(), // ISO date string
  time: Type.String({ pattern: "^\\d{2}:\\d{2}$" }),
  conductorId: Type.String(),
  serviceGroupId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  notes: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
type CreateMeetingBodyType = Static<typeof CreateMeetingBody>;

const UpdateMeetingBody = Type.Partial(
  Type.Object({
    date: Type.String(),
    time: Type.String(),
    conductorId: Type.String(),
    notes: Type.Union([Type.String(), Type.Null()]),
  }),
);
type UpdateMeetingBodyType = Static<typeof UpdateMeetingBody>;

const MeetingIdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});
type MeetingIdParamsType = Static<typeof MeetingIdParams>;

const GroupIdParams = Type.Object({
  groupId: Type.String({ format: "uuid" }),
});
type GroupIdParamsType = Static<typeof GroupIdParams>;

const WeekQuery = Type.Object({
  week: Type.Optional(Type.String({ pattern: "^\\d{4}-W\\d{2}$" })),
});
type WeekQueryType = Static<typeof WeekQuery>;

const CreateGroupBody = Type.Object({
  name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  leaderId: Type.String(),
  memberIds: Type.Array(Type.String()),
  territoryIds: Type.Optional(Type.Array(Type.String())),
});
type CreateGroupBodyType = Static<typeof CreateGroupBody>;

const UpdateGroupBody = Type.Partial(CreateGroupBody);
type UpdateGroupBodyType = Static<typeof UpdateGroupBody>;

const LocationBody = Type.Object({
  latitude: Type.Number(),
  longitude: Type.Number(),
  accuracy: Type.Optional(Type.Number()),
});
type LocationBodyType = Static<typeof LocationBody>;

/**
 * Get start/end dates for an ISO week string like "2026-W14".
 */
function isoWeekToDates(isoWeek: string): { start: Date; end: Date } {
  const [yearStr, weekStr] = isoWeek.split("-W");
  const year = Number(yearStr);
  const week = Number(weekStr);

  // January 4 is always in week 1
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7; // Monday=1...Sunday=7
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { start: monday, end: sunday };
}

export async function serviceGroupMeetingRoutes(app: FastifyInstance): Promise<void> {
  // ─── List service meetings ────────────────────────────────────────
  app.get<{ Querystring: WeekQueryType }>(
    "/field-service/meetings",
    {
      preHandler: requirePermission(PERMISSIONS.SERVICE_MEETINGS_VIEW),
      schema: { querystring: WeekQuery },
    },
    async (request) => {
      const { week } = request.query;
      let dateFilter: { gte?: Date; lte?: Date } | undefined;

      if (week) {
        const { start, end } = isoWeekToDates(week);
        dateFilter = { gte: start, lte: end };
      }

      const meetings = await prisma.serviceGroupMeeting.findMany({
        where: {
          ...(dateFilter && { date: dateFilter }),
        },
        include: {
          meetingPoint: true,
          signups: {
            where: { cancelledAt: null },
            select: { id: true, publisherId: true, signedUpAt: true, cancelledAt: true },
          },
          fieldGroups: {
            select: { id: true, name: true, status: true, memberIds: true },
          },
        },
        orderBy: [{ date: "asc" }, { time: "asc" }],
      });

      // Resolve conductor + signup publisher names
      const allPublisherIds = new Set<string>();
      for (const m of meetings) {
        allPublisherIds.add(m.conductorId);
        for (const s of m.signups) allPublisherIds.add(s.publisherId);
      }

      const publishers = await prisma.publisher.findMany({
        where: { id: { in: [...allPublisherIds] } },
        select: { id: true, firstName: true, lastName: true },
      });
      const pubMap = new Map(publishers.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));

      return meetings.map((m) => ({
        ...m,
        conductorName: pubMap.get(m.conductorId) ?? null,
        signupCount: m.signups.length,
        signups: m.signups.map((s) => ({
          ...s,
          publisherName: pubMap.get(s.publisherId) ?? null,
        })),
      }));
    },
  );

  // ─── Get single service meeting ──────────────────────────────────
  app.get<{ Params: MeetingIdParamsType }>(
    "/field-service/meetings/:id",
    {
      preHandler: requirePermission(PERMISSIONS.SERVICE_MEETINGS_VIEW),
      schema: { params: MeetingIdParams },
    },
    async (request, reply) => {
      const meeting = await prisma.serviceGroupMeeting.findUnique({
        where: { id: request.params.id },
        include: {
          meetingPoint: true,
          signups: { where: { cancelledAt: null } },
          fieldGroups: {
            include: {
              locationShares: { where: { isActive: true } },
            },
          },
        },
      });

      if (!meeting) {
        return reply.code(404).send({ error: "Meeting not found" });
      }

      // Resolve names
      const allIds = new Set<string>([meeting.conductorId]);
      for (const s of meeting.signups) allIds.add(s.publisherId);
      for (const g of meeting.fieldGroups) {
        allIds.add(g.leaderId);
        for (const m of g.memberIds) allIds.add(m);
      }

      const publishers = await prisma.publisher.findMany({
        where: { id: { in: [...allIds] } },
        select: { id: true, firstName: true, lastName: true },
      });
      const pubMap = new Map(publishers.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));

      return {
        ...meeting,
        conductorName: pubMap.get(meeting.conductorId) ?? null,
        signupCount: meeting.signups.length,
        signups: meeting.signups.map((s) => ({
          ...s,
          publisherName: pubMap.get(s.publisherId) ?? null,
        })),
        fieldGroups: meeting.fieldGroups.map((g) => ({
          ...g,
          leaderName: pubMap.get(g.leaderId) ?? null,
        })),
      };
    },
  );

  // ─── Create service meeting ───────────────────────────────────────
  app.post<{ Body: CreateMeetingBodyType }>(
    "/field-service/meetings",
    {
      preHandler: requirePermission(PERMISSIONS.SERVICE_MEETINGS_MANAGE),
      schema: { body: CreateMeetingBody },
    },
    async (request, reply) => {
      const publisherId = request.user?.sub ?? "system";
      const { meetingPointId, date, time, conductorId, serviceGroupId, notes } = request.body;

      // Verify meeting point exists
      const point = await prisma.fieldServiceMeetingPoint.findUnique({
        where: { id: meetingPointId },
      });
      if (!point) {
        return reply.code(404).send({ error: "Meeting point not found" });
      }

      const meeting = await prisma.serviceGroupMeeting.create({
        data: {
          tenantId: "default",
          meetingPointId,
          date: new Date(date),
          time,
          conductorId,
          serviceGroupId: serviceGroupId ?? null,
          notes: notes ?? null,
          createdBy: publisherId,
        },
        include: { meetingPoint: true },
      });

      return reply.code(201).send(meeting);
    },
  );

  // ─── Update service meeting ───────────────────────────────────────
  app.put<{ Params: MeetingIdParamsType; Body: UpdateMeetingBodyType }>(
    "/field-service/meetings/:id",
    {
      preHandler: requirePermission(PERMISSIONS.SERVICE_MEETINGS_MANAGE),
      schema: { params: MeetingIdParams, body: UpdateMeetingBody },
    },
    async (request, reply) => {
      const existing = await prisma.serviceGroupMeeting.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Meeting not found" });
      }
      if (existing.status !== "planned") {
        return reply.code(400).send({ error: "Can only update planned meetings" });
      }

      const updated = await prisma.serviceGroupMeeting.update({
        where: { id: request.params.id },
        data: {
          ...(request.body.date && { date: new Date(request.body.date) }),
          ...(request.body.time && { time: request.body.time }),
          ...(request.body.conductorId && { conductorId: request.body.conductorId }),
          ...(request.body.notes !== undefined && { notes: request.body.notes }),
        },
      });

      return updated;
    },
  );

  // ─── Cancel service meeting ───────────────────────────────────────
  app.delete<{ Params: MeetingIdParamsType }>(
    "/field-service/meetings/:id",
    {
      preHandler: requirePermission(PERMISSIONS.SERVICE_MEETINGS_MANAGE),
      schema: { params: MeetingIdParams },
    },
    async (request, reply) => {
      const existing = await prisma.serviceGroupMeeting.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Meeting not found" });
      }
      if (existing.status !== "planned") {
        return reply.code(400).send({ error: "Can only cancel planned meetings" });
      }

      await prisma.serviceGroupMeeting.update({
        where: { id: request.params.id },
        data: { status: "cancelled" },
      });

      return reply.code(204).send();
    },
  );

  // ─── Publisher signup ─────────────────────────────────────────────
  app.post<{ Params: MeetingIdParamsType }>(
    "/field-service/meetings/:id/signup",
    {
      preHandler: requirePermission(PERMISSIONS.SERVICE_MEETINGS_SIGNUP),
      schema: { params: MeetingIdParams },
    },
    async (request, reply) => {
      const publisherId = request.user?.sub ?? "system";
      const meetingId = request.params.id;

      const meeting = await prisma.serviceGroupMeeting.findUnique({
        where: { id: meetingId },
        include: {
          meetingPoint: { select: { maxParticipants: true } },
          _count: { select: { signups: { where: { cancelledAt: null } } } },
        },
      });

      if (!meeting) {
        return reply.code(404).send({ error: "Meeting not found" });
      }
      if (meeting.status !== "planned") {
        return reply.code(400).send({ error: "Can only sign up for planned meetings" });
      }

      // Check capacity
      if (meeting.meetingPoint?.maxParticipants) {
        const currentCount = meeting._count.signups;
        if (currentCount >= meeting.meetingPoint.maxParticipants) {
          return reply.code(409).send({ error: "Meeting is full" });
        }
      }

      // Upsert (re-activate if previously cancelled)
      const existing = await prisma.serviceMeetingSignup.findUnique({
        where: { meetingId_publisherId: { meetingId, publisherId } },
      });

      if (existing) {
        if (!existing.cancelledAt) {
          return reply.code(409).send({ error: "Already signed up" });
        }
        // Re-activate
        const updated = await prisma.serviceMeetingSignup.update({
          where: { id: existing.id },
          data: { cancelledAt: null, signedUpAt: new Date() },
        });
        return reply.code(200).send(updated);
      }

      const signup = await prisma.serviceMeetingSignup.create({
        data: {
          tenantId: "default",
          meetingId,
          publisherId,
        },
      });

      return reply.code(201).send(signup);
    },
  );

  // ─── Cancel signup ────────────────────────────────────────────────
  app.delete<{ Params: MeetingIdParamsType }>(
    "/field-service/meetings/:id/signup",
    {
      preHandler: requirePermission(PERMISSIONS.SERVICE_MEETINGS_SIGNUP),
      schema: { params: MeetingIdParams },
    },
    async (request, reply) => {
      const publisherId = request.user?.sub ?? "system";
      const meetingId = request.params.id;

      const signup = await prisma.serviceMeetingSignup.findUnique({
        where: { meetingId_publisherId: { meetingId, publisherId } },
      });

      if (!signup || signup.cancelledAt) {
        return reply.code(404).send({ error: "Signup not found" });
      }

      await prisma.serviceMeetingSignup.update({
        where: { id: signup.id },
        data: { cancelledAt: new Date() },
      });

      return reply.code(204).send();
    },
  );

  // ─── Start meeting ────────────────────────────────────────────────
  app.post<{ Params: MeetingIdParamsType }>(
    "/field-service/meetings/:id/start",
    {
      preHandler: requirePermission(PERMISSIONS.SERVICE_MEETINGS_CONDUCT),
      schema: { params: MeetingIdParams },
    },
    async (request, reply) => {
      const meeting = await prisma.serviceGroupMeeting.findUnique({
        where: { id: request.params.id },
      });
      if (!meeting) return reply.code(404).send({ error: "Meeting not found" });
      if (meeting.status !== "planned") {
        return reply.code(400).send({ error: "Meeting is not in planned state" });
      }

      const updated = await prisma.serviceGroupMeeting.update({
        where: { id: request.params.id },
        data: { status: "active", startedAt: new Date() },
        include: { meetingPoint: true, signups: true, fieldGroups: true },
      });

      return updated;
    },
  );

  // ─── Complete meeting ─────────────────────────────────────────────
  app.post<{ Params: MeetingIdParamsType }>(
    "/field-service/meetings/:id/complete",
    {
      preHandler: requirePermission(PERMISSIONS.SERVICE_MEETINGS_CONDUCT),
      schema: { params: MeetingIdParams },
    },
    async (request, reply) => {
      const meeting = await prisma.serviceGroupMeeting.findUnique({
        where: { id: request.params.id },
        include: { fieldGroups: { include: { locationShares: true } } },
      });
      if (!meeting) return reply.code(404).send({ error: "Meeting not found" });
      if (meeting.status !== "active") {
        return reply.code(400).send({ error: "Meeting is not active" });
      }

      // Complete all field groups and deactivate location shares
      for (const group of meeting.fieldGroups) {
        if (group.status !== "completed") {
          await prisma.serviceMeetingFieldGroup.update({
            where: { id: group.id },
            data: { status: "completed", completedAt: new Date() },
          });
        }
        for (const share of group.locationShares) {
          if (share.isActive) {
            await prisma.serviceLocationShare.update({
              where: { id: share.id },
              data: { isActive: false, stoppedAt: new Date() },
            });
          }
        }
      }

      const updated = await prisma.serviceGroupMeeting.update({
        where: { id: request.params.id },
        data: { status: "completed", completedAt: new Date() },
        include: { meetingPoint: true, signups: true, fieldGroups: true },
      });

      return updated;
    },
  );

  // ─── Create field group ───────────────────────────────────────────
  app.post<{ Params: MeetingIdParamsType; Body: CreateGroupBodyType }>(
    "/field-service/meetings/:id/groups",
    {
      preHandler: requirePermission(PERMISSIONS.SERVICE_MEETINGS_CONDUCT),
      schema: { params: MeetingIdParams, body: CreateGroupBody },
    },
    async (request, reply) => {
      const meeting = await prisma.serviceGroupMeeting.findUnique({
        where: { id: request.params.id },
      });
      if (!meeting) return reply.code(404).send({ error: "Meeting not found" });

      const group = await prisma.serviceMeetingFieldGroup.create({
        data: {
          tenantId: "default",
          meetingId: request.params.id,
          name: request.body.name ?? null,
          leaderId: request.body.leaderId,
          memberIds: request.body.memberIds,
          territoryIds: request.body.territoryIds ?? [],
        },
      });

      return reply.code(201).send(group);
    },
  );

  // ─── Update field group ───────────────────────────────────────────
  app.put<{ Params: GroupIdParamsType; Body: UpdateGroupBodyType }>(
    "/field-service/groups/:groupId",
    {
      preHandler: requirePermission(PERMISSIONS.SERVICE_MEETINGS_CONDUCT),
      schema: { params: GroupIdParams, body: UpdateGroupBody },
    },
    async (request, reply) => {
      const group = await prisma.serviceMeetingFieldGroup.findUnique({
        where: { id: request.params.groupId },
      });
      if (!group) return reply.code(404).send({ error: "Group not found" });

      const updated = await prisma.serviceMeetingFieldGroup.update({
        where: { id: request.params.groupId },
        data: {
          ...(request.body.name !== undefined && { name: request.body.name }),
          ...(request.body.leaderId && { leaderId: request.body.leaderId }),
          ...(request.body.memberIds && { memberIds: request.body.memberIds }),
          ...(request.body.territoryIds && { territoryIds: request.body.territoryIds }),
        },
      });

      return updated;
    },
  );

  // ─── Start field group ────────────────────────────────────────────
  app.post<{ Params: GroupIdParamsType }>(
    "/field-service/groups/:groupId/start",
    {
      preHandler: requirePermission(PERMISSIONS.SERVICE_MEETINGS_CONDUCT),
      schema: { params: GroupIdParams },
    },
    async (request, reply) => {
      const group = await prisma.serviceMeetingFieldGroup.findUnique({
        where: { id: request.params.groupId },
      });
      if (!group) return reply.code(404).send({ error: "Group not found" });
      if (group.status !== "planned") {
        return reply.code(400).send({ error: "Group is not in planned state" });
      }

      const updated = await prisma.serviceMeetingFieldGroup.update({
        where: { id: request.params.groupId },
        data: { status: "in_field", startedAt: new Date() },
      });

      return updated;
    },
  );

  // ─── Complete field group ─────────────────────────────────────────
  app.post<{ Params: GroupIdParamsType }>(
    "/field-service/groups/:groupId/complete",
    {
      preHandler: requirePermission(PERMISSIONS.SERVICE_MEETINGS_CONDUCT),
      schema: { params: GroupIdParams },
    },
    async (request, reply) => {
      const group = await prisma.serviceMeetingFieldGroup.findUnique({
        where: { id: request.params.groupId },
        include: { locationShares: { where: { isActive: true } } },
      });
      if (!group) return reply.code(404).send({ error: "Group not found" });
      if (group.status !== "in_field") {
        return reply.code(400).send({ error: "Group is not in field" });
      }

      // Deactivate all location shares
      for (const share of group.locationShares) {
        await prisma.serviceLocationShare.update({
          where: { id: share.id },
          data: { isActive: false, stoppedAt: new Date() },
        });
      }

      const updated = await prisma.serviceMeetingFieldGroup.update({
        where: { id: request.params.groupId },
        data: { status: "completed", completedAt: new Date() },
      });

      return updated;
    },
  );

  // ─── Start location sharing ───────────────────────────────────────
  app.post<{ Params: GroupIdParamsType; Body: LocationBodyType }>(
    "/field-service/groups/:groupId/location/start",
    {
      preHandler: requirePermission(PERMISSIONS.SERVICE_MEETINGS_SIGNUP),
      schema: { params: GroupIdParams, body: LocationBody },
    },
    async (request, reply) => {
      const publisherId = request.user?.sub ?? "system";

      // Check privacy opt-in
      const publisher = await prisma.publisher.findFirst({
        where: { keycloakSub: publisherId },
        select: { allowLocationSharing: true },
      });

      if (!publisher?.allowLocationSharing) {
        return reply.code(403).send({
          error: "Location sharing not enabled. Enable it in your privacy settings.",
        });
      }

      const group = await prisma.serviceMeetingFieldGroup.findUnique({
        where: { id: request.params.groupId },
      });
      if (!group) return reply.code(404).send({ error: "Group not found" });

      const share = await prisma.serviceLocationShare.create({
        data: {
          tenantId: "default",
          fieldGroupId: request.params.groupId,
          publisherId,
          latitude: request.body.latitude,
          longitude: request.body.longitude,
          accuracy: request.body.accuracy ?? null,
        },
      });

      return reply.code(201).send(share);
    },
  );

  // ─── Update location ──────────────────────────────────────────────
  app.post<{ Params: GroupIdParamsType; Body: LocationBodyType }>(
    "/field-service/groups/:groupId/location/update",
    {
      preHandler: requirePermission(PERMISSIONS.SERVICE_MEETINGS_SIGNUP),
      schema: { params: GroupIdParams, body: LocationBody },
    },
    async (request, reply) => {
      const publisherId = request.user?.sub ?? "system";

      const share = await prisma.serviceLocationShare.findFirst({
        where: {
          fieldGroupId: request.params.groupId,
          publisherId,
          isActive: true,
        },
      });

      if (!share) {
        return reply.code(404).send({ error: "No active location share found" });
      }

      const updated = await prisma.serviceLocationShare.update({
        where: { id: share.id },
        data: {
          latitude: request.body.latitude,
          longitude: request.body.longitude,
          accuracy: request.body.accuracy ?? null,
          lastUpdatedAt: new Date(),
        },
      });

      return updated;
    },
  );

  // ─── Stop location sharing ────────────────────────────────────────
  app.post<{ Params: GroupIdParamsType }>(
    "/field-service/groups/:groupId/location/stop",
    {
      preHandler: requirePermission(PERMISSIONS.SERVICE_MEETINGS_SIGNUP),
      schema: { params: GroupIdParams },
    },
    async (request, reply) => {
      const publisherId = request.user?.sub ?? "system";

      const share = await prisma.serviceLocationShare.findFirst({
        where: {
          fieldGroupId: request.params.groupId,
          publisherId,
          isActive: true,
        },
      });

      if (!share) {
        return reply.code(404).send({ error: "No active location share found" });
      }

      await prisma.serviceLocationShare.update({
        where: { id: share.id },
        data: { isActive: false, stoppedAt: new Date() },
      });

      return reply.code(204).send();
    },
  );

  // ─── Get group locations (conductor view) ─────────────────────────
  app.get<{ Params: GroupIdParamsType }>(
    "/field-service/groups/:groupId/locations",
    {
      preHandler: requirePermission(PERMISSIONS.SERVICE_MEETINGS_CONDUCT),
      schema: { params: GroupIdParams },
    },
    async (request, reply) => {
      const group = await prisma.serviceMeetingFieldGroup.findUnique({
        where: { id: request.params.groupId },
      });
      if (!group) return reply.code(404).send({ error: "Group not found" });

      const shares = await prisma.serviceLocationShare.findMany({
        where: {
          fieldGroupId: request.params.groupId,
          isActive: true,
        },
      });

      // Resolve publisher names
      const pubIds = shares.map((s) => s.publisherId);
      const publishers = pubIds.length > 0
        ? await prisma.publisher.findMany({
            where: { keycloakSub: { in: pubIds } },
            select: { keycloakSub: true, firstName: true, lastName: true },
          })
        : [];
      const pubMap = new Map(publishers.map((p) => [p.keycloakSub, `${p.firstName} ${p.lastName}`]));

      return shares.map((s) => ({
        ...s,
        publisherName: pubMap.get(s.publisherId) ?? null,
      }));
    },
  );
}
