import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { getVapidPublicKey } from "../lib/push-service.js";

// ─── Schemas ──────────────────────────────────────────────────────────

const SubscribeBody = Type.Object({
  deviceId: Type.String({ format: "uuid" }),
  endpoint: Type.String({ minLength: 1 }),
  p256dh: Type.String({ minLength: 1 }),
  auth: Type.String({ minLength: 1 }),
});
type SubscribeBodyType = Static<typeof SubscribeBody>;

const UnsubscribeBody = Type.Object({
  deviceId: Type.String({ format: "uuid" }),
});
type UnsubscribeBodyType = Static<typeof UnsubscribeBody>;

// ─── Route Plugin ─────────────────────────────────────────────────────

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  // ─── GET /push/vapid-key ─────────────────────────────────────────
  // Returns the VAPID public key for client-side push subscription setup.

  app.get(
    "/push/vapid-key",
    { preHandler: requirePermission(PERMISSIONS.DEVICES_VIEW) },
    async (_request, reply) => {
      const publicKey = getVapidPublicKey();
      if (!publicKey) {
        return reply.code(503).send({ error: "Push notifications not configured" });
      }
      return { publicKey };
    },
  );

  // ─── POST /push/subscribe ────────────────────────────────────────
  // Store a push subscription for a device.
  // Verifies the device belongs to the authenticated user.

  app.post<{ Body: SubscribeBodyType }>(
    "/push/subscribe",
    {
      preHandler: requirePermission(PERMISSIONS.DEVICES_VIEW),
      schema: { body: SubscribeBody },
    },
    async (request, reply) => {
      const userId = request.user.sub;
      const tenantId = (request as any).policyCtx?.tenantId ?? "default";
      const { deviceId, endpoint, p256dh, auth } = request.body;

      // Verify device belongs to this user
      const device = await prisma.device.findUnique({
        where: { id: deviceId },
        select: { id: true, userId: true, tenantId: true, status: true },
      });

      if (!device || device.userId !== userId || device.tenantId !== tenantId) {
        return reply.code(404).send({ error: "Device not found" });
      }

      if (device.status === "revoked") {
        return reply.code(403).send({ error: "Device revoked" });
      }

      const subscription = await prisma.pushSubscription.upsert({
        where: { deviceId },
        create: { tenantId, deviceId, endpoint, p256dh, auth },
        update: { endpoint, p256dh, auth },
      });

      return reply.code(200).send({ id: subscription.id });
    },
  );

  // ─── DELETE /push/subscribe ──────────────────────────────────────
  // Remove a push subscription for a device.
  // Verifies the device belongs to the authenticated user.

  app.delete<{ Body: UnsubscribeBodyType }>(
    "/push/subscribe",
    {
      preHandler: requirePermission(PERMISSIONS.DEVICES_VIEW),
      schema: { body: UnsubscribeBody },
    },
    async (request, reply) => {
      const userId = request.user.sub;
      const tenantId = (request as any).policyCtx?.tenantId ?? "default";
      const { deviceId } = request.body;

      // Verify device belongs to this user
      const device = await prisma.device.findUnique({
        where: { id: deviceId },
        select: { id: true, userId: true, tenantId: true },
      });

      if (!device || device.userId !== userId || device.tenantId !== tenantId) {
        return reply.code(404).send({ error: "Device not found" });
      }

      await prisma.pushSubscription.deleteMany({ where: { deviceId } });

      return reply.code(204).send();
    },
  );
}
