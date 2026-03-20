/**
 * Onboarding routes — public, no auth required.
 *
 * Handles invite code redemption and privacy acceptance.
 */

import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { createHash } from "node:crypto";

const RedeemBody = Type.Object({
  code: Type.String({ minLength: 1 }),
  keycloakSub: Type.Optional(Type.String()),
});
type RedeemBodyType = Static<typeof RedeemBody>;

const AcceptPrivacyBody = Type.Object({
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
});
type AcceptPrivacyBodyType = Static<typeof AcceptPrivacyBody>;

export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  // POST /onboarding/redeem — validate invite code, link account
  app.post<{ Body: RedeemBodyType }>(
    "/onboarding/redeem",
    { schema: { body: RedeemBody } },
    async (request, reply) => {
      const codeHash = createHash("sha256")
        .update(request.body.code)
        .digest("hex");

      const invite = await prisma.inviteCode.findUnique({
        where: { codeHash },
        include: { publisher: true },
      });

      if (!invite) {
        return reply.code(400).send({ error: "Invalid invite code" });
      }
      if (invite.redeemedAt) {
        return reply.code(400).send({ error: "Invite code already used" });
      }
      if (invite.expiresAt < new Date()) {
        return reply.code(400).send({ error: "Invite code expired" });
      }

      // Mark as redeemed
      await prisma.inviteCode.update({
        where: { id: invite.id },
        data: { redeemedAt: new Date() },
      });

      // Link Keycloak sub if provided
      const updateData: Record<string, unknown> = {
        status: "pending_approval",
      };
      if (request.body.keycloakSub) {
        updateData.keycloakSub = request.body.keycloakSub;
      }

      const publisher = await prisma.publisher.update({
        where: { id: invite.publisherId },
        data: updateData as Parameters<typeof prisma.publisher.update>[0]["data"],
      });

      await prisma.auditLog.create({
        data: {
          actorId: request.body.keycloakSub ?? "onboarding",
          action: "onboarding.redeem",
          objectType: "Publisher",
          objectId: publisher.id,
          afterState: { status: "pending_approval" },
        },
      });

      return {
        publisherId: publisher.id,
        status: publisher.status,
        firstName: publisher.firstName,
        lastName: publisher.lastName,
      };
    },
  );

  // POST /onboarding/accept-privacy — set privacy preferences and accept terms
  app.post<{ Body: AcceptPrivacyBodyType }>(
    "/onboarding/accept-privacy",
    { schema: { body: AcceptPrivacyBody } },
    async (request, reply) => {
      const publisher = await prisma.publisher.findUnique({
        where: { id: request.body.publisherId },
      });
      if (!publisher) {
        return reply.code(404).send({ error: "Publisher not found" });
      }

      const updated = await prisma.publisher.update({
        where: { id: request.body.publisherId },
        data: {
          privacySettings: {
            contactVisibility: request.body.contactVisibility,
            addressVisibility: request.body.addressVisibility,
            notesVisibility: request.body.notesVisibility,
          },
          privacyAccepted: true,
          privacyAcceptedAt: new Date(),
        },
      });

      await prisma.auditLog.create({
        data: {
          actorId: publisher.keycloakSub ?? "onboarding",
          action: "onboarding.accept_privacy",
          objectType: "Publisher",
          objectId: publisher.id,
          afterState: {
            privacyAccepted: true,
            privacySettings: request.body,
          },
        },
      });

      return {
        publisherId: updated.id,
        privacyAccepted: updated.privacyAccepted,
      };
    },
  );
}
