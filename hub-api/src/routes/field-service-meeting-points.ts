/**
 * Field Service Meeting Point routes — permanent, recurring meeting points
 * for regular field service (independent of campaigns).
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";

// ─── Schemas ────────────────────────────────────────────────────────

const CreateBody = Type.Object({
  name: Type.String({ minLength: 1 }),
  address: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  latitude: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  longitude: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  dayOfWeek: Type.Integer({ minimum: 0, maximum: 6 }),
  time: Type.String({ pattern: "^\\d{2}:\\d{2}$" }),
  conductorId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  assistantIds: Type.Optional(Type.Array(Type.String())),
  territoryIds: Type.Optional(Type.Array(Type.String())),
  maxParticipants: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
  notes: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
type CreateBodyType = Static<typeof CreateBody>;

const UpdateBody = Type.Partial(CreateBody);
type UpdateBodyType = Static<typeof UpdateBody>;

const IdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});
type IdParamsType = Static<typeof IdParams>;

export async function fieldServiceMeetingPointRoutes(app: FastifyInstance): Promise<void> {
  // ─── List all meeting points ──────────────────────────────────────
  app.get(
    "/field-service/meeting-points",
    {
      preHandler: requirePermission(PERMISSIONS.MEETING_POINTS_VIEW),
    },
    async (request) => {
      const points = await prisma.fieldServiceMeetingPoint.findMany({
        where: { isActive: true },
        orderBy: [{ dayOfWeek: "asc" }, { time: "asc" }],
      });

      // Resolve conductor names
      const conductorIds = points.map((p) => p.conductorId).filter(Boolean) as string[];
      const conductors = conductorIds.length > 0
        ? await prisma.publisher.findMany({
            where: { id: { in: conductorIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [];
      const conductorMap = new Map(conductors.map((c) => [c.id, `${c.firstName} ${c.lastName}`]));

      return points.map((p) => ({
        ...p,
        conductorName: p.conductorId ? conductorMap.get(p.conductorId) ?? null : null,
      }));
    },
  );

  // ─── Get meeting point detail ─────────────────────────────────────
  app.get<{ Params: IdParamsType }>(
    "/field-service/meeting-points/:id",
    {
      preHandler: requirePermission(PERMISSIONS.MEETING_POINTS_VIEW),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const point = await prisma.fieldServiceMeetingPoint.findUnique({
        where: { id: request.params.id },
      });

      if (!point) {
        return reply.code(404).send({ error: "Meeting point not found" });
      }

      let conductorName: string | null = null;
      if (point.conductorId) {
        const conductor = await prisma.publisher.findUnique({
          where: { id: point.conductorId },
          select: { firstName: true, lastName: true },
        });
        if (conductor) conductorName = `${conductor.firstName} ${conductor.lastName}`;
      }

      return { ...point, conductorName };
    },
  );

  // ─── Create meeting point ─────────────────────────────────────────
  app.post<{ Body: CreateBodyType }>(
    "/field-service/meeting-points",
    {
      preHandler: requirePermission(PERMISSIONS.MEETING_POINTS_MANAGE),
      schema: { body: CreateBody },
    },
    async (request, reply) => {
      const publisherId = request.user?.sub ?? "system";
      const body = request.body;

      const point = await prisma.fieldServiceMeetingPoint.create({
        data: {
          tenantId: "default",
          name: body.name,
          address: body.address ?? null,
          latitude: body.latitude ?? null,
          longitude: body.longitude ?? null,
          dayOfWeek: body.dayOfWeek,
          time: body.time,
          conductorId: body.conductorId ?? null,
          assistantIds: body.assistantIds ?? [],
          territoryIds: body.territoryIds ?? [],
          maxParticipants: body.maxParticipants ?? null,
          notes: body.notes ?? null,
          createdBy: publisherId,
        },
      });

      return reply.code(201).send(point);
    },
  );

  // ─── Update meeting point ─────────────────────────────────────────
  app.put<{ Params: IdParamsType; Body: UpdateBodyType }>(
    "/field-service/meeting-points/:id",
    {
      preHandler: requirePermission(PERMISSIONS.MEETING_POINTS_MANAGE),
      schema: { params: IdParams, body: UpdateBody },
    },
    async (request, reply) => {
      const existing = await prisma.fieldServiceMeetingPoint.findUnique({
        where: { id: request.params.id },
      });

      if (!existing) {
        return reply.code(404).send({ error: "Meeting point not found" });
      }

      const updated = await prisma.fieldServiceMeetingPoint.update({
        where: { id: request.params.id },
        data: {
          ...(request.body.name !== undefined && { name: request.body.name }),
          ...(request.body.address !== undefined && { address: request.body.address }),
          ...(request.body.latitude !== undefined && { latitude: request.body.latitude }),
          ...(request.body.longitude !== undefined && { longitude: request.body.longitude }),
          ...(request.body.dayOfWeek !== undefined && { dayOfWeek: request.body.dayOfWeek }),
          ...(request.body.time !== undefined && { time: request.body.time }),
          ...(request.body.conductorId !== undefined && { conductorId: request.body.conductorId }),
          ...(request.body.assistantIds !== undefined && { assistantIds: request.body.assistantIds }),
          ...(request.body.territoryIds !== undefined && { territoryIds: request.body.territoryIds }),
          ...(request.body.maxParticipants !== undefined && { maxParticipants: request.body.maxParticipants }),
          ...(request.body.notes !== undefined && { notes: request.body.notes }),
        },
      });

      return updated;
    },
  );

  // ─── Delete meeting point ─────────────────────────────────────────
  app.delete<{ Params: IdParamsType }>(
    "/field-service/meeting-points/:id",
    {
      preHandler: requirePermission(PERMISSIONS.MEETING_POINTS_MANAGE),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const existing = await prisma.fieldServiceMeetingPoint.findUnique({
        where: { id: request.params.id },
        include: { _count: { select: { serviceMeetings: true } } },
      });

      if (!existing) {
        return reply.code(404).send({ error: "Meeting point not found" });
      }

      // Soft delete if meetings exist, hard delete otherwise
      if (existing._count.serviceMeetings > 0) {
        await prisma.fieldServiceMeetingPoint.update({
          where: { id: request.params.id },
          data: { isActive: false },
        });
      } else {
        await prisma.fieldServiceMeetingPoint.delete({
          where: { id: request.params.id },
        });
      }

      return reply.code(204).send();
    },
  );
}
