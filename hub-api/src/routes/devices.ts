import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import { randomBytes } from "node:crypto";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";

const MAX_DEVICES_PER_USER = 3;

// ─── Schemas ─────────────────────────────────────────────────────────

const RegisterBody = Type.Object({
  deviceUuid: Type.String({ minLength: 1 }),
  userAgent: Type.Optional(Type.String()),
  platform: Type.Optional(Type.String()),
  screenSize: Type.Optional(Type.String()),
  displayName: Type.Optional(Type.String()),
});
type RegisterBodyType = Static<typeof RegisterBody>;

const IdParams = Type.Object({ id: Type.String({ format: "uuid" }) });
type IdParamsType = Static<typeof IdParams>;

const DeviceUuidQuery = Type.Object({
  deviceUuid: Type.String({ minLength: 1 }),
});
type DeviceUuidQueryType = Static<typeof DeviceUuidQuery>;

const AdminRevokeBody = Type.Object({
  reason: Type.Optional(Type.String()),
});
type AdminRevokeBodyType = Static<typeof AdminRevokeBody>;

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Parse a human-readable display name from a User-Agent string.
 * Falls back to the raw UA or "Unknown Device".
 */
function parseDisplayName(userAgent: string | undefined): string {
  if (!userAgent) return "Unknown Device";
  // Simple UA parsing: extract device/browser hint
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Android/.test(userAgent)) {
    const match = userAgent.match(/Android[^;]*; ([^)]+)\)/);
    if (match) return match[1].trim();
    return "Android Device";
  }
  if (/Windows/.test(userAgent)) return "Windows PC";
  if (/Macintosh|Mac OS X/.test(userAgent)) return "Mac";
  if (/Linux/.test(userAgent)) return "Linux PC";
  return "Unknown Device";
}

// ─── Route Plugin ─────────────────────────────────────────────────────

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  // ─── POST /devices/register ──────────────────────────────────────
  // Register or re-register a device. Generates a fresh encSalt.
  // Enforces MAX_DEVICES_PER_USER = 3.

  app.post<{ Body: RegisterBodyType }>(
    "/devices/register",
    {
      preHandler: requirePermission(PERMISSIONS.DEVICES_MANAGE),
      schema: { body: RegisterBody },
    },
    async (request, reply) => {
      const userId = request.user.sub;
      const tenantId = (request as any).policyCtx?.tenantId ?? "default";
      const { deviceUuid, userAgent, platform, screenSize, displayName } = request.body;

      // Check if device already registered for this user
      const existing = await prisma.device.findUnique({
        where: { userId_deviceUuid: { userId, deviceUuid } },
      });

      if (existing) {
        // Re-registration: refresh encSalt and mark active
        const encSalt = randomBytes(32).toString("base64");
        const updated = await prisma.device.update({
          where: { id: existing.id },
          data: {
            encSalt,
            status: "active",
            revokedAt: null,
            revokedBy: null,
            revokeReason: null,
            userAgent: userAgent ?? existing.userAgent,
            platform: platform ?? existing.platform,
            screenSize: screenSize ?? existing.screenSize,
            displayName: displayName ?? existing.displayName,
            updatedAt: new Date(),
          },
        });
        return reply.code(200).send(updated);
      }

      // Enforce device limit
      const count = await prisma.device.count({
        where: { userId, tenantId, status: "active" },
      });

      if (count >= MAX_DEVICES_PER_USER) {
        return reply.code(409).send({
          error: "Device limit reached",
          message: `Maximum ${MAX_DEVICES_PER_USER} devices allowed per user`,
        });
      }

      const encSalt = randomBytes(32).toString("base64");
      const resolvedDisplayName =
        displayName ?? parseDisplayName(userAgent);

      const device = await prisma.device.create({
        data: {
          tenantId,
          userId,
          deviceUuid,
          userAgent: userAgent ?? "",
          platform: platform ?? "",
          screenSize: screenSize ?? "",
          displayName: resolvedDisplayName,
          encSalt,
          status: "active",
        },
      });

      return reply.code(201).send(device);
    },
  );

  // ─── GET /devices/me?deviceUuid=X ───────────────────────────────
  // Check this device's status (active / revoked) and revokeReason.

  app.get<{ Querystring: DeviceUuidQueryType }>(
    "/devices/me",
    {
      preHandler: requirePermission(PERMISSIONS.DEVICES_VIEW),
      schema: { querystring: DeviceUuidQuery },
    },
    async (request, reply) => {
      const userId = request.user.sub;
      const { deviceUuid } = request.query;

      const device = await prisma.device.findUnique({
        where: { userId_deviceUuid: { userId, deviceUuid } },
        select: {
          id: true,
          deviceUuid: true,
          displayName: true,
          platform: true,
          status: true,
          revokedAt: true,
          revokeReason: true,
          registeredAt: true,
          lastSyncAt: true,
        },
      });

      if (!device) {
        return reply.code(404).send({ error: "Device not found" });
      }

      return device;
    },
  );

  // ─── GET /devices ────────────────────────────────────────────────
  // List all devices belonging to the current user.

  app.get(
    "/devices",
    { preHandler: requirePermission(PERMISSIONS.DEVICES_VIEW) },
    async (request) => {
      const userId = request.user.sub;
      const tenantId = (request as any).policyCtx?.tenantId ?? "default";

      return prisma.device.findMany({
        where: { userId, tenantId },
        orderBy: { registeredAt: "desc" },
        select: {
          id: true,
          deviceUuid: true,
          displayName: true,
          platform: true,
          screenSize: true,
          status: true,
          revokedAt: true,
          revokeReason: true,
          registeredAt: true,
          lastSyncAt: true,
        },
      });
    },
  );

  // ─── DELETE /devices/:id ─────────────────────────────────────────
  // Remove own device (ownership check — cannot delete another user's device).

  app.delete<{ Params: IdParamsType }>(
    "/devices/:id",
    {
      preHandler: requirePermission(PERMISSIONS.DEVICES_MANAGE),
      schema: { params: IdParams },
    },
    async (request, reply) => {
      const userId = request.user.sub;

      const device = await prisma.device.findUnique({
        where: { id: request.params.id },
      });

      if (!device) {
        return reply.code(404).send({ error: "Device not found" });
      }

      if (device.userId !== userId) {
        return reply.code(403).send({ error: "Cannot delete another user's device" });
      }

      await prisma.device.delete({ where: { id: device.id } });
      return reply.code(204).send();
    },
  );

  // ─── GET /devices/encryption-salt?deviceUuid=X ──────────────────
  // Return the per-device encryption salt for key derivation.
  // Only accessible to the owning user; revoked devices get 403.

  app.get<{ Querystring: DeviceUuidQueryType }>(
    "/devices/encryption-salt",
    {
      preHandler: requirePermission(PERMISSIONS.DEVICES_VIEW),
      schema: { querystring: DeviceUuidQuery },
    },
    async (request, reply) => {
      const userId = request.user.sub;
      const { deviceUuid } = request.query;

      const device = await prisma.device.findUnique({
        where: { userId_deviceUuid: { userId, deviceUuid } },
        select: { encSalt: true, status: true },
      });

      if (!device) {
        return reply.code(404).send({ error: "Device not found" });
      }

      if (device.status === "revoked") {
        return reply.code(403).send({
          error: "Device revoked",
          message: "This device has been revoked. Local data is no longer accessible.",
        });
      }

      return { encSalt: device.encSalt };
    },
  );

  // ─── GET /admin/devices ──────────────────────────────────────────
  // Admin: list all devices for the tenant.

  app.get(
    "/admin/devices",
    { preHandler: requirePermission(PERMISSIONS.ADMIN_DEVICES_VIEW) },
    async (request) => {
      const tenantId = (request as any).policyCtx?.tenantId ?? "default";

      return prisma.device.findMany({
        where: { tenantId },
        orderBy: { registeredAt: "desc" },
        select: {
          id: true,
          userId: true,
          deviceUuid: true,
          displayName: true,
          platform: true,
          screenSize: true,
          userAgent: true,
          status: true,
          revokedAt: true,
          revokedBy: true,
          revokeReason: true,
          registeredAt: true,
          lastSyncAt: true,
          lastIp: true,
        },
      });
    },
  );

  // ─── GET /admin/devices/publisher/:publisherId ──────────────────
  // Admin: list devices for a specific publisher (by publisher ID → keycloakSub).

  app.get<{ Params: { publisherId: string } }>(
    "/admin/devices/publisher/:publisherId",
    {
      preHandler: requirePermission(PERMISSIONS.ADMIN_DEVICES_VIEW),
      schema: { params: Type.Object({ publisherId: Type.String({ format: "uuid" }) }) },
    },
    async (request, reply) => {
      const publisher = await prisma.publisher.findUnique({
        where: { id: request.params.publisherId },
        select: { keycloakSub: true },
      });

      if (!publisher?.keycloakSub) {
        return reply.code(200).send([]);
      }

      return prisma.device.findMany({
        where: { userId: publisher.keycloakSub },
        orderBy: { registeredAt: "desc" },
        select: {
          id: true,
          deviceUuid: true,
          displayName: true,
          platform: true,
          screenSize: true,
          status: true,
          revokedAt: true,
          revokeReason: true,
          registeredAt: true,
          lastSyncAt: true,
        },
      });
    },
  );

  // ─── DELETE /admin/devices/:id ───────────────────────────────────
  // Admin: revoke a device (sets status=revoked, clears encSalt).

  app.delete<{ Params: IdParamsType; Body: AdminRevokeBodyType }>(
    "/admin/devices/:id",
    {
      preHandler: requirePermission(PERMISSIONS.ADMIN_DEVICES_MANAGE),
      schema: { params: IdParams, body: AdminRevokeBody },
    },
    async (request, reply) => {
      const adminUserId = request.user.sub;
      const tenantId = (request as any).policyCtx?.tenantId ?? "default";

      const device = await prisma.device.findUnique({
        where: { id: request.params.id },
      });

      if (!device || device.tenantId !== tenantId) {
        return reply.code(404).send({ error: "Device not found" });
      }

      if (device.status === "revoked") {
        return reply.code(409).send({ error: "Device already revoked" });
      }

      const updated = await prisma.device.update({
        where: { id: device.id },
        data: {
          status: "revoked",
          encSalt: "",
          revokedAt: new Date(),
          revokedBy: adminUserId,
          revokeReason: request.body?.reason ?? null,
        },
      });

      return reply.code(200).send(updated);
    },
  );
}
