import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { maskFields, audit } from "../lib/policy-engine.js";
import { PERMISSIONS, FLAG_TO_APP_ROLE } from "../lib/permissions.js";
import { syncPublisherRoomMemberships } from "../lib/matrix-provisioning.js";
import { deleteKeycloakUser, assignKeycloakRole, removeKeycloakRole, sendExecuteActionsEmail, resetPassword } from "../lib/keycloak-admin.js";
import { randomBytes } from "node:crypto";

const PublisherBody = Type.Object({
  firstName: Type.String({ minLength: 1 }),
  lastName: Type.String({ minLength: 1 }),
  displayName: Type.Optional(Type.String()),
  email: Type.Optional(Type.String({ format: "email" })),
  phone: Type.Optional(Type.String()),
  gender: Type.Optional(Type.Union([Type.Literal("male"), Type.Literal("female")])),
  dateOfBirth: Type.Optional(Type.String({ format: "date" })),
  address: Type.Optional(Type.String()),
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
  notes: Type.Optional(Type.String()),
  role: Type.Optional(Type.Union([
    Type.Literal("admin"),
    Type.Literal("elder"),
    Type.Literal("publisher"),
    Type.Literal("viewer"),
  ])),
  isOwner: Type.Optional(Type.Boolean()),
});

/** Generate internal email: firstname.lastname@slug.hubport.cloud */
export async function generateInternalEmail(firstName: string, lastName: string): Promise<string> {
  const domain = process.env.WEBAUTHN_RP_ID || "hubport.cloud";
  const base = `${firstName.toLowerCase().replace(/[^a-z]/g, "")}.${lastName.toLowerCase().replace(/[^a-z]/g, "")}`;
  let candidate = `${base}@${domain}`;
  let suffix = 1;
  while (await prisma.publisher.findFirst({ where: { internalEmail: candidate } })) {
    suffix++;
    candidate = `${base}${suffix}@${domain}`;
  }
  return candidate;
}

/** Generate a strong temporary password (base64url + special char) */
function generateTempPassword(): string {
  const base = randomBytes(12).toString("base64url").slice(0, 15);
  return base + "!";
}

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
        include: {
          appRoles: { include: { role: { select: { name: true, scope: true } } } },
        },
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
        include: {
          assignments: { include: { territory: true } },
          appRoles: { include: { role: true } },
        },
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
      const { dateOfBirth, ...rest } = request.body;
      const internalEmail = await generateInternalEmail(rest.firstName, rest.lastName);
      const publisher = await prisma.publisher.create({
        data: {
          ...rest,
          internalEmail,
          ...(dateOfBirth ? { dateOfBirth: new Date(dateOfBirth) } : {}),
        },
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

      const { dateOfBirth: dob, ...restBody } = request.body;
      const publisher = await prisma.publisher.update({
        where: { id: request.params.id },
        data: {
          ...restBody,
          ...(dob !== undefined ? { dateOfBirth: dob ? new Date(dob) : null } : {}),
        },
      });

      await audit(
        "publisher.update",
        request.user.sub,
        "Publisher",
        publisher.id,
        existing,
        publisher,
      );

      // If congregationRole changed, sync Matrix room memberships
      if (existing.congregationRole !== publisher.congregationRole) {
        syncPublisherRoomMemberships(publisher.id).catch(() => {});
      }

      // If system role changed, sync Keycloak realm role
      if (existing.role !== publisher.role && existing.keycloakSub) {
        (async () => {
          try {
            if (existing.role) await removeKeycloakRole(existing.keycloakSub!, existing.role);
          } catch { /* old role may not exist */ }
          try {
            await assignKeycloakRole(existing.keycloakSub!, publisher.role);
          } catch (err) {
            app.log.warn({ err }, "Failed to sync KC realm role");
          }
        })().catch(() => {});
      }

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

      // Delete Keycloak user if linked (non-fatal — DB cleanup proceeds)
      if (existing.keycloakSub) {
        try {
          await deleteKeycloakUser(existing.keycloakSub);
        } catch (err) {
          app.log.warn({ err, keycloakSub: existing.keycloakSub }, "publisher.delete: Keycloak user removal failed");
        }
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

  // Get roles assigned to a publisher (auto-mapped + manual split)
  app.get<{ Params: IdParamsType }>(
    "/publishers/:id/roles",
    {
      preHandler: requirePermission(PERMISSIONS.PUBLISHERS_VIEW),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const { id } = request.params;

      const publisher = await prisma.publisher.findUnique({
        where: { id },
        select: {
          congregationRole: true,
          congregationFlags: true,
          appRoles: {
            include: { role: { select: { id: true, name: true, description: true, scope: true } } },
          },
        },
      });

      if (!publisher) {
        return reply.code(404).send({ error: "Publisher not found" });
      }

      // Derive auto-mapped roles from congregation flags (stored as String[])
      const flags = (publisher.congregationFlags as string[]) || [];
      const autoMapped: Array<{ roleName: string; fromFlag: string }> = [];
      for (const [flag, roleName] of Object.entries(FLAG_TO_APP_ROLE)) {
        if (flags.includes(flag)) {
          autoMapped.push({ roleName, fromFlag: flag });
        }
      }

      // Manual roles = AppRoleMember records
      const manual = publisher.appRoles.map((arm: any) => ({
        id: arm.role.id,
        name: arm.role.name,
        description: arm.role.description,
        scope: arm.role.scope,
        validFrom: arm.validFrom,
        validTo: arm.validTo,
      }));

      return reply.send({ autoMapped, manual });
    },
  );

  // ── Password Reset Rate Limiter ─────────────────────────────────
  const RESET_RATE_LIMIT = 3; // max 3 password resets per publisher per hour
  const RESET_RATE_WINDOW_MS = 60 * 60 * 1000;
  const resetTimestamps = new Map<string, number[]>();

  function checkResetRateLimit(publisherId: string): boolean {
    const now = Date.now();
    const timestamps = resetTimestamps.get(publisherId) || [];
    const recent = timestamps.filter(t => now - t < RESET_RATE_WINDOW_MS);
    resetTimestamps.set(publisherId, recent);
    if (recent.length >= RESET_RATE_LIMIT) return false;
    recent.push(now);
    return true;
  }

  // Admin-initiated password reset (elder-only)
  app.post<{ Params: IdParamsType }>(
    "/publishers/:id/reset-password",
    {
      preHandler: [requirePermission(PERMISSIONS.PUBLISHERS_RESET_PASSWORD)],
      schema: {
        params: IdParams,
      },
    },
    async (request, reply) => {
      const publisher = await prisma.publisher.findUnique({
        where: { id: request.params.id },
        select: { id: true, keycloakSub: true, firstName: true, lastName: true },
      });

      if (!publisher?.keycloakSub) {
        return reply.status(404).send({ error: "Publisher not found or not linked to Keycloak" });
      }

      if (!checkResetRateLimit(publisher.id)) {
        return reply.code(429).send({ error: "Rate limit exceeded — max 3 password resets per publisher per hour" });
      }

      try {
        const redirectUri = process.env.HUB_APP_URL || "/";
        await sendExecuteActionsEmail(publisher.keycloakSub, ["UPDATE_PASSWORD"], redirectUri, "hub-app");
        await audit(
          "publisher.reset-password",
          request.user.sub,
          "Publisher",
          publisher.id,
          undefined,
          { method: "email" },
        );
        return reply.send({ method: "email", message: "Password reset email sent" });
      } catch {
        const tempPassword = generateTempPassword();
        await resetPassword(publisher.keycloakSub, tempPassword, true);
        await audit(
          "publisher.reset-password",
          request.user.sub,
          "Publisher",
          publisher.id,
          undefined,
          { method: "temporary" },
        );
        return reply.send({
          method: "temporary",
          temporaryPassword: tempPassword,
          message: "Temporary password set. User must change it on next login.",
        });
      }
    },
  );
}
