# Territory Polygon Export — Design Spec

**Date:** 2026-04-03
**Status:** Approved
**Scope:** hubport.cloud hub-app + hub-api

## Problem

Territories have polygon boundaries stored as GeoJSON, and KML import exists, but there is no way to export territory polygons. Users need exports for:

1. **Field service** — printable maps for door-to-door work
2. **Data exchange** — share polygons with other tools (Google Earth, GPS devices)
3. **Backup / archive** — bulk export all territory boundaries for safekeeping

## Solution

Four export formats with three scope levels, using a hybrid client/server architecture.

### Export Formats

| Format | Generation | Use Case |
|--------|-----------|----------|
| KML 2.2 | Client-side | Google Earth, JW territory tools |
| GeoJSON (RFC 7946) | Client-side | Developer/data exchange |
| GPX 1.1 | Client-side | GPS devices |
| PDF (A4 landscape) | Server-side (Puppeteer) | Printable field maps |

### Export Scopes

| Scope | Trigger |
|-------|---------|
| Single territory | Export dropdown on TerritoryDetail page |
| Bulk selection | Checkboxes on TerritoryList + export toolbar |
| Export All | "Export All" button on TerritoryList toolbar |

## Architecture

### Client-Side (KML, GeoJSON, GPX)

**New module:** `hub-app/src/lib/territory-export.ts`

Pure functions that serialize existing GeoJSON boundaries into target formats. No API calls needed — boundaries are already loaded in the frontend. Territories without boundaries (`boundaries === null`) are silently skipped.

```typescript
// Uses TerritoryListItem (existing type from territory-api.ts)
exportToKml(territories: TerritoryListItem[]): string
exportToGeoJson(territories: TerritoryListItem[]): string
exportToGpx(territories: TerritoryListItem[]): string
downloadFile(content: string, filename: string, mimeType: string): void
// downloadZip not needed client-side — PDF export always goes through the server endpoint
// which returns the ZIP directly. Client-side exports are single text files (no ZIP needed).
```

**Error handling:** Malformed GeoJSON boundaries (missing coordinates, wrong type) are skipped with a console warning. If all territories are skipped, show a toast error instead of downloading an empty file.

#### KML Format

- KML 2.2 with `<Document>` containing one `<Placemark>` per territory
- `<name>` = territory number + name
- `<description>` = territory metadata
- Polygon coordinates in KML's `lng,lat,0` format
- Single territory -> one Placemark; bulk/all -> multiple Placemarks in one Document

#### GeoJSON Format

- RFC 7946 compliant FeatureCollection
- Each territory = one Feature
- `properties: { number, name, type }`
- Coordinates preserved as-is from stored boundaries (already WGS84)

#### GPX Format

- GPX 1.1 with territories as `<trk>` (track) elements with `<trkseg>` segments
- `<trkpt>` for each vertex, first/last point duplicated to close the shape
- `<name>` = territory number
- Note: GPX has no native polygon type; `<trk>` is the conventional representation for closed areas in GPS software

#### Client-Side Bulk Performance

For large congregations (hundreds of territories), serialization may take noticeable time. Show a brief loading spinner on the export button while generating. Memory-safe: use string concatenation rather than building a full DOM.

### Server-Side (PDF)

**New API endpoint:** `POST /territories/export/pdf`

```
Request:
{
  territoryIds: string[],   // UUIDs, max 100
  styles?: ("satellite" | "street")[]  // default: ["satellite", "street"]
}

Response:
  Content-Type: application/zip
  Content-Disposition: attachment; filename="<name>.zip"
```

**Fastify schema validation (TypeBox):**
- `territoryIds`: array of UUID strings, `minItems: 1`, `maxItems: 100`
- `styles`: optional array, defaults to both styles
- Returns 404 for non-existent IDs (does not leak other tenant data — single-tenant DB)
- Returns 400 if no selected territories have boundaries

**New modules:**
- `hub-api/src/lib/pdf-renderer.ts` — Puppeteer map rendering + PDF composition

**New dependencies:**
- `puppeteer-core` — headless Chromium (uses system-installed Chromium, not bundled)
- `pdfkit` — PDF document composition
- `archiver` — ZIP bundling

#### Docker / Chromium Strategy

The tenant stack uses `node:20-alpine`. Adding Chromium to Alpine:

```dockerfile
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
```

- Uses `puppeteer-core` (not `puppeteer`) to avoid bundling Chromium twice
- Image size increase: ~200MB (acceptable — tenant images are pulled infrequently)
- Multi-arch: Alpine's `chromium` package is available for both amd64 and arm64
- Runs with `--no-sandbox` flag (container is already sandboxed)

#### Map Tile Source

The MapLibre template uses the same tile sources as the hub-app frontend:
- **Street:** MapTiler Streets (vector tiles)
- **Satellite:** MapTiler Satellite (raster tiles)

Tile API key provisioning:
- `MAPTILER_API_KEY` environment variable, sourced from Vault at container startup
- Same key already used by hub-app (served via `/api/config` runtime config endpoint)
- Rate limits: MapTiler free tier allows 100k tile requests/month; bulk PDF export of 100 territories ~ 2000-4000 tile requests (well within limits)

If tile loading fails (network error, rate limit), Puppeteer retries once after 5s. If still failing, generates PDF with white background + polygon only and logs a warning.

#### PDF Rendering Pipeline

For each territory + each selected style:

1. Calculate bbox from polygon coordinates with 15% padding
2. Open headless Puppeteer page (1280x900 viewport — A4 landscape aspect ratio)
3. Load minimal HTML template with MapLibre GL JS (inline, not full hub-app)
4. Set map bounds to territory bbox, inject MapTiler API key
5. Add polygon layer: 3px amber (`#d4a017`) outline, `rgba(212,160,23,0.15)` fill
6. Wait for `map.once('idle')` (tiles loaded)
7. Screenshot as PNG buffer
8. Close page (reuse browser instance)

#### PDF Composition (pdfkit)

- A4 landscape (842x595 points)
- Header: 40pt tall, dark background (`#1a1a2e`), territory number + name left-aligned, export date right-aligned, amber accent line below
- Map image: fills remaining area below header, scaled to fit maintaining aspect ratio

#### Performance

- Reuse single Puppeteer browser instance across all territories in a batch
- Concurrent page rendering: max 3 pages in parallel
- Close browser instance after batch completes
- Timeout: 30s per map render, 30min total for batch endpoint
- At 3 concurrency with 30s per render: `ceil(200/3) * 30 = ~2000s` for max batch (100 territories x 2 styles)
- For faster results, users can select a single style via the `styles` parameter

#### Error Handling

- If Puppeteer fails for one territory, skip it and include `_errors.txt` in ZIP listing failures
- Return partial ZIP rather than failing entire batch
- Log failures server-side for debugging

## UI Integration

### TerritoryDetail Page (Single Export)

**New "Export" dropdown button** alongside Edit and Clip buttons:

- Dropdown options (i18n message IDs: `territory.export.kml`, `.geojson`, `.gpx`, `.pdf`):
  - Export KML
  - Export GeoJSON
  - Export GPX
  - Export PDF Maps
- KML/GeoJSON/GPX -> instant client-side download
- PDF Maps -> loading spinner, API call, ZIP download
- Only visible when territory has boundaries

### TerritoryList Page (Bulk + All Export)

**Checkbox column** in territory table:

- Header checkbox: select all / deselect all (excludes `congregation_boundary` type)
- Per-row checkbox for individual selection
- Only territories with boundaries are selectable (others greyed out)
- Congregation boundary row has a checkbox but is NOT included in "select all"

**Export toolbar** (appears when >= 1 selected):

- Count display: "3 territories selected"
- Four buttons: KML / GeoJSON / GPX / PDF Maps
- "Export All" button: selects all territories with boundaries (excluding congregation boundary), triggers chosen format
- PDF export shows progress indicator

### Styling

- Hubport dark/gold theme, amber accent for selections
- Loading states use existing `Loader2` spinner (lucide)
- Export dropdown consistent with existing toolbar patterns
- All labels use react-intl `FormattedMessage` with `territory.export.*` message IDs

### Offline / PWA Behavior

- Client-side exports (KML, GeoJSON, GPX) work offline when territory data is in Dexie.js cache
- PDF export button is disabled when offline (shows tooltip: "PDF export requires internet connection")

## File Naming

### Single Territory

| Format | Filename |
|--------|----------|
| KML | `T-101-parkstrasse.kml` |
| GeoJSON | `T-101-parkstrasse.geojson` |
| GPX | `T-101-parkstrasse.gpx` |
| PDF | `T-101-parkstrasse-maps.zip` containing `-satellite.pdf` + `-street.pdf` |

### Bulk / Export All

| Format | Filename |
|--------|----------|
| KML | `territories-export-2026-04-03.kml` (merged) |
| GeoJSON | `territories-export-2026-04-03.geojson` (merged) |
| GPX | `territories-export-2026-04-03.gpx` (merged) |
| PDF | `territories-maps-2026-04-03.zip` (individual PDFs per territory) |

- Territory names sanitized for filenames: lowercase, spaces/special chars -> hyphens
- Date stamp in ISO format
- Congregation boundary excluded from "Export All" unless explicitly selected

## RBAC

New permission: `TERRITORIES_EXPORT` (value: `app:territories.export`)

- Follows existing naming convention: `TERRITORIES_<ACTION>` with `app:territories.<action>` value
- Required for all export operations
- Added to both `BASE_ROLE_PERMISSIONS` and `CONGREGATION_ROLE_PERMISSIONS` entries that include `TERRITORIES_VIEW`:
  - Base roles: `publisher`, `elder`, `ministerial_servant`
  - Congregation roles: `elder`, `ministerial_servant`, `territory_servant`
- Export buttons hidden from users without this permission

## Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `hub-app/src/lib/territory-export.ts` | Client-side KML/GeoJSON/GPX serialization + download helper |
| `hub-api/src/lib/pdf-renderer.ts` | Puppeteer map rendering + pdfkit PDF composition |
| `hub-api/src/routes/territory-export.ts` | `POST /territories/export/pdf` endpoint |
| `hub-api/src/lib/map-template.html` | Minimal MapLibre HTML page for Puppeteer rendering |

### Modified Files

| File | Change |
|------|--------|
| `hub-app/src/pages/territories/TerritoryDetail.tsx` | Add Export dropdown button |
| `hub-app/src/pages/territories/TerritoryList.tsx` | Add checkbox column + export toolbar |
| `hub-app/src/lib/territory-api.ts` | Add `exportPdf()` API client function |
| `hub-api/src/lib/permissions.ts` | Add `TERRITORIES_EXPORT` permission |
| `hub-api/src/index.ts` | Register export routes |
| `Dockerfile` | Add Chromium + env vars for Puppeteer |
| `hub-api/package.json` | Add puppeteer-core, pdfkit, archiver |
| `hub-app/src/i18n/en.json` (+ de.json) | Add `territory.export.*` i18n messages |

## Dependencies

### hub-api (new)

- `puppeteer-core` — headless Chromium (system-installed, not bundled)
- `pdfkit` — PDF generation
- `archiver` — ZIP creation

### hub-app (new)

- None — uses built-in browser APIs (Blob, URL.createObjectURL, anchor click)

## Testing

- Unit tests for KML/GeoJSON/GPX serialization (pure functions, easy to test)
- Round-trip test: export KML -> re-import via existing `/territories/import/kml` -> verify coordinates match
- Integration test for PDF endpoint (mock Puppeteer or use test territory)
- PDF visual inspection: verify map renders correctly with polygon overlay
- Edge cases: territory with null boundaries, MultiPolygon type, malformed GeoJSON
- RBAC test: users without `TERRITORIES_EXPORT` cannot access endpoint or see buttons
