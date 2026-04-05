import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockAudit } = vi.hoisted(() => ({
  mockPrisma: {
    preventiveTask: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    preventiveEntry: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  mockAudit: vi.fn(),
}));

vi.mock("../../lib/prisma.js", () => ({ default: mockPrisma }));
vi.mock("../../lib/rbac.js", () => ({
  requirePermission: () => async () => {},
  requireAnyPermission: (..._perms: string[]) => async () => {},
}));
vi.mock("../../lib/policy-engine.js", () => ({
  audit: mockAudit,
}));

import Fastify from "fastify";
import { facilitiesPreventiveRoutes } from "../facilities-preventive.js";
import { calculateNextDue } from "../../lib/frequency.js";

const TEST_USER_ID = "test-user-sub";
const TENANT_ID = "test-tenant";

describe("Facilities preventive routes", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.addHook("onRequest", async (request: any) => {
      request.user = { sub: TEST_USER_ID };
      request.policyCtx = { tenantId: TENANT_ID };
    });
    await app.register(facilitiesPreventiveRoutes);
    await app.ready();
  });

  describe("POST /facilities/preventive (create) — frequency validation", () => {
    it("rejects invalid frequency '4m' with 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/facilities/preventive",
        payload: {
          name: "Test Task",
          category: "safety",
          frequency: "4m",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.error).toContain("Invalid frequency");
    });

    it("accepts valid frequency '3m' and creates task", async () => {
      const created = {
        id: "task-1",
        name: "Test Task",
        category: "safety",
        frequency: "3m",
        nextDue: new Date(),
      };
      mockPrisma.preventiveTask.create.mockResolvedValue(created);

      const res = await app.inject({
        method: "POST",
        url: "/facilities/preventive",
        payload: {
          name: "Test Task",
          category: "safety",
          frequency: "3m",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(mockPrisma.preventiveTask.create).toHaveBeenCalled();
      expect(mockAudit).toHaveBeenCalledWith(
        "preventive_task.create",
        TEST_USER_ID,
        "PreventiveTask",
        "task-1",
        null,
        created,
      );
    });
  });

  describe("POST /facilities/preventive/:id/complete — completion", () => {
    it("records completion via $transaction and calculates nextDue", async () => {
      const task = {
        id: "task-1",
        name: "Test",
        frequency: "3m",
        lastDone: null,
      };
      mockPrisma.preventiveTask.findUnique.mockResolvedValue(task);

      const entry = { id: "entry-1", taskId: "task-1", doneAt: new Date() };
      mockPrisma.$transaction.mockResolvedValue([entry, {}]);

      const res = await app.inject({
        method: "POST",
        url: "/facilities/preventive/task-1/complete",
        payload: { notes: "Done" },
      });

      expect(res.statusCode).toBe(200);
      expect(mockPrisma.$transaction).toHaveBeenCalled();

      const body = JSON.parse(res.payload);
      expect(body.entry).toBeDefined();
      expect(body.nextDue).toBeDefined();

      // Verify nextDue is approximately 3 months from now
      const expectedNext = calculateNextDue(new Date(), "3m");
      const actualNext = new Date(body.nextDue);
      // Allow 5 seconds tolerance for test execution time
      expect(Math.abs(actualNext.getTime() - expectedNext.getTime())).toBeLessThan(5000);
    });

    it("returns 404 for nonexistent task", async () => {
      mockPrisma.preventiveTask.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: "POST",
        url: "/facilities/preventive/nonexistent/complete",
        payload: {},
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /facilities/preventive/calendar.ics — iCal feed", () => {
    it("returns text/calendar content type with valid iCal", async () => {
      mockPrisma.preventiveTask.findMany.mockResolvedValue([
        {
          id: "task-1",
          name: "Fire extinguisher check",
          category: "safety",
          frequency: "6m",
          nextDue: new Date("2026-06-01T00:00:00Z"),
          assignee: { firstName: "Max", lastName: "Mustermann" },
        },
      ]);

      const res = await app.inject({
        method: "GET",
        url: "/facilities/preventive/calendar.ics",
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/calendar");
      expect(res.payload).toContain("BEGIN:VCALENDAR");
      expect(res.payload).toContain("END:VCALENDAR");
      expect(res.payload).toContain("BEGIN:VEVENT");
      expect(res.payload).toContain("Fire extinguisher check");
    });
  });

  describe("POST /facilities/preventive/seed — seed tasks", () => {
    it("seeds 12 default tasks when count is 0", async () => {
      mockPrisma.preventiveTask.count.mockResolvedValue(0);
      mockPrisma.preventiveTask.create.mockResolvedValue({ id: "new-task" });

      const res = await app.inject({
        method: "POST",
        url: "/facilities/preventive/seed",
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.seeded).toBe(true);
      expect(body.count).toBe(12);
      expect(mockPrisma.preventiveTask.create).toHaveBeenCalledTimes(12);
    });

    it("skips seeding when tasks already exist", async () => {
      mockPrisma.preventiveTask.count.mockResolvedValue(5);

      const res = await app.inject({
        method: "POST",
        url: "/facilities/preventive/seed",
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.seeded).toBe(false);
      expect(mockPrisma.preventiveTask.create).not.toHaveBeenCalled();
    });
  });

  describe("GET /facilities/preventive — list pagination", () => {
    it("returns nextCursor when more results exist", async () => {
      // Default limit is 20, route fetches take+1 = 21 to detect more
      const tasks = Array.from({ length: 21 }, (_, i) => ({
        id: `task-${i}`,
        name: `Task ${i}`,
        nextDue: new Date(),
        assignee: null,
        _count: { entries: 0 },
      }));
      mockPrisma.preventiveTask.findMany.mockResolvedValue(tasks);

      const res = await app.inject({
        method: "GET",
        url: "/facilities/preventive",
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data).toHaveLength(20);
      expect(body.nextCursor).toBe("task-19");
    });

    it("returns null nextCursor on last page", async () => {
      const tasks = Array.from({ length: 5 }, (_, i) => ({
        id: `task-${i}`,
        name: `Task ${i}`,
        nextDue: new Date(),
        assignee: null,
        _count: { entries: 0 },
      }));
      mockPrisma.preventiveTask.findMany.mockResolvedValue(tasks);

      const res = await app.inject({
        method: "GET",
        url: "/facilities/preventive",
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data).toHaveLength(5);
      expect(body.nextCursor).toBeNull();
    });
  });

  describe("DELETE /facilities/preventive/:id — delete task", () => {
    it("deletes task and returns ok", async () => {
      mockPrisma.preventiveTask.findUnique.mockResolvedValue({ id: "task-1" });
      mockPrisma.preventiveTask.delete.mockResolvedValue({ id: "task-1" });

      const res = await app.inject({
        method: "DELETE",
        url: "/facilities/preventive/task-1",
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.ok).toBe(true);
      expect(mockPrisma.preventiveTask.delete).toHaveBeenCalledWith({
        where: { id: "task-1" },
      });
      expect(mockAudit).toHaveBeenCalledWith(
        "preventive_task.delete",
        TEST_USER_ID,
        "PreventiveTask",
        "task-1",
      );
    });

    it("returns 404 for nonexistent task", async () => {
      mockPrisma.preventiveTask.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: "DELETE",
        url: "/facilities/preventive/nonexistent",
      });

      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.payload).error).toContain("Task not found");
      expect(mockPrisma.preventiveTask.delete).not.toHaveBeenCalled();
    });
  });
});
