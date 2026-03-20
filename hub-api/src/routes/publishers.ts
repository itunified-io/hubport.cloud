import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { maskFields, audit } from "../lib/policy-engine.js";
import { PERMISSIONS } from "../lib/permissions.js";

const PublisherBody = Type.Object({
  firstName: Type.String({ minLength: 1 }),
  lastName: Type.String({ minLength: 1 }),
  email: Type.Optional(Type.String({ format: "email" })),
  phone: Type.Optional(Type.String()),
  gender: Type.Optional(Type.Union([Type.Literal("male"), Type.Literal("female")])),
  congregationRole: Type.Optional(Type.Union([
    Type.Literal("publisher"),
    Type.Literal("ministerial_servant"),
    Type.Literal("elder"),
  ])),
  congregationFlags: Type.Optional(Type.Array(Type.String())),
  status: Type.Optional(Type.Union([
    Type.Literal("active"),
    Type.Literal("inactive"),
  ])),
});

type PublisherBodyType = Static<typeof PublisherBody>;

const IdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});

type IdParamsType = Static<typeof IdParams>;

export async function publisherRoutes(app: FastifyInstance): Promise<void> {
  // List all publishers — requires view or view_minimal
  app.get(
    "/publishers",
    { preHandler: requirePermission(PERMISSIONS.PUBLISHERS_VIEW_MINIMAL) },
    async (request) => {
      const publishers = await prisma.publisher.findMany({
        orderBy: { lastName: "asc" },
      });

      const ctx = request.policyCtx;
      if (!ctx) return publishers;

      // Apply field masking per publisher
      return publishers.map((p: Record<string, unknown>) =>
        maskFields(p as Record<string, unknown>, ctx),
      );
    },
  );

  // Get one publisher
  app.get<{ Params: IdParamsType }>(
    "/publishers/:id",
    {
      preHandler: requirePermission(PERMISSIONS.PUBLISHERS_VIEW_MINIMAL),
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

      const ctx = request.policyCtx;
      if (!ctx) return publisher;

      return maskFields(publisher as unknown as Record<string, unknown>, ctx);
    },
  );

  // Create publisher — requires edit permission
  app.post<{ Body: PublisherBodyType }>(
    "/publishers",
    {
      preHandler: requirePermission(PERMISSIONS.PUBLISHERS_EDIT),
      schema: { body: PublisherBody },
    },
    async (request, reply) => {
      const publisher = await prisma.publisher.create({
        data: request.body,
      });

      await audit(
        "publisher.create",
        request.user.sub,
        "Publisher",
        publisher.id,
        undefined,
        publisher,
      );

      return reply.code(201).send(publisher);
    },
  );

  // Update publisher — requires edit permission
  app.put<{ Params: IdParamsType; Body: PublisherBodyType }>(
    "/publishers/:id",
    {
      preHandler: requirePermission(PERMISSIONS.PUBLISHERS_EDIT),
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

      await audit(
        "publisher.update",
        request.user.sub,
        "Publisher",
        publisher.id,
        existing,
        publisher,
      );

      return publisher;
    },
  );

  // Delete publisher — requires edit permission (admin via wildcard)
  app.delete<{ Params: IdParamsType }>(
    "/publishers/:id",
    {
      preHandler: requirePermission(PERMISSIONS.PUBLISHERS_EDIT),
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

      await audit(
        "publisher.delete",
        request.user.sub,
        "Publisher",
        existing.id,
        existing,
      );

      return reply.code(204).send();
    },
  );
}
