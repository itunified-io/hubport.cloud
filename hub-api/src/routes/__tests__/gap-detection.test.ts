import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    territory: { findUnique: vi.fn() },
    address: { findMany: vi.fn() },
    ignoredOsmBuilding: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    gapDetectionRun: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("../../lib/prisma.js", () => ({ default: mockPrisma }));
vi.mock("../../lib/rbac.js", () => ({
  requirePermission: () => async () => {},
  requireAnyPermission: (..._perms: string[]) => async () => {},
}));
vi.mock("../../lib/osm-overpass.js", () => ({
  queryBuildingsInBBox: vi.fn(),
}));

import { queryBuildingsInBBox } from "../../lib/osm-overpass.js";
import Fastify from "fastify";
import { gapDetectionRoutes } from "../gap-detection.js";

const mockedQueryBuildings = queryBuildingsInBBox as ReturnType<typeof vi.fn>;

describe("Gap detection routes", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();
    app.addHook("onRequest", async (request: any) => {
      request.user = { sub: "test-user" };
    });
    await app.register(gapDetectionRoutes);
    await app.ready();
  });

  describe("POST /territories/gap-detection/run", () => {
    it("detects gaps in a territory", async () => {
      const territoryId = "00000000-0000-0000-0000-000000000001";

      mockPrisma.territory.findUnique.mockResolvedValue({
        id: territoryId,
        number: "001",
        boundaries: {
          type: "Polygon",
          coordinates: [[[10.0, 48.0], [10.2, 48.0], [10.2, 48.2], [10.0, 48.2], [10.0, 48.0]]],
        },
      });

      mockedQueryBuildings.mockResolvedValue([
        { osmId: "way/1", lat: 48.1, lng: 10.1, hasAddress: true, buildingType: "house" },
        { osmId: "way/2", lat: 48.15, lng: 10.15, hasAddress: false, buildingType: "yes" },
      ]);

      mockPrisma.gapDetectionRun.create.mockResolvedValue({ id: "run-1" });
      mockPrisma.gapDetectionRun.update.mockResolvedValue({});
      mockPrisma.address.findMany.mockResolvedValue([
        { osmId: "way/1" },
      ]);
      mockPrisma.ignoredOsmBuilding.findMany.mockResolvedValue([]);
      mockPrisma.gapDetectionRun.findMany.mockResolvedValue([]);
      mockPrisma.gapDetectionRun.deleteMany.mockResolvedValue({});

      const res = await app.inject({
        method: "POST",
        url: "/territories/gap-detection/run",
        payload: { territoryIds: [territoryId] },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveLength(1);
      expect(body[0].coveredCount).toBe(1);
      expect(body[0].gapCount).toBe(1);
    });
  });

  describe("POST /territories/gap-detection/ignore", () => {
    it("ignores buildings in batch", async () => {
      mockPrisma.ignoredOsmBuilding.findFirst.mockResolvedValue(null);
      mockPrisma.ignoredOsmBuilding.create.mockResolvedValue({});

      const res = await app.inject({
        method: "POST",
        url: "/territories/gap-detection/ignore",
        payload: {
          buildings: [
            {
              territoryId: "00000000-0000-0000-0000-000000000001",
              osmId: "way/999",
              reason: "Garage, not residential",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.created).toContain("way/999");
    });

    it("skips already ignored buildings", async () => {
      mockPrisma.ignoredOsmBuilding.findFirst.mockResolvedValue({ id: "existing" });

      const res = await app.inject({
        method: "POST",
        url: "/territories/gap-detection/ignore",
        payload: {
          buildings: [
            {
              territoryId: "00000000-0000-0000-0000-000000000001",
              osmId: "way/999",
              reason: "Garage",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.skipped).toContain("way/999");
    });
  });

  describe("GET /territories/gap-detection/ignored", () => {
    it("lists ignored buildings", async () => {
      mockPrisma.ignoredOsmBuilding.findMany.mockResolvedValue([
        { id: "i1", osmId: "way/100", reason: "Garage", territory: { id: "t1", number: "001", name: "Test" } },
      ]);

      const res = await app.inject({
        method: "GET",
        url: "/territories/gap-detection/ignored",
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body).toHaveLength(1);
    });
  });

  describe("GET /territories/gap-detection/history", () => {
    it("returns recent completed and failed runs", async () => {
      mockPrisma.gapDetectionRun.findMany
        .mockResolvedValueOnce([{ id: "r1", status: "completed" }])
        .mockResolvedValueOnce([{ id: "r2", status: "failed" }]);

      const res = await app.inject({
        method: "GET",
        url: "/territories/gap-detection/history",
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.completed).toHaveLength(1);
      expect(body.failed).toHaveLength(1);
    });
  });
});
