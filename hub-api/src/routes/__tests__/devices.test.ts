import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so mock objects are available when vi.mock factory runs
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    device: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("../../lib/prisma.js", () => ({ default: mockPrisma }));
vi.mock("../../lib/rbac.js", () => ({
  requirePermission: () => async () => {},
  requireAnyPermission: (..._perms: string[]) => async () => {},
}));

import Fastify from "fastify";
import { deviceRoutes } from "../devices.js";

const TEST_USER_ID = "test-user-sub";
const TENANT_ID = "tenant-1";
const DEVICE_UUID = "00000000-0000-0000-0000-000000000abc";
const DEVICE_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_USER_ID = "other-user-sub";

describe("Device routes", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.addHook("onRequest", async (request: any) => {
      request.user = { sub: TEST_USER_ID };
      request.policyCtx = { tenantId: TENANT_ID };
    });
    await app.register(deviceRoutes);
    await app.ready();
  });

  // ─── POST /devices/register ──────────────────────────────────────

  describe("POST /devices/register", () => {
    it("creates a device and returns 201 when under the limit", async () => {
      mockPrisma.device.findUnique.mockResolvedValue(null); // no existing device
      mockPrisma.device.count.mockResolvedValue(0);
      mockPrisma.device.create.mockResolvedValue({
        id: DEVICE_ID,
        tenantId: TENANT_ID,
        userId: TEST_USER_ID,
        deviceUuid: DEVICE_UUID,
        userAgent: "Mozilla/5.0",
        platform: "web",
        screenSize: "1920x1080",
        displayName: "Windows PC",
        encSalt: "abc123==",
        status: "active",
        registeredAt: new Date().toISOString(),
      });

      const res = await app.inject({
        method: "POST",
        url: "/devices/register",
        payload: {
          deviceUuid: DEVICE_UUID,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          platform: "web",
          screenSize: "1920x1080",
        },
      });

      expect(res.statusCode).toBe(201);
      expect(mockPrisma.device.create).toHaveBeenCalledOnce();
      const body = JSON.parse(res.payload);
      expect(body.deviceUuid).toBe(DEVICE_UUID);
    });

    it("returns 409 when user is at the device limit (3 active devices)", async () => {
      mockPrisma.device.findUnique.mockResolvedValue(null); // no existing
      mockPrisma.device.count.mockResolvedValue(3); // already at limit

      const res = await app.inject({
        method: "POST",
        url: "/devices/register",
        payload: { deviceUuid: DEVICE_UUID },
      });

      expect(res.statusCode).toBe(409);
      expect(mockPrisma.device.create).not.toHaveBeenCalled();
      const body = JSON.parse(res.payload);
      expect(body.error).toContain("Device limit reached");
    });

    it("re-registers an existing device with a fresh encSalt and returns 200", async () => {
      const existingDevice = {
        id: DEVICE_ID,
        tenantId: TENANT_ID,
        userId: TEST_USER_ID,
        deviceUuid: DEVICE_UUID,
        userAgent: "old-ua",
        platform: "web",
        screenSize: "1280x720",
        displayName: "Old Device",
        encSalt: "old-salt==",
        status: "active",
      };
      mockPrisma.device.findUnique.mockResolvedValue(existingDevice);
      mockPrisma.device.update.mockResolvedValue({
        ...existingDevice,
        encSalt: "new-salt==",
        status: "active",
      });

      const res = await app.inject({
        method: "POST",
        url: "/devices/register",
        payload: { deviceUuid: DEVICE_UUID },
      });

      expect(res.statusCode).toBe(200);
      expect(mockPrisma.device.update).toHaveBeenCalledOnce();
      expect(mockPrisma.device.create).not.toHaveBeenCalled();
    });
  });

  // ─── GET /devices/me ─────────────────────────────────────────────

  describe("GET /devices/me", () => {
    it("returns active device status", async () => {
      mockPrisma.device.findUnique.mockResolvedValue({
        id: DEVICE_ID,
        deviceUuid: DEVICE_UUID,
        displayName: "Windows PC",
        platform: "web",
        status: "active",
        revokedAt: null,
        revokeReason: null,
        registeredAt: new Date().toISOString(),
        lastSyncAt: null,
      });

      const res = await app.inject({
        method: "GET",
        url: `/devices/me?deviceUuid=${DEVICE_UUID}`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.status).toBe("active");
      expect(body.deviceUuid).toBe(DEVICE_UUID);
    });

    it("returns revoked status with reason when device is revoked", async () => {
      mockPrisma.device.findUnique.mockResolvedValue({
        id: DEVICE_ID,
        deviceUuid: DEVICE_UUID,
        displayName: "Windows PC",
        platform: "web",
        status: "revoked",
        revokedAt: new Date().toISOString(),
        revokeReason: "Security policy violation",
        registeredAt: new Date().toISOString(),
        lastSyncAt: null,
      });

      const res = await app.inject({
        method: "GET",
        url: `/devices/me?deviceUuid=${DEVICE_UUID}`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.status).toBe("revoked");
      expect(body.revokeReason).toBe("Security policy violation");
    });

    it("returns 404 when device not found", async () => {
      mockPrisma.device.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: "GET",
        url: `/devices/me?deviceUuid=nonexistent-uuid`,
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── DELETE /devices/:id ─────────────────────────────────────────

  describe("DELETE /devices/:id", () => {
    it("deletes own device and returns 204", async () => {
      mockPrisma.device.findUnique.mockResolvedValue({
        id: DEVICE_ID,
        userId: TEST_USER_ID,
        tenantId: TENANT_ID,
        deviceUuid: DEVICE_UUID,
        status: "active",
      });
      mockPrisma.device.delete.mockResolvedValue({ id: DEVICE_ID });

      const res = await app.inject({
        method: "DELETE",
        url: `/devices/${DEVICE_ID}`,
      });

      expect(res.statusCode).toBe(204);
      expect(mockPrisma.device.delete).toHaveBeenCalledWith({
        where: { id: DEVICE_ID },
      });
    });

    it("returns 403 when attempting to delete another user's device", async () => {
      mockPrisma.device.findUnique.mockResolvedValue({
        id: DEVICE_ID,
        userId: OTHER_USER_ID, // different user
        tenantId: TENANT_ID,
        deviceUuid: DEVICE_UUID,
        status: "active",
      });

      const res = await app.inject({
        method: "DELETE",
        url: `/devices/${DEVICE_ID}`,
      });

      expect(res.statusCode).toBe(403);
      expect(mockPrisma.device.delete).not.toHaveBeenCalled();
      const body = JSON.parse(res.payload);
      expect(body.error).toContain("another user");
    });

    it("returns 404 when device does not exist", async () => {
      mockPrisma.device.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: "DELETE",
        url: `/devices/${DEVICE_ID}`,
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ─── GET /devices/encryption-salt ────────────────────────────────

  describe("GET /devices/encryption-salt", () => {
    it("returns encSalt for an active device", async () => {
      mockPrisma.device.findUnique.mockResolvedValue({
        encSalt: "super-secret-salt==",
        status: "active",
      });

      const res = await app.inject({
        method: "GET",
        url: `/devices/encryption-salt?deviceUuid=${DEVICE_UUID}`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.encSalt).toBe("super-secret-salt==");
    });

    it("returns 403 for a revoked device", async () => {
      mockPrisma.device.findUnique.mockResolvedValue({
        encSalt: "",
        status: "revoked",
      });

      const res = await app.inject({
        method: "GET",
        url: `/devices/encryption-salt?deviceUuid=${DEVICE_UUID}`,
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.payload);
      expect(body.error).toContain("revoked");
    });
  });

  // ─── GET /devices ─────────────────────────────────────────────────

  describe("GET /devices", () => {
    it("returns the list of own devices", async () => {
      mockPrisma.device.findMany.mockResolvedValue([
        { id: DEVICE_ID, deviceUuid: DEVICE_UUID, displayName: "iPhone", status: "active" },
      ]);

      const res = await app.inject({ method: "GET", url: "/devices" });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveLength(1);
      expect(body[0].displayName).toBe("iPhone");
    });
  });

  // ─── DELETE /admin/devices/:id ────────────────────────────────────

  describe("DELETE /admin/devices/:id", () => {
    it("revokes a device and clears encSalt", async () => {
      mockPrisma.device.findUnique.mockResolvedValue({
        id: DEVICE_ID,
        tenantId: TENANT_ID,
        userId: OTHER_USER_ID,
        status: "active",
        encSalt: "existing-salt==",
      });
      mockPrisma.device.update.mockResolvedValue({
        id: DEVICE_ID,
        status: "revoked",
        encSalt: "",
        revokedAt: new Date().toISOString(),
        revokedBy: TEST_USER_ID,
        revokeReason: "Lost device",
      });

      const res = await app.inject({
        method: "DELETE",
        url: `/admin/devices/${DEVICE_ID}`,
        payload: { reason: "Lost device" },
      });

      expect(res.statusCode).toBe(200);
      expect(mockPrisma.device.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "revoked",
            encSalt: "",
            revokeReason: "Lost device",
          }),
        }),
      );
    });

    it("returns 404 when device belongs to a different tenant", async () => {
      mockPrisma.device.findUnique.mockResolvedValue({
        id: DEVICE_ID,
        tenantId: "other-tenant", // different tenant
        userId: OTHER_USER_ID,
        status: "active",
      });

      const res = await app.inject({
        method: "DELETE",
        url: `/admin/devices/${DEVICE_ID}`,
        payload: {},
      });

      expect(res.statusCode).toBe(404);
    });

    it("returns 409 when device is already revoked", async () => {
      mockPrisma.device.findUnique.mockResolvedValue({
        id: DEVICE_ID,
        tenantId: TENANT_ID,
        userId: OTHER_USER_ID,
        status: "revoked",
      });

      const res = await app.inject({
        method: "DELETE",
        url: `/admin/devices/${DEVICE_ID}`,
        payload: {},
      });

      expect(res.statusCode).toBe(409);
    });
  });
});
