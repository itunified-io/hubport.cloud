import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { audit } from "../lib/policy-engine.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { decryptPublisherFields } from "../lib/prisma-encryption.js";

const GroupBody = Type.Object({
  name: Type.String({ minLength: 1 }),
  overseerId: Type.Optional(Type.Union([Type.String({ format: "uuid" }), Type.Null()])),
  assistantId: Type.Optional(Type.Union([Type.String({ format: "uuid" }), Type.Null()])),
  sortOrder: Type.Optional(Type.Number()),
});

const IdParams = Type.Object({ id: Type.String({ format: "uuid" }) });

type IdParamsType = Static<typeof IdParams>;
type GroupBodyType = Static<typeof GroupBody>;

const DEFAULT_GROUPS = [
  { name: "Gruppe 1", sortOrder: 1 },
  { name: "Gruppe 2", sortOrder: 2 },
  { name: "Gruppe 3", sortOrder: 3 },
  { name: "Gruppe 4", sortOrder: 4 },
  { name: "Gruppe 5", sortOrder: 5 },
];

/** Publisher fields to select for display (name only, minimal PII) */
const PUBLISHER_SELECT = { id: true, firstName: true, lastName: true, displayName: true } as const;

export async function serviceGroupRoutes(app: FastifyInstance): Promise<void> {
  // Seed default groups if none exist
  app.get("/service-groups/seed", async () => {
    const count = await prisma.serviceGroup.count();
    if (count > 0) return { seeded: false, count };
    for (const g of DEFAULT_GROUPS) {
      await prisma.serviceGroup.create({ data: g });
    }
    return { seeded: true, count: DEFAULT_GROUPS.length };
  });

  // List all service groups with member counts
  app.get(
    "/service-groups",
    { preHandler: requirePermission(PERMISSIONS.PUBLISHERS_VIEW_MINIMAL) },
    async () => {
      const groups = await prisma.serviceGroup.findMany({
        orderBy: { sortOrder: "asc" },
        include: {
          members: { select: PUBLISHER_SELECT },
          overseerPub: { select: PUBLISHER_SELECT },
          assistantPub: { select: PUBLISHER_SELECT },
          _count: { select: { members: true, cleaningSchedules: true } },
        },
      });

      // Decrypt nested Publisher fields (extension doesn't handle nested includes)
      for (const group of groups) {
        for (const member of group.members) {
          await decryptPublisherFields(member as Record<string, unknown>);
        }
        if (group.overseerPub) await decryptPublisherFields(group.overseerPub as Record<string, unknown>);
        if (group.assistantPub) await decryptPublisherFields(group.assistantPub as Record<string, unknown>);
      }

      return groups;
    },
  );

  // Get one service group
  app.get<{ Params: IdParamsType }>(
    "/service-groups/:id",
    { preHandler: requirePermission(PERMISSIONS.PUBLISHERS_VIEW_MINIMAL) },
    async (request, reply) => {
      const group = await prisma.serviceGroup.findUnique({
        where: { id: request.params.id },
        include: {
          members: {
            select: { ...PUBLISHER_SELECT, email: true, phone: true },
            orderBy: { lastName: "asc" },
          },
          overseerPub: { select: PUBLISHER_SELECT },
          assistantPub: { select: PUBLISHER_SELECT },
          cleaningSchedules: {
            include: { duty: true },
            orderBy: { date: "asc" },
            take: 20,
          },
        },
      });
      if (!group) return reply.code(404).send({ error: "Service group not found" });

      // Decrypt nested Publisher fields
      for (const member of group.members) {
        await decryptPublisherFields(member as Record<string, unknown>);
      }
      if (group.overseerPub) await decryptPublisherFields(group.overseerPub as Record<string, unknown>);
      if (group.assistantPub) await decryptPublisherFields(group.assistantPub as Record<string, unknown>);

      return group;
    },
  );

  // Create service group
  app.post<{ Body: GroupBodyType }>(
    "/service-groups",
    { schema: { body: GroupBody }, preHandler: requirePermission(PERMISSIONS.SETTINGS_EDIT) },
    async (request) => {
      const group = await prisma.serviceGroup.create({ data: request.body });
      await audit("service_group.create", request.user.sub, "ServiceGroup", group.id, null, group);
      return group;
    },
  );

  // Update service group
  app.put<{ Params: IdParamsType; Body: GroupBodyType }>(
    "/service-groups/:id",
    { schema: { body: GroupBody }, preHandler: requirePermission(PERMISSIONS.SETTINGS_EDIT) },
    async (request, reply) => {
      const before = await prisma.serviceGroup.findUnique({ where: { id: request.params.id } });
      if (!before) return reply.code(404).send({ error: "Service group not found" });
      const group = await prisma.serviceGroup.update({ where: { id: request.params.id }, data: request.body });
      await audit("service_group.update", request.user.sub, "ServiceGroup", group.id, before, group);
      return group;
    },
  );

  // Delete service group
  app.delete<{ Params: IdParamsType }>(
    "/service-groups/:id",
    { preHandler: requirePermission(PERMISSIONS.SETTINGS_EDIT) },
    async (request, reply) => {
      const before = await prisma.serviceGroup.findUnique({ where: { id: request.params.id } });
      if (!before) return reply.code(404).send({ error: "Service group not found" });
      // Unassign all publishers first
      await prisma.publisher.updateMany({ where: { serviceGroupId: request.params.id }, data: { serviceGroupId: null } });
      await prisma.serviceGroup.delete({ where: { id: request.params.id } });
      await audit("service_group.delete", request.user.sub, "ServiceGroup", request.params.id, before);
      return reply.code(204).send();
    },
  );

  // Assign publisher to service group
  app.post<{ Params: IdParamsType; Body: { publisherId: string } }>(
    "/service-groups/:id/members",
    {
      schema: { body: Type.Object({ publisherId: Type.String({ format: "uuid" }) }) },
      preHandler: requirePermission(PERMISSIONS.PUBLISHERS_EDIT),
    },
    async (request, reply) => {
      const group = await prisma.serviceGroup.findUnique({ where: { id: request.params.id } });
      if (!group) return reply.code(404).send({ error: "Service group not found" });
      await prisma.publisher.update({
        where: { id: request.body.publisherId },
        data: { serviceGroupId: request.params.id },
      });
      await audit("service_group.assign", request.user.sub, "ServiceGroup", request.params.id, null, { publisherId: request.body.publisherId });
      return { ok: true };
    },
  );

  // Remove publisher from service group
  app.delete<{ Params: { id: string; publisherId: string } }>(
    "/service-groups/:id/members/:publisherId",
    { preHandler: requirePermission(PERMISSIONS.PUBLISHERS_EDIT) },
    async (request, reply) => {
      await prisma.publisher.update({
        where: { id: request.params.publisherId },
        data: { serviceGroupId: null },
      });
      await audit("service_group.unassign", request.user.sub, "ServiceGroup", request.params.id, null, { publisherId: request.params.publisherId });
      return { ok: true };
    },
  );
}
