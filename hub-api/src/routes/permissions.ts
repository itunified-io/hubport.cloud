/**
 * Permission & Role management routes.
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission, getPolicyContext, getPolicyEngine } from "../lib/rbac.js";
import { seedSystemRoles } from "../lib/seed-roles.js";
import { PERMISSIONS } from "../lib/permissions.js";

const P = PERMISSIONS;

const IdParams = Type.Object({ id: Type.String({ format: "uuid" }) });
type IdParamsType = Static<typeof IdParams>;

const MemberIdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
  publisherId: Type.String({ format: "uuid" }),
});
type MemberIdParamsType = Static<typeof MemberIdParams>;

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

const AssignMemberBody = Type.Object({
  publisherId: Type.String({ format: "uuid" }),
  validFrom: Type.Optional(Type.String({ format: "date-time" })),
  validTo: Type.Optional(Type.String({ format: "date-time" })),
  deniedPermissions: Type.Optional(Type.Array(Type.String())),
});
type AssignMemberBodyType = Static<typeof AssignMemberBody>;

export async function permissionRoutes(app: FastifyInstance): Promise<void> {
  // GET /permissions/me — effective permissions for current user
  app.get("/permissions/me", async (request) => {
    const ctx = await getPolicyContext(request);
    const engine = getPolicyEngine();
    return {
      userId: ctx.userId,
      publisherId: ctx.publisherId,
      keycloakRole: ctx.keycloakRole,
      effectivePermissions: ctx.effectivePermissions,
      denyRules: ctx.denyRules,
      appRoles: ctx.appRoles.map((r) => ({
        roleId: r.roleId,
        name: r.name,
        scope: r.scope,
      })),
      pageVisibility: engine.pageVisibility(ctx),
      privacyAccepted: ctx.privacyAccepted,
    };
  });

  // GET /roles — list all AppRoles with member counts
  app.get(
    "/roles",
    { preHandler: requirePermission(P.ROLES_VIEW) },
    async () => {
      const roles = await prisma.appRole.findMany({
        orderBy: { name: "asc" },
        include: { _count: { select: { members: true } } },
      });
      return roles.map((r) => ({
        ...r,
        memberCount: r._count.members,
        _count: undefined,
      }));
    },
  );

  // POST /roles — create custom role
  app.post<{ Body: RoleBodyType }>(
    "/roles",
    {
      preHandler: requirePermission(P.ROLES_EDIT),
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

      const ctx = await getPolicyContext(request);
      await getPolicyEngine().audit(
        ctx.userId, "role.create", "AppRole", role.id,
        undefined, { name: role.name, permissions: role.permissions },
      );

      return reply.code(201).send(role);
    },
  );

  // PUT /roles/:id — update role
  app.put<{ Params: IdParamsType; Body: RoleBodyType }>(
    "/roles/:id",
    {
      preHandler: requirePermission(P.ROLES_EDIT),
      schema: { params: IdParams, body: RoleBody },
    },
    async (request, reply) => {
      const existing = await prisma.appRole.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) return reply.code(404).send({ error: "Role not found" });

      const role = await prisma.appRole.update({
        where: { id: request.params.id },
        data: {
          name: request.body.name,
          description: request.body.description,
          permissions: request.body.permissions,
          scope: request.body.scope ?? existing.scope,
        },
      });

      const ctx = await getPolicyContext(request);
      await getPolicyEngine().audit(
        ctx.userId, "role.update", "AppRole", role.id,
        { name: existing.name, permissions: existing.permissions },
        { name: role.name, permissions: role.permissions },
      );

      return role;
    },
  );

  // DELETE /roles/:id — delete non-system role
  app.delete<{ Params: IdParamsType }>(
    "/roles/:id",
    {
      preHandler: requirePermission(P.ROLES_EDIT),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const existing = await prisma.appRole.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) return reply.code(404).send({ error: "Role not found" });
      if (existing.isSystem) {
        return reply.code(400).send({ error: "Cannot delete system role" });
      }

      await prisma.appRole.delete({ where: { id: request.params.id } });

      const ctx = await getPolicyContext(request);
      await getPolicyEngine().audit(
        ctx.userId, "role.delete", "AppRole", existing.id,
        { name: existing.name }, undefined,
      );

      return reply.code(204).send();
    },
  );

  // POST /roles/:id/members — assign publisher to role
  app.post<{ Params: IdParamsType; Body: AssignMemberBodyType }>(
    "/roles/:id/members",
    {
      preHandler: requirePermission(P.ROLES_EDIT),
      schema: { params: IdParams, body: AssignMemberBody },
    },
    async (request, reply) => {
      const role = await prisma.appRole.findUnique({
        where: { id: request.params.id },
      });
      if (!role) return reply.code(404).send({ error: "Role not found" });

      const publisher = await prisma.publisher.findUnique({
        where: { id: request.body.publisherId },
      });
      if (!publisher) return reply.code(404).send({ error: "Publisher not found" });

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

      const ctx = await getPolicyContext(request);
      await getPolicyEngine().audit(
        ctx.userId, "role.assign", "AppRoleMember", member.id,
        undefined, { roleId: role.id, roleName: role.name, publisherId: publisher.id },
      );

      return reply.code(201).send(member);
    },
  );

  // DELETE /roles/:id/members/:publisherId — remove assignment
  app.delete<{ Params: MemberIdParamsType }>(
    "/roles/:id/members/:publisherId",
    {
      preHandler: requirePermission(P.ROLES_EDIT),
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

      const ctx = await getPolicyContext(request);
      await getPolicyEngine().audit(
        ctx.userId, "role.unassign", "AppRoleMember", "",
        { roleId: request.params.id, publisherId: request.params.publisherId }, undefined,
      );

      return reply.code(204).send();
    },
  );

  // POST /roles/seed — seed system roles (admin only, or called on first boot)
  app.post(
    "/roles/seed",
    { preHandler: requirePermission(P.WILDCARD) },
    async (_request, reply) => {
      const count = await seedSystemRoles(prisma);
      return reply.send({ seeded: count });
    },
  );
}
