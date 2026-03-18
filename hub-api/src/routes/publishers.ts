import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requireRole } from "../lib/rbac.js";

const PublisherBody = Type.Object({
  firstName: Type.String({ minLength: 1 }),
  lastName: Type.String({ minLength: 1 }),
  email: Type.Optional(Type.String({ format: "email" })),
  phone: Type.Optional(Type.String()),
  role: Type.Optional(Type.Union([
    Type.Literal("admin"),
    Type.Literal("elder"),
    Type.Literal("publisher"),
    Type.Literal("viewer"),
  ])),
  status: Type.Optional(Type.Union([
    Type.Literal("active"),
    Type.Literal("inactive"),
    Type.Literal("away"),
  ])),
});

type PublisherBodyType = Static<typeof PublisherBody>;

const IdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});

type IdParamsType = Static<typeof IdParams>;

export async function publisherRoutes(app: FastifyInstance): Promise<void> {
  // List all publishers — publisher+ can read
  app.get(
    "/publishers",
    { preHandler: requireRole("publisher") },
    async () => {
      return prisma.publisher.findMany({
        orderBy: { lastName: "asc" },
      });
    },
  );

  // Get one publisher — publisher+
  app.get<{ Params: IdParamsType }>(
    "/publishers/:id",
    {
      preHandler: requireRole("publisher"),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const publisher = await prisma.publisher.findUnique({
        where: { id: request.params.id },
        include: { assignments: { include: { territory: true } } },
      });
      if (!publisher) {
        return reply.code(404).send({ error: "Not found" });
      }
      return publisher;
    },
  );

  // Create publisher — elder+
  app.post<{ Body: PublisherBodyType }>(
    "/publishers",
    {
      preHandler: requireRole("elder"),
      schema: { body: PublisherBody },
    },
    async (request, reply) => {
      const publisher = await prisma.publisher.create({
        data: request.body,
      });
      return reply.code(201).send(publisher);
    },
  );

  // Update publisher — elder+
  app.put<{ Params: IdParamsType; Body: PublisherBodyType }>(
    "/publishers/:id",
    {
      preHandler: requireRole("elder"),
      schema: { params: IdParams, body: PublisherBody },
    },
    async (request, reply) => {
      const existing = await prisma.publisher.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Not found" });
      }
      const publisher = await prisma.publisher.update({
        where: { id: request.params.id },
        data: request.body,
      });
      return publisher;
    },
  );

  // Delete publisher — admin only
  app.delete<{ Params: IdParamsType }>(
    "/publishers/:id",
    {
      preHandler: requireRole("admin"),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const existing = await prisma.publisher.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Not found" });
      }
      await prisma.publisher.delete({
        where: { id: request.params.id },
      });
      return reply.code(204).send();
    },
  );
}
