import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    osmRefreshQueue: {
      update: vi.fn(),
    },
    territory: {
      findUnique: vi.fn(),
    },
    address: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $executeRaw: vi.fn(),
  },
}));

vi.mock("../../lib/prisma.js", () => ({
  default: mockPrisma,
}));

vi.mock("../../lib/osm-overpass.js", () => ({
  queryBuildingsInBBox: vi.fn(),
}));

import { queryBuildingsInBBox } from "../../lib/osm-overpass.js";
import { processOsmRefresh } from "../osm-refresh.js";

const mockedQueryBuildings = queryBuildingsInBBox as ReturnType<typeof vi.fn>;

describe("processOsmRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("processes a territory and creates new addresses", async () => {
    const jobData = {
      territoryId: "territory-1",
      queueRecordId: "queue-1",
    };

    mockPrisma.territory.findUnique.mockResolvedValue({
      id: "territory-1",
      boundaries: {
        type: "Polygon",
        coordinates: [[[10.0, 48.0], [10.2, 48.0], [10.2, 48.2], [10.0, 48.2], [10.0, 48.0]]],
      },
    });

    mockedQueryBuildings.mockResolvedValue([
      {
        osmId: "way/100",
        osmType: "way",
        lat: 48.1,
        lng: 10.1,
        tags: {},
        street: "Main St",
        houseNumber: "1",
        streetAddress: "Main St 1",
        buildingType: "house",
        hasAddress: true,
      },
      {
        osmId: "way/200",
        osmType: "way",
        lat: 48.15,
        lng: 10.15,
        tags: {},
        hasAddress: false,
      },
    ]);

    mockPrisma.address.findMany.mockResolvedValue([]);
    mockPrisma.address.create.mockResolvedValue({ id: "addr-1" });

    const mockJob = { data: jobData } as any;
    await processOsmRefresh(mockJob);

    // Should mark as processing
    expect(mockPrisma.osmRefreshQueue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "queue-1" },
        data: expect.objectContaining({ status: "processing" }),
      }),
    );

    // Should create 1 address (only the one with hasAddress: true)
    expect(mockPrisma.address.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.address.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        territoryId: "territory-1",
        osmId: "way/100",
        street: "Main St",
        houseNumber: "1",
        source: "osm",
      }),
    });

    // Should mark as completed
    expect(mockPrisma.osmRefreshQueue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "queue-1" },
        data: expect.objectContaining({
          status: "completed",
          buildingsFound: 2,
          addressesCreated: 1,
          addressesUpdated: 0,
        }),
      }),
    );
  });

  it("updates existing addresses when street changes", async () => {
    const jobData = {
      territoryId: "territory-1",
      queueRecordId: "queue-1",
    };

    mockPrisma.territory.findUnique.mockResolvedValue({
      id: "territory-1",
      boundaries: {
        type: "Polygon",
        coordinates: [[[10.0, 48.0], [10.2, 48.0], [10.2, 48.2], [10.0, 48.2], [10.0, 48.0]]],
      },
    });

    mockedQueryBuildings.mockResolvedValue([
      {
        osmId: "way/100",
        lat: 48.1,
        lng: 10.1,
        tags: {},
        street: "New Street Name",
        houseNumber: "1",
        hasAddress: true,
        buildingType: "house",
      },
    ]);

    mockPrisma.address.findMany.mockResolvedValue([
      { id: "addr-existing", osmId: "way/100", street: "Old Street", houseNumber: "1" },
    ]);

    mockPrisma.address.update.mockResolvedValue({ id: "addr-existing" });

    const mockJob = { data: jobData } as any;
    await processOsmRefresh(mockJob);

    expect(mockPrisma.address.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "addr-existing" },
        data: expect.objectContaining({
          street: "New Street Name",
        }),
      }),
    );
  });

  it("marks as failed when territory not found", async () => {
    mockPrisma.territory.findUnique.mockResolvedValue(null);

    const mockJob = {
      data: { territoryId: "nonexistent", queueRecordId: "queue-1" },
    } as any;

    await expect(processOsmRefresh(mockJob)).rejects.toThrow("Territory nonexistent not found");

    expect(mockPrisma.osmRefreshQueue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
  });

  it("marks as failed when territory has no boundaries", async () => {
    mockPrisma.territory.findUnique.mockResolvedValue({
      id: "territory-1",
      boundaries: null,
    });

    const mockJob = {
      data: { territoryId: "territory-1", queueRecordId: "queue-1" },
    } as any;

    await expect(processOsmRefresh(mockJob)).rejects.toThrow("no boundaries");

    expect(mockPrisma.osmRefreshQueue.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
  });
});
