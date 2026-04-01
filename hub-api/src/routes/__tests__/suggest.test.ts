import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock nominatim before importing
vi.mock("../../lib/osm-nominatim.js", () => ({
  reverseGeocode: vi.fn(),
}));

import { reverseGeocode } from "../../lib/osm-nominatim.js";
import { suggestFromBoundaries } from "../territories.js";

const mockedReverseGeocode = reverseGeocode as ReturnType<typeof vi.fn>;

const makePolygon = (coords: number[][] = [[11.37, 47.74], [11.39, 47.74], [11.39, 47.76], [11.37, 47.76], [11.37, 47.74]]) => ({
  type: "Polygon" as const,
  coordinates: [coords],
});

function mockPrisma(territories: Array<{ number: string; name: string }>) {
  return {
    territory: {
      findMany: vi.fn().mockResolvedValue(territories),
    },
  } as any;
}

describe("suggestFromBoundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns city and suggested number from polygon centroid", async () => {
    mockedReverseGeocode.mockResolvedValue({
      lat: 47.75, lng: 11.38, displayName: "Antdorf",
      osmId: "123", osmType: "relation",
      address: { city: "Antdorf", country: "Germany" },
    });

    const prisma = mockPrisma([
      { number: "501", name: "Antdorf" },
      { number: "503", name: "Antdorf" },
      { number: "505", name: "Antdorf" },
    ]);

    const result = await suggestFromBoundaries(prisma, makePolygon());
    expect(result.city).toBe("Antdorf");
    expect(result.suggestedPrefix).toBe("5");
    expect(result.suggestedNumber).toBe("502");
    expect(result.existingInGroup).toEqual(["501", "503", "505"]);
  });

  it("returns null city when Nominatim fails", async () => {
    mockedReverseGeocode.mockResolvedValue(null);

    const prisma = mockPrisma([]);
    const result = await suggestFromBoundaries(prisma, makePolygon());
    expect(result.city).toBeNull();
    expect(result.suggestedPrefix).toBe("1");
    expect(result.suggestedNumber).toBe("101");
  });

  it("finds next available number skipping gaps", async () => {
    mockedReverseGeocode.mockResolvedValue({
      lat: 47.75, lng: 11.38, displayName: "Penzberg",
      osmId: "1", osmType: "relation",
      address: { city: "Penzberg" },
    });

    const prisma = mockPrisma([
      { number: "301", name: "Penzberg" },
      { number: "302", name: "Penzberg" },
      { number: "304", name: "Penzberg" },
    ]);

    const result = await suggestFromBoundaries(prisma, makePolygon());
    expect(result.suggestedNumber).toBe("303");
  });

  it("suggests next unused prefix for new city", async () => {
    mockedReverseGeocode.mockResolvedValue({
      lat: 47.75, lng: 11.38, displayName: "Seeshaupt",
      osmId: "2", osmType: "relation",
      address: { city: "Seeshaupt" },
    });

    const prisma = mockPrisma([
      { number: "101", name: "Penzberg" },
      { number: "301", name: "Antdorf" },
      { number: "501", name: "Iffeldorf" },
    ]);

    const result = await suggestFromBoundaries(prisma, makePolygon());
    expect(result.city).toBe("Seeshaupt");
    // Prefixes 1, 3, 5 taken → suggest 2
    expect(result.suggestedPrefix).toBe("2");
    expect(result.suggestedNumber).toBe("201");
  });

  it("handles Nominatim throwing an error gracefully", async () => {
    mockedReverseGeocode.mockRejectedValue(new Error("Network error"));

    const prisma = mockPrisma([{ number: "101", name: "Test" }]);
    const result = await suggestFromBoundaries(prisma, makePolygon());
    expect(result.city).toBeNull();
    // Prefix 1 is taken, so suggest 2
    expect(result.suggestedPrefix).toBe("2");
  });
});
