import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────

const { mockPrisma } = vi.hoisted(() => {
  const makeDelegate = () => ({
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn(),
  });

  return {
    mockPrisma: {
      territory:               makeDelegate(),
      address:                 makeDelegate(),
      addressVisit:            makeDelegate(),
      territoryAssignment:     makeDelegate(),
      publisher:               makeDelegate(),
      fieldServiceMeetingPoint: makeDelegate(),
      campaignMeetingPoint:    makeDelegate(),
      serviceGroupMeeting:     makeDelegate(),
      territoryShare:          makeDelegate(),
      device:                  makeDelegate(),
    },
  };
});

vi.mock("../../lib/prisma.js", () => ({ default: mockPrisma }));
vi.mock("../../lib/rbac.js", () => ({
  requirePermission: () => async () => {},
  requireAnyPermission: (..._perms: string[]) => async () => {},
}));

import Fastify from "fastify";
import { syncRoutes } from "../sync.js";

const TENANT_ID = "tenant-1";
const DEVICE_ID  = "00000000-0000-0000-0000-000000000001";
const RECORD_ID  = "00000000-0000-0000-0000-000000000abc";
const NOW        = new Date("2026-01-01T12:00:00Z");

// Return an empty findMany for every delegate by default
function resetAllDelegates() {
  const delegates = [
    "territory", "address", "addressVisit", "territoryAssignment",
    "publisher", "fieldServiceMeetingPoint", "campaignMeetingPoint",
    "serviceGroupMeeting", "territoryShare",
  ] as const;
  for (const d of delegates) {
    (mockPrisma as any)[d].findMany.mockResolvedValue([]);
    (mockPrisma as any)[d].count.mockResolvedValue(0);
  }
}

describe("Sync routes", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetAllDelegates();

    app = Fastify();
    app.addHook("onRequest", async (request: any) => {
      request.user = { sub: "test-user" };
      request.policyCtx = { tenantId: TENANT_ID };
    });
    await app.register(syncRoutes);
    await app.ready();
  });

  // ─── GET /sync/status ─────────────────────────────────────────────

  describe("GET /sync/status", () => {
    it("returns sync metadata with minClientVersion", async () => {
      const res = await app.inject({ method: "GET", url: "/sync/status" });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty("minClientVersion");
      expect(body).toHaveProperty("serverVersion");
      expect(body).toHaveProperty("serverTime");
      expect(typeof body.minClientVersion).toBe("string");
    });

    it("uses MIN_CLIENT_VERSION env var when set", async () => {
      const originalEnv = process.env.MIN_CLIENT_VERSION;
      process.env.MIN_CLIENT_VERSION = "2.5.0";

      const res = await app.inject({ method: "GET", url: "/sync/status" });
      const body = JSON.parse(res.payload);
      expect(body.minClientVersion).toBe("2.5.0");

      process.env.MIN_CLIENT_VERSION = originalEnv;
    });
  });

  // ─── HEAD /sync/status ────────────────────────────────────────────

  describe("HEAD /sync/status", () => {
    it("returns 204 with no body", async () => {
      const res = await app.inject({ method: "HEAD", url: "/sync/status" });

      expect(res.statusCode).toBe(204);
      expect(res.payload).toBe("");
    });
  });

  // ─── GET /sync/pull ───────────────────────────────────────────────

  describe("GET /sync/pull", () => {
    it("returns delta since timestamp (all tables empty)", async () => {
      const since = "2026-01-01T00:00:00Z";
      const res = await app.inject({
        method: "GET",
        url: `/sync/pull?since=${encodeURIComponent(since)}`,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);

      expect(body).toHaveProperty("serverTime");
      expect(body).toHaveProperty("tables");
      expect(body.hasMore).toBe(false);

      // All syncable tables present
      expect(body.tables).toHaveProperty("territories");
      expect(body.tables).toHaveProperty("addresses");
      expect(body.tables).toHaveProperty("visits");
      expect(body.tables).toHaveProperty("assignments");
      expect(body.tables).toHaveProperty("publishers");
      expect(body.tables).toHaveProperty("meetingPoints");
      expect(body.tables).toHaveProperty("campaignMeetingPoints");
      expect(body.tables).toHaveProperty("meetings");
      expect(body.tables).toHaveProperty("territoryShares");

      // Each table has upserts/deletes arrays
      for (const tbl of Object.values(body.tables) as Array<{ upserts: unknown[]; deletes: unknown[] }>) {
        expect(Array.isArray(tbl.upserts)).toBe(true);
        expect(Array.isArray(tbl.deletes)).toBe(true);
        expect(tbl.upserts).toHaveLength(0);
        expect(tbl.deletes).toHaveLength(0);
      }
    });

    it("returns full dump without since param (queries from epoch)", async () => {
      const territory = { id: RECORD_ID, number: "T001", syncVersion: 1, deletedAt: null, updatedAt: NOW };
      mockPrisma.territory.findMany.mockResolvedValue([territory]);
      mockPrisma.territory.count.mockResolvedValue(1);

      const res = await app.inject({ method: "GET", url: "/sync/pull" });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.tables.territories.upserts).toHaveLength(1);
      expect(body.tables.territories.upserts[0]).toMatchObject({ id: RECORD_ID });
      expect(body.tables.territories.deletes).toHaveLength(0);

      // Verify territory.findMany was called with epoch-based filter
      expect(mockPrisma.territory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ updatedAt: { gt: new Date(0) } }),
        }),
      );
    });

    it("places soft-deleted records in deletes array", async () => {
      const deleted = { id: RECORD_ID, syncVersion: 3, deletedAt: new Date("2025-12-01") };
      mockPrisma.territory.findMany.mockResolvedValue([deleted]);

      const res = await app.inject({ method: "GET", url: "/sync/pull" });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.tables.territories.deletes).toContain(RECORD_ID);
      expect(body.tables.territories.upserts).toHaveLength(0);
    });

    it("does not include cursor when hasMore is false", async () => {
      const res = await app.inject({ method: "GET", url: "/sync/pull" });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.hasMore).toBe(false);
      expect(body.cursor).toBeUndefined();
    });
  });

  // ─── POST /sync/push ──────────────────────────────────────────────

  describe("POST /sync/push", () => {
    it("accepts a create operation", async () => {
      const newRecord = { id: RECORD_ID, number: "T001", syncVersion: 1 };
      mockPrisma.territory.create.mockResolvedValue(newRecord);
      mockPrisma.device.updateMany.mockResolvedValue({ count: 1 });

      const res = await app.inject({
        method: "POST",
        url: "/sync/push",
        payload: {
          deviceId: DEVICE_ID,
          changes: [
            {
              table:     "territories",
              recordId:  RECORD_ID,
              operation: "create",
              payload:   { number: "T001", name: "North Zone" },
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.results).toHaveLength(1);
      expect(body.results[0].status).toBe("accepted");
      expect(body.results[0].recordId).toBe(RECORD_ID);
    });

    it("accepts an update when version matches (no conflict)", async () => {
      const existing = { id: RECORD_ID, number: "T001", syncVersion: 3, deletedAt: null };
      const updated  = { id: RECORD_ID, number: "T001-renamed", syncVersion: 4 };

      mockPrisma.territory.findUnique.mockResolvedValue(existing);
      mockPrisma.territory.update.mockResolvedValue(updated);
      mockPrisma.device.updateMany.mockResolvedValue({ count: 1 });

      const res = await app.inject({
        method: "POST",
        url: "/sync/push",
        payload: {
          deviceId: DEVICE_ID,
          changes: [
            {
              table:     "territories",
              recordId:  RECORD_ID,
              operation: "update",
              version:   3,
              payload:   { name: "T001-renamed" },
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.results[0].status).toBe("accepted");
      expect(body.results[0].serverVersion).toBe(4);

      // Verify syncVersion was NOT set in the update data
      expect(mockPrisma.territory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ syncVersion: expect.anything() }),
        }),
      );
    });

    it("returns conflict when client version does not match server version", async () => {
      const existing = { id: RECORD_ID, name: "Server version", syncVersion: 5, deletedAt: null };
      mockPrisma.territory.findUnique.mockResolvedValue(existing);
      mockPrisma.device.updateMany.mockResolvedValue({ count: 1 });

      const res = await app.inject({
        method: "POST",
        url: "/sync/push",
        payload: {
          deviceId: DEVICE_ID,
          changes: [
            {
              table:     "territories",
              recordId:  RECORD_ID,
              operation: "update",
              version:   3,            // client is at 3, server is at 5
              payload:   { name: "Client version" },
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.results[0].status).toBe("conflict");
      expect(body.results[0].serverVersion).toBe(5);
      expect(body.results[0].clientVersion).toBe(3);
      expect(body.results[0].serverData).toBeDefined();
      expect(mockPrisma.territory.update).not.toHaveBeenCalled();
    });

    it("force flag bypasses version check", async () => {
      const existing = { id: RECORD_ID, name: "Server version", syncVersion: 5, deletedAt: null };
      const updated  = { id: RECORD_ID, name: "Force override", syncVersion: 6 };

      mockPrisma.territory.findUnique.mockResolvedValue(existing);
      mockPrisma.territory.update.mockResolvedValue(updated);
      mockPrisma.device.updateMany.mockResolvedValue({ count: 1 });

      const res = await app.inject({
        method: "POST",
        url: "/sync/push",
        payload: {
          deviceId: DEVICE_ID,
          changes: [
            {
              table:     "territories",
              recordId:  RECORD_ID,
              operation: "update",
              version:   3,
              force:     true,
              payload:   { name: "Force override" },
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.results[0].status).toBe("accepted");
    });

    it("rejects changes for an unknown table", async () => {
      mockPrisma.device.updateMany.mockResolvedValue({ count: 1 });

      const res = await app.inject({
        method: "POST",
        url: "/sync/push",
        payload: {
          deviceId: DEVICE_ID,
          changes: [
            {
              table:     "unknownTable",
              recordId:  RECORD_ID,
              operation: "update",
              version:   1,
              payload:   { name: "Whatever" },
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.results[0].status).toBe("error");
      expect(body.results[0].reason).toContain("Unknown table");
    });

    it("processes multiple changes in one request", async () => {
      const existing = { id: RECORD_ID, syncVersion: 1, deletedAt: null };
      const updated  = { id: RECORD_ID, syncVersion: 2 };

      mockPrisma.territory.findUnique.mockResolvedValue(existing);
      mockPrisma.territory.update.mockResolvedValue(updated);
      mockPrisma.device.updateMany.mockResolvedValue({ count: 1 });

      const res = await app.inject({
        method: "POST",
        url: "/sync/push",
        payload: {
          deviceId: DEVICE_ID,
          changes: [
            { table: "territories", recordId: RECORD_ID, operation: "update", version: 1, payload: { name: "Updated" } },
            { table: "unknownTable", recordId: "other-id", operation: "create", payload: {} },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.results).toHaveLength(2);
      expect(body.results[0].status).toBe("accepted");
      expect(body.results[1].status).toBe("error");
    });

    it("soft-deletes a record when operation is delete", async () => {
      const existing = { id: RECORD_ID, syncVersion: 2, deletedAt: null };
      const softDeleted = { id: RECORD_ID, syncVersion: 3, deletedAt: new Date() };

      mockPrisma.territory.findUnique.mockResolvedValue(existing);
      mockPrisma.territory.update.mockResolvedValue(softDeleted);
      mockPrisma.device.updateMany.mockResolvedValue({ count: 1 });

      const res = await app.inject({
        method: "POST",
        url: "/sync/push",
        payload: {
          deviceId: DEVICE_ID,
          changes: [
            { table: "territories", recordId: RECORD_ID, operation: "delete" },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.results[0].status).toBe("accepted");

      expect(mockPrisma.territory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
    });

    it("updates device.lastSyncAt after processing", async () => {
      mockPrisma.device.updateMany.mockResolvedValue({ count: 1 });

      await app.inject({
        method: "POST",
        url: "/sync/push",
        payload: { deviceId: DEVICE_ID, changes: [] },
      });

      expect(mockPrisma.device.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: DEVICE_ID },
          data: expect.objectContaining({ lastSyncAt: expect.any(Date) }),
        }),
      );
    });
  });
});
