import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { randomBytes, createHash } from "node:crypto";
import prisma from "../lib/prisma.js";
import { generateInternalEmail } from "./publishers.js";
import { requirePermission } from "../lib/rbac.js";
import { audit } from "../lib/policy-engine.js";
import { PERMISSIONS, FLAG_TO_APP_ROLE, CONGREGATION_FLAGS } from "../lib/permissions.js";
import {
  createKeycloakUser,
  disableKeycloakUser,
  enableKeycloakUser,
  deleteKeycloakUser,
  logoutKeycloakUser,
} from "../lib/keycloak-admin.js";
import { getMailRelaySecret } from "../lib/vault-client.js";
import { ensureMatrixUser, uploadMatrixMedia } from "../lib/matrix-admin.js";

const IdParams = Type.Object({ id: Type.String({ format: "uuid" }) });
type IdParamsType = Static<typeof IdParams>;

const InviteBody = Type.Object({
  firstName: Type.String({ minLength: 1 }),
  lastName: Type.String({ minLength: 1 }),
  email: Type.String({ format: "email" }),
  gender: Type.Optional(Type.Union([Type.Literal("male"), Type.Literal("female")])),
  congregationRole: Type.Optional(Type.Union([
    Type.Literal("publisher"),
    Type.Literal("ministerial_servant"),
    Type.Literal("elder"),
  ])),
  congregationFlags: Type.Optional(Type.Array(Type.String())),
});
type InviteBodyType = Static<typeof InviteBody>;

function validateFlags(role: string, flags: string[]): string[] {
  const validCommon = CONGREGATION_FLAGS.common as readonly string[];
  const validRole = role === "elder"
    ? (CONGREGATION_FLAGS.elder as readonly string[])
    : role === "ministerial_servant"
      ? (CONGREGATION_FLAGS.ministerial_servant as readonly string[])
      : [];

  return flags.filter(
    (f) => validCommon.includes(f) || validRole.includes(f),
  );
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  // ─── List Users ──────────────────────────────────────────────────

  app.get(
    "/users",
    { preHandler: requirePermission(PERMISSIONS.ROLES_VIEW) },
    async () => {
      return prisma.publisher.findMany({
        orderBy: { lastName: "asc" },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
          email: true,
          congregationRole: true,
          congregationFlags: true,
          status: true,
          role: true,
          createdAt: true,
          invitedAt: true,
          approvedAt: true,
          appRoles: {
            include: { role: { select: { name: true, scope: true } } },
          },
        },
      });
    },
  );

  // ─── Invite User ─────────────────────────────────────────────────

  app.post<{ Body: InviteBodyType }>(
    "/users/invite",
    {
      preHandler: requirePermission(PERMISSIONS.ROLES_EDIT),
      schema: { body: InviteBody },
    },
    async (request, reply) => {
      const {
        firstName, lastName, email, gender,
        congregationRole = "publisher",
        congregationFlags = [],
      } = request.body;

      const validFlags = validateFlags(congregationRole, congregationFlags);
      const internalEmail = await generateInternalEmail(firstName, lastName);

      // Create publisher record in invited status
      const publisher = await prisma.publisher.create({
        data: {
          firstName,
          lastName,
          email,
          internalEmail,
          gender,
          congregationRole,
          congregationFlags: validFlags,
          status: "invited",
          invitedBy: request.user.sub,
          invitedAt: new Date(),
        },
      });

      // Generate invite code (6 alphanumeric chars, URL-safe)
      const code = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
      const codeHash = createHash("sha256").update(code).digest("hex");

      await prisma.inviteCode.create({
        data: {
          codeHash,
          publisherId: publisher.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        },
      });

      // Keycloak user creation deferred to POST /onboarding/redeem
      // (createInvitedKeycloakUser sets emailVerified=true, temp password)

      // Auto-assign AppRoles based on congregation flags
      for (const flag of validFlags) {
        const appRoleName = FLAG_TO_APP_ROLE[flag];
        if (appRoleName) {
          const appRole = await prisma.appRole.findUnique({
            where: { name: appRoleName },
          });
          if (appRole) {
            await prisma.appRoleMember.create({
              data: { roleId: appRole.id, publisherId: publisher.id },
            });
          }
        }
      }

      await audit(
        "user.invite",
        request.user.sub,
        "Publisher",
        publisher.id,
        undefined,
        { firstName, lastName, congregationRole, congregationFlags: validFlags },
      );

      return reply.code(201).send({
        publisher,
        inviteCode: code,
      });
    },
  );

  // ─── Approve User ────────────────────────────────────────────────

  app.post<{ Params: IdParamsType }>(
    "/users/:id/approve",
    {
      preHandler: requirePermission(PERMISSIONS.ROLES_EDIT),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const publisher = await prisma.publisher.findUnique({
        where: { id: request.params.id },
      });
      if (!publisher) return reply.code(404).send({ error: "Not found" });
      if (publisher.status !== "pending_approval" && publisher.status !== "invited") {
        return reply.code(400).send({ error: `Cannot approve from status: ${publisher.status}` });
      }

      const updated = await prisma.publisher.update({
        where: { id: request.params.id },
        data: {
          status: "active",
          approvedBy: request.user.sub,
          approvedAt: new Date(),
        },
      });

      await audit(
        "user.approve",
        request.user.sub,
        "Publisher",
        publisher.id,
        { status: publisher.status },
        { status: "active" },
      );

      return updated;
    },
  );

  // ─── Reject User ─────────────────────────────────────────────────

  app.post<{ Params: IdParamsType }>(
    "/users/:id/reject",
    {
      preHandler: requirePermission(PERMISSIONS.ROLES_EDIT),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const publisher = await prisma.publisher.findUnique({
        where: { id: request.params.id },
      });
      if (!publisher) return reply.code(404).send({ error: "Not found" });
      if (publisher.status !== "pending_approval" && publisher.status !== "invited") {
        return reply.code(400).send({ error: `Cannot reject from status: ${publisher.status}` });
      }

      const updated = await prisma.publisher.update({
        where: { id: request.params.id },
        data: { status: "rejected" },
      });

      await audit(
        "user.reject",
        request.user.sub,
        "Publisher",
        publisher.id,
        { status: publisher.status },
        { status: "rejected" },
      );

      return updated;
    },
  );

  // ─── Deactivate User ─────────────────────────────────────────────

  app.post<{ Params: IdParamsType }>(
    "/users/:id/deactivate",
    {
      preHandler: requirePermission(PERMISSIONS.ROLES_EDIT),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const publisher = await prisma.publisher.findUnique({
        where: { id: request.params.id },
      });
      if (!publisher) return reply.code(404).send({ error: "Not found" });
      if (publisher.status !== "active") {
        return reply.code(400).send({ error: `Cannot deactivate from status: ${publisher.status}` });
      }

      // Disable in Keycloak
      if (publisher.keycloakSub) {
        try {
          await disableKeycloakUser(publisher.keycloakSub);
          await logoutKeycloakUser(publisher.keycloakSub);
        } catch {
          // Log but continue — DB state is authoritative
        }
      }

      const updated = await prisma.publisher.update({
        where: { id: request.params.id },
        data: { status: "inactive" },
      });

      await audit(
        "user.deactivate",
        request.user.sub,
        "Publisher",
        publisher.id,
        { status: "active" },
        { status: "inactive" },
      );

      return updated;
    },
  );

  // ─── Reactivate User ─────────────────────────────────────────────

  app.post<{ Params: IdParamsType }>(
    "/users/:id/reactivate",
    {
      preHandler: requirePermission(PERMISSIONS.ROLES_EDIT),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const publisher = await prisma.publisher.findUnique({
        where: { id: request.params.id },
      });
      if (!publisher) return reply.code(404).send({ error: "Not found" });
      if (publisher.status !== "inactive") {
        return reply.code(400).send({ error: `Cannot reactivate from status: ${publisher.status}` });
      }

      // Re-enable in Keycloak
      if (publisher.keycloakSub) {
        try {
          await enableKeycloakUser(publisher.keycloakSub);
        } catch {
          // Log but continue
        }
      }

      const updated = await prisma.publisher.update({
        where: { id: request.params.id },
        data: { status: "active" },
      });

      await audit(
        "user.reactivate",
        request.user.sub,
        "Publisher",
        publisher.id,
        { status: "inactive" },
        { status: "active" },
      );

      return updated;
    },
  );

  // ─── Self-Service Routes ──────────────────────────────────────────

  // Get own profile
  app.get("/publishers/me", async (request, reply) => {
    const ctx = request.policyCtx;
    if (!ctx?.publisherId) return reply.code(404).send({ error: "No publisher record" });

    return prisma.publisher.findUnique({
      where: { id: ctx.publisherId },
      include: {
        appRoles: { include: { role: { select: { name: true, scope: true } } } },
      },
    });
  });

  // Update own profile
  app.put("/publishers/me", {
    schema: {
      body: Type.Object({
        displayName: Type.Optional(Type.String()),
        phone: Type.Optional(Type.String()),
        email: Type.Optional(Type.String({ format: "email" })),
      }),
    },
  }, async (request, reply) => {
    const ctx = request.policyCtx;
    if (!ctx?.publisherId) return reply.code(404).send({ error: "No publisher record" });

    const body = request.body as { displayName?: string; phone?: string; email?: string };
    const before = await prisma.publisher.findUnique({ where: { id: ctx.publisherId } });

    const updated = await prisma.publisher.update({
      where: { id: ctx.publisherId },
      data: {
        ...(body.displayName !== undefined && { displayName: body.displayName }),
        ...(body.phone !== undefined && { phone: body.phone }),
        ...(body.email !== undefined && { email: body.email }),
      },
    });

    await audit("publisher.self.update", ctx.userId, "Publisher", ctx.publisherId, before, updated);

    return updated;
  });

  // Upload profile picture
  app.post("/publishers/me/avatar", async (request, reply) => {
    const ctx = request.policyCtx;
    if (!ctx?.publisherId) return reply.code(403).send({ error: "Not a publisher" });

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: "No file uploaded" });

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(data.mimetype)) {
      return reply.code(400).send({ error: "Only JPEG, PNG, WebP, and GIF images are allowed" });
    }

    const buffer = await data.toBuffer();
    if (buffer.length > 2 * 1024 * 1024) {
      return reply.code(400).send({ error: "Image must be under 2MB" });
    }

    // Upload to Synapse media store → mxc:// URL
    const mxcUrl = await uploadMatrixMedia(buffer, data.mimetype, data.filename || "avatar.jpg");

    // Update publisher record
    const before = await prisma.publisher.findUnique({ where: { id: ctx.publisherId } });
    const updated = await prisma.publisher.update({
      where: { id: ctx.publisherId },
      data: { avatarUrl: mxcUrl },
    });

    // Sync avatar to Matrix user profile
    const localpart = updated.id;
    try {
      await ensureMatrixUser(localpart, updated.displayName ?? `${updated.firstName} ${updated.lastName}`, mxcUrl);
    } catch {
      // Non-fatal — avatar is stored in DB even if Synapse sync fails
      request.log.warn("Failed to sync avatar to Synapse");
    }

    await audit("publisher.avatar.update", ctx.userId, "Publisher", ctx.publisherId, before, updated);

    return reply.send({ avatarUrl: mxcUrl });
  });

  // Update own privacy settings
  app.put("/publishers/me/privacy", {
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
  }, async (request, reply) => {
    const ctx = request.policyCtx;
    if (!ctx?.publisherId) return reply.code(404).send({ error: "No publisher record" });

    const body = request.body as Record<string, string>;
    const updated = await prisma.publisher.update({
      where: { id: ctx.publisherId },
      data: {
        privacySettings: body,
        privacyAccepted: true,
        privacyAcceptedAt: new Date(),
      },
    });

    await audit("publisher.privacy.update", ctx.userId, "Publisher", ctx.publisherId, undefined, body);

    return updated;
  });

  // Self-deactivate
  app.post("/publishers/me/deactivate", async (request, reply) => {
    const ctx = request.policyCtx;
    if (!ctx?.publisherId) return reply.code(404).send({ error: "No publisher record" });

    const publisher = await prisma.publisher.findUnique({ where: { id: ctx.publisherId } });
    if (!publisher) return reply.code(404).send({ error: "Not found" });

    if (publisher.keycloakSub) {
      try {
        await disableKeycloakUser(publisher.keycloakSub);
        await logoutKeycloakUser(publisher.keycloakSub);
      } catch {
        // Continue
      }
    }

    await prisma.publisher.update({
      where: { id: ctx.publisherId },
      data: { status: "inactive" },
    });

    await audit("publisher.self.deactivate", ctx.userId, "Publisher", ctx.publisherId);

    return { ok: true, message: "Account deactivated" };
  });

  // GDPR hard delete
  app.delete("/publishers/me", async (request, reply) => {
    const ctx = request.policyCtx;
    if (!ctx?.publisherId) return reply.code(404).send({ error: "No publisher record" });

    const publisher = await prisma.publisher.findUnique({ where: { id: ctx.publisherId } });
    if (!publisher) return reply.code(404).send({ error: "Not found" });

    // Delete from Keycloak
    if (publisher.keycloakSub) {
      try {
        await deleteKeycloakUser(publisher.keycloakSub);
      } catch {
        // Continue — DB delete is more important
      }
    }

    // Cascade delete (AppRoleMember, InviteCode cascade via onDelete)
    await prisma.publisher.delete({ where: { id: ctx.publisherId } });

    await audit("publisher.self.gdpr_delete", ctx.userId, "Publisher", ctx.publisherId, publisher);

    return reply.code(204).send();
  });

  // ── Invite Email Rate Limiter (ADR-0079) ─────────────────────────
  const INVITE_RATE_LIMIT = 3; // max invite emails per publisher per hour
  const INVITE_RATE_WINDOW_MS = 60 * 60 * 1000;
  const inviteSendTimestamps = new Map<string, number[]>();

  function checkInviteRateLimit(publisherId: string): boolean {
    const now = Date.now();
    const timestamps = inviteSendTimestamps.get(publisherId) || [];
    const recent = timestamps.filter(t => now - t < INVITE_RATE_WINDOW_MS);
    inviteSendTimestamps.set(publisherId, recent);
    if (recent.length >= INVITE_RATE_LIMIT) return false;
    recent.push(now);
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════
  // INVITE EMAIL — relay via central API (no Gmail creds in tenant)
  // ═══════════════════════════════════════════════════════════════════

  const InviteEmailBody = Type.Object({
    publisherId: Type.String({ format: "uuid" }),
    inviteCode: Type.String(),
    email: Type.String({ format: "email" }),
    firstName: Type.String(),
  });

  type InviteEmailBodyType = Static<typeof InviteEmailBody>;

  app.post<{ Body: InviteEmailBodyType }>(
    "/users/invite-email",
    {
      schema: { body: InviteEmailBody },
      preHandler: requirePermission(PERMISSIONS.ROLES_EDIT),
    },
    async (request, reply) => {
      const { publisherId, inviteCode, email, firstName } = request.body;
      const centralApiUrl = process.env.CENTRAL_API_URL || process.env.HUB_API_URL;
      const tenantSlug = process.env.WEBAUTHN_RP_ID?.replace(".hubport.cloud", "") || "tenant";
      let relaySecret: string;
      try {
        relaySecret = await getMailRelaySecret();
      } catch {
        return reply.code(503).send({ error: "Email relay not configured (MAIL_RELAY_SECRET not available)" });
      }
      if (!centralApiUrl) {
        return reply.code(503).send({ error: "Email relay not configured (missing CENTRAL_API_URL)" });
      }

      // Verify publisher exists and has email — use DB email, NOT request body (ADR-0079)
      const publisher = await prisma.publisher.findUnique({ where: { id: publisherId } });
      if (!publisher) {
        return reply.code(404).send({ error: "Publisher not found" });
      }
      if (!publisher.email) {
        return reply.code(400).send({ error: "Publisher has no email address" });
      }
      if (!checkInviteRateLimit(publisherId)) {
        return reply.code(429).send({ error: "Rate limit exceeded — max 3 invite emails per publisher per hour" });
      }

      try {
        const res = await fetch(`${centralApiUrl}/admin/internal/send-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${relaySecret}`,
          },
          body: JSON.stringify({
            to: publisher.email,
            subject: `Einladung zu ${tenantSlug}.hubport.cloud`,
            templateName: "invite",
            templateData: { firstName, inviteCode, tenantSlug },
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          app.log.error({ status: res.status, data }, "invite email relay failed");
          return reply.code(502).send({ error: "Failed to send invite email" });
        }

        await audit("user.invite_email", request.user.sub, "Publisher", publisherId, { email });
        return { ok: true };
      } catch (err) {
        app.log.error(err, "invite email relay error");
        return reply.code(502).send({ error: "Email service unreachable" });
      }
    },
  );

  // ─── Resend Invite ──────────────────────────────────────────────
  // Generates a new invite code and sends the invite email again.

  app.post<{ Params: IdParamsType }>(
    "/users/:id/resend-invite",
    {
      preHandler: requirePermission(PERMISSIONS.ROLES_EDIT),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const publisher = await prisma.publisher.findUnique({ where: { id: request.params.id } });
      if (!publisher) return reply.code(404).send({ error: "Publisher not found" });
      if (publisher.status !== "invited" && publisher.status !== "pending_approval") {
        return reply.code(400).send({ error: "Publisher is not in invited/pending state" });
      }
      if (!publisher.email) {
        return reply.code(400).send({ error: "Publisher has no email address" });
      }
      if (!checkInviteRateLimit(publisher.id)) {
        return reply.code(429).send({ error: "Rate limit exceeded — max 3 invite emails per publisher per hour" });
      }

      // Generate new invite code (invalidates old one)
      const newCode = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
      const hash = createHash("sha256").update(newCode).digest("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // Delete old invite codes for this publisher and create new one
      await prisma.inviteCode.deleteMany({ where: { publisherId: publisher.id } });
      await prisma.inviteCode.create({
        data: { codeHash: hash, publisherId: publisher.id, expiresAt },
      });

      // Send invite email via central API relay (dedicated relay secret — ADR-0079)
      const centralApiUrl2 = process.env.CENTRAL_API_URL || process.env.HUB_API_URL;
      const tenantSlug2 = process.env.WEBAUTHN_RP_ID?.replace(".hubport.cloud", "") || "tenant";
      let relaySecret2: string | undefined;
      try {
        relaySecret2 = await getMailRelaySecret();
      } catch (err) {
        app.log.warn({ err }, "resend-invite: failed to get mail relay secret");
      }

      let emailSent = false;
      if (centralApiUrl2 && relaySecret2) {
        try {
          const emailRes = await fetch(`${centralApiUrl2}/admin/internal/send-email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${relaySecret2}`,
            },
            body: JSON.stringify({
              to: publisher.email,
              subject: `Einladung zu ${tenantSlug2}.hubport.cloud`,
              templateName: "invite",
              templateData: { firstName: publisher.firstName, inviteCode: newCode, tenantSlug: tenantSlug2 },
            }),
          });
          if (emailRes.ok) {
            emailSent = true;
            app.log.info({ publisherId: publisher.id }, "resend-invite: email sent successfully");
          } else {
            const errBody = await emailRes.text().catch(() => "");
            app.log.error({ status: emailRes.status, body: errBody }, "resend-invite: email relay returned error");
          }
        } catch (err) {
          app.log.error(err, "resend-invite: email relay unreachable");
        }
      } else {
        app.log.warn({ hasCentralUrl: !!centralApiUrl2, hasRelaySecret: !!relaySecret2 }, "resend-invite: email relay not configured — skipping email");
      }

      await audit("user.resend_invite", request.user.sub, "Publisher", publisher.id, null, { inviteCode: newCode });
      return { ok: true, inviteCode: newCode, emailSent };
    },
  );
}
