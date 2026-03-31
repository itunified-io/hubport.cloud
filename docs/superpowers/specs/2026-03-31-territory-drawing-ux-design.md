# Territory Drawing UX Enhancement — Design Spec

**Date:** 2026-03-31
**Status:** Draft
**Target repo:** hubport.cloud (territory module)
**Source reference:** Frozen `itunified-io/hub` codebase — Studio v2

## Problem

The current Territory Studio v2 has 5 expert tools (Fix, Extend, Shape, Split, Sharpen) behind a tools panel with mode switching, brush width sliders, include/exclude toggles, and a generate→preview→apply workflow. This creates a steep learning curve for service overseers and territory servants who just want to draw and adjust territory boundaries.

Key pain points:
- **5 tools require spatial knowledge** — users must understand what "sharpen" or "fix" means
- **Mode switching friction** — selecting a tool, configuring it, drawing, generating, previewing, applying
- **No live feedback** — overlays only appear after a stroke completes
- **Brush width in meters** — abstract for users thinking in street blocks
- **Server round-trip undo** — every undo saves to DB, causing latency
- **No mobile/tablet support** — desktop-only editing
- **No snap-to-road** while drawing — boundaries rarely follow roads automatically

## Design Principle

> **The map is the interface.** No tools panel. No mode switching. Every interaction happens directly on the polygon. The system infers intent from context.

## Target Users

Both user types are equally important:
1. **Service overseers** — set up territories (bulk import + occasional adjustment)
2. **Territory servants** — frequently redraw/split territories as congregation grows

## Interaction Model — Google Maps Style Direct Manipulation

### Selecting a Territory
- **Desktop:** Click on a territory polygon
- **Tablet:** Tap on a territory polygon
- Selected territory shows vertex handles (white circles) and midpoint handles (smaller, semi-transparent circles on edge midpoints)

### Moving Vertices
- **Desktop:** Drag a white vertex handle
- **Tablet:** Touch-drag a vertex handle
- Live preview of the new boundary shape while dragging
- Snap engine engages during drag (see Snap Engine section)

### Adding Vertices
- **Desktop/Tablet:** Click/tap a midpoint handle
- Midpoint converts to a full vertex, two new midpoints appear on the adjacent edges
- Immediately draggable after creation

### Deleting Vertices
- **Desktop:** Right-click vertex → context menu → "Delete vertex"
- **Tablet:** Long-press vertex → context menu → "Delete vertex"
- Minimum 3 vertices enforced (cannot delete below triangle)

### Splitting a Territory
- **Desktop:** Hover over a polygon edge → scissors icon (✂️) appears → click scissors → draw a cut line across the territory → two new territories created
- **Tablet:** Deferred to a later release (scope decision — not a technical blocker)
- After split: user is prompted to name/number the new territory

**Split workflow detail:**
1. User clicks scissors icon on polygon edge → enters split mode (cursor changes to crosshair)
2. User draws a line across the territory (click start point, click end point — or click multiple points for curved cut)
3. Double-click or press Enter to confirm the cut line
4. Client sends `POST /territories/studio/deterministic-plan` with `{ operation: 'split', selectedTerritoryIds: [id], settings: { splitLine: <GeoJSON LineString> } }`
5. Server uses PostGIS `ST_Split()` to divide the polygon, returns two proposal geometries
6. Client shows a dialog: "Split into two territories" with fields for the new territory's number and name. The original territory keeps its ID and metadata; the second half becomes a new territory.
7. On confirm: client calls `PUT /territories/:id` to update the original (half A) + `POST /territories` to create the new one (half B)
8. **Address reassignment:** Addresses are reassigned based on `ST_Contains()` — each address's point geometry determines which half it belongs to. Addresses exactly on the split line go to the larger half. This runs server-side during the split save.

### Creating a New Boundary

Two creation modes, user picks based on preference:

**A) Click-to-place (precision):**
- Enter creation mode from territory detail page ("Draw boundary" button)
- Click on map to place vertices one by one
- Double-click (or click first vertex) to close the polygon
- System auto-snaps the completed polygon to roads/neighbors

**B) Freehand lasso (speed):**
- Hold Shift + click-drag to draw a freehand shape
- On mouse-up, system converts the rough shape to a clean polygon
- Auto-snaps vertices to nearby roads and neighbor edges
- Simplifies vertex count using Douglas-Peucker algorithm with a tolerance of ~5 meters (converts screen pixels to meters at current zoom level). Target: reduce freehand curves from 100+ points to 10-30 meaningful vertices.

Both modes clip to congregation boundary and subtract water bodies automatically.

### Deselecting
- Click/tap on empty map area to deselect
- All handles disappear, territory returns to normal display

## Snap Engine — Rule-Driven Priority

When a vertex is being dragged, the snap engine evaluates snap candidates in priority order and selects the best match within a configurable tolerance (default: 15px screen distance).

### Snap Priority (highest to lowest)

| Priority | Target | When |
|----------|--------|------|
| 1 | **Neighbor territory edge** | Vertex is within tolerance of another territory's edge. Prevents gaps and overlaps between adjacent territories. |
| 2 | **Road centerline (OSM)** | Vertex is within tolerance of a road from Overpass data. Most boundaries follow streets. |
| 3 | **Congregation boundary** | Vertex is near the outer congregation boundary. Ensures territories don't extend beyond. |
| 4 | **Building footprint edge** | Vertex is near a building corner/edge. Useful in rural areas without clear road boundaries. |

### Snap Behavior
- **Visual feedback:** Green badge appears near vertex showing what it snapped to (e.g., "🧲 snapped to Hauptstraße")
- **Override:** Hold Alt/Option to temporarily disable all snapping and place vertex freely
- **Tolerance:** 15px screen distance (adjusts with zoom level — tighter at high zoom)
- **Multiple candidates:** When several snap targets are within tolerance, highest priority wins. Ties broken by nearest distance.

### Data Sources

All snap data is fetched via the new server-side `GET /territories/snap-context?bbox=...` endpoint. The server calls existing Overpass functions (`queryRoadsInBBox`, `queryBuildingsInBBox`, `queryWaterBodiesInBBox`) and returns a combined response. The client caches this response per viewport (re-fetches when the user pans/zooms significantly — >50% viewport change).

- **Roads:** Server fetches from OSM Overpass, returns as GeoJSON LineStrings
- **Neighbor edges:** Computed client-side from already-loaded territory GeoJSON features (no API call)
- **Congregation boundary:** Already loaded as part of map data (no API call)
- **Buildings:** Included in snap-context response, returned as GeoJSON Points with building type

### Performance

The snap engine runs on every `pointermove` during a vertex drag. To maintain 60fps:
- **Throttle:** Snap calculation runs at most every 16ms (one per frame). Intermediate events update cursor position only.
- **Spatial index:** Neighbor edges and road segments are indexed in a flat-array R-tree (e.g., `rbush`) built once when snap context is loaded. Point-to-segment distance queries against the index are O(log n).
- **Budget:** Snap evaluation must complete in <5ms. If it exceeds this, reduce snap targets (drop buildings first, then roads) until within budget.
- **Lazy building load:** Buildings are only fetched when zoom level is ≥16 (street level). At lower zooms, only roads and neighbors are snap targets.

## Auto-Fix Pipeline

When a boundary change is saved, the server runs automatic fixes before persisting. These replace the manual "Fix" and "Sharpen" tools from v2.

### Fix Steps (server-side, sequential)

1. **Geometry validation** — `ST_MakeValid()` repairs self-intersections and topology errors (already in `upsertBoundary()`)
2. **Water exclusion** — `ST_Difference(boundary, water_mask)` subtracts water bodies (already in `upsertBoundary()`)
3. **Congregation clipping** — New logic, added to `upsertBoundary()`:
   ```sql
   -- Clip to congregation boundary (new step)
   ST_Intersection(
     boundary,
     (SELECT boundary FROM territories
      WHERE tenant_id = $tenantId AND type = 'congregation_boundary'
      AND status != 'archived' AND boundary IS NOT NULL LIMIT 1)
   )
   ```
   If no congregation boundary exists, this step is skipped. This is new code — the frozen hub does not have congregation clipping in the save pipeline.
4. **Overlap detection** — After save, run `findOverlappingTerritories()` (already exists). Do NOT auto-resolve — user must intentionally adjust.

### API Response Contract

The `PUT /territories/:id` response is extended with auto-fix metadata:

```json
{
  "territory": { /* standard territory object */ },
  "autoFix": {
    "applied": ["water_exclusion", "congregation_clip"],
    "geometryModified": true,
    "overlaps": [
      { "territoryId": "uuid", "number": "T-5", "name": "North", "overlapAreaM2": 120.5 }
    ]
  }
}
```

- `autoFix.applied` — list of fix steps that actually changed the geometry
- `autoFix.geometryModified` — true if the saved geometry differs from what the client sent
- `autoFix.overlaps` — detected overlaps (informational, not blocking)

### Client Feedback
- If `autoFix.geometryModified` is true, show a toast: "Boundary adjusted — {applied steps}" (e.g., "Boundary adjusted — clipped to congregation area")
- If `autoFix.overlaps` is non-empty, show a yellow warning badge on the overlapping edges. Badge text: "Overlaps with T-5 (121 m²)"
- Client re-reads the saved geometry from the response to update the map (may differ from what was sent)

## Undo/Redo — Optimistic UI

### Architecture
- **Client-side undo stack** — array of `{ territoryId, beforeGeometry, afterGeometry, description, timestamp }` entries
- **Optimistic rendering** — boundary change is applied to the map instantly on mouse-up
- **Background sync** — `updateTerritory()` API call fires in background
- **Failure rollback** — if server returns error, revert ALL optimistic changes from the failed operation onward (rollback the failed edit + any subsequent edits that depended on it). The undo stack is truncated to the last successfully synced state. Show error toast: "Save failed — reverted to last saved state. Your recent changes were lost."
- **Sync fence** — each optimistic edit increments a local sequence number. The client tracks the last server-confirmed sequence. On failure, all edits with sequence > last-confirmed are reverted.
- **Stack size** — max 50 entries per session (oldest dropped when exceeded)

### Gestures
- **Desktop:** `⌘Z` / `Ctrl+Z` undo, `⌘⇧Z` / `Ctrl+⇧Z` redo
- **Tablet:** Two-finger swipe left (undo) / right (redo) — or on-screen buttons in minimal HUD

### HUD
Minimal bottom bar overlay on the map (not a panel):
- Left: undo/redo keyboard hints (desktop) or small icon buttons (tablet)
- Right: save status indicator ("Saved ✓" / "Saving..." / "Error — tap to retry")

## Touch Support — Tablet

### Supported (iPad-size and up)
- Tap to select territory
- Drag vertex handles to reshape
- Tap midpoint to add vertex
- Long-press vertex for context menu (delete)
- Pinch-zoom and pan (standard map gestures)
- Two-finger swipe for undo/redo

### Not Supported (Phone)
- Territory boundaries displayed read-only on phone screens
- No vertex handles, no editing gestures
- Phone users view assigned territories, log visits, see addresses

### Breakpoint
- Editing enabled at `≥ 768px` viewport width
- Below 768px: view-only mode, no vertex handles rendered

## Map Library

**MapLibre GL JS** — the frozen hub uses MapLibre via the `TerritoryMap` component (1,351 lines). This carries over to hubport.cloud. MapLibre is the open-source fork of Mapbox GL JS, supports custom layers, GeoJSON sources, and event handling needed for vertex manipulation.

Key MapLibre features used:
- `map.on('mousedown/mousemove/mouseup')` — for vertex dragging
- GeoJSON source updates — for live boundary preview during drag
- Custom HTML markers — for vertex/midpoint handles (positioned via `map.project()`/`map.unproject()`)
- `map.queryRenderedFeatures()` — for hit-testing polygon clicks

No map library migration needed — MapLibre stays.

## Permissions (RBAC)

The existing hubport.cloud RBAC model (12 AppRoles, PolicyEngine) applies. Territory editing permissions:

| Permission | Who can | Used by |
|------------|---------|---------|
| `app:territories.view` | View territories on map | All authenticated roles |
| `app:territories.edit` | Edit boundaries (drag vertices, create, lasso) | Service Overseer, Service Overseer Assistant, Tenant Admin |
| `app:territories.delete` | Delete territories | Service Overseer, Tenant Admin |
| `app:territories.split` | Split territories (scissors) | Service Overseer, Tenant Admin |
| `app:territories.import` | KML/CSV import | Service Overseer, Tenant Admin |

- The `TerritoryEditor` component checks `hasPermission('app:territories.edit')` before rendering vertex handles. Without this permission, territories display as non-interactive polygons.
- Split (scissors affordance) additionally requires `app:territories.split` — a user with `edit` but not `split` can reshape but not divide.
- The existing `app:territories.split` permission does not exist in the frozen hub — it must be added to the RBAC permission matrix as a new permission key.

## Components to Build (hubport.cloud)

### New Components
| Component | Purpose |
|-----------|---------|
| `TerritoryEditor` | Main editor — replaces TerritoryStudioV2. Manages selection, vertex handles, undo stack. |
| `VertexHandle` | Draggable vertex circle with snap engine integration |
| `MidpointHandle` | Clickable midpoint circle, converts to vertex on click |
| `SnapEngine` | Pure function: takes drag position + snap targets → returns snapped position + label |
| `ScissorsAffordance` | Hover-triggered split icon on polygon edges |
| `SplitFlow` | Modal flow after scissors click: draw cut line → confirm → name new territory |
| `CreationFlow` | Click-to-place + lasso drawing for new boundaries |
| `EditHUD` | Minimal bottom overlay: undo/redo + save status |
| `ContextMenu` | Right-click / long-press menu for vertex operations |

### Reused from Frozen Hub (carry to hubport.cloud as-is)
| Module | Why |
|--------|-----|
| `postgis-helpers.ts` | All spatial SQL — upsertBoundary, validateGeometry, findOverlappingTerritories, etc. |
| `osm-overpass.ts` | Overpass API client for roads, buildings, water bodies |
| `osm-nominatim.ts` | Geocoding client |
| `geometry-utils.ts` | Client-side polygon validation, haversine, circle/rectangle creation |
| `proposal-scoring.ts` | Gap detection confidence scoring |
| Prisma models (V011–V020) | All 9 territory database models |

### Dropped (not carried to hubport.cloud)
| Module | Why |
|--------|-----|
| `TerritoryStudio.tsx` (v1, 5,361 lines) | Monolithic, superseded by v2, superseded again by this design |
| `TerritoryStudioV2.tsx` + all hooks | Replaced by TerritoryEditor (direct manipulation replaces tool-based approach) |
| `StudioToolbar`, `ToolPanel`, `IssuesPanel`, `PreviewPanel` | No longer needed — no tools panel, no preview step |
| `SmartDrawPanel.tsx` | Replaced by CreationFlow |
| `BoundaryDrawMap.tsx` | Merged into TerritoryEditor |
| `useFixTool`, `useExtendTool`, `useSharpenTool` | Auto-fix pipeline replaces manual fix/sharpen. Extend is just "drag vertex outward". |
| `useShapeTool` | Shape/brush painting replaced by direct vertex manipulation |
| `useSplitTool` | Replaced by ScissorsAffordance + SplitFlow |

## API Changes

### Existing Endpoints (no changes needed)
- `PUT /territories/:id` with `boundary` field — already handles geometry update
- `POST /territories/studio/deterministic-plan` — still needed for split operation (server-side polygon splitting via PostGIS)
- All territory CRUD, address, assignment, share endpoints unchanged

### New Endpoints
| Endpoint | Purpose |
|----------|---------|
| `GET /territories/snap-context?bbox=...` | Returns roads + buildings + water bodies for a bounding box. Combines existing Overpass queries into a single cached endpoint. Reduces client-side API calls from 3 to 1. |

### Modified Behavior
- `PUT /territories/:id` with `boundary`: server now always runs the auto-fix pipeline (validate → water clip → congregation clip) before saving. Currently this only happens when `waterMaskGeoJson` is explicitly passed.

## Migration Path

This design replaces Studio v2 entirely. The migration is clean because:

1. **No shared state** — Studio v2 state is component-local (useState hooks), not persisted
2. **Same API** — `updateTerritory()` is the only mutation endpoint; it stays the same
3. **Same DB models** — all Prisma models and migrations carry over unchanged
4. **Same spatial SQL** — `postgis-helpers.ts` carries over as-is
5. **Same OSM clients** — `osm-overpass.ts` and `osm-nominatim.ts` carry over as-is

The TerritoryEditor replaces TerritoryStudioV2 as the editing interface. The TerritoryDetail page gains an "Edit boundary" button that opens the editor inline (no separate Studio page needed).

## Success Criteria

1. User can select a territory and reshape it by dragging vertices — no tool selection required
2. Vertices snap to roads and neighbor edges automatically during drag
3. New boundaries can be created via click-to-place or freehand lasso
4. Territories can be split via scissors affordance on edge hover
5. Undo/redo is instant (optimistic UI)
6. Auto-fix (water, congregation clipping) runs transparently on save
7. Works on tablets (≥768px viewport)
8. Zero regression on existing territory CRUD, import, gap detection, sharing features
