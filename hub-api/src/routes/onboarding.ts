import type { FastifyInstance } from "fastify";
import { Type } from "@sinclair/typebox";
import { createHash } from "node:crypto";
import prisma from "../lib/prisma.js";
import { audit } from "../lib/policy-engine.js";

export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  // ─── Redeem Invite Code ──────────────────────────────────────────

  app.post("/onboarding/redeem", {
    schema: {
      body: Type.Object({
        code: Type.String({ minLength: 4 }),
        keycloakSub: Type.Optional(Type.String()),
      }),
    },
  }, async (request, reply) => {
    const { code, keycloakSub } = request.body as { code: string; keycloakSub?: string };
    const codeHash = createHash("sha256").update(code.toUpperCase()).digest("hex");

    const invite = await prisma.inviteCode.findUnique({
      where: { codeHash },
      include: { publisher: true },
    });

    if (!invite) {
      return reply.code(400).send({ error: "Invalid invite code" });
    }

    if (invite.redeemedAt) {
      return reply.code(400).send({ error: "Invite code already redeemed" });
    }

    if (invite.expiresAt < new Date()) {
      return reply.code(400).send({ error: "Invite code expired" });
    }

    // Mark as redeemed
    await prisma.inviteCode.update({
      where: { id: invite.id },
      data: { redeemedAt: new Date() },
    });

    // Update publisher status and link Keycloak sub if provided
    await prisma.publisher.update({
      where: { id: invite.publisherId },
      data: {
        status: "pending_approval",
        ...(keycloakSub && { keycloakSub }),
      },
    });

    await audit(
      "onboarding.redeem",
      keycloakSub ?? "anonymous",
      "InviteCode",
      invite.id,
      undefined,
      { publisherId: invite.publisherId },
    );

    return {
      ok: true,
      publisherId: invite.publisherId,
      publisherName: `${invite.publisher.firstName} ${invite.publisher.lastName}`,
    };
  });

  // ─── Accept Privacy Terms ────────────────────────────────────────

  app.post("/onboarding/accept-privacy", {
    schema: {
      body: Type.Object({
        publisherId: Type.String({ format: "uuid" }),
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
    const body = request.body as {
      publisherId: string;
      contactVisibility: string;
      addressVisibility: string;
      notesVisibility: string;
    };

    const publisher = await prisma.publisher.findUnique({
      where: { id: body.publisherId },
    });

    if (!publisher) {
      return reply.code(404).send({ error: "Publisher not found" });
    }

    await prisma.publisher.update({
      where: { id: body.publisherId },
      data: {
        privacyAccepted: true,
        privacyAcceptedAt: new Date(),
        privacySettings: {
          contactVisibility: body.contactVisibility,
          addressVisibility: body.addressVisibility,
          notesVisibility: body.notesVisibility,
        },
      },
    });

    await audit(
      "onboarding.accept_privacy",
      publisher.keycloakSub ?? "anonymous",
      "Publisher",
      body.publisherId,
      undefined,
      { contactVisibility: body.contactVisibility, addressVisibility: body.addressVisibility, notesVisibility: body.notesVisibility },
    );

    return { ok: true };
  });
}
