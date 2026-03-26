import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import { createHash } from "node:crypto";
import prisma from "../lib/prisma.js";
import { audit } from "../lib/policy-engine.js";
import { provisionMatrixUserForPublisher } from "../lib/matrix-provisioning.js";
import { createInvitedKeycloakUser, deleteKeycloakUser } from "../lib/keycloak-admin.js";
import {
  generateOnboardingToken,
  hashToken,
  requireOnboardingToken,
} from "../lib/onboarding-token.js";
import { checkRedeemRateLimit } from "../lib/redeem-rate-limit.js";

export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  // ─── Redeem Invite Code (PUBLIC — rate-limited, no auth) ───────────

  app.post("/onboarding/redeem", {
    schema: {
      body: Type.Object({
        code: Type.String({ minLength: 6, maxLength: 6, pattern: "^[A-Za-z0-9]{6}$" }),
      }),
    },
  }, async (request, reply) => {
    const { code } = request.body as { code: string };
    const normalizedCode = code.toUpperCase().trim();
    const codeHash = createHash("sha256").update(normalizedCode).digest("hex");

    // Rate limit: IP + code hash compound key
    const ip =
      (request.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      request.ip;
    if (!checkRedeemRateLimit(ip, codeHash)) {
      return reply.code(429).send({
        error: "Zu viele Versuche, bitte warten Sie 15 Minuten",
        code: "RATE_LIMITED",
      });
    }

    const invite = await prisma.inviteCode.findUnique({
      where: { codeHash },
    });

    if (!invite) {
      return reply.code(400).send({ error: "Ungültiger Code", code: "INVALID_CODE" });
    }

    if (invite.expiresAt < new Date()) {
      return reply.code(410).send({
        error: "Code abgelaufen, bitte kontaktieren Sie Ihren Administrator",
        code: "CODE_EXPIRED",
      });
    }

    // Fetch publisher separately so encryption extension decrypts fields
    // (include:{publisher:true} on InviteCode skips Publisher decryption)
    const publisher = await prisma.publisher.findUniqueOrThrow({
      where: { id: invite.publisherId },
    });

    // Resume: already redeemed but not complete
    if (invite.redeemedAt && publisher.onboardingStep !== "complete") {
      const token = await generateOnboardingToken(app, publisher.id, publisher.keycloakSub!);
      await prisma.publisher.update({
        where: { id: publisher.id },
        data: { onboardingToken: hashToken(token) },
      });
      return reply.send({
        token,
        publisher: {
          email: publisher.email,
          firstName: publisher.firstName,
          lastName: publisher.lastName,
          onboardingStep: publisher.onboardingStep,
        },
      });
    }

    // Already completed
    if (invite.redeemedAt && publisher.onboardingStep === "complete") {
      return reply.code(400).send({
        error: "Konto bereits erstellt, bitte melden Sie sich an",
        code: "ALREADY_COMPLETE",
      });
    }

    // First redemption: create Keycloak user
    let keycloakSub: string;
    try {
      keycloakSub = await createInvitedKeycloakUser(publisher.email!);
    } catch (err) {
      app.log.error(err, "Failed to create Keycloak user for invite");
      return reply.code(500).send({
        error: "Kontoerstellung fehlgeschlagen, bitte versuchen Sie es erneut",
        code: "KC_ERROR",
      });
    }

    // Update DB in transaction
    try {
      await prisma.$transaction([
        prisma.inviteCode.update({
          where: { id: invite.id },
          data: { redeemedAt: new Date() },
        }),
        prisma.publisher.update({
          where: { id: publisher.id },
          data: {
            keycloakSub,
            onboardingStep: "code_redeemed",
            status: "pending_approval",
          },
        }),
        prisma.securitySetup.create({
          data: { keycloakSub },
        }),
      ]);
    } catch (err) {
      app.log.error({ err, keycloakSub }, "DB update failed — deleting orphaned KC user");
      try { await deleteKeycloakUser(keycloakSub); } catch (e) { app.log.error(e, "Failed to delete orphaned KC user"); }
      return reply.code(500).send({ error: "Kontoerstellung fehlgeschlagen", code: "DB_ERROR" });
    }

    const token = await generateOnboardingToken(app, publisher.id, keycloakSub);
    await prisma.publisher.update({
      where: { id: publisher.id },
      data: { onboardingToken: hashToken(token) },
    });

    await audit("onboarding.redeem", keycloakSub, "InviteCode", invite.id, undefined, {
      publisherId: publisher.id,
    });

    return reply.send({
      token,
      publisher: {
        email: publisher.email,
        firstName: publisher.firstName,
        lastName: publisher.lastName,
        onboardingStep: "code_redeemed",
      },
    });
  });

  // ─── Get Onboarding Status (resume support) ───────────────────────

  app.get("/onboarding/status", async (request, reply) => {
    const ok = await requireOnboardingToken(app, request, reply);
    if (!ok) return;

    const { publisherId } = (request as any).user;
    const publisher = await prisma.publisher.findUnique({
      where: { id: publisherId },
    });

    return reply.send({
      publisher: {
        email: publisher!.email,
        firstName: publisher!.firstName,
        lastName: publisher!.lastName,
        onboardingStep: publisher!.onboardingStep,
      },
    });
  });

  // ─── Save User Info ────────────────────────────────────────────────

  app.post("/onboarding/user-info", {
    schema: {
      body: Type.Object({
        firstName: Type.String({ minLength: 1, maxLength: 100 }),
        lastName: Type.String({ minLength: 1, maxLength: 100 }),
      }),
    },
  }, async (request, reply) => {
    const ok = await requireOnboardingToken(app, request, reply);
    if (!ok) return;

    const { publisherId } = (request as any).user;
    const { firstName, lastName } = request.body as { firstName: string; lastName: string };

    const publisher = await prisma.publisher.findUnique({ where: { id: publisherId } });
    if (publisher?.onboardingStep !== "code_redeemed") {
      return reply.code(400).send({ error: "Ungültiger Schritt", code: "WRONG_STEP" });
    }

    await prisma.publisher.update({
      where: { id: publisherId },
      data: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        onboardingStep: "user_info",
      },
    });

    const token = await generateOnboardingToken(app, publisherId, publisher.keycloakSub!);
    await prisma.publisher.update({
      where: { id: publisherId },
      data: { onboardingToken: hashToken(token) },
    });

    await audit("onboarding.user_info", publisher.keycloakSub!, "Publisher", publisherId);

    return reply.send({ token, onboardingStep: "user_info" });
  });

  // ─── Complete Security Step ────────────────────────────────────────

  app.post("/onboarding/complete-security", async (request, reply) => {
    const ok = await requireOnboardingToken(app, request, reply);
    if (!ok) return;

    const { publisherId } = (request as any).user;
    const publisher = await prisma.publisher.findUnique({ where: { id: publisherId } });

    if (publisher?.onboardingStep !== "user_info") {
      return reply.code(400).send({ error: "Ungültiger Schritt", code: "WRONG_STEP" });
    }

    // Verify security is actually set up
    const setup = await prisma.securitySetup.findUnique({
      where: { keycloakSub: publisher.keycloakSub! },
    });
    if (!setup?.passwordChanged) {
      return reply.code(400).send({ error: "Passwort muss zuerst geändert werden", code: "PASSWORD_REQUIRED" });
    }

    const hasPasskey = (await prisma.webAuthnCredential.count({
      where: { keycloakSub: publisher.keycloakSub! },
    })) > 0;
    const hasTotp = !!setup.totpSecret;

    if (!hasPasskey && !hasTotp) {
      return reply.code(400).send({
        error: "Mindestens ein zweiter Faktor erforderlich (Passkey oder TOTP)",
        code: "2FA_REQUIRED",
      });
    }

    await prisma.publisher.update({
      where: { id: publisherId },
      data: { onboardingStep: "security" },
    });

    const token = await generateOnboardingToken(app, publisherId, publisher.keycloakSub!);
    await prisma.publisher.update({
      where: { id: publisherId },
      data: { onboardingToken: hashToken(token) },
    });

    await audit("onboarding.security_complete", publisher.keycloakSub!, "Publisher", publisherId);

    return reply.send({ token, onboardingStep: "security" });
  });

  // ─── Accept Privacy (uses existing visibility enum format) ─────────

  app.post("/onboarding/accept-privacy", {
    schema: {
      body: Type.Object({
        contactVisibility: Type.Union([
          Type.Literal("everyone"), Type.Literal("elders_only"), Type.Literal("nobody"),
        ]),
        addressVisibility: Type.Union([
          Type.Literal("everyone"), Type.Literal("elders_only"), Type.Literal("nobody"),
        ]),
        notesVisibility: Type.Union([
          Type.Literal("everyone"), Type.Literal("elders_only"), Type.Literal("nobody"),
        ]),
        termsAccepted: Type.Boolean(),
        termsVersion: Type.String({ maxLength: 20 }),
      }),
    },
  }, async (request, reply) => {
    const ok = await requireOnboardingToken(app, request, reply);
    if (!ok) return;

    const { publisherId } = (request as any).user;
    const body = request.body as {
      contactVisibility: string;
      addressVisibility: string;
      notesVisibility: string;
      termsAccepted: boolean;
      termsVersion: string;
    };

    if (!body.termsAccepted) {
      return reply.code(400).send({
        error: "Nutzungsbedingungen müssen akzeptiert werden",
        code: "TERMS_REQUIRED",
      });
    }

    const publisher = await prisma.publisher.findUnique({ where: { id: publisherId } });
    if (publisher?.onboardingStep !== "security") {
      return reply.code(400).send({ error: "Ungültiger Schritt", code: "WRONG_STEP" });
    }

    await prisma.publisher.update({
      where: { id: publisherId },
      data: {
        privacyAccepted: true,
        privacyAcceptedAt: new Date(),
        privacySettings: {
          contactVisibility: body.contactVisibility,
          addressVisibility: body.addressVisibility,
          notesVisibility: body.notesVisibility,
        },
        termsVersion: body.termsVersion,
        onboardingStep: "complete",
        status: "active",
        onboardingToken: null,
      },
    });

    await audit("onboarding.accept_privacy", publisher.keycloakSub!, "Publisher", publisherId, undefined, {
      contactVisibility: body.contactVisibility,
      addressVisibility: body.addressVisibility,
      notesVisibility: body.notesVisibility,
    });

    // Provision Matrix user + join to spaces (non-fatal — chat failure must not block onboarding)
    try {
      await provisionMatrixUserForPublisher(publisher);
    } catch (err) {
      app.log.warn({ err }, "Matrix provisioning failed during onboarding — will retry on next chat access");
    }

    return reply.send({ ok: true, redirectUrl: "/" });
  });
}
