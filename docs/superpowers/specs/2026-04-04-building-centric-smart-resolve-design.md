# Building-Centric Smart Resolve — Design Spec

## Problem

The current Smart Resolve uses gap polygons (uncovered areas computed via `ST_Difference`) to drive resolution. This approach has three fundamental problems:

1. **Wrong distance metric.** Buildings are assigned to territories by centroid distance, not boundary edge distance. A building 12m from territory 139's edge gets assigned to a distant territory whose centroid happens to be closer.
2. **Disconnected expansion geometry.** `ST_Buffer(building_points, 15m)` creates isolated 15m circles around buildings. When buildings are far from the territory edge, the circles don't connect back — producing MultiPolygon blobs instead of natural boundary extensions.
3. **Gap polygons are the wrong abstraction.** Users think in terms of "these 3 red buildings should belong to territory 139" — not "this 290 ha gap polygon should be resolved." The gap polygon adds complexity without value.

## Solution

Replace gap-polygon-based resolution with building-centric resolution:

- Find uncovered **residential** buildings (high + medium severity — red and orange dots)
- Assign each to the **nearest territory by boundary edge distance** (PostGIS `ST_Distance`)
- Group into clusters per territory
- Expand each territory via **convex hull stretch**: convex hull of (buildings + nearest boundary edge points), buffered 15m, unioned with territory polygon
- One-click resolve per cluster

## Architecture

### Backend: `runGapAnalysis` rewrite

**Input:** Uncovered buildings from the latest gap detection run (already stored in DB).

**Process:**

1. Load all uncovered buildings from the latest completed gap detection run (`GapDetectionResult` features with `covered: false`)
2. Load building overrides to determine effective severity
3. Filter to residential-only: high severity (house, apartments, residential, detached, etc.) + medium severity (farm, `yes` with address) + `confirmed_residential` overrides. Excludes yellow (uncertain) and gray (non-residential).
4. For each residential building, compute nearest territory via PostGIS. Uses `ST_DWithin` as a pre-filter to avoid computing exact distances for buildings far from all territories:
   ```sql
   SELECT t.id, t.number::integer AS num, t.name,
     ST_Distance(
       ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography,
       ST_MakeValid(ST_GeomFromGeoJSON(t.boundaries::text))::geography
     ) AS distance_m
   FROM "Territory" t
   WHERE t.type = 'territory'
     AND t.boundaries IS NOT NULL
     AND t.boundaries->>'coordinates' IS NOT NULL
     AND jsonb_typeof(t.boundaries->'coordinates') = 'array'
     AND ST_DWithin(
       ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography,
       ST_MakeValid(ST_GeomFromGeoJSON(t.boundaries::text))::geography,
       $maxDistanceM
     )
   ORDER BY distance_m ASC, num ASC
   LIMIT 1
   ```
   The secondary sort on `num ASC` (cast to integer) ensures deterministic assignment when two territories are equidistant.
   Buildings that return no rows from this query go into the `unassigned` list.
5. Group buildings by assigned territory ID → clusters
6. Return cluster list + unassigned list

**Response shape:**

```typescript
interface BuildingCluster {
  territoryId: string;
  territoryNumber: string;
  territoryName: string;
  maxDistanceM: number;    // furthest building in cluster from territory edge
  buildings: Array<{
    osmId: string;
    lat: number;
    lng: number;
    buildingType: string;
    streetAddress?: string;
    distanceM: number;     // this building's distance from territory edge
  }>;
}

interface SmartResolveAnalysis {
  clusters: BuildingCluster[];
  unassigned: Array<{  // buildings > maxDistance from any territory
    osmId: string;
    lat: number;
    lng: number;
    buildingType: string;
    streetAddress?: string;
  }>;
  thresholds: { maxDistanceM: number };
}
```

Note: `clusterId` is not needed — `territoryId` uniquely identifies each cluster (one cluster per territory). The resolve endpoint uses `territoryId` + `buildingCoords`.

### Backend: `resolveClusterExpand` (replaces `resolveGapExpandNeighbors`)

**Input:** `{ territoryId: string; buildingCoords: [lng, lat][] }` — coordinates in GeoJSON order `[longitude, latitude]`.

**PostGIS expansion — convex hull stretch (pseudo-code, implementation builds array dynamically):**

```sql
SELECT ST_AsGeoJSON(
  ST_Union(
    ST_MakeValid(ST_GeomFromGeoJSON($territory_boundaries)),
    ST_Buffer(
      ST_ConvexHull(
        ST_Collect(ARRAY[
          -- Building points
          ST_SetSRID(ST_MakePoint($lng1, $lat1), 4326),
          ST_SetSRID(ST_MakePoint($lng2, $lat2), 4326),
          ...
          -- Nearest boundary edge points (one per building)
          ST_ClosestPoint(
            ST_MakeValid(ST_GeomFromGeoJSON($territory_boundaries)),
            ST_SetSRID(ST_MakePoint($lng1, $lat1), 4326)
          ),
          ST_ClosestPoint(
            ST_MakeValid(ST_GeomFromGeoJSON($territory_boundaries)),
            ST_SetSRID(ST_MakePoint($lng2, $lat2), 4326)
          ),
          ...
        ])
      )::geography,
      15
    )::geometry
  )
) AS geojson
```

Note: The `ST_ConvexHull` operates on SRID 4326 (unprojected). For the target geography (Bavaria, ~48°N latitude), distortion is negligible at the scale of individual territory expansions (< 500m). The `::geography` cast on the hull ensures the 15m buffer is computed spherically.

This creates a natural "tongue" extending from the territory boundary edge to reach the buildings, buffered by 15m.

**Post-expansion:**

1. **Load congregation boundary** from DB (`Territory` with `type = 'congregation_boundary'`) — same pattern as existing `clipToCongregation` helper
2. Clip expanded polygon to congregation boundary only (no neighbor clip — expansion deliberately fills gaps)
3. Save previous boundary as `TerritoryBoundaryVersion` with `changeType: "gap_expansion"`
4. Update territory boundaries

### API Routes

Existing endpoints stay, request/response shapes change:

- `GET /territories/gap-analysis` → returns `SmartResolveAnalysis` (clusters instead of gap polygons)
  - Params: `maxDistanceM` (default 200)
  - Drops: `minResidentialBuildings`, `minAreaM2` (no longer relevant)
- `POST /territories/gap-resolve` → body changes:
  - `action: "expand_cluster"` (replaces `expand_neighbors`)
  - `territoryId: string` + `buildingCoords: [lng, lat][]` (GeoJSON coordinate order)
  - Drops: `gapPolygon`, `neighborAssignments` array

### Frontend: `GapResolutionSection.tsx`

**Simplified UI:**

- **Button:** "Find Uncovered" (replaces "Analyze Gaps")
- **Threshold:** Single `maxDistance` input (default 200m). No `minArea` or `minBuildings`.
- **Results:** Flat cluster list, each card shows:
  - Territory number + name
  - Distance badge showing max distance (e.g., "12m away" — furthest building in cluster)
  - Building count with red severity dot
  - Building addresses (compact list, if available)
  - Single button: **"Include in #139"** — one-click resolve
  - After resolve: green checkmark

- **"No nearby territory" section:** Buildings > maxDistance shown separately with note "Manual territory creation needed"

**Map visualization on cluster select:**

- Highlight target territory polygon (blue outline pulse)
- Show uncovered buildings as red dots
- Dashed preview line from each building to nearest territory edge point
- Semi-transparent blue fill showing the convex hull expansion preview
- After resolve: territory boundary updates, building dots disappear

**Removed:**
- Gap polygon layers (orange fill/outline)
- "New Territory" form (rare case, handled manually)
- "Expand Neighbors" split (always expand nearest)
- Gap polygon hover/select
- Threshold inputs for minBuildings and minArea

### Frontend: `GapDetection.tsx`

- Remove `gapPolygons` state and `updateGapPolygonLayers`
- Replace with `clusterPreview` state for expansion preview layers
- `onHighlightGap` callback → `onHighlightCluster` with cluster data
- Map layers: territory highlight (blue), building dots (red), expansion preview (blue fill), edge lines (dashed)

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Building > 200m from any territory | Listed in "unassigned" section, no auto-assign |
| Building equidistant from 2 territories | Assign to lower-numbered territory via `ORDER BY distance_m ASC, num ASC` |
| Expansion would overlap neighbor | Don't clip — "Fix Violations" handles overlaps separately |
| 0 uncovered residential buildings | Green checkmark: "All residential buildings are covered!" |
| Overpass failure | Not relevant — uses buildings already stored from gap detection run |
| PostGIS unavailable | 501 error (same as current) |
| Stale state (territory edited between analysis and resolve) | Resolve re-loads current boundary from DB before expanding. If buildings are now covered (inside the updated boundary), they are skipped. No optimistic locking needed — worst case is a harmless no-op expansion. |
| Concurrent resolve (two users resolve same cluster) | Both expansions use `ST_Union` which is idempotent — second expansion on an already-expanded territory produces the same result. Version history records both attempts. |

## Files Changed

| File | Action |
|------|--------|
| `hub-api/src/lib/gap-analysis.ts` | Rewrite `runGapAnalysis`, replace `resolveGapExpandNeighbors` with `resolveClusterExpand` |
| `hub-api/src/routes/gap-resolution.ts` | Update request/response schemas |
| `hub-app/src/lib/territory-api.ts` | Update types (`BuildingCluster`, `SmartResolveAnalysis`) |
| `hub-app/src/components/territories/GapResolutionSection.tsx` | Rewrite — cluster list UI |
| `hub-app/src/pages/territories/GapDetection.tsx` | Replace gap polygon layers with cluster preview layers |

## What's NOT Changing

- Gap detection ("Run Detection") — unchanged, still finds uncovered buildings
- Building severity colors on map — unchanged
- Building triage (overrides, ignore) — unchanged
- Territory boundary version history — unchanged (same pattern)
- Dock/undock floating window — unchanged
