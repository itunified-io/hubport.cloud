import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requireRole } from "../lib/rbac.js";

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
  // List upcoming meetings — all authenticated users
  app.get(
    "/meetings",
    { preHandler: requireRole("viewer") },
    async () => {
      return prisma.meeting.findMany({
        where: { date: { gte: new Date() } },
        orderBy: { date: "asc" },
      });
    },
  );

  // Get one meeting — all authenticated
  app.get<{ Params: IdParamsType }>(
    "/meetings/:id",
    {
      preHandler: requireRole("viewer"),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const meeting = await prisma.meeting.findUnique({
        where: { id: request.params.id },
      });
      if (!meeting) {
        return reply.code(404).send({ error: "Not found" });
      }
      return meeting;
    },
  );

  // Create meeting — elder+
  app.post<{ Body: MeetingBodyType }>(
    "/meetings",
    {
      preHandler: requireRole("elder"),
      schema: { body: MeetingBody },
    },
    async (request, reply) => {
      const meeting = await prisma.meeting.create({
        data: {
          ...request.body,
          date: new Date(request.body.date),
        },
      });
      return reply.code(201).send(meeting);
    },
  );

  // Update meeting — elder+
  app.put<{ Params: IdParamsType; Body: MeetingBodyType }>(
    "/meetings/:id",
    {
      preHandler: requireRole("elder"),
      schema: { params: IdParams, body: MeetingBody },
    },
    async (request, reply) => {
      const existing = await prisma.meeting.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Not found" });
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

  // Delete meeting — admin only
  app.delete<{ Params: IdParamsType }>(
    "/meetings/:id",
    {
      preHandler: requireRole("admin"),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const existing = await prisma.meeting.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Not found" });
      }
      await prisma.meeting.delete({
        where: { id: request.params.id },
      });
      return reply.code(204).send();
    },
  );
}
