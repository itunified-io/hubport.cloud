import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so mock objects are available when vi.mock factory runs
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    territory: { findUnique: vi.fn() },
    address: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    addressVisit: { create: vi.fn() },
    publisher: { findFirst: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock("../../lib/prisma.js", () => ({ default: mockPrisma }));
vi.mock("../../lib/rbac.js", () => ({
  requirePermission: () => async () => {},
  requireAnyPermission: (..._perms: string[]) => async () => {},
}));

import Fastify from "fastify";
import { addressRoutes } from "../addresses.js";

describe("Address routes", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.addHook("onRequest", async (request: any) => {
      request.user = { sub: "test-user-sub" };
    });
    await app.register(addressRoutes);
    await app.ready();
  });

  describe("GET /territories/:id/addresses", () => {
    it("returns addresses for a territory", async () => {
      mockPrisma.territory.findUnique.mockResolvedValue({ id: "t1" });
      mockPrisma.address.findMany.mockResolvedValue([
        {
          id: "a1",
          lat: 48.1,
          lng: 10.1,
          street: "Main St",
          houseNumber: "1",
          status: "active",
          doNotVisitUntil: null,
          visits: [],
        },
      ]);

      const res = await app.inject({
        method: "GET",
        url: "/territories/00000000-0000-0000-0000-000000000001/addresses",
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveLength(1);
      expect(body[0].street).toBe("Main St");
    });

    it("returns 404 for nonexistent territory", async () => {
      mockPrisma.territory.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: "GET",
        url: "/territories/00000000-0000-0000-0000-000000000001/addresses",
      });

      expect(res.statusCode).toBe(404);
    });

    it("auto-reverts expired DNC addresses", async () => {
      mockPrisma.territory.findUnique.mockResolvedValue({ id: "t1" });
      const pastDate = new Date(Date.now() - 86400000);
      mockPrisma.address.findMany.mockResolvedValue([
        {
          id: "a1",
          status: "do_not_call",
          doNotVisitUntil: pastDate,
          visits: [],
        },
      ]);
      mockPrisma.address.updateMany.mockResolvedValue({ count: 1 });

      const res = await app.inject({
        method: "GET",
        url: "/territories/00000000-0000-0000-0000-000000000001/addresses",
      });

      expect(res.statusCode).toBe(200);
      expect(mockPrisma.address.updateMany).toHaveBeenCalled();
      const body = JSON.parse(res.payload);
      expect(body[0].status).toBe("active");
    });
  });

  describe("POST /territories/:id/addresses", () => {
    it("creates a new address", async () => {
      mockPrisma.territory.findUnique.mockResolvedValue({ id: "t1" });
      mockPrisma.address.create.mockResolvedValue({
        id: "new-addr",
        lat: 48.1,
        lng: 10.1,
        street: "Test St",
        houseNumber: "5",
        territoryId: "t1",
      });
      mockPrisma.$executeRaw.mockResolvedValue(1);

      const res = await app.inject({
        method: "POST",
        url: "/territories/00000000-0000-0000-0000-000000000001/addresses",
        payload: { lat: 48.1, lng: 10.1, street: "Test St", houseNumber: "5" },
      });

      expect(res.statusCode).toBe(201);
      expect(mockPrisma.address.create).toHaveBeenCalled();
    });

    it("returns 404 if territory does not exist", async () => {
      mockPrisma.territory.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: "POST",
        url: "/territories/00000000-0000-0000-0000-000000000001/addresses",
        payload: { lat: 48.1, lng: 10.1 },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("PUT /territories/:id/addresses/:addrId", () => {
    it("updates an existing address", async () => {
      mockPrisma.address.findFirst.mockResolvedValue({ id: "a1", territoryId: "t1" });
      mockPrisma.address.update.mockResolvedValue({
        id: "a1",
        street: "Updated St",
      });

      const res = await app.inject({
        method: "PUT",
        url: "/territories/00000000-0000-0000-0000-000000000001/addresses/00000000-0000-0000-0000-000000000002",
        payload: { street: "Updated St" },
      });

      expect(res.statusCode).toBe(200);
    });

    it("returns 404 for nonexistent address", async () => {
      mockPrisma.address.findFirst.mockResolvedValue(null);

      const res = await app.inject({
        method: "PUT",
        url: "/territories/00000000-0000-0000-0000-000000000001/addresses/00000000-0000-0000-0000-000000000002",
        payload: { street: "Test" },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("DELETE /territories/:id/addresses/:addrId", () => {
    it("deletes an address", async () => {
      mockPrisma.address.findFirst.mockResolvedValue({ id: "a1" });
      mockPrisma.address.delete.mockResolvedValue({ id: "a1" });

      const res = await app.inject({
        method: "DELETE",
        url: "/territories/00000000-0000-0000-0000-000000000001/addresses/00000000-0000-0000-0000-000000000002",
      });

      expect(res.statusCode).toBe(204);
    });
  });

  describe("POST /territories/:id/addresses/bulk", () => {
    it("creates multiple addresses", async () => {
      mockPrisma.territory.findUnique.mockResolvedValue({ id: "t1" });
      mockPrisma.address.createMany.mockResolvedValue({ count: 2 });

      const res = await app.inject({
        method: "POST",
        url: "/territories/00000000-0000-0000-0000-000000000001/addresses/bulk",
        payload: {
          addresses: [
            { lat: 48.1, lng: 10.1, street: "A St", houseNumber: "1" },
            { lat: 48.2, lng: 10.2, street: "B St", houseNumber: "2" },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.created).toBe(2);
    });
  });

  describe("POST /territories/:id/addresses/:addrId/visits", () => {
    it("logs a visit and denormalizes lastVisitAt", async () => {
      mockPrisma.address.findFirst.mockResolvedValue({ id: "a1" });
      mockPrisma.publisher.findFirst.mockResolvedValue({ id: "pub1" });

      const visitRecord = {
        id: "v1",
        outcome: "contacted",
        notes: "Nice person",
        publisher: { id: "pub1", firstName: "Test", lastName: "User" },
      };
      mockPrisma.$transaction.mockResolvedValue([visitRecord, {}]);

      const res = await app.inject({
        method: "POST",
        url: "/territories/00000000-0000-0000-0000-000000000001/addresses/00000000-0000-0000-0000-000000000002/visits",
        payload: { outcome: "contacted", notes: "Nice person" },
      });

      expect(res.statusCode).toBe(201);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it("updates address status to DNC when outcome is do_not_call", async () => {
      mockPrisma.address.findFirst.mockResolvedValue({ id: "a1" });
      mockPrisma.publisher.findFirst.mockResolvedValue({ id: "pub1" });
      mockPrisma.$transaction.mockResolvedValue([
        { id: "v1", outcome: "do_not_call" },
        {},
      ]);
      mockPrisma.address.update.mockResolvedValue({ id: "a1", status: "do_not_call" });

      const res = await app.inject({
        method: "POST",
        url: "/territories/00000000-0000-0000-0000-000000000001/addresses/00000000-0000-0000-0000-000000000002/visits",
        payload: { outcome: "do_not_call" },
      });

      expect(res.statusCode).toBe(201);
      expect(mockPrisma.address.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: "do_not_call" },
        }),
      );
    });
  });
});
