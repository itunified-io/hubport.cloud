/**
 * Speaker directory routes.
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import prisma from "../lib/prisma.js";

const IdParams = Type.Object({ id: Type.String({ format: "uuid" }) });
type IdParamsType = Static<typeof IdParams>;

const SpeakerBody = Type.Object({
  firstName: Type.String({ minLength: 1 }),
  lastName: Type.String({ minLength: 1 }),
  congregationName: Type.Optional(Type.String()),
  email: Type.Optional(Type.String()),
  phone: Type.Optional(Type.String()),
  isLocal: Type.Optional(Type.Boolean()),
  status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("inactive")])),
  notes: Type.Optional(Type.String()),
});
type SpeakerBodyType = Static<typeof SpeakerBody>;

export async function speakerRoutes(app: FastifyInstance): Promise<void> {
  // List speakers
  app.get(
    "/speakers",
    { preHandler: requirePermission(PERMISSIONS.SPEAKERS_VIEW) },
    async (request) => {
      const { isLocal, status } = request.query as { isLocal?: string; status?: string };
      const where: Record<string, unknown> = {};
      if (isLocal !== undefined) where.isLocal = isLocal === "true";
      if (status) where.status = status;

      return prisma.speaker.findMany({
        where,
        include: { _count: { select: { schedules: true } } },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      });
    },
  );

  // Get speaker
  app.get<{ Params: IdParamsType }>(
    "/speakers/:id",
    {
      preHandler: requirePermission(PERMISSIONS.SPEAKERS_VIEW),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const speaker = await prisma.speaker.findUnique({
        where: { id: request.params.id },
        include: {
          schedules: {
            include: {
              publicTalk: true,
              meeting: { select: { id: true, date: true, title: true } },
            },
            orderBy: { meeting: { date: "desc" } },
          },
        },
      });
      if (!speaker) return reply.code(404).send({ error: "Speaker not found" });
      return speaker;
    },
  );

  // Create speaker
  app.post<{ Body: SpeakerBodyType }>(
    "/speakers",
    {
      preHandler: requirePermission(PERMISSIONS.SPEAKERS_EDIT),
      schema: { body: SpeakerBody },
    },
    async (request, reply) => {
      const speaker = await prisma.speaker.create({ data: request.body });
      return reply.code(201).send(speaker);
    },
  );

  // Update speaker
  app.put<{ Params: IdParamsType; Body: SpeakerBodyType }>(
    "/speakers/:id",
    {
      preHandler: requirePermission(PERMISSIONS.SPEAKERS_EDIT),
      schema: { params: IdParams, body: SpeakerBody },
    },
    async (request, reply) => {
      const existing = await prisma.speaker.findUnique({ where: { id: request.params.id } });
      if (!existing) return reply.code(404).send({ error: "Speaker not found" });
      return prisma.speaker.update({ where: { id: request.params.id }, data: request.body });
    },
  );
}
