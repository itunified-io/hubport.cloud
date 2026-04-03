# Territory Polygon Export Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add KML/GeoJSON/GPX/PDF export for territory polygons with single, bulk, and export-all scopes.

**Architecture:** Client-side serialization for text formats (KML, GeoJSON, GPX) via pure functions in `territory-export.ts`. Server-side PDF rendering via Puppeteer + pdfkit behind `POST /territories/export/pdf`. Export UI on both TerritoryDetail (dropdown) and TerritoryList (checkboxes + toolbar).

**Tech Stack:** TypeScript, React, Fastify, MapLibre GL JS, Puppeteer-core, pdfkit, archiver

**Spec:** `docs/superpowers/specs/2026-04-03-territory-polygon-export-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `hub-app/src/lib/territory-export.ts` | Pure functions: `exportToKml`, `exportToGeoJson`, `exportToGpx`, `downloadFile`, `sanitizeFilename` |
| `hub-app/src/pages/territories/ExportDropdown.tsx` | Reusable export dropdown button (used on detail + list pages) |
| `hub-api/src/routes/territory-export.ts` | `POST /territories/export/pdf` endpoint with TypeBox validation |
| `hub-api/src/lib/pdf-renderer.ts` | Puppeteer browser management, map screenshot, pdfkit PDF composition |
| _(no separate HTML file)_ | Map template is inlined as a template literal in `pdf-renderer.ts` to avoid build/copy issues |
| `hub-app/src/lib/__tests__/territory-export.test.ts` | Unit tests for KML/GeoJSON/GPX serialization |

### Modified Files

| File | Change |
|------|--------|
| `hub-api/src/lib/permissions.ts` | Add `TERRITORIES_EXPORT` permission + role mappings |
| `hub-api/src/index.ts` | Import and register `territoryExportRoutes` |
| `hub-app/src/lib/territory-api.ts` | Add `exportPdf()` function |
| `hub-app/src/pages/territories/TerritoryDetail.tsx` | Add ExportDropdown alongside Edit/Clip buttons |
| `hub-app/src/pages/territories/TerritoryList.tsx` | Add checkbox column, export toolbar, "Export All" |
| `hub-app/src/i18n/messages/en-US.json` | Add `territory.export.*` messages |
| `hub-app/src/i18n/messages/de-DE.json` | Add German translations |
| `hub-api/package.json` | Add puppeteer-core, pdfkit, @types/pdfkit, archiver, @types/archiver |
| `Dockerfile` | Add Chromium + env vars in runtime stage (before `adduser` for layer caching) |

**Note:** All commit messages below omit the issue number (`#NNN`). The implementer MUST add the GitHub issue reference per CLAUDE.md conventions.

---

## Chunk 1: RBAC Permission + Client-Side Export Functions

### Task 1: Add TERRITORIES_EXPORT Permission

**Files:**
- Modify: `hub-api/src/lib/permissions.ts`

- [ ] **Step 1: Add the permission constant**

In `hub-api/src/lib/permissions.ts`, add after line 97 (`TERRITORIES_SHARE`):

```typescript
  TERRITORIES_EXPORT: "app:territories.export",
```

- [ ] **Step 2: Add to BASE_ROLE_PERMISSIONS**

Add `PERMISSIONS.TERRITORIES_EXPORT` to:
- `publisher` array (after `PERMISSIONS.TERRITORIES_VIEW` at line 237)
- `elder` array (after `PERMISSIONS.TERRITORIES_SHARE` at line 267)
- `ministerial_servant` array (after `PERMISSIONS.TERRITORIES_VIEW` at line 333)

- [ ] **Step 3: Add to CONGREGATION_ROLE_PERMISSIONS**

Add `PERMISSIONS.TERRITORIES_EXPORT` to:
- `ministerial_servant` array (after `PERMISSIONS.TERRITORIES_VIEW` at line 333)
- `elder` array (after `PERMISSIONS.TERRITORIES_VIEW` at line 350)

- [ ] **Step 4: Build hub-api to verify**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-api`
Expected: Clean build, no errors.

- [ ] **Step 5: Commit**

```bash
git add hub-api/src/lib/permissions.ts
git commit -m "feat: add TERRITORIES_EXPORT permission for polygon export"
```

---

### Task 2: Client-Side Export Serialization — GeoJSON

**Files:**
- Create: `hub-app/src/lib/territory-export.ts`
- Create: `hub-app/src/lib/__tests__/territory-export.test.ts`

- [ ] **Step 1: Write failing test for GeoJSON export**

Create `hub-app/src/lib/__tests__/territory-export.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { exportToGeoJson, sanitizeFilename } from "../territory-export";
import type { TerritoryListItem } from "../territory-api";

const makeTerr = (overrides: Partial<TerritoryListItem> = {}): TerritoryListItem => ({
  id: "uuid-1",
  number: "101",
  name: "Parkstrasse",
  description: null,
  type: "territory",
  boundaries: {
    type: "Polygon",
    coordinates: [[[11.38, 47.75], [11.39, 47.75], [11.39, 47.76], [11.38, 47.76], [11.38, 47.75]]],
  },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  assignments: [],
  ...overrides,
});

describe("exportToGeoJson", () => {
  it("exports single territory as FeatureCollection", () => {
    const result = JSON.parse(exportToGeoJson([makeTerr()]));
    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toHaveLength(1);
    expect(result.features[0].type).toBe("Feature");
    expect(result.features[0].properties.number).toBe("101");
    expect(result.features[0].properties.name).toBe("Parkstrasse");
    expect(result.features[0].geometry.type).toBe("Polygon");
    expect(result.features[0].geometry.coordinates).toEqual(
      [[[11.38, 47.75], [11.39, 47.75], [11.39, 47.76], [11.38, 47.76], [11.38, 47.75]]],
    );
  });

  it("skips territories without boundaries", () => {
    const result = JSON.parse(exportToGeoJson([
      makeTerr(),
      makeTerr({ id: "uuid-2", number: "102", name: "Bahnhof", boundaries: null }),
    ]));
    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties.number).toBe("101");
  });

  it("returns empty FeatureCollection when all skipped", () => {
    const result = JSON.parse(exportToGeoJson([
      makeTerr({ boundaries: null }),
    ]));
    expect(result.features).toHaveLength(0);
  });

  it("handles MultiPolygon", () => {
    const multi = makeTerr({
      boundaries: {
        type: "MultiPolygon",
        coordinates: [[[[11.38, 47.75], [11.39, 47.75], [11.39, 47.76], [11.38, 47.75]]]],
      },
    });
    const result = JSON.parse(exportToGeoJson([multi]));
    expect(result.features[0].geometry.type).toBe("MultiPolygon");
  });
});

describe("sanitizeFilename", () => {
  it("lowercases and replaces spaces", () => {
    expect(sanitizeFilename("Park Strasse")).toBe("park-strasse");
  });

  it("removes special chars", () => {
    expect(sanitizeFilename("Straße/Weg (Alt)")).toBe("strasse-weg-alt");
  });

  it("collapses multiple hyphens", () => {
    expect(sanitizeFilename("a - - b")).toBe("a-b");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npx vitest run hub-app/src/lib/__tests__/territory-export.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement exportToGeoJson and sanitizeFilename**

Create `hub-app/src/lib/territory-export.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npx vitest run hub-app/src/lib/__tests__/territory-export.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add hub-app/src/lib/territory-export.ts hub-app/src/lib/__tests__/territory-export.test.ts
git commit -m "feat: add GeoJSON export serialization with tests"
```

---

### Task 3: Client-Side Export — KML

**Files:**
- Modify: `hub-app/src/lib/territory-export.ts`
- Modify: `hub-app/src/lib/__tests__/territory-export.test.ts`

- [ ] **Step 1: Write failing test for KML export**

Add to `territory-export.test.ts`:

```typescript
import { exportToKml } from "../territory-export";

describe("exportToKml", () => {
  it("exports valid KML 2.2 with Placemark", () => {
    const kml = exportToKml([makeTerr()]);
    expect(kml).toContain('xmlns="http://www.opengis.net/kml/2.2"');
    expect(kml).toContain("<Placemark>");
    expect(kml).toContain("<name>101 — Parkstrasse</name>");
    expect(kml).toContain("<coordinates>");
    // KML format: lng,lat,0
    expect(kml).toContain("11.38,47.75,0");
  });

  it("merges multiple territories into one Document", () => {
    const kml = exportToKml([
      makeTerr(),
      makeTerr({ id: "uuid-2", number: "102", name: "Bahnhof" }),
    ]);
    const placemarkCount = (kml.match(/<Placemark>/g) ?? []).length;
    expect(placemarkCount).toBe(2);
  });

  it("skips territories without boundaries", () => {
    const kml = exportToKml([makeTerr({ boundaries: null })]);
    expect(kml).not.toContain("<Placemark>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npx vitest run hub-app/src/lib/__tests__/territory-export.test.ts`
Expected: FAIL — `exportToKml` not a function.

- [ ] **Step 3: Implement exportToKml**

Add to `hub-app/src/lib/territory-export.ts`:

```typescript
// ─── KML ────────────────────────────────────────────────────────────

function polygonToKmlCoords(geom: GeoJsonGeometry): string {
  if (geom.type === "Polygon") {
    const rings = geom.coordinates as number[][][];
    return rings
      .map((ring) => ring.map((c) => `${c[0]},${c[1]},0`).join(" "))
      .map((coords) => `<LinearRing><coordinates>${coords}</coordinates></LinearRing>`)
      .join("");
  }
  if (geom.type === "MultiPolygon") {
    const polys = geom.coordinates as number[][][][];
    return polys
      .map((poly) =>
        poly.map((ring) => ring.map((c) => `${c[0]},${c[1]},0`).join(" "))
          .map((coords) => `<LinearRing><coordinates>${coords}</coordinates></LinearRing>`)
          .join(""),
      )
      .join("");
  }
  return "";
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function exportToKml(territories: TerritoryListItem[]): string {
  const placemarks = territories
    .map((t) => {
      const geom = extractBoundary(t);
      if (!geom) return "";
      const name = escapeXml(`${t.number} — ${t.name}`);
      const coordsXml = polygonToKmlCoords(geom);
      const boundaryXml = geom.type === "MultiPolygon"
        ? `<MultiGeometry>${(geom.coordinates as number[][][][]).map((poly) =>
            `<Polygon><outerBoundaryIs>${poly.map((ring) =>
              `<LinearRing><coordinates>${ring.map((c) => `${c[0]},${c[1]},0`).join(" ")}</coordinates></LinearRing>`
            ).join("")}</outerBoundaryIs></Polygon>`
          ).join("")}</MultiGeometry>`
        : `<Polygon><outerBoundaryIs>${coordsXml}</outerBoundaryIs></Polygon>`;
      return `    <Placemark>\n      <name>${name}</name>\n      ${boundaryXml}\n    </Placemark>`;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npx vitest run hub-app/src/lib/__tests__/territory-export.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add hub-app/src/lib/territory-export.ts hub-app/src/lib/__tests__/territory-export.test.ts
git commit -m "feat: add KML export serialization with tests"
```

---

### Task 4: Client-Side Export — GPX

**Files:**
- Modify: `hub-app/src/lib/territory-export.ts`
- Modify: `hub-app/src/lib/__tests__/territory-export.test.ts`

- [ ] **Step 1: Write failing test for GPX export**

Add to `territory-export.test.ts`:

```typescript
import { exportToGpx } from "../territory-export";

describe("exportToGpx", () => {
  it("exports valid GPX 1.1 with trk/trkseg", () => {
    const gpx = exportToGpx([makeTerr()]);
    expect(gpx).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
    expect(gpx).toContain("<trk>");
    expect(gpx).toContain("<trkseg>");
    expect(gpx).toContain("<name>101</name>");
    expect(gpx).toContain('lat="47.75"');
    expect(gpx).toContain('lon="11.38"');
  });

  it("closes the ring by duplicating first point", () => {
    const openRing = makeTerr({
      boundaries: {
        type: "Polygon",
        coordinates: [[[11.38, 47.75], [11.39, 47.75], [11.39, 47.76]]],
      },
    });
    const gpx = exportToGpx([openRing]);
    // First and last trkpt should match
    const pts = gpx.match(/<trkpt[^>]*>/g) ?? [];
    expect(pts.length).toBeGreaterThanOrEqual(4); // 3 + closing duplicate
    expect(pts[0]).toBe(pts[pts.length - 1]);
  });

  it("skips territories without boundaries", () => {
    const gpx = exportToGpx([makeTerr({ boundaries: null })]);
    expect(gpx).not.toContain("<trk>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npx vitest run hub-app/src/lib/__tests__/territory-export.test.ts`
Expected: FAIL — `exportToGpx` not a function.

- [ ] **Step 3: Implement exportToGpx**

Add to `hub-app/src/lib/territory-export.ts`:

```typescript
// ─── GPX ────────────────────────────────────────────────────────────

export function exportToGpx(territories: TerritoryListItem[]): string {
  const tracks = territories
    .map((t) => {
      const geom = extractBoundary(t);
      if (!geom) return "";

      // Extract outer ring(s)
      let rings: number[][][] = [];
      if (geom.type === "Polygon") {
        rings = [((geom.coordinates as number[][][])[0] ?? [])];
      } else if (geom.type === "MultiPolygon") {
        rings = (geom.coordinates as number[][][][]).map((p) => p[0] ?? []);
      }

      const segments = rings.map((ring) => {
        // Ensure ring is closed
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npx vitest run hub-app/src/lib/__tests__/territory-export.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add hub-app/src/lib/territory-export.ts hub-app/src/lib/__tests__/territory-export.test.ts
git commit -m "feat: add GPX export serialization with tests"
```

---

## Chunk 2: Export UI Components

### Task 5: Add i18n Messages

**Files:**
- Modify: `hub-app/src/i18n/messages/en-US.json`
- Modify: `hub-app/src/i18n/messages/de-DE.json`

- [ ] **Step 1: Add English messages**

Add to `en-US.json` (in alphabetical territory section):

```json
  "territory.export": "Export",
  "territory.export.kml": "Export KML",
  "territory.export.geojson": "Export GeoJSON",
  "territory.export.gpx": "Export GPX",
  "territory.export.pdf": "Export PDF Maps",
  "territory.export.pdf.loading": "Generating PDFs...",
  "territory.export.selected": "{count} territories selected",
  "territory.export.all": "Export All",
  "territory.export.noData": "No exportable territories found",
  "territory.export.offline": "PDF export requires internet connection",
```

- [ ] **Step 2: Add German messages**

Add to `de-DE.json`:

```json
  "territory.export": "Exportieren",
  "territory.export.kml": "KML exportieren",
  "territory.export.geojson": "GeoJSON exportieren",
  "territory.export.gpx": "GPX exportieren",
  "territory.export.pdf": "PDF-Karten exportieren",
  "territory.export.pdf.loading": "PDFs werden erstellt...",
  "territory.export.selected": "{count} Gebiete ausgewählt",
  "territory.export.all": "Alle exportieren",
  "territory.export.noData": "Keine exportierbaren Gebiete gefunden",
  "territory.export.offline": "PDF-Export benötigt Internetverbindung",
```

- [ ] **Step 3: Build hub-app to verify**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add hub-app/src/i18n/messages/en-US.json hub-app/src/i18n/messages/de-DE.json
git commit -m "feat: add i18n messages for territory export (EN + DE)"
```

---

### Task 6: ExportDropdown Component

**Files:**
- Create: `hub-app/src/pages/territories/ExportDropdown.tsx`

- [ ] **Step 1: Create ExportDropdown component**

```typescript
/**
 * Reusable export dropdown for territories.
 * Used on TerritoryDetail (single) and TerritoryList (bulk) pages.
 */
import { useState, useRef, useEffect } from "react";
import { FormattedMessage } from "react-intl";
import { Download, Loader2, FileText, Map as MapIcon } from "lucide-react";
import { usePermissions } from "@/auth/PermissionProvider";
import type { TerritoryListItem } from "@/lib/territory-api";
import {
  exportToKml, exportToGeoJson, exportToGpx,
  downloadFile, territoryFilename, bulkFilename,
} from "@/lib/territory-export";

interface ExportDropdownProps {
  territories: TerritoryListItem[];
  /** True = single territory mode (use territory filename) */
  single?: boolean;
  /** Called when PDF export is requested */
  onExportPdf?: () => void;
  /** True while PDF is being generated */
  pdfLoading?: boolean;
  /** Disabled state (e.g., offline for PDF) */
  disabled?: boolean;
}

export function ExportDropdown({
  territories,
  single,
  onExportPdf,
  pdfLoading,
  disabled,
}: ExportDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { can } = usePermissions();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!can("app:territories.export")) return null;

  const handleExport = (format: "kml" | "geojson" | "gpx") => {
    const withBoundaries = territories.filter((t) => t.boundaries);
    if (withBoundaries.length === 0) return;

    const t0 = withBoundaries[0]!;
    let content: string;
    let filename: string;
    let mime: string;

    switch (format) {
      case "kml":
        content = exportToKml(withBoundaries);
        filename = single ? territoryFilename(t0, "kml") : bulkFilename("kml");
        mime = "application/vnd.google-earth.kml+xml";
        break;
      case "geojson":
        content = exportToGeoJson(withBoundaries);
        filename = single ? territoryFilename(t0, "geojson") : bulkFilename("geojson");
        mime = "application/geo+json";
        break;
      case "gpx":
        content = exportToGpx(withBoundaries);
        filename = single ? territoryFilename(t0, "gpx") : bulkFilename("gpx");
        mime = "application/gpx+xml";
        break;
    }

    downloadFile(content, filename, mime);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[var(--radius-sm)] transition-colors shadow-lg bg-[var(--bg-1)] border border-[var(--border)] text-[var(--text)] hover:bg-[var(--glass)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Download size={13} />
        <FormattedMessage id="territory.export" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius-sm)] shadow-xl z-50 overflow-hidden">
          <button
            onClick={() => handleExport("kml")}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            <FileText size={13} />
            <FormattedMessage id="territory.export.kml" />
          </button>
          <button
            onClick={() => handleExport("geojson")}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            <FileText size={13} />
            <FormattedMessage id="territory.export.geojson" />
          </button>
          <button
            onClick={() => handleExport("gpx")}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            <FileText size={13} />
            <FormattedMessage id="territory.export.gpx" />
          </button>
          <div className="border-t border-[var(--border)]" />
          <button
            onClick={() => { onExportPdf?.(); setOpen(false); }}
            disabled={pdfLoading}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer disabled:opacity-50"
          >
            {pdfLoading ? <Loader2 size={13} className="animate-spin" /> : <MapIcon size={13} />}
            <FormattedMessage id={pdfLoading ? "territory.export.pdf.loading" : "territory.export.pdf"} />
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build hub-app to verify**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/pages/territories/ExportDropdown.tsx
git commit -m "feat: add ExportDropdown component for territory export UI"
```

---

### Task 7: Integrate Export on TerritoryDetail Page

**Files:**
- Modify: `hub-app/src/pages/territories/TerritoryDetail.tsx`

- [ ] **Step 1: Add import and ExportDropdown**

Add import at top of file:

```typescript
import { ExportDropdown } from "./ExportDropdown";
```

- [ ] **Step 2: Add ExportDropdown to toolbar**

Find the toolbar section (around line 993-1020) where Edit and Clip buttons are rendered in `!editMode` block. After the Clip button, add:

```typescript
                    {territory.boundaries && (
                      <ExportDropdown
                        territories={[territory]}
                        single
                        onExportPdf={() => {
                          // PDF export will be implemented in Task 11
                        }}
                      />
                    )}
```

- [ ] **Step 3: Build hub-app to verify**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add hub-app/src/pages/territories/TerritoryDetail.tsx
git commit -m "feat: add Export dropdown to territory detail page"
```

---

### Task 8: TerritoryList — Checkbox Selection + Export Toolbar

**Files:**
- Modify: `hub-app/src/pages/territories/TerritoryList.tsx`

- [ ] **Step 1: Add imports and state**

Add at top of `TerritoryList.tsx`:

```typescript
import { Download } from "lucide-react";
import { usePermissions } from "@/auth/PermissionProvider";
import { ExportDropdown } from "./ExportDropdown";
```

Inside the component, add state after existing state:

```typescript
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { can } = usePermissions();
  const canExport = can("app:territories.export");
```

- [ ] **Step 2: Add checkbox toggle helpers**

```typescript
  // Territories that can be exported (have boundaries, not congregation_boundary)
  const exportable = filtered.filter(
    (t) => t.boundaries && t.type !== "congregation_boundary",
  );

  const allSelected = exportable.length > 0 && exportable.every((t) => selectedIds.has(t.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(exportable.map((t) => t.id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedTerritories = territories.filter((t) => selectedIds.has(t.id));
```

- [ ] **Step 3: Add checkbox column to table header**

Before the `#` column `<th>`, add:

```typescript
                {canExport && (
                  <th className="px-2 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="accent-[var(--amber)] cursor-pointer"
                    />
                  </th>
                )}
```

- [ ] **Step 4: Add checkbox column to table rows**

Inside the `<tr>` for each territory, before the number `<td>`, add:

```typescript
                    {canExport && (
                      <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                        {t.boundaries && t.type !== "congregation_boundary" ? (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(t.id)}
                            onChange={() => toggleOne(t.id)}
                            className="accent-[var(--amber)] cursor-pointer"
                          />
                        ) : (
                          <input type="checkbox" disabled className="opacity-30" />
                        )}
                      </td>
                    )}
```

- [ ] **Step 5: Add export toolbar above table**

After the search input div and before the loading/empty/table block, add:

```typescript
      {/* Export toolbar */}
      {canExport && (
        <div className="flex items-center gap-3 px-4 py-2 bg-[var(--amber)]/10 border border-[var(--amber)]/30 rounded-[var(--radius-sm)]">
          {selectedIds.size > 0 ? (
            <>
              <span className="text-xs font-medium text-[var(--amber)]">
                <FormattedMessage
                  id="territory.export.selected"
                  values={{ count: selectedIds.size }}
                />
              </span>
              <ExportDropdown
                territories={selectedTerritories}
                onExportPdf={() => {
                  // PDF export will be wired in Task 12
                }}
              />
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer ml-auto"
              >
                <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                setSelectedIds(new Set(exportable.map((t) => t.id)));
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[var(--radius-sm)] bg-[var(--bg-1)] border border-[var(--border)] text-[var(--text)] hover:bg-[var(--glass)] cursor-pointer"
            >
              <Download size={13} />
              <FormattedMessage id="territory.export.all" />
            </button>
          )}
        </div>
      )}
```

- [ ] **Step 6: Change TerritoryList to fetch full data (not lite) when export is available**

The list currently uses `{ lite: true }` which doesn't include boundaries. Change the `useEffect` to fetch full data when the user has export permission:

```typescript
    listTerritories(token, { lite: !canExport })
```

This way boundaries are loaded for export but lite mode is preserved for users without export permission.

- [ ] **Step 7: Build hub-app to verify**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`
Expected: Clean build.

- [ ] **Step 8: Commit**

```bash
git add hub-app/src/pages/territories/TerritoryList.tsx
git commit -m "feat: add checkbox selection and export toolbar to territory list"
```

---

## Chunk 3: Server-Side PDF Export

### Task 9: Install Backend Dependencies

**Files:**
- Modify: `hub-api/package.json`

- [ ] **Step 1: Install dependencies**

```bash
cd /Users/buecheleb/github/itunified-io/hubport.cloud
npm install --workspace=hub-api puppeteer-core pdfkit archiver
npm install --workspace=hub-api -D @types/pdfkit @types/archiver
```

- [ ] **Step 2: Commit**

```bash
git add hub-api/package.json package-lock.json
git commit -m "deps: add puppeteer-core, pdfkit, archiver for PDF export"
```

---

### Task 10: PDF Renderer Module

**Files:**
- Create: `hub-api/src/lib/pdf-renderer.ts`

- [ ] **Step 1: Implement pdf-renderer**

```typescript
/**
 * PDF renderer — uses Puppeteer to screenshot MapLibre maps,
 * then composes PDF documents with pdfkit.
 * The HTML template is inlined to avoid build/copy issues with tsc.
 */
import puppeteer, { type Browser } from "puppeteer-core";
import PDFDocument from "pdfkit";

/** Minimal MapLibre HTML page — inlined to avoid file resolution issues at runtime. */
function buildMapHtml(config: {
  style: string;
  apiKey: string;
  bounds: [[number, number], [number, number]];
  geometry: { type: string; coordinates: unknown };
}): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>*{margin:0;padding:0;box-sizing:border-box}body{width:1280px;height:900px;overflow:hidden}#map{width:100%;height:100%}</style>
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet"/>
</head><body><div id="map"></div><script>
const cfg=${JSON.stringify(config)};
const styleUrl=cfg.style==="satellite"
  ?"https://api.maptiler.com/maps/satellite/style.json?key="+cfg.apiKey
  :"https://api.maptiler.com/maps/streets-v2/style.json?key="+cfg.apiKey;
const map=new maplibregl.Map({container:"map",style:styleUrl,bounds:cfg.bounds,
  fitBoundsOptions:{padding:40},interactive:false,attributionControl:false});
map.on("load",()=>{
  map.addSource("territory",{type:"geojson",data:{type:"Feature",geometry:cfg.geometry,properties:{}}});
  map.addLayer({id:"territory-fill",type:"fill",source:"territory",paint:{"fill-color":"rgba(212,160,23,0.15)"}});
  map.addLayer({id:"territory-outline",type:"line",source:"territory",paint:{"line-color":"#d4a017","line-width":3}});
});
map.once("idle",()=>{window.__MAP_READY__=true});
</script></body></html>`;
}

interface RenderRequest {
  number: string;
  name: string;
  geometry: { type: string; coordinates: unknown };
  bounds: [[number, number], [number, number]]; // [[west, south], [east, north]]
  style: "satellite" | "street";
  apiKey: string;
}

/** Calculate LngLat bounds from GeoJSON geometry with padding. */
export function calcBounds(
  geometry: { type: string; coordinates: unknown },
  padding = 0.15,
): [[number, number], [number, number]] {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;

  const flatten = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const pt = c as number[];
      if (pt[0]! < minLng) minLng = pt[0]!;
      if (pt[0]! > maxLng) maxLng = pt[0]!;
      if (pt[1]! < minLat) minLat = pt[1]!;
      if (pt[1]! > maxLat) maxLat = pt[1]!;
    } else if (Array.isArray(c)) {
      for (const item of c) flatten(item);
    }
  };
  flatten(geometry.coordinates);

  const lngPad = (maxLng - minLng) * padding;
  const latPad = (maxLat - minLat) * padding;

  return [
    [minLng - lngPad, minLat - latPad],
    [maxLng + lngPad, maxLat + latPad],
  ];
}

/** Render a single map screenshot via Puppeteer. Returns PNG buffer. */
async function renderMapScreenshot(
  browser: Browser,
  req: RenderRequest,
): Promise<Buffer> {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const html = buildMapHtml({
    style: req.style,
    apiKey: req.apiKey,
    bounds: req.bounds,
    geometry: req.geometry,
  });

  await page.setContent(html, { waitUntil: "networkidle0" });

  // Wait for map idle (tiles loaded), with 30s timeout
  await page.waitForFunction("window.__MAP_READY__ === true", { timeout: 30_000 }).catch(async () => {
    // Retry once after 5s
    await new Promise((r) => setTimeout(r, 5000));
    await page.waitForFunction("window.__MAP_READY__ === true", { timeout: 25_000 });
  });

  const screenshot = await page.screenshot({ type: "png" }) as Buffer;
  await page.close();
  return screenshot;
}

/** Compose a PDF with header + map image. Returns PDF as Buffer. */
export async function composePdf(
  mapImage: Buffer,
  number: string,
  name: string,
  style: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ layout: "landscape", size: "A4", margin: 0 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = 842;
    const headerH = 40;

    // Header background
    doc.rect(0, 0, W, headerH).fill("#1a1a2e");

    // Amber accent line
    doc.rect(0, headerH - 2, W, 2).fill("#d4a017");

    // Header text
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#ffffff");
    doc.text(`T-${number} — ${name}`, 16, 12, { width: W / 2 });

    doc.font("Helvetica").fontSize(9).fillColor("#9ca3af");
    const dateStr = new Date().toISOString().slice(0, 10);
    doc.text(`${style} · ${dateStr}`, W - 200, 15, { width: 184, align: "right" });

    // Map image
    doc.image(mapImage, 0, headerH, { width: W, height: 595 - headerH });

    doc.end();
  });
}

/** Render PDFs for multiple territories. Returns array of { filename, buffer }. */
export async function renderTerritoryPdfs(
  territories: Array<{
    number: string;
    name: string;
    boundaries: unknown;
  }>,
  styles: ("satellite" | "street")[],
  apiKey: string,
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void },
): Promise<{ files: Array<{ filename: string; buffer: Buffer }>; errors: string[] }> {
  const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH ?? "/usr/bin/chromium-browser";
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    headless: true,
  });

  const files: Array<{ filename: string; buffer: Buffer }> = [];
  const errors: string[] = [];

  // Process territories with concurrency limit of 3
  const CONCURRENCY = 3;
  const tasks: Array<{ territory: typeof territories[0]; style: "satellite" | "street" }> = [];
  for (const t of territories) {
    for (const s of styles) {
      tasks.push({ territory: t, style: s });
    }
  }

  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const batch = tasks.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async ({ territory: t, style }) => {
        const geom = t.boundaries as { type: string; coordinates: unknown };
        const bounds = calcBounds(geom);
        const sanitized = t.name
          .toLowerCase()
          .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
          .replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
        const filename = `T-${t.number}-${sanitized}-${style}.pdf`;

        logger.info(`Rendering ${filename}...`);
        const screenshot = await renderMapScreenshot(browser, {
          number: t.number,
          name: t.name,
          geometry: geom,
          bounds,
          style,
          apiKey,
        });
        const pdf = await composePdf(screenshot, t.number, t.name, style);
        return { filename, buffer: pdf };
      }),
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j]!;
      const task = batch[j]!;
      if (result.status === "fulfilled") {
        files.push(result.value);
      } else {
        const msg = `Failed: T-${task.territory.number} (${task.style}): ${result.reason}`;
        logger.error(msg);
        errors.push(msg);
      }
    }
  }

  await browser.close();
  return { files, errors };
}
```

- [ ] **Step 2: Build hub-api to verify**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-api`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add hub-api/src/lib/pdf-renderer.ts
git commit -m "feat: add PDF renderer with Puppeteer + pdfkit"
```

---

### Task 11: PDF Export API Endpoint

**Files:**
- Create: `hub-api/src/routes/territory-export.ts`
- Modify: `hub-api/src/index.ts`

- [ ] **Step 1: Create the export route**

```typescript
/**
 * Territory export routes — PDF map generation via Puppeteer.
 */
import type { FastifyInstance } from "fastify";
import { Type, type Static } from "@sinclair/typebox";
import archiver from "archiver";
import prisma from "../lib/prisma.js";
import { requirePermission } from "../lib/rbac.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { renderTerritoryPdfs } from "../lib/pdf-renderer.js";

const ExportPdfBody = Type.Object({
  territoryIds: Type.Array(Type.String({ format: "uuid" }), { minItems: 1, maxItems: 100 }),
  styles: Type.Optional(
    Type.Array(Type.Union([Type.Literal("satellite"), Type.Literal("street")])),
  ),
});
type ExportPdfBodyType = Static<typeof ExportPdfBody>;

export async function territoryExportRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: ExportPdfBodyType }>(
    "/territories/export/pdf",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_EXPORT),
      schema: { body: ExportPdfBody },
    },
    async (request, reply) => {
      const { territoryIds, styles: reqStyles } = request.body;
      const styles = reqStyles?.length ? reqStyles : (["satellite", "street"] as const);

      // Load territories
      const territories = await prisma.territory.findMany({
        where: { id: { in: territoryIds } },
        select: { id: true, number: true, name: true, boundaries: true },
      });

      if (territories.length === 0) {
        return reply.code(404).send({ error: "No territories found" });
      }

      // Filter to those with boundaries
      const withBoundaries = territories.filter((t) => t.boundaries);
      if (withBoundaries.length === 0) {
        return reply.code(400).send({ error: "No selected territories have boundaries" });
      }

      const apiKey = process.env.MAPTILER_API_KEY;
      if (!apiKey) {
        return reply.code(500).send({ error: "MAPTILER_API_KEY not configured" });
      }

      const { files, errors } = await renderTerritoryPdfs(
        withBoundaries.map((t) => ({
          number: t.number,
          name: t.name,
          boundaries: t.boundaries,
        })),
        [...styles],
        apiKey,
        request.log,
      );

      if (files.length === 0) {
        return reply.code(500).send({ error: "All PDF renders failed", details: errors });
      }

      // Build ZIP
      const date = new Date().toISOString().slice(0, 10);
      const zipName = withBoundaries.length === 1
        ? `T-${withBoundaries[0]!.number}-maps.zip`
        : `territories-maps-${date}.zip`;

      reply.header("Content-Type", "application/zip");
      reply.header("Content-Disposition", `attachment; filename="${zipName}"`);

      const archive = archiver("zip", { zlib: { level: 6 } });
      archive.pipe(reply.raw);

      for (const f of files) {
        archive.append(f.buffer, { name: f.filename });
      }

      if (errors.length > 0) {
        archive.append(errors.join("\n"), { name: "_errors.txt" });
      }

      await archive.finalize();
      return reply;
    },
  );
}
```

- [ ] **Step 2: Register route in index.ts**

Add import at top of `hub-api/src/index.ts` (after line 40, with the other imports):

```typescript
import { territoryExportRoutes } from "./routes/territory-export.js";
```

Add registration (after the last `app.register` call, around line 114):

```typescript
  await app.register(territoryExportRoutes);
```

- [ ] **Step 3: Build hub-api to verify**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-api`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add hub-api/src/routes/territory-export.ts hub-api/src/index.ts
git commit -m "feat: add POST /territories/export/pdf endpoint"
```

---

### Task 12: Frontend PDF Export API Client + Wire Up

**Files:**
- Modify: `hub-app/src/lib/territory-api.ts`
- Modify: `hub-app/src/pages/territories/TerritoryDetail.tsx`
- Modify: `hub-app/src/pages/territories/TerritoryList.tsx`

- [ ] **Step 1: Add exportPdf to territory-api.ts**

Add at the end of `hub-app/src/lib/territory-api.ts`:

```typescript
// ─── PDF Export ─────────────────────────────────────────────────────

export async function exportPdf(
  territoryIds: string[],
  token: string,
  styles?: ("satellite" | "street")[],
): Promise<Blob> {
  const res = await fetch(`${getApiUrl()}/territories/export/pdf`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ territoryIds, styles }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "PDF export failed" }));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.blob();
}
```

- [ ] **Step 2: Wire up PDF export on TerritoryDetail**

In `TerritoryDetail.tsx`, add state and handler:

```typescript
import { exportPdf } from "@/lib/territory-api";

// Inside component, add state:
const [pdfLoading, setPdfLoading] = useState(false);

// Add handler:
const handleExportPdf = async () => {
  if (!territory?.id || !user?.access_token) return;
  setPdfLoading(true);
  try {
    const blob = await exportPdf([territory.id], user.access_token);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `T-${territory.number}-maps.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("PDF export failed:", err);
  } finally {
    setPdfLoading(false);
  }
};
```

Update the ExportDropdown usage:

```typescript
<ExportDropdown
  territories={[territory]}
  single
  onExportPdf={handleExportPdf}
  pdfLoading={pdfLoading}
/>
```

- [ ] **Step 3: Wire up PDF export on TerritoryList**

In `TerritoryList.tsx`, add similar state and handler using `selectedTerritories.map(t => t.id)`.

- [ ] **Step 4: Build hub-app to verify**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`
Expected: Clean build.

- [ ] **Step 5: Commit**

```bash
git add hub-app/src/lib/territory-api.ts hub-app/src/pages/territories/TerritoryDetail.tsx hub-app/src/pages/territories/TerritoryList.tsx
git commit -m "feat: wire up PDF export API client to detail and list pages"
```

---

## Chunk 4: Docker + Final Integration

### Task 13: Dockerfile — Add Chromium

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Add Chromium to runtime stage**

In the `Dockerfile`, right after `WORKDIR /app` (line 50) and **before** the `adduser` line, add (for optimal Docker layer caching):

```dockerfile
# Chromium for Puppeteer PDF export
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
```

- [ ] **Step 2: Commit**

```bash
git add Dockerfile
git commit -m "feat: add Chromium to Docker image for PDF export"
```

---

### Task 14: Version Bump + CHANGELOG + Final Build

**Files:**
- Modify: `package.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump version in package.json**

Update the root `package.json` version to the next CalVer (check current tag first with `git tag -l 'v2026.04.*'`).

- [ ] **Step 2: Update CHANGELOG.md**

Add new version entry at the top with all changes from this feature.

- [ ] **Step 3: Build both workspaces**

```bash
cd /Users/buecheleb/github/itunified-io/hubport.cloud
npm run build --workspace=hub-api
npm run build --workspace=hub-app
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run hub-app/src/lib/__tests__/territory-export.test.ts
```

- [ ] **Step 5: Commit, tag, release, Docker build, deploy**

Follow standard release workflow:
1. Commit version bump + CHANGELOG
2. Push to origin
3. Create annotated tag
4. Create GH release
5. Docker buildx build --push (multi-platform)
6. Docker image prune + buildx prune
7. Pull and deploy to tenant
8. Verify startup logs
