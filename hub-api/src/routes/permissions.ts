import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { getPageVisibility, audit } from "../lib/policy-engine.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { seedSystemRoles } from "../lib/seed-roles.js";

const IdParams = Type.Object({ id: Type.String({ format: "uuid" }) });
type IdParamsType = Static<typeof IdParams>;

const RoleBody = Type.Object({
  name: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
  permissions: Type.Array(Type.String()),
  scope: Type.Optional(Type.Union([
    Type.Literal("all"),
    Type.Literal("midweek"),
    Type.Literal("weekend"),
  ])),
});
type RoleBodyType = Static<typeof RoleBody>;

const MemberAssignBody = Type.Object({
  publisherId: Type.String({ format: "uuid" }),
  validFrom: Type.Optional(Type.String({ format: "date-time" })),
  validTo: Type.Optional(Type.String({ format: "date-time" })),
  deniedPermissions: Type.Optional(Type.Array(Type.String())),
});
type MemberAssignBodyType = Static<typeof MemberAssignBody>;

const MemberIdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
  publisherId: Type.String({ format: "uuid" }),
});
type MemberIdParamsType = Static<typeof MemberIdParams>;

export async function permissionRoutes(app: FastifyInstance): Promise<void> {
  // ─── Self Permissions ────────────────────────────────────────────

  app.get("/permissions/me", async (request) => {
    const ctx = request.policyCtx;
    if (!ctx) return { effectivePermissions: [], denyRules: [], pageVisibility: {} };

    return {
      effectivePermissions: ctx.effectivePermissions,
      denyRules: ctx.denyRules,
      pageVisibility: getPageVisibility(ctx),
      privacyAccepted: ctx.privacyAccepted,
      congregationRole: ctx.congregationRole,
      appRoles: ctx.appRoles.map((r) => ({
        name: r.name,
        scope: r.scope,
      })),
    };
  });

  // ─── Role CRUD (admin) ──────────────────────────────────────────

  app.get(
    "/roles",
    { preHandler: requirePermission(PERMISSIONS.ROLES_VIEW) },
    async () => {
      return prisma.appRole.findMany({
        orderBy: { name: "asc" },
        include: { _count: { select: { members: true } } },
      });
    },
  );

  app.post<{ Body: RoleBodyType }>(
    "/roles",
    {
      preHandler: requirePermission(PERMISSIONS.ROLES_EDIT),
      schema: { body: RoleBody },
    },
    async (request, reply) => {
      const role = await prisma.appRole.create({
        data: {
          name: request.body.name,
          description: request.body.description,
          permissions: request.body.permissions,
          scope: request.body.scope ?? "all",
          isSystem: false,
        },
      });

      await audit(
        "role.create",
        request.user.sub,
        "AppRole",
        role.id,
        undefined,
        role,
      );

      return reply.code(201).send(role);
    },
  );

  app.put<{ Params: IdParamsType; Body: RoleBodyType }>(
    "/roles/:id",
    {
      preHandler: requirePermission(PERMISSIONS.ROLES_EDIT),
      schema: { params: IdParams, body: RoleBody },
    },
    async (request, reply) => {
      const existing = await prisma.appRole.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) return reply.code(404).send({ error: "Not found" });

      const role = await prisma.appRole.update({
        where: { id: request.params.id },
        data: {
          name: request.body.name,
          description: request.body.description,
          permissions: request.body.permissions,
          scope: request.body.scope ?? existing.scope,
        },
      });

      await audit(
        "role.update",
        request.user.sub,
        "AppRole",
        role.id,
        existing,
        role,
      );

      return role;
    },
  );

  app.delete<{ Params: IdParamsType }>(
    "/roles/:id",
    {
      preHandler: requirePermission(PERMISSIONS.ROLES_EDIT),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const existing = await prisma.appRole.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) return reply.code(404).send({ error: "Not found" });
      if (existing.isSystem) {
        return reply.code(400).send({ error: "Cannot delete system role" });
      }

      await prisma.appRole.delete({ where: { id: request.params.id } });

      await audit(
        "role.delete",
        request.user.sub,
        "AppRole",
        existing.id,
        existing,
      );

      return reply.code(204).send();
    },
  );

  // ─── Role Member Assignment ────────────────────────────────────

  app.post<{ Params: IdParamsType; Body: MemberAssignBodyType }>(
    "/roles/:id/members",
    {
      preHandler: requirePermission(PERMISSIONS.ROLES_EDIT),
      schema: { params: IdParams, body: MemberAssignBody },
    },
    async (request, reply) => {
      const role = await prisma.appRole.findUnique({
        where: { id: request.params.id },
      });
      if (!role) return reply.code(404).send({ error: "Role not found" });

      const member = await prisma.appRoleMember.upsert({
        where: {
          roleId_publisherId: {
            roleId: request.params.id,
            publisherId: request.body.publisherId,
          },
        },
        update: {
          validFrom: request.body.validFrom ? new Date(request.body.validFrom) : null,
          validTo: request.body.validTo ? new Date(request.body.validTo) : null,
          deniedPermissions: request.body.deniedPermissions ?? [],
        },
        create: {
          roleId: request.params.id,
          publisherId: request.body.publisherId,
          validFrom: request.body.validFrom ? new Date(request.body.validFrom) : null,
          validTo: request.body.validTo ? new Date(request.body.validTo) : null,
          deniedPermissions: request.body.deniedPermissions ?? [],
        },
      });

      await audit(
        "role.member.assign",
        request.user.sub,
        "AppRoleMember",
        member.id,
        undefined,
        { roleId: role.id, roleName: role.name, publisherId: request.body.publisherId },
      );

      return reply.code(201).send(member);
    },
  );

  app.delete<{ Params: MemberIdParamsType }>(
    "/roles/:id/members/:publisherId",
    {
      preHandler: requirePermission(PERMISSIONS.ROLES_EDIT),
      schema: { params: MemberIdParams },
    },
    async (request, reply) => {
      try {
        await prisma.appRoleMember.delete({
          where: {
            roleId_publisherId: {
              roleId: request.params.id,
              publisherId: request.params.publisherId,
            },
          },
        });
      } catch {
        return reply.code(404).send({ error: "Assignment not found" });
      }

      await audit(
        "role.member.remove",
        request.user.sub,
        "AppRoleMember",
        undefined,
        { roleId: request.params.id, publisherId: request.params.publisherId },
      );

      return reply.code(204).send();
    },
  );

  // ─── Seed System Roles ─────────────────────────────────────────

  app.post(
    "/roles/seed",
    { preHandler: requirePermission(PERMISSIONS.ROLES_EDIT) },
    async (_request, reply) => {
      await seedSystemRoles();
      return reply.send({ ok: true, message: "System roles seeded" });
    },
  );
}
