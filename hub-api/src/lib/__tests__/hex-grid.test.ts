import { describe, it, expect } from "vitest";
import {
  polygonToHexes,
  hexToBBox,
  hexToGeoJSON,
  subdivideHexes,
  pointToHex,
  hashBoundary,
} from "../hex-grid.js";

// Small polygon around Penzberg (~5km × 5km)
const PENZBERG_POLYGON = {
  type: "Polygon" as const,
  coordinates: [[
    [11.35, 47.75],
    [11.40, 47.75],
    [11.40, 47.80],
    [11.35, 47.80],
    [11.35, 47.75],
  ]],
};

// Larger congregation-sized polygon (~20km × 20km)
const LARGE_POLYGON = {
  type: "Polygon" as const,
  coordinates: [[
    [11.21, 47.74],
    [11.41, 47.74],
    [11.41, 47.92],
    [11.21, 47.92],
    [11.21, 47.74],
  ]],
};

describe("hex-grid", () => {
  describe("polygonToHexes", () => {
    it("returns hex indexes for a small polygon at res 8", () => {
      const hexes = polygonToHexes(PENZBERG_POLYGON, 8);
      expect(hexes.length).toBeGreaterThan(0);
      expect(hexes.length).toBeLessThan(100);
      // All hex indexes should be strings of length 15 (H3 v4 format)
      for (const h of hexes) {
        expect(typeof h).toBe("string");
        expect(h.length).toBe(15);
      }
    });

    it("returns more hexes for a larger polygon", () => {
      const small = polygonToHexes(PENZBERG_POLYGON, 8);
      const large = polygonToHexes(LARGE_POLYGON, 8);
      expect(large.length).toBeGreaterThan(small.length);
    });

    it("returns more hexes at higher resolution", () => {
      const res8 = polygonToHexes(PENZBERG_POLYGON, 8);
      const res9 = polygonToHexes(PENZBERG_POLYGON, 9);
      expect(res9.length).toBeGreaterThan(res8.length);
    });

    it("returns empty array for invalid geometry", () => {
      const result = polygonToHexes({ type: "Point", coordinates: [11.35, 47.75] }, 8);
      expect(result).toEqual([]);
    });

    it("handles MultiPolygon by taking largest polygon", () => {
      const multi = {
        type: "MultiPolygon" as const,
        coordinates: [
          // Small polygon (3 vertices + close = 4 coords)
          [[[11.35, 47.75], [11.36, 47.75], [11.36, 47.76], [11.35, 47.75]]],
          // Larger polygon (5 coords — should be selected by vertex count)
          [PENZBERG_POLYGON.coordinates[0]],
        ],
      };
      const hexes = polygonToHexes(multi, 8);
      // Should produce hexes (picks the larger polygon)
      expect(hexes.length).toBeGreaterThan(1);
    });
  });

  describe("hexToBBox", () => {
    it("returns valid bbox with south < north and west < east", () => {
      const hexes = polygonToHexes(PENZBERG_POLYGON, 8);
      const bbox = hexToBBox(hexes[0]!);
      expect(bbox.south).toBeLessThan(bbox.north);
      expect(bbox.west).toBeLessThan(bbox.east);
      // Should be in the Penzberg area
      expect(bbox.south).toBeGreaterThan(47.0);
      expect(bbox.north).toBeLessThan(48.0);
      expect(bbox.west).toBeGreaterThan(11.0);
      expect(bbox.east).toBeLessThan(12.0);
    });
  });

  describe("hexToGeoJSON", () => {
    it("returns a valid GeoJSON Polygon with closed ring", () => {
      const hexes = polygonToHexes(PENZBERG_POLYGON, 8);
      const geojson = hexToGeoJSON(hexes[0]!);
      expect(geojson.type).toBe("Polygon");
      expect(geojson.coordinates).toHaveLength(1);
      const ring = geojson.coordinates[0]!;
      // Hexagon has 6 vertices + closing point = 7
      expect(ring.length).toBe(7);
      // Ring should be closed
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      // Coordinates should be [lng, lat] format
      for (const coord of ring) {
        expect(coord[0]).toBeGreaterThan(11.0); // lng
        expect(coord[1]).toBeGreaterThan(47.0); // lat
      }
    });
  });

  describe("subdivideHexes", () => {
    it("produces children at finer resolution", () => {
      const hexes = polygonToHexes(PENZBERG_POLYGON, 8);
      const children = subdivideHexes([hexes[0]!], 10);
      // Each res-8 hex has 49 res-10 children (7^2)
      expect(children.length).toBe(49);
    });

    it("produces more children for multiple parent hexes", () => {
      const hexes = polygonToHexes(PENZBERG_POLYGON, 8);
      const children = subdivideHexes(hexes.slice(0, 3), 10);
      expect(children.length).toBe(3 * 49);
    });
  });

  describe("pointToHex", () => {
    it("returns a valid hex index for a known location", () => {
      const hex = pointToHex(47.75, 11.37, 8);
      expect(typeof hex).toBe("string");
      expect(hex.length).toBe(15);
    });

    it("returns same hex for nearby points", () => {
      const h1 = pointToHex(47.750, 11.370, 8);
      const h2 = pointToHex(47.751, 11.371, 8);
      // Very close points should be in the same res-8 hex
      expect(h1).toBe(h2);
    });
  });

  describe("hashBoundary", () => {
    it("returns consistent hash for same input", () => {
      const h1 = hashBoundary(PENZBERG_POLYGON);
      const h2 = hashBoundary(PENZBERG_POLYGON);
      expect(h1).toBe(h2);
    });

    it("returns different hash for different input", () => {
      const h1 = hashBoundary(PENZBERG_POLYGON);
      const h2 = hashBoundary(LARGE_POLYGON);
      expect(h1).not.toBe(h2);
    });

    it("returns a 64-char hex string (SHA-256)", () => {
      const hash = hashBoundary(PENZBERG_POLYGON);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
