import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock osm-overpass before importing the module under test
vi.mock("../../lib/osm-overpass.js", () => ({
  queryRoadsInBBox: vi.fn(),
  queryBuildingsInBBox: vi.fn(),
  queryWaterBodiesInBBox: vi.fn(),
}));

// Mock prisma
vi.mock("../../lib/prisma.js", () => ({
  default: {
    localOsmFeature: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

// Mock rbac
vi.mock("../../lib/rbac.js", () => ({
  requirePermission: () => async () => {},
  requireAnyPermission: (..._perms: string[]) => async () => {},
}));

import {
  queryRoadsInBBox,
  queryBuildingsInBBox,
  queryWaterBodiesInBBox,
} from "../../lib/osm-overpass.js";
import Fastify from "fastify";
import { territoryRoutes } from "../territories.js";

const mockedRoads = queryRoadsInBBox as ReturnType<typeof vi.fn>;
const mockedBuildings = queryBuildingsInBBox as ReturnType<typeof vi.fn>;
const mockedWater = queryWaterBodiesInBBox as ReturnType<typeof vi.fn>;

describe("GET /territories/snap-context", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify();
    await app.register(territoryRoutes);
    await app.ready();

    mockedRoads.mockReset();
    mockedBuildings.mockReset();
    mockedWater.mockReset();
  });

  it("returns combined GeoJSON FeatureCollection", async () => {
    mockedRoads.mockResolvedValue([
      {
        osmId: "way/123",
        highway: "residential",
        name: "Main St",
        geometry: {
          type: "LineString",
          coordinates: [
            [10.0, 48.0],
            [10.1, 48.1],
          ],
        },
      },
    ]);
    mockedBuildings.mockResolvedValue([
      {
        osmId: "way/456",
        osmType: "way",
        lat: 48.05,
        lng: 10.05,
        tags: {},
        buildingType: "house",
        hasAddress: false,
      },
    ]);
    mockedWater.mockResolvedValue([
      {
        osmId: "way/789",
        waterType: "water",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [10.0, 48.0],
              [10.1, 48.0],
              [10.1, 48.1],
              [10.0, 48.0],
            ],
          ],
        },
        name: "Lake Test",
      },
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/territories/snap-context?bbox=10.0,48.0,10.2,48.2",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.type).toBe("FeatureCollection");
    expect(body.features).toHaveLength(3);

    const snapTypes = body.features.map(
      (f: any) => f.properties.snapType,
    );
    expect(snapTypes).toContain("road");
    expect(snapTypes).toContain("building");
    expect(snapTypes).toContain("water");

    // Verify Overpass was called with correct bbox (south, west, north, east)
    expect(mockedRoads).toHaveBeenCalledWith(48.0, 10.0, 48.2, 10.2);
  });

  it("returns 400 for invalid bbox format", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/territories/snap-context?bbox=invalid",
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for out-of-range coordinates", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/territories/snap-context?bbox=-200,48.0,10.2,48.2",
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns empty collection when no snap targets found", async () => {
    mockedRoads.mockResolvedValue([]);
    mockedBuildings.mockResolvedValue([]);
    mockedWater.mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url: "/territories/snap-context?bbox=10.0,48.0,10.2,48.2",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.features).toHaveLength(0);
  });
});
