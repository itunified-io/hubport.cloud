/**
 * Publisher routes — CRUD with permission-based auth and field masking.
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import {
  requirePermission,
  requireAnyPermission,
  getPolicyContext,
  getPolicyEngine,
} from "../lib/rbac.js";
import { PERMISSIONS, FLAG_TO_ROLE } from "../lib/permissions.js";
import { createKeycloakUser, assignKeycloakRole } from "../lib/keycloak-admin.js";
import { createHash, randomBytes } from "node:crypto";

const P = PERMISSIONS;

const PublisherBody = Type.Object({
  firstName: Type.String({ minLength: 1 }),
  lastName: Type.String({ minLength: 1 }),
  displayName: Type.Optional(Type.String()),
  email: Type.Optional(Type.String({ format: "email" })),
  phone: Type.Optional(Type.String()),
  gender: Type.Optional(Type.Union([Type.Literal("male"), Type.Literal("female")])),
  dateOfBirth: Type.Optional(Type.String({ format: "date" })),
  address: Type.Optional(Type.String()),
  congregationRole: Type.Optional(
    Type.Union([
      Type.Literal("publisher"),
      Type.Literal("ministerial_servant"),
      Type.Literal("elder"),
    ]),
  ),
  congregationFlags: Type.Optional(Type.Array(Type.String())),
  status: Type.Optional(
    Type.Union([
      Type.Literal("active"),
      Type.Literal("inactive"),
      Type.Literal("invited"),
      Type.Literal("pending_approval"),
      Type.Literal("rejected"),
    ]),
  ),
  notes: Type.Optional(Type.String()),
});

type PublisherBodyType = Static<typeof PublisherBody>;

const IdParams = Type.Object({
  id: Type.String({ format: "uuid" }),
});
type IdParamsType = Static<typeof IdParams>;

export async function publisherRoutes(app: FastifyInstance): Promise<void> {
  // List all publishers — with field masking
  app.get(
    "/publishers",
    {
      preHandler: requireAnyPermission(P.PUBLISHERS_VIEW, P.PUBLISHERS_VIEW_MINIMAL),
    },
    async (request) => {
      const ctx = await getPolicyContext(request);
      const engine = getPolicyEngine();

      const publishers = await prisma.publisher.findMany({
        orderBy: { lastName: "asc" },
        include: {
          appRoles: {
            include: { role: { select: { id: true, name: true, scope: true } } },
          },
        },
      });

      return publishers.map((p) => {
        const masked = engine.maskFields(p as unknown as Record<string, unknown>, ctx);
        return {
          ...masked,
          appRoles: (p.appRoles ?? []).map((ar) => ({
            roleId: ar.role.id,
            roleName: ar.role.name,
            scope: ar.role.scope,
          })),
        };
      });
    },
  );

  // Get one publisher — with field masking
  app.get<{ Params: IdParamsType }>(
    "/publishers/:id",
    {
      preHandler: requireAnyPermission(P.PUBLISHERS_VIEW, P.PUBLISHERS_VIEW_MINIMAL),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const ctx = await getPolicyContext(request);
      const engine = getPolicyEngine();

      const publisher = await prisma.publisher.findUnique({
        where: { id: request.params.id },
        include: {
          assignments: { include: { territory: true } },
          appRoles: {
            include: { role: true },
          },
        },
      });
      if (!publisher) return reply.code(404).send({ error: "Not found" });

      return engine.maskFields(publisher as unknown as Record<string, unknown>, ctx);
    },
  );

  // Create publisher — elder+
  app.post<{ Body: PublisherBodyType }>(
    "/publishers",
    {
      preHandler: requirePermission(P.PUBLISHERS_EDIT),
      schema: { body: PublisherBody },
    },
    async (request, reply) => {
      const ctx = await getPolicyContext(request);
      const engine = getPolicyEngine();

      const data: Record<string, unknown> = {
        firstName: request.body.firstName,
        lastName: request.body.lastName,
        displayName: request.body.displayName,
        email: request.body.email,
        phone: request.body.phone,
        gender: request.body.gender,
        dateOfBirth: request.body.dateOfBirth
          ? new Date(request.body.dateOfBirth)
          : undefined,
        address: request.body.address,
        congregationRole: request.body.congregationRole ?? "publisher",
        congregationFlags: request.body.congregationFlags ?? [],
        status: request.body.status ?? "active",
        notes: request.body.notes,
        role: mapCongregationToKeycloakRole(request.body.congregationRole),
      };

      const publisher = await prisma.publisher.create({
        data: data as Parameters<typeof prisma.publisher.create>[0]["data"],
      });

      // Auto-assign AppRoles based on congregation flags
      await autoAssignRoles(publisher.id, request.body.congregationFlags ?? []);

      await engine.audit(
        ctx.userId, "publisher.create", "Publisher", publisher.id,
        undefined, { firstName: publisher.firstName, lastName: publisher.lastName },
      );

      return reply.code(201).send(publisher);
    },
  );

  // Update publisher — elder+
  app.put<{ Params: IdParamsType; Body: PublisherBodyType }>(
    "/publishers/:id",
    {
      preHandler: requirePermission(P.PUBLISHERS_EDIT),
      schema: { params: IdParams, body: PublisherBody },
    },
    async (request, reply) => {
      const ctx = await getPolicyContext(request);
      const engine = getPolicyEngine();

      const existing = await prisma.publisher.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) return reply.code(404).send({ error: "Not found" });

      const data: Record<string, unknown> = { ...request.body };
      if (request.body.dateOfBirth) {
        data.dateOfBirth = new Date(request.body.dateOfBirth);
      }
      if (request.body.congregationRole) {
        data.role = mapCongregationToKeycloakRole(request.body.congregationRole);
      }

      const publisher = await prisma.publisher.update({
        where: { id: request.params.id },
        data: data as Parameters<typeof prisma.publisher.update>[0]["data"],
      });

      // Re-evaluate auto-assigned roles if flags changed
      if (request.body.congregationFlags) {
        await autoAssignRoles(publisher.id, request.body.congregationFlags);
      }

      await engine.audit(
        ctx.userId, "publisher.update", "Publisher", publisher.id,
        { firstName: existing.firstName, lastName: existing.lastName, status: existing.status },
        { firstName: publisher.firstName, lastName: publisher.lastName, status: publisher.status },
      );

      return publisher;
    },
  );

  // Delete publisher — admin only
  app.delete<{ Params: IdParamsType }>(
    "/publishers/:id",
    {
      preHandler: requirePermission(P.PUBLISHERS_DELETE),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const ctx = await getPolicyContext(request);
      const engine = getPolicyEngine();

      const existing = await prisma.publisher.findUnique({
        where: { id: request.params.id },
      });
      if (!existing) return reply.code(404).send({ error: "Not found" });

      await prisma.publisher.delete({ where: { id: request.params.id } });

      await engine.audit(
        ctx.userId, "publisher.delete", "Publisher", existing.id,
        { firstName: existing.firstName, lastName: existing.lastName }, undefined,
      );

      return reply.code(204).send();
    },
  );

  // POST /publishers/:id/invite — send onboarding invitation
  app.post<{ Params: IdParamsType }>(
    "/publishers/:id/invite",
    {
      preHandler: requirePermission(P.PUBLISHERS_INVITE),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const ctx = await getPolicyContext(request);
      const engine = getPolicyEngine();

      const publisher = await prisma.publisher.findUnique({
        where: { id: request.params.id },
      });
      if (!publisher) return reply.code(404).send({ error: "Not found" });
      if (publisher.keycloakSub) {
        return reply.code(400).send({ error: "Publisher already has an account" });
      }

      // Generate invite code
      const code = randomBytes(16).toString("hex");
      const codeHash = createHash("sha256").update(code).digest("hex");

      // Create or update invite code
      await prisma.inviteCode.upsert({
        where: { publisherId: publisher.id },
        update: {
          codeHash,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          redeemedAt: null,
        },
        create: {
          codeHash,
          publisherId: publisher.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      // Update publisher status
      await prisma.publisher.update({
        where: { id: publisher.id },
        data: {
          status: "invited",
          invitedBy: ctx.userId,
          invitedAt: new Date(),
        },
      });

      // If publisher has email, create Keycloak account
      let keycloakUserId: string | undefined;
      if (publisher.email) {
        const kcResult = await createKeycloakUser(
          publisher.email,
          publisher.firstName,
          publisher.lastName,
        );
        if (kcResult.success && kcResult.data) {
          keycloakUserId = kcResult.data.userId;

          // Assign Keycloak role
          const kcRole = mapCongregationToKeycloakRole(publisher.congregationRole);
          await assignKeycloakRole(keycloakUserId, kcRole);

          // Link publisher to Keycloak
          await prisma.publisher.update({
            where: { id: publisher.id },
            data: { keycloakSub: keycloakUserId },
          });
        }
      }

      await engine.audit(
        ctx.userId, "publisher.invite", "Publisher", publisher.id,
        undefined, { code: "***", email: publisher.email, keycloakUserId },
      );

      return reply.code(200).send({
        inviteCode: code,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        keycloakUserCreated: !!keycloakUserId,
      });
    },
  );

  // GET /publishers/me — own full record
  app.get("/publishers/me", async (request, reply) => {
    const ctx = await getPolicyContext(request);
    if (!ctx.publisherId) {
      return reply.code(404).send({ error: "No publisher record linked to your account" });
    }

    const publisher = await prisma.publisher.findUnique({
      where: { id: ctx.publisherId },
      include: {
        assignments: { include: { territory: true } },
        appRoles: { include: { role: true } },
      },
    });

    return publisher;
  });

  // PUT /publishers/me — edit own record (limited fields)
  app.put<{ Body: { displayName?: string; email?: string; phone?: string } }>(
    "/publishers/me",
    {
      schema: {
        body: Type.Object({
          displayName: Type.Optional(Type.String()),
          email: Type.Optional(Type.String({ format: "email" })),
          phone: Type.Optional(Type.String()),
        }),
      },
    },
    async (request, reply) => {
      const ctx = await getPolicyContext(request);
      if (!ctx.publisherId) {
        return reply.code(404).send({ error: "No publisher record linked" });
      }

      const publisher = await prisma.publisher.update({
        where: { id: ctx.publisherId },
        data: request.body,
      });

      return publisher;
    },
  );

  // PUT /publishers/me/privacy — update own privacy settings
  app.put<{
    Body: {
      contactVisibility: string;
      addressVisibility: string;
      notesVisibility: string;
    };
  }>(
    "/publishers/me/privacy",
    {
      schema: {
        body: Type.Object({
          contactVisibility: Type.Union([
            Type.Literal("everyone"),
            Type.Literal("elders_only"),
            Type.Literal("nobody"),
          ]),
          addressVisibility: Type.Union([
            Type.Literal("everyone"),
            Type.Literal("elders_only"),
            Type.Literal("nobody"),
          ]),
          notesVisibility: Type.Union([
            Type.Literal("everyone"),
            Type.Literal("elders_only"),
            Type.Literal("nobody"),
          ]),
        }),
      },
    },
    async (request, reply) => {
      const ctx = await getPolicyContext(request);
      if (!ctx.publisherId) {
        return reply.code(404).send({ error: "No publisher record linked" });
      }

      const publisher = await prisma.publisher.update({
        where: { id: ctx.publisherId },
        data: {
          privacySettings: request.body,
          privacyAccepted: true,
          privacyAcceptedAt: new Date(),
        },
      });

      return publisher;
    },
  );

  // POST /publishers/:id/approve — pending_approval → active
  app.post<{ Params: IdParamsType }>(
    "/publishers/:id/approve",
    {
      preHandler: requirePermission(P.PUBLISHERS_EDIT),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const ctx = await getPolicyContext(request);
      const engine = getPolicyEngine();

      const publisher = await prisma.publisher.findUnique({
        where: { id: request.params.id },
      });
      if (!publisher) return reply.code(404).send({ error: "Not found" });
      if (publisher.status !== "pending_approval" && publisher.status !== "invited") {
        return reply.code(400).send({
          error: `Cannot approve publisher with status '${publisher.status}'`,
        });
      }

      const updated = await prisma.publisher.update({
        where: { id: request.params.id },
        data: {
          status: "active",
          approvedBy: ctx.userId,
          approvedAt: new Date(),
        },
      });

      await engine.audit(
        ctx.userId, "publisher.approve", "Publisher", publisher.id,
        { status: publisher.status }, { status: "active" },
      );

      return updated;
    },
  );

  // POST /publishers/:id/reject — pending_approval → rejected
  app.post<{ Params: IdParamsType; Body: { reason?: string } }>(
    "/publishers/:id/reject",
    {
      preHandler: requirePermission(P.PUBLISHERS_EDIT),
      schema: {
        params: IdParams,
        body: Type.Object({ reason: Type.Optional(Type.String()) }),
      },
    },
    async (request, reply) => {
      const ctx = await getPolicyContext(request);
      const engine = getPolicyEngine();

      const publisher = await prisma.publisher.findUnique({
        where: { id: request.params.id },
      });
      if (!publisher) return reply.code(404).send({ error: "Not found" });

      const updated = await prisma.publisher.update({
        where: { id: request.params.id },
        data: { status: "rejected" },
      });

      await engine.audit(
        ctx.userId, "publisher.reject", "Publisher", publisher.id,
        { status: publisher.status },
        { status: "rejected", reason: request.body.reason },
      );

      return updated;
    },
  );

  // POST /publishers/:id/deactivate — active → inactive
  app.post<{ Params: IdParamsType }>(
    "/publishers/:id/deactivate",
    {
      preHandler: requirePermission(P.PUBLISHERS_EDIT),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const ctx = await getPolicyContext(request);
      const engine = getPolicyEngine();

      const publisher = await prisma.publisher.findUnique({
        where: { id: request.params.id },
      });
      if (!publisher) return reply.code(404).send({ error: "Not found" });

      const updated = await prisma.publisher.update({
        where: { id: request.params.id },
        data: { status: "inactive" },
      });

      await engine.audit(
        ctx.userId, "publisher.deactivate", "Publisher", publisher.id,
        { status: publisher.status }, { status: "inactive" },
      );

      return updated;
    },
  );

  // POST /publishers/:id/reactivate — inactive → active
  app.post<{ Params: IdParamsType }>(
    "/publishers/:id/reactivate",
    {
      preHandler: requirePermission(P.PUBLISHERS_EDIT),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const ctx = await getPolicyContext(request);
      const engine = getPolicyEngine();

      const publisher = await prisma.publisher.findUnique({
        where: { id: request.params.id },
      });
      if (!publisher) return reply.code(404).send({ error: "Not found" });

      const updated = await prisma.publisher.update({
        where: { id: request.params.id },
        data: { status: "active" },
      });

      await engine.audit(
        ctx.userId, "publisher.reactivate", "Publisher", publisher.id,
        { status: publisher.status }, { status: "active" },
      );

      return updated;
    },
  );
}

// --- Helpers ---

function mapCongregationToKeycloakRole(role?: string): string {
  switch (role) {
    case "elder": return "elder";
    case "ministerial_servant": return "publisher";
    case "publisher": return "publisher";
    default: return "publisher";
  }
}

async function autoAssignRoles(
  publisherId: string,
  flags: string[],
): Promise<void> {
  for (const [flag, roleName] of Object.entries(FLAG_TO_ROLE)) {
    if (flags.includes(flag)) {
      const role = await prisma.appRole.findUnique({ where: { name: roleName } });
      if (role) {
        await prisma.appRoleMember.upsert({
          where: { roleId_publisherId: { roleId: role.id, publisherId } },
          update: {},
          create: { roleId: role.id, publisherId },
        });
      }
    }
  }
}
