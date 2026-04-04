# Smart Gap Resolution — Design Spec

**Date**: 2026-04-04
**Status**: Draft
**Scope**: hub-api + hub-app (territory management)

## Problem

After territories are drawn, gaps often remain — uncovered areas between existing territory polygons that contain residential buildings. The existing gap detection system shows all uncovered buildings as uniform orange dots, making it hard to prioritize. There is no resolution path — the overseer must manually draw new territories or redraw existing ones.

## Solution

Enhance the existing gap detection with:
1. **Severity-based building colors** — color-coded markers by building type so residential buildings stand out
2. **Smart gap resolution** — inline "Smart Resolve" that analyzes clusters of uncovered residential buildings and proposes new territories or neighbor expansions, with adjustable thresholds and one-click apply

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Building colors | Severity-based: red/orange/yellow/gray | Prioritizes residential buildings visually |
| Decision logic | Combined thresholds (buildings + area) with user override | Balances automation with overseer control |
| Thresholds | User-adjustable, explicit "Analyze" recalculation | Different congregations have different density |
| Building assignment | Nearest boundary distance | Intuitive, produces compact territories |
| UI location | Inline on existing `GapDetection.tsx` page | Extends existing workflow, no new navigation |
| Gap geometry | `ST_Difference(congregation, ST_Union(territories))` | Exact uncovered area |
| Overpass strategy | Single query for congregation bbox | Avoids rate limiting, reuses existing pattern |
| Clustering | PostGIS gap polygons | Most accurate geographic grouping |

## Architecture

### 1. Severity-Based Building Colors

Replace the uniform orange circle markers with severity-based colors using MapLibre data-driven styling.

**Color mapping** (by `buildingType` property, already present in gap detection features):

| Severity | Building Types | Color | Hex |
|----------|---------------|-------|-----|
| High (must cover) | `house`, `apartments`, `residential`, `detached`, `semidetached_house`, `terrace` | Red | `#ef4444` |
| Medium | `farm`, `yes` (with street address) | Orange | `#f97316` |
| Low (uncertain) | `yes` (without address), unknown | Yellow | `#eab308` |
| Ignorable | `garage`, `commercial`, `industrial`, `retail`, `shed`, `barn`, `church`, `public` | Gray | `#9ca3af` |

Implementation: MapLibre `match` expression on `buildingType` + `case` expression checking `streetAddress` for the `yes` type split.

**Legend**: Add a small legend overlay on the map showing the 4 severity levels with their colors.

### 2. Gap Computation (PostGIS — `postgis-helpers.ts`)

New function `computeGapPolygons`:

```sql
WITH all_territories AS (
  SELECT ST_Union(
    ST_MakeValid(ST_GeomFromGeoJSON(boundaries::text))
  ) AS combined
  FROM "Territory"
  WHERE boundaries IS NOT NULL
    AND type = 'territory'
    AND boundaries->>'coordinates' IS NOT NULL
    AND jsonb_typeof(boundaries->'coordinates') = 'array'
),
congregation AS (
  SELECT ST_MakeValid(ST_GeomFromGeoJSON(boundaries::text)) AS geom
  FROM "Territory"
  WHERE type = 'congregation_boundary'
    AND boundaries IS NOT NULL
    AND boundaries->>'coordinates' IS NOT NULL
),
gaps AS (
  SELECT (ST_Dump(ST_Difference(congregation.geom, all_territories.combined))).geom AS geom
  FROM congregation, all_territories
)
SELECT
  ST_AsGeoJSON(geom) AS geojson,
  ST_Area(geom::geography) AS area_m2,
  ST_XMin(geom) AS west, ST_YMin(geom) AS south,
  ST_XMax(geom) AS east, ST_YMax(geom) AS north
FROM gaps
WHERE ST_Area(geom::geography) > 100
  AND ST_Area(geom::geography) / NULLIF(ST_Perimeter(geom::geography) * ST_Perimeter(geom::geography), 0) > 0.001
ORDER BY ST_Area(geom::geography) DESC
```

**Edge cases:**
- No congregation boundary → return 400 (matches existing gap-detection pattern)
- Invalid coordinates → return 400
- No territories → return empty gaps (skip — entire congregation too large)
- PostGIS unavailable → check `isPostgisMissing`, return 501

### 3. Building Analysis (single Overpass query)

Reuse existing gap detection pattern:
1. Single `queryBuildingsInBBox` for congregation bbox
2. Filter inside congregation via `isInsideBoundaries`
3. Distribute into gap polygons via `isInsideBoundaries` per gap
4. Exclude ignored buildings (from `IgnoredOsmBuilding` table)
5. Classify by severity (residential/mixed/uncertain/ignorable)

### 4. Decision Engine

```typescript
interface GapAnalysis {
  gapId: string;                    // generated UUID
  gapPolygon: object;              // GeoJSON Polygon
  areaMeter2: number;
  residentialCount: number;        // high + medium severity
  totalBuildingCount: number;
  recommendation: 'new_territory' | 'expand_neighbors';
  neighborAssignments: NeighborAssignment[];  // always computed
}

interface NeighborAssignment {
  territoryId: string;
  territoryNumber: string;
  territoryName: string;
  buildingCount: number;
}
```

**Default thresholds** (adjustable):
- `minResidentialBuildings`: 8
- `minAreaM2`: 5000

**Logic**: `residentialCount >= min AND areaMeter2 >= minArea` → recommend new territory, else expand neighbors. Both options always available.

### 5. Neighbor Assignment

Per gap:
1. Adjacent territories: `ST_DWithin(gap::geography, territory::geography, 50)`
2. Each building → nearest neighbor by boundary distance
3. Cap: 6 neighbors max

Expansion polygon computed at resolve time (not analysis): `ST_Union(territory::geography, ST_Buffer(ST_Collect(points)::geography, 15))::geometry`

### 6. API Endpoints

#### `GET /api/territories/gap-analysis`

**Permission**: `GAP_DETECTION_RUN`

Query params: `minResidentialBuildings` (default 8), `minAreaM2` (default 5000)

Guards: no congregation → 400, PostGIS missing → 501, Overpass fail → 502

Response:
```json
{
  "gaps": [{
    "gapId": "uuid",
    "gapPolygon": { "type": "Polygon", "coordinates": [] },
    "areaMeter2": 12500,
    "residentialCount": 14,
    "totalBuildingCount": 18,
    "recommendation": "new_territory",
    "neighborAssignments": [
      { "territoryId": "uuid", "territoryNumber": "205", "territoryName": "...", "buildingCount": 6 }
    ]
  }],
  "thresholds": { "minResidentialBuildings": 8, "minAreaM2": 5000 }
}
```

#### `POST /api/territories/gap-resolve`

**Permission**: `TERRITORIES_EDIT`

Body: `{ gapPolygon, action, newTerritoryName?, newTerritoryNumber?, neighborAssignments? }`

Uses `gapPolygon` (not gapId) to avoid stale references. Wrapped in `prisma.$transaction`. Creates `TerritoryBoundaryVersion` for all mutations.

### 7. UI Changes to GapDetection.tsx

**A) Color-coded markers** (replace existing orange circles):

Change `showGapsOnMap` to use data-driven paint:
```typescript
"circle-color": [
  "match", ["get", "buildingType"],
  "house", "#ef4444",
  "apartments", "#ef4444",
  "residential", "#ef4444",
  "detached", "#ef4444",
  "semidetached_house", "#ef4444",
  "terrace", "#ef4444",
  "farm", "#f97316",
  // default: check streetAddress for yes→orange vs yellow
  ["case",
    ["all", ["==", ["get", "buildingType"], "yes"], ["has", "streetAddress"]],
    "#f97316",
    "#eab308"
  ]
  "garage", "#9ca3af",
  "commercial", "#9ca3af",
  "industrial", "#9ca3af",
  "#eab308" // default yellow
]
```

**B) Legend overlay**: Small floating legend (bottom-left of map) with 4 color dots + labels.

**C) Smart Resolve section** (below existing gap list in right panel):

- Collapsible "Smart Resolve" section with settings icon
- Threshold inputs: "Min. residential buildings" + "Min. area m2"
- "Analyze Gaps" button → calls `GET /gap-analysis`
- Gap polygon fills on map (semi-transparent orange) when analysis is active
- Per-gap inline cards:
  - Stats line: "14 residential / 18 total, 12,500 m2"
  - Recommendation badge (green highlight)
  - "Create Territory" button → inline name/number form → apply
  - "Expand Neighbors" button → shows assignment list → apply
  - "Resolved" badge after applying
- All strings via `react-intl` `FormattedMessage`

### 8. Files to Create/Modify

**New files:**
- `hub-api/src/lib/gap-analysis.ts` — analysis engine + resolve functions
- `hub-api/src/routes/gap-resolution.ts` — API endpoints
- `hub-app/src/components/territories/GapResolutionSection.tsx` — smart resolve UI section

**Modified files:**
- `hub-api/src/lib/postgis-helpers.ts` — add `computeGapPolygons()`
- `hub-api/src/index.ts` — register gap-resolution routes
- `hub-app/src/pages/territories/GapDetection.tsx` — severity colors, legend, integrate resolution section
- `hub-app/src/lib/territory-api.ts` — add gap-analysis + gap-resolve API client functions

**Reused existing code:**
- `queryBuildingsInBBox()` from `osm-overpass.ts`
- `isInsideBoundaries()`, `bboxFromGeoJSON()` from `geo.ts`
- `runAutoFixPipeline()`, `upsertBoundary()` from `postgis-helpers.ts`
- Congregation guard pattern from `gap-detection.ts`
- `useMapLibre` hook for map rendering

## Error Handling

| Scenario | Response |
|----------|----------|
| No congregation boundary | 400 + descriptive message |
| PostGIS unavailable | 501 |
| Overpass failure | 502 (after retries) |
| Gap no longer exists at resolve time | Recompute, 409 if gone |
| Partial expand failure | `$transaction` rollback, 500 |
| Zero territories | Empty gaps array |

## Verification

1. Run `npm test` in hub-api workspace
2. Build + deploy to penzberg-north-uat
3. Manual E2E:
   - Run gap detection → verify colored markers (red residential, gray garages, etc.)
   - Verify legend shows on map
   - Open "Smart Resolve" → set thresholds → "Analyze Gaps"
   - Verify gap polygons appear on map with building counts
   - Adjust thresholds → re-analyze → verify recommendations change
   - Apply "Create Territory" → verify new territory on map
   - Apply "Expand Neighbors" → verify polygon growth
   - Verify no overlaps, boundary version history created
