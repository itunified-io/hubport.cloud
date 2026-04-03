/**
 * Territory polygon export — client-side serialization for KML, GeoJSON, GPX.
 * Pure functions, no API calls. Boundaries are already loaded in the frontend.
 */
import type { TerritoryListItem } from "./territory-api";

// ─── Helpers ────────────────────────────────────────────────────────

interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

function extractBoundary(t: TerritoryListItem): GeoJsonGeometry | null {
  const b = t.boundaries as GeoJsonGeometry | null;
  if (!b || !b.type || !b.coordinates) return null;
  if (b.type !== "Polygon" && b.type !== "MultiPolygon") {
    console.warn(`[export] Skipping territory ${t.number}: unsupported geometry type "${b.type}"`);
    return null;
  }
  return b;
}

/** Sanitize territory name for use in filenames. */
export function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Build filename for single territory export. */
export function territoryFilename(t: TerritoryListItem, ext: string): string {
  return `T-${t.number}-${sanitizeFilename(t.name)}.${ext}`;
}

/** Build filename for bulk export. */
export function bulkFilename(ext: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `territories-export-${date}.${ext}`;
}

/** Trigger browser download of a text file. */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── GeoJSON ────────────────────────────────────────────────────────

export function exportToGeoJson(territories: TerritoryListItem[]): string {
  const features = territories
    .map((t) => {
      const geom = extractBoundary(t);
      if (!geom) return null;
      return {
        type: "Feature" as const,
        properties: { number: t.number, name: t.name, type: t.type ?? "territory" },
        geometry: geom,
      };
    })
    .filter(Boolean);

  return JSON.stringify({ type: "FeatureCollection", features }, null, 2);
}

// ─── KML ────────────────────────────────────────────────────────────

export function exportToKml(territories: TerritoryListItem[]): string {
  const placemarks = territories
    .map((t) => {
      const geom = extractBoundary(t);
      if (!geom) return "";
      const name = escapeXml(`${t.number} — ${t.name}`);

      let geometryXml: string;
      if (geom.type === "MultiPolygon") {
        const polys = geom.coordinates as number[][][][];
        geometryXml = `<MultiGeometry>${polys.map((poly) =>
          `<Polygon><outerBoundaryIs><LinearRing><coordinates>${
            poly[0]!.map((c) => `${c[0]},${c[1]},0`).join(" ")
          }</coordinates></LinearRing></outerBoundaryIs></Polygon>`
        ).join("")}</MultiGeometry>`;
      } else {
        const rings = geom.coordinates as number[][][];
        geometryXml = `<Polygon><outerBoundaryIs><LinearRing><coordinates>${
          rings[0]!.map((c) => `${c[0]},${c[1]},0`).join(" ")
        }</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
      }

      return `    <Placemark>\n      <name>${name}</name>\n      ${geometryXml}\n    </Placemark>`;
    })
    .filter(Boolean)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Territory Export</name>
${placemarks}
  </Document>
</kml>`;
}

// ─── GPX ────────────────────────────────────────────────────────────

export function exportToGpx(territories: TerritoryListItem[]): string {
  const tracks = territories
    .map((t) => {
      const geom = extractBoundary(t);
      if (!geom) return "";

      let rings: number[][][] = [];
      if (geom.type === "Polygon") {
        rings = [((geom.coordinates as number[][][])[0] ?? [])];
      } else if (geom.type === "MultiPolygon") {
        rings = (geom.coordinates as number[][][][]).map((p) => p[0] ?? []);
      }

      const segments = rings.map((ring) => {
        const pts = [...ring];
        if (pts.length > 0) {
          const first = pts[0]!;
          const last = pts[pts.length - 1]!;
          if (first[0] !== last[0] || first[1] !== last[1]) {
            pts.push([...first]);
          }
        }
        const trkpts = pts
          .map((c) => `        <trkpt lat="${c[1]}" lon="${c[0]}"></trkpt>`)
          .join("\n");
        return `      <trkseg>\n${trkpts}\n      </trkseg>`;
      }).join("\n");

      return `    <trk>\n      <name>${escapeXml(t.number)}</name>\n${segments}\n    </trk>`;
    })
    .filter(Boolean)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="hubport.cloud"
     xmlns="http://www.topografix.com/GPX/1/1">
${tracks}
</gpx>`;
}
