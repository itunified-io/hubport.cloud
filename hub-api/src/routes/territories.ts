import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requireRole } from "../lib/rbac.js";

const TerritoryBody = Type.Object({
  number: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
  boundaries: Type.Optional(Type.Any()),
});

type TerritoryBodyType = Static<typeof TerritoryBody>;

const IdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});

type IdParamsType = Static<typeof IdParams>;

const AssignBody = Type.Object({
  publisherId: Type.String({ format: "uuid" }),
});

type AssignBodyType = Static<typeof AssignBody>;

export async function territoryRoutes(app: FastifyInstance): Promise<void> {
  // List all territories — publisher+
  app.get(
    "/territories",
    { preHandler: requireRole("publisher") },
    async () => {
      return prisma.territory.findMany({
        orderBy: { number: "asc" },
        include: {
          assignments: {
            where: { returnedAt: null },
            include: { publisher: true },
          },
        },
      });
    },
  );

  // Get one territory with full assignment history — publisher+
  app.get<{ Params: IdParamsType }>(
    "/territories/:id",
    {
      preHandler: requireRole("publisher"),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const territory = await prisma.territory.findUnique({
        where: { id: request.params.id },
        include: {
          assignments: {
            include: { publisher: true },
            orderBy: { assignedAt: "desc" },
          },
        },
      });
      if (!territory) {
        return reply.code(404).send({ error: "Not found" });
      }
      return territory;
    },
  );

  // Create territory — elder+
  app.post<{ Body: TerritoryBodyType }>(
    "/territories",
    {
      preHandler: requireRole("elder"),
      schema: { body: TerritoryBody },
    },
    async (request, reply) => {
      const territory = await prisma.territory.create({
        data: request.body,
      });
      return reply.code(201).send(territory);
    },
  );

  // Update territory — elder+
  app.put<{ Params: IdParamsType; Body: TerritoryBodyType }>(
    "/territories/:id",
    {
      preHandler: requireRole("elder"),
      schema: { params: IdParams, body: TerritoryBody },
    },
    async (request, reply) => {
      const existing = await prisma.territory.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Not found" });
      }
      const territory = await prisma.territory.update({
        where: { id: request.params.id },
        data: request.body,
      });
      return territory;
    },
  );

  // Delete territory — admin only
  app.delete<{ Params: IdParamsType }>(
    "/territories/:id",
    {
      preHandler: requireRole("admin"),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const existing = await prisma.territory.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) {
        return reply.code(404).send({ error: "Not found" });
      }
      await prisma.territory.delete({
        where: { id: request.params.id },
      });
      return reply.code(204).send();
    },
  );

  // Assign territory to publisher — elder+
  app.post<{ Params: IdParamsType; Body: AssignBodyType }>(
    "/territories/:id/assign",
    {
      preHandler: requireRole("elder"),
      schema: { params: IdParams, body: AssignBody },
    },
    async (request, reply) => {
      const territory = await prisma.territory.findUnique({
        where: { id: request.params.id },
      });
      if (!territory) {
        return reply.code(404).send({ error: "Territory not found" });
      }

      const publisher = await prisma.publisher.findUnique({
        where: { id: request.body.publisherId },
      });
      if (!publisher) {
        return reply.code(404).send({ error: "Publisher not found" });
      }

      // Check if territory is already assigned (no returnedAt)
      const active = await prisma.territoryAssignment.findFirst({
        where: { territoryId: request.params.id, returnedAt: null },
      });
      if (active) {
        return reply.code(409).send({
          error: "Conflict",
          message: "Territory is already assigned. Return it first.",
        });
      }

      const assignment = await prisma.territoryAssignment.create({
        data: {
          territoryId: request.params.id,
          publisherId: request.body.publisherId,
        },
        include: { publisher: true, territory: true },
      });
      return reply.code(201).send(assignment);
    },
  );

  // Return territory — elder+
  app.post<{ Params: IdParamsType }>(
    "/territories/:id/return",
    {
      preHandler: requireRole("elder"),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const active = await prisma.territoryAssignment.findFirst({
        where: { territoryId: request.params.id, returnedAt: null },
      });
      if (!active) {
        return reply.code(404).send({
          error: "Not found",
          message: "No active assignment for this territory",
        });
      }

      const assignment = await prisma.territoryAssignment.update({
        where: { id: active.id },
        data: { returnedAt: new Date() },
        include: { publisher: true, territory: true },
      });
      return assignment;
    },
  );
}
