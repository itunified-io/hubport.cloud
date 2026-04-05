# H3 Hex Grid for Overpass Tiling & Spatial Infrastructure

## Problem

Gap detection queries the Overpass API for all buildings within the congregation bounding box. This bbox is ~20km × 20km, which frequently causes Overpass 504 timeouts. The current fix splits the bbox into rectangular tiles (0.025°), but these tiles:

- Include large areas outside the congregation boundary (wasted queries)
- Have inconsistent area at different latitudes
- Are single-purpose — no reuse for heatmaps or other spatial features

## Solution

Replace rectangular tiles with H3 hexagonal tiling using the `h3-js` library (v4). H3 hexagons conform to the congregation boundary shape, have uniform area, and serve as a reusable spatial grid for multiple features.

## Architecture

### Multi-Resolution Strategy

| Resolution | Hex Area | Count (this congregation) | Use Case |
|-----------|----------|--------------------------|----------|
| 8 | ~0.74 km² | ~50-60 | Overpass fetching |
| 10 | ~0.015 km² | ~3000-4000 | Heatmap display |

Resolution 8 hexes are used for Overpass queries. For heatmaps, res-8 hexes are subdivided to res-10 children using `cellToChildren()`.

### Components

#### 1. Hex Grid Engine — `hub-api/src/lib/hex-grid.ts` (new)

Pure computation module, no database dependency.

**Functions:**

- `polygonToHexes(geojson, resolution)` — converts a GeoJSON polygon to H3 index strings covering the polygon. Converts GeoJSON `[lng, lat]` coordinates to h3-js `[lat, lng]` format, then calls `polygonToCells()` with `containmentMode: "intersecting"` to ensure complete boundary coverage (no buildings missed at edges).
- `hexToBBox(h3Index)` — returns `{ south, west, north, east }` from hex boundary vertices via `cellToBoundary()`. Feeds Overpass tile queries.
- `hexToGeoJSON(h3Index)` — returns a GeoJSON Polygon for map rendering. Converts h3-js `[lat, lng]` back to GeoJSON `[lng, lat]`.
- `subdivideHexes(h3Indexes, targetRes)` — converts hex indexes to children at a finer resolution using `cellToChildren()`. Used by heatmaps.

**Coordinate order note:** h3-js v4 uses `[lat, lng]` throughout. GeoJSON uses `[lng, lat]`. All public functions in this module accept GeoJSON format and handle conversion internally.

#### 2. Overpass Integration — `hub-api/src/lib/osm-overpass.ts` (modified)

New function `queryBuildingsInPolygon` added to the same file as `queryBuildingsTile` (no export changes needed — `queryBuildingsTile` remains file-private):

- `queryBuildingsInPolygon(geojson, resolution?)` — takes a GeoJSON polygon (congregation boundary), computes H3 hex coverage at resolution 8 via `polygonToHexes()`, fetches buildings per hex via `queryBuildingsTile()`, deduplicates by `osmId`.
- 1s delay between hex queries to avoid Overpass rate-limiting.
- Progress logging: `[overpass] Hex 12/56: +234 buildings (total: 1891)`
- `queryBuildingsInBBox` remains unchanged for other callers (snap context, roads, water).

**Gap detection route change:** `gap-detection.ts` calls `queryBuildingsInPolygon(congBoundary.boundaries)` instead of `queryBuildingsInBBox(bbox)`. The `bboxFromGeoJSON` call and `bbox` variable are removed. The PostGIS `checkCongregationContainsPostGIS` filter is still needed — H3 `intersecting` mode includes hexes that overlap the boundary edge, so some fetched buildings will fall outside the congregation polygon.

#### 3. Hex Grid Cache — Prisma model `HexGridCache` (new)

```prisma
model HexGridCache {
  id            String   @id @default(uuid())
  boundaryHash  String
  resolution    Int
  hexIndexes    String[]
  buildingCount Int?
  createdAt     DateTime @default(now())

  @@unique([boundaryHash, resolution])
}
```

- `boundaryHash`: SHA-256 of the congregation boundary GeoJSON. Changes automatically when the boundary is edited or reimported.
- `@@unique([boundaryHash, resolution])`: allows caching different resolutions (8, 10) for the same boundary.
- Only hex index lists are cached, not building data. Buildings are always fetched fresh from Overpass (OSM data changes over time).
- Cache function: `getOrComputeHexes(prisma, congregationGeoJSON, resolution)` — hash boundary, check cache, return cached or compute + store.
- Stale entries (old boundary hashes) are ignored. Cleanup: delete entries where `createdAt` is older than 30 days via a periodic check in `getOrComputeHexes`.

#### 4. Heatmap Upgrade (Phase 2, future PR)

- Replace `simpleGeohash()` clustering in `hub-api/src/routes/heatmap.ts` with H3 bucketing at resolution 10.
- Frontend renders H3 hexagons as filled MapLibre polygons instead of circle-based heatmap.
- Uses `subdivideHexes(res8hexes, 10)` or direct `polygonToHexes(boundary, 10)`.
- `h3-js` added to `hub-app` dependencies for frontend hex rendering (lazy-loaded via dynamic import to avoid ~2MB bundle impact on PWA).

## Edge Cases

- **Overpass failure:** If any hex query fails after retries on all endpoints, the entire gap detection run is marked `failed`. No partial results.
- **No congregation boundary:** Falls back to `queryBuildingsInBBox` with the raw bbox.
- **Hex edge buildings:** Buildings on hex edges may appear in multiple hex queries due to `intersecting` containment mode. Deduplicated by `osmId`.
- **Cache invalidation:** Automatic via boundary hash. No explicit invalidation needed.
- **PostGIS filtering still required:** H3 hexes with `intersecting` mode extend slightly beyond the congregation boundary. The existing PostGIS `checkCongregationContainsPostGIS` filter removes buildings outside the actual polygon.

## Dependencies

- `h3-js@^4` (pure JS, ~2MB, no native bindings, works on arm64 Docker) — added to `hub-api/package.json` in Phase 1, `hub-app/package.json` in Phase 2.

## Testing

- **Unit tests for `hex-grid.ts`:** Pure functions, highly testable. Test `polygonToHexes` with a known polygon and verify hex count + coordinate conversion. Test `hexToBBox` returns valid bbox. Test `subdivideHexes` produces correct child count.
- **Integration test for `queryBuildingsInPolygon`:** Mock `queryBuildingsTile` to verify hex iteration, deduplication, and progress logging.

## Phasing

| Phase | Scope | Deliverable |
|-------|-------|-------------|
| 1 | Hex grid engine + Overpass integration + cache + tests | Single PR, fixes Overpass timeouts |
| 2 | Heatmap upgrade to H3 polygons | Separate spec + PR |

## Files

| File | Action | Phase |
|------|--------|-------|
| `hub-api/src/lib/hex-grid.ts` | Create | 1 |
| `hub-api/src/lib/__tests__/hex-grid.test.ts` | Create — unit tests | 1 |
| `hub-api/src/lib/osm-overpass.ts` | Modify — add `queryBuildingsInPolygon` | 1 |
| `hub-api/src/routes/gap-detection.ts` | Modify — use `queryBuildingsInPolygon` | 1 |
| `hub-api/prisma/schema.prisma` | Add `HexGridCache` model | 1 |
| `hub-api/package.json` | Add `h3-js@^4` dependency | 1 |
| `hub-api/src/routes/heatmap.ts` | Modify — H3 bucketing | 2 |
| `hub-app/src/pages/territories/HeatmapControl.tsx` | Modify — H3 polygon rendering | 2 |
| `hub-app/package.json` | Add `h3-js@^4` dependency | 2 |
