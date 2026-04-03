/**
 * Unit tests for territory polygon export (KML, GeoJSON, GPX).
 */
import { describe, it, expect } from "vitest";
import {
  sanitizeFilename,
  territoryFilename,
  bulkFilename,
  exportToGeoJson,
  exportToKml,
  exportToGpx,
} from "../territory-export";
import type { TerritoryListItem } from "../territory-api";

// ─── Test Fixtures ──────────────────────────────────────────────────

function makeTerritoryItem(overrides: Partial<TerritoryListItem> = {}): TerritoryListItem {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    number: "101",
    name: "Parkstraße",
    description: null,
    type: "territory",
    boundaries: {
      type: "Polygon",
      coordinates: [
        [
          [11.37, 47.85],
          [11.38, 47.85],
          [11.38, 47.86],
          [11.37, 47.86],
          [11.37, 47.85],
        ],
      ],
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    assignments: [],
    ...overrides,
  };
}

const multiPolygonTerritory = makeTerritoryItem({
  number: "200",
  name: "Multi Area",
  boundaries: {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [11.37, 47.85],
          [11.38, 47.85],
          [11.38, 47.86],
          [11.37, 47.85],
        ],
      ],
      [
        [
          [11.40, 47.87],
          [11.41, 47.87],
          [11.41, 47.88],
          [11.40, 47.87],
        ],
      ],
    ],
  },
});

const noBoundaryTerritory = makeTerritoryItem({
  number: "999",
  name: "No Boundary",
  boundaries: null,
});

// ─── sanitizeFilename ───────────────────────────────────────────────

describe("sanitizeFilename", () => {
  it("lowercases and replaces spaces with hyphens", () => {
    expect(sanitizeFilename("Park Straße")).toBe("park-strasse");
  });

  it("replaces German umlauts", () => {
    expect(sanitizeFilename("Über Öl Ärger Süß")).toBe("ueber-oel-aerger-suess");
  });

  it("removes special characters", () => {
    expect(sanitizeFilename("Test! @#$ Name")).toBe("test-name");
  });

  it("collapses multiple hyphens", () => {
    expect(sanitizeFilename("a---b")).toBe("a-b");
  });

  it("trims leading/trailing hyphens", () => {
    expect(sanitizeFilename("---hello---")).toBe("hello");
  });
});

// ─── territoryFilename ──────────────────────────────────────────────

describe("territoryFilename", () => {
  it("builds correct filename", () => {
    const t = makeTerritoryItem();
    expect(territoryFilename(t, "kml")).toBe("T-101-parkstrasse.kml");
  });

  it("handles different extensions", () => {
    const t = makeTerritoryItem();
    expect(territoryFilename(t, "geojson")).toBe("T-101-parkstrasse.geojson");
    expect(territoryFilename(t, "gpx")).toBe("T-101-parkstrasse.gpx");
  });
});

// ─── bulkFilename ───────────────────────────────────────────────────

describe("bulkFilename", () => {
  it("includes today's date in ISO format", () => {
    const result = bulkFilename("kml");
    // Pattern: territories-export-YYYY-MM-DD.kml
    expect(result).toMatch(/^territories-export-\d{4}-\d{2}-\d{2}\.kml$/);
  });
});

// ─── exportToGeoJson ────────────────────────────────────────────────

describe("exportToGeoJson", () => {
  it("returns a valid FeatureCollection", () => {
    const t = makeTerritoryItem();
    const result = JSON.parse(exportToGeoJson([t]));

    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toHaveLength(1);
    expect(result.features[0].type).toBe("Feature");
    expect(result.features[0].properties).toEqual({
      number: "101",
      name: "Parkstraße",
      type: "territory",
    });
    expect(result.features[0].geometry.type).toBe("Polygon");
    expect(result.features[0].geometry.coordinates).toHaveLength(1);
  });

  it("skips territories without boundaries", () => {
    const result = JSON.parse(exportToGeoJson([noBoundaryTerritory]));
    expect(result.features).toHaveLength(0);
  });

  it("handles MultiPolygon geometry", () => {
    const result = JSON.parse(exportToGeoJson([multiPolygonTerritory]));
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.type).toBe("MultiPolygon");
    expect(result.features[0].geometry.coordinates).toHaveLength(2);
  });

  it("handles mixed territories (some with, some without boundaries)", () => {
    const t = makeTerritoryItem();
    const result = JSON.parse(exportToGeoJson([t, noBoundaryTerritory]));
    expect(result.features).toHaveLength(1);
  });
});

// ─── exportToKml ────────────────────────────────────────────────────

describe("exportToKml", () => {
  it("returns valid KML structure", () => {
    const t = makeTerritoryItem();
    const kml = exportToKml([t]);

    expect(kml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(kml).toContain('<kml xmlns="http://www.opengis.net/kml/2.2">');
    expect(kml).toContain("<Document>");
    expect(kml).toContain("<Placemark>");
    expect(kml).toContain("<name>101 — Parkstraße</name>");
  });

  it("contains correct KML coordinates (lng,lat,0)", () => {
    const t = makeTerritoryItem();
    const kml = exportToKml([t]);

    expect(kml).toContain("11.37,47.85,0");
    expect(kml).toContain("11.38,47.85,0");
  });

  it("wraps MultiPolygon in MultiGeometry", () => {
    const kml = exportToKml([multiPolygonTerritory]);
    expect(kml).toContain("<MultiGeometry>");
    // Should have two Polygon elements inside
    const polyCount = (kml.match(/<Polygon>/g) || []).length;
    expect(polyCount).toBe(2);
  });

  it("skips territories without boundaries", () => {
    const kml = exportToKml([noBoundaryTerritory]);
    expect(kml).not.toContain("<Placemark>");
  });

  it("escapes XML special characters in names", () => {
    const t = makeTerritoryItem({ name: 'Test <&> "Name"' });
    const kml = exportToKml([t]);

    expect(kml).toContain("&lt;");
    expect(kml).toContain("&amp;");
    expect(kml).toContain("&gt;");
    expect(kml).toContain("&quot;");
    expect(kml).not.toContain("<&>");
  });
});

// ─── exportToGpx ────────────────────────────────────────────────────

describe("exportToGpx", () => {
  it("returns valid GPX structure", () => {
    const t = makeTerritoryItem();
    const gpx = exportToGpx([t]);

    expect(gpx).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(gpx).toContain('<gpx version="1.1"');
    expect(gpx).toContain("xmlns=\"http://www.topografix.com/GPX/1/1\"");
    expect(gpx).toContain("<trk>");
    expect(gpx).toContain("<trkseg>");
    expect(gpx).toContain("<name>101</name>");
  });

  it("contains correct lat/lon attributes", () => {
    const t = makeTerritoryItem();
    const gpx = exportToGpx([t]);

    expect(gpx).toContain('lat="47.85"');
    expect(gpx).toContain('lon="11.37"');
  });

  it("auto-closes ring if first != last point", () => {
    const openRing = makeTerritoryItem({
      boundaries: {
        type: "Polygon",
        coordinates: [
          [
            [11.37, 47.85],
            [11.38, 47.85],
            [11.38, 47.86],
            // Missing closing point — should auto-close
          ],
        ],
      },
    });
    const gpx = exportToGpx([openRing]);

    // Count trkpt elements — should be 4 (3 original + 1 auto-closed)
    const trkptCount = (gpx.match(/<trkpt /g) || []).length;
    expect(trkptCount).toBe(4);
  });

  it("does NOT duplicate closing point if already closed", () => {
    const t = makeTerritoryItem(); // default fixture is already closed
    const gpx = exportToGpx([t]);

    // 5 points in fixture, already closed → 5 trkpts
    const trkptCount = (gpx.match(/<trkpt /g) || []).length;
    expect(trkptCount).toBe(5);
  });

  it("handles MultiPolygon with multiple trkseg", () => {
    const gpx = exportToGpx([multiPolygonTerritory]);

    const trksegCount = (gpx.match(/<trkseg>/g) || []).length;
    expect(trksegCount).toBe(2);
  });

  it("skips territories without boundaries", () => {
    const gpx = exportToGpx([noBoundaryTerritory]);
    expect(gpx).not.toContain("<trk>");
  });
});
