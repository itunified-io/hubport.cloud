import { describe, it, expect, vi, beforeEach } from "vitest";

const TEST_USER_ID = "user-1";
const OTHER_USER_ID = "user-2";
const TENANT_ID = "tenant-1";

// Use vi.hoisted so mock objects are available when vi.mock factory runs
const { mockPrisma, mockAudit, mockCan } = vi.hoisted(() => ({
  mockPrisma: {
    maintenanceIssue: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    maintenancePhoto: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    maintenanceComment: {
      create: vi.fn(),
    },
  },
  mockAudit: vi.fn().mockResolvedValue(undefined),
  mockCan: vi.fn().mockReturnValue({ allowed: false }),
}));

vi.mock("../../lib/prisma.js", () => ({ default: mockPrisma }));
vi.mock("../../lib/rbac.js", () => ({
  requirePermission: () => async () => {},
  requireAnyPermission: (..._perms: string[]) => async () => {},
}));
vi.mock("../../lib/policy-engine.js", () => ({
  audit: mockAudit,
  can: mockCan,
}));

import Fastify from "fastify";
import { facilitiesMaintenanceRoutes } from "../facilities-maintenance.js";

describe("facilities-maintenance routes", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCan.mockReturnValue({ allowed: false });
    app = Fastify();
    app.addHook("onRequest", async (request: any) => {
      request.user = { sub: TEST_USER_ID };
      request.policyCtx = { tenantId: TENANT_ID };
    });
    await app.register(facilitiesMaintenanceRoutes);
    await app.ready();
  });

  // ─── Status Transitions ──────────────────────────────────────────

  describe("status transitions", () => {
    const baseIssue = {
      id: "issue-1",
      status: "reported",
      deletedAt: null,
    };

    it("rejects invalid transition reported -> closed", async () => {
      mockPrisma.maintenanceIssue.findFirst.mockResolvedValue({ ...baseIssue });

      const res = await app.inject({
        method: "PUT",
        url: "/facilities/maintenance/issue-1",
        payload: { status: "closed" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Invalid status transition");
    });

    it("accepts valid transition reported -> under_review", async () => {
      mockPrisma.maintenanceIssue.findFirst.mockResolvedValue({ ...baseIssue });
      const updated = { ...baseIssue, status: "under_review" };
      mockPrisma.maintenanceIssue.update.mockResolvedValue(updated);

      const res = await app.inject({
        method: "PUT",
        url: "/facilities/maintenance/issue-1",
        payload: { status: "under_review" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("under_review");
    });

    it("sets resolvedAt when transitioning to resolved", async () => {
      mockPrisma.maintenanceIssue.findFirst.mockResolvedValue({
        ...baseIssue,
        status: "in_progress",
      });
      mockPrisma.maintenanceIssue.update.mockImplementation(async ({ data }) => ({
        ...baseIssue,
        status: "resolved",
        resolvedAt: data.resolvedAt,
      }));

      const res = await app.inject({
        method: "PUT",
        url: "/facilities/maintenance/issue-1",
        payload: { status: "resolved" },
      });

      expect(res.statusCode).toBe(200);
      // Verify update was called with a resolvedAt date
      const callData = mockPrisma.maintenanceIssue.update.mock.calls[0][0].data;
      expect(callData.resolvedAt).toBeInstanceOf(Date);
    });

    it("clears resolvedAt on reopen (resolved -> in_progress)", async () => {
      mockPrisma.maintenanceIssue.findFirst.mockResolvedValue({
        ...baseIssue,
        status: "resolved",
        resolvedAt: new Date(),
      });
      mockPrisma.maintenanceIssue.update.mockImplementation(async ({ data }) => ({
        ...baseIssue,
        status: "in_progress",
        resolvedAt: data.resolvedAt,
      }));

      const res = await app.inject({
        method: "PUT",
        url: "/facilities/maintenance/issue-1",
        payload: { status: "in_progress" },
      });

      expect(res.statusCode).toBe(200);
      const callData = mockPrisma.maintenanceIssue.update.mock.calls[0][0].data;
      expect(callData.resolvedAt).toBeNull();
    });

    it("sets closedAt when transitioning to closed", async () => {
      mockPrisma.maintenanceIssue.findFirst.mockResolvedValue({
        ...baseIssue,
        status: "resolved",
      });
      mockPrisma.maintenanceIssue.update.mockImplementation(async ({ data }) => ({
        ...baseIssue,
        status: "closed",
        closedAt: data.closedAt,
      }));

      const res = await app.inject({
        method: "PUT",
        url: "/facilities/maintenance/issue-1",
        payload: { status: "closed" },
      });

      expect(res.statusCode).toBe(200);
      const callData = mockPrisma.maintenanceIssue.update.mock.calls[0][0].data;
      expect(callData.closedAt).toBeInstanceOf(Date);
    });
  });

  // ─── Photo Constraints ────────────────────────────────────────────

  describe("photo constraints", () => {
    const issue = { id: "issue-1", deletedAt: null };

    it("rejects photo over 2 MB", async () => {
      // The data field length is checked against MAX_PHOTO_SIZE_BYTES (2 MB)
      // Use a string just over the limit but small enough to pass Fastify body limit
      const oversized = "x".repeat(2 * 1024 * 1024 + 1);
      mockPrisma.maintenanceIssue.findFirst.mockResolvedValue({ id: "issue-1", deletedAt: null });

      const res = await app.inject({
        method: "POST",
        url: "/facilities/maintenance/issue-1/photos",
        payload: { data: oversized, mimeType: "image/jpeg" },
      });

      // Fastify may reject with 413 if body limit is smaller, or route rejects with 400
      expect([400, 413]).toContain(res.statusCode);
    });

    it("rejects non-JPEG/PNG mime type", async () => {
      mockPrisma.maintenanceIssue.findFirst.mockResolvedValue(issue);

      const res = await app.inject({
        method: "POST",
        url: "/facilities/maintenance/issue-1/photos",
        payload: { data: "smalldata", mimeType: "image/gif" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("JPEG and PNG");
    });

    it("rejects 11th photo (max 10)", async () => {
      mockPrisma.maintenanceIssue.findFirst.mockResolvedValue(issue);
      mockPrisma.maintenancePhoto.count.mockResolvedValue(10);

      const res = await app.inject({
        method: "POST",
        url: "/facilities/maintenance/issue-1/photos",
        payload: { data: "smalldata", mimeType: "image/png" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("10");
    });

    it("owner can delete their photo", async () => {
      mockPrisma.maintenancePhoto.findUnique.mockResolvedValue({
        id: "photo-1",
        uploadedById: TEST_USER_ID,
      });
      mockPrisma.maintenancePhoto.delete.mockResolvedValue({ id: "photo-1" });

      const res = await app.inject({
        method: "DELETE",
        url: "/facilities/maintenance/issue-1/photos/photo-1",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
    });

    it("non-owner non-manager gets 403", async () => {
      mockPrisma.maintenancePhoto.findUnique.mockResolvedValue({
        id: "photo-1",
        uploadedById: OTHER_USER_ID,
      });
      mockCan.mockReturnValue({ allowed: false });

      const res = await app.inject({
        method: "DELETE",
        url: "/facilities/maintenance/issue-1/photos/photo-1",
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain("Not authorized");
    });
  });

  // ─── Soft Delete ──────────────────────────────────────────────────

  describe("soft delete", () => {
    it("sets deletedAt on delete", async () => {
      mockPrisma.maintenanceIssue.findFirst.mockResolvedValue({
        id: "issue-1",
        deletedAt: null,
      });
      mockPrisma.maintenanceIssue.update.mockResolvedValue({
        id: "issue-1",
        deletedAt: new Date(),
      });

      const res = await app.inject({
        method: "DELETE",
        url: "/facilities/maintenance/issue-1",
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      const callData = mockPrisma.maintenanceIssue.update.mock.calls[0][0].data;
      expect(callData.deletedAt).toBeInstanceOf(Date);
    });

    it("list excludes soft-deleted issues (deletedAt: null filter)", async () => {
      mockPrisma.maintenanceIssue.findMany.mockResolvedValue([]);

      await app.inject({
        method: "GET",
        url: "/facilities/maintenance",
      });

      const where = mockPrisma.maintenanceIssue.findMany.mock.calls[0][0].where;
      expect(where.deletedAt).toBeNull();
    });
  });

  // ─── Pagination ───────────────────────────────────────────────────

  describe("pagination", () => {
    it("returns nextCursor when more results exist", async () => {
      // Default limit is 20, so return 21 items to trigger hasMore
      const items = Array.from({ length: 21 }, (_, i) => ({
        id: `issue-${i}`,
        createdAt: new Date(),
      }));
      mockPrisma.maintenanceIssue.findMany.mockResolvedValue(items);

      const res = await app.inject({
        method: "GET",
        url: "/facilities/maintenance",
      });

      const body = res.json();
      expect(body.nextCursor).toBe("issue-19"); // last of 20 after pop
      expect(body.data).toHaveLength(20);
    });

    it("returns null nextCursor on last page", async () => {
      const items = Array.from({ length: 5 }, (_, i) => ({
        id: `issue-${i}`,
        createdAt: new Date(),
      }));
      mockPrisma.maintenanceIssue.findMany.mockResolvedValue(items);

      const res = await app.inject({
        method: "GET",
        url: "/facilities/maintenance",
      });

      const body = res.json();
      expect(body.nextCursor).toBeNull();
      expect(body.data).toHaveLength(5);
    });
  });

  // ─── Create ───────────────────────────────────────────────────────

  describe("create", () => {
    it("creates an issue and returns it", async () => {
      const created = {
        id: "issue-new",
        title: "Broken window",
        description: "Window in hall B",
        category: "structural",
        priority: "high",
        location: "Hall B",
        reporterId: TEST_USER_ID,
        status: "reported",
      };
      mockPrisma.maintenanceIssue.create.mockResolvedValue(created);

      const res = await app.inject({
        method: "POST",
        url: "/facilities/maintenance",
        payload: {
          title: "Broken window",
          description: "Window in hall B",
          category: "structural",
          priority: "high",
          location: "Hall B",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe("issue-new");
      expect(res.json().title).toBe("Broken window");
      expect(mockPrisma.maintenanceIssue.create).toHaveBeenCalledOnce();
      expect(mockAudit).toHaveBeenCalledOnce();
    });
  });

  // ─── Forward LDC ─────────────────────────────────────────────────

  describe("forward LDC", () => {
    it("forwards issue to LDC and transitions status", async () => {
      mockPrisma.maintenanceIssue.findFirst.mockResolvedValue({
        id: "issue-1",
        status: "under_review",
        deletedAt: null,
      });
      const updated = {
        id: "issue-1",
        status: "forwarded_to_ldc",
        ldcForwarded: new Date(),
        ldcContact: "John Doe",
      };
      mockPrisma.maintenanceIssue.update.mockResolvedValue(updated);

      const res = await app.inject({
        method: "POST",
        url: "/facilities/maintenance/issue-1/forward-ldc",
        payload: { ldcContact: "John Doe" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("forwarded_to_ldc");
    });

    it("rejects forward from invalid status (reported)", async () => {
      mockPrisma.maintenanceIssue.findFirst.mockResolvedValue({
        id: "issue-1",
        status: "reported",
        deletedAt: null,
      });

      const res = await app.inject({
        method: "POST",
        url: "/facilities/maintenance/issue-1/forward-ldc",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Cannot forward");
    });

    it("rejects forward from closed status", async () => {
      mockPrisma.maintenanceIssue.findFirst.mockResolvedValue({
        id: "issue-1",
        status: "closed",
        deletedAt: null,
      });

      const res = await app.inject({
        method: "POST",
        url: "/facilities/maintenance/issue-1/forward-ldc",
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("Cannot forward");
    });
  });

  // ─── Report PDF ──────────────────────────────────────────────────

  describe("report PDF", () => {
    it("returns 404 when issue not found", async () => {
      mockPrisma.maintenanceIssue.findFirst.mockResolvedValue(null);

      const res = await app.inject({
        method: "GET",
        url: "/facilities/maintenance/issue-1/report",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain("Issue not found");
    });

    it("returns PDF when issue exists", async () => {
      mockPrisma.maintenanceIssue.findFirst.mockResolvedValue({
        id: "issue-1",
        title: "Broken pipe",
        description: "Leaking pipe in basement",
        category: "plumbing",
        priority: "high",
        status: "reported",
        location: "Basement",
        createdAt: new Date("2026-01-15"),
        deletedAt: null,
        reporter: { firstName: "Max", lastName: "Mustermann" },
        assignee: null,
        photos: [],
        comments: [],
      });

      const res = await app.inject({
        method: "GET",
        url: "/facilities/maintenance/issue-1/report",
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("application/pdf");
    });
  });
});
