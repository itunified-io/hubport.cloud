# Territory Editor Enhancement — Design Spec

**Date:** 2026-04-01
**Status:** Approved
**Scope:** Smart creation flow on TerritoryMap, batch "Snap All", bug fixes

---

## Overview

Enhance territory management with a smart creation flow (draw → auto-detect city → suggest number) and a batch "Snap All" feature. Fix two existing bugs (edit button visibility, violation badges). The existing editor infrastructure (TerritoryEditor, SnapEngine, VertexHandle, MidpointHandle, EditHUD, CreationFlow, useSnapEngine, useTerritoryEditor, useUndoRedo) is already solid — this work extends it rather than replacing it.

## Existing Infrastructure (No Replacement Needed)

The codebase already has a full inline polygon editor:

| Component | Location | Status |
|-----------|----------|--------|
| `TerritoryEditor.tsx` | `hub-app/src/pages/territories/` | Edit/view/create/split modes, vertex/midpoint rendering, toolbar |
| `VertexHandle.tsx` | `hub-app/src/pages/territories/` | Draggable handles with snap integration, Alt override |
| `MidpointHandle.tsx` | `hub-app/src/pages/territories/` | Click-to-insert vertex on edge midpoints |
| `EditHUD.tsx` | `hub-app/src/pages/territories/` | Status bar with vertex count, snap targets, undo hints |
| `CreationFlow.tsx` | `hub-app/src/pages/territories/` | Click + freehand drawing on MapLibre |
| `SnapEngine.ts` | `hub-app/src/pages/territories/` | Pure `snapVertex()` with priority: neighbor > road > boundary > building |
| `useSnapEngine.ts` | `hub-app/src/hooks/` | React hook, throttled 60fps, converts snap context to targets |
| `useTerritoryEditor.ts` | `hub-app/src/hooks/` | Mode management, snap context fetch, save with auto-fix |
| `useUndoRedo.ts` | `hub-app/src/hooks/` | Undo/redo stack (50 entries), push/undo/redo/clear |
| `geometry-utils.ts` | `hub-app/src/lib/` | Polygon validation, vertex extraction, self-intersection checks |

---

## Section 1: Smart Creation Flow

### What Changes

Currently: "+ New Territory" on TerritoryMap opens a modal for number + name, then navigates to detail page to draw.

New: "+ New Territory" enters drawing mode directly on TerritoryMap. User sees all neighbors and congregation boundary while drawing. After closing the polygon, system auto-suggests city name and territory number via new backend endpoint. Modal appears with pre-filled fields.

### User Flow

1. User clicks "+ New Territory" on TerritoryMap
2. Map enters drawing mode via existing `CreationFlow` component — all existing territories and congregation boundary remain visible
3. User draws rough polygon (click vertices or freehand lasso, double-click/Enter to close)
4. Frontend calls `POST /territories/suggest` with drawn polygon
5. Modal shows pre-filled city name + suggested number (both editable), group hint (e.g., "5xx — Antdorf (501, 503, 505 exist)")
6. User confirms → `POST /territories` creates territory with drawn polygon

### Backend: `POST /territories/suggest`

```
Request:  { boundaries: GeoJSON Polygon }
Response: {
  city: "Antdorf",
  suggestedPrefix: "5",
  suggestedNumber: "507",
  existingInGroup: ["501", "503", "505"],
  autoFix: { ...AutoFixResult }
}
```

Logic:
1. Compute centroid of polygon
2. Overpass `is_in` query on centroid → get admin boundary name (city/village)
3. Match city against existing territory `name` fields → find group prefix
4. If new city with no existing group, suggest next unused prefix (1-9)
5. Find next available number in group (skip existing)
6. Run auto-fix pipeline on polygon (validate → congregation clip)
7. Return all in one response

Error handling:
- Overpass timeout/unreachable → return `city: null`, let user type manually
- Centroid outside all admin boundaries → return `city: null`
- Auto-fix failure → return boundaries as-is with `autoFix: null`

### Numbering Logic

- Semi-automatic: system suggests prefix + next number, user picks/overrides
- First digit = group prefix tied to a city (e.g., 5xx = Antdorf)
- If city has no existing group, suggest next unused prefix
- User can always override both name and number

### Frontend Changes

- `TerritoryMap.tsx`: Wire "+ New Territory" to enter `CreationFlow` directly on the map (instead of modal → navigate to detail)
- `CreationFlow.tsx`: On `onComplete`, call `suggestTerritory()` API, then open confirmation modal
- New: `CreateTerritoryModal.tsx` — confirmation modal with pre-filled city/number, editable fields, group hint, create button

---

## Section 2: Batch "Snap All" Feature

### What Exists

`SnapEngine.ts` already has `snapVertex()` for single-vertex magnet snapping during drag. `useSnapEngine.ts` provides the React hook. `VertexHandle.tsx` already shows snap labels during drag.

### What's New: `snapAll()` Function

Add `snapAll(vertices, targets, tolerance)` to `SnapEngine.ts`:

```typescript
export function snapAll(
  vertices: [number, number][],
  targets: SnapTarget[],
  tolerance: number = DEFAULT_SNAP_TOLERANCE
): { snapped: [number, number][]; report: SnapReport[] }
```

For each vertex, calls existing `snapVertex()` logic. Returns new vertex array + per-vertex report (original position, snapped position, target name, distance, or "no match").

### "Snap All" Button in TerritoryEditor

Add "Snap All" button to `TerritoryEditor.tsx` toolbar (visible in edit mode):

1. User clicks "Snap All"
2. All vertices snapped via `snapAll()`
3. Preview overlay on map:
   - Orange dashed polygon = original positions
   - Green solid polygon = snapped positions
   - Gray lines connecting each original → snapped vertex
4. "Accept" applies snapped vertices, "Revert" cancels
5. Accept pushes to undo stack (batch operation)

### Dynamic Snap Context Refresh

Currently snap context is fetched once when entering edit mode. Add: re-fetch when user pans map significantly outside original bbox (>50% outside).

---

## Section 3: Bug Fixes

### Edit Button Not Visible

**Symptom:** Edit button on territory detail page not appearing despite code existing, gated on `can("app:territories.edit")`.

**Root Cause:** Timing race — `can()` returns false during initial render before permission data loads. The permission context updates but the component doesn't re-render because the `can` function reference is stable.

**Fix:** Keep the permission check but add a loading state. When permissions are still loading, show the button as disabled/skeleton. Once permissions resolve, show or hide based on actual permission. This preserves the security gate while fixing the reactivity issue. Investigate whether `useCan()` or similar hook from the RBAC system triggers re-renders on permission load.

### Violation Badges Not Showing

**Symptom:** No violation markers on territory map.

**Root Causes (already partially fixed in v2026.04.01.12):**
1. PostGIS extension was missing → fixed with `CREATE EXTENSION IF NOT EXISTS postgis`
2. `mapRef.current` doesn't trigger re-renders → fixed with `isLoaded` gate

**Additional Fix:** Add observable feedback to `ViolationBadges.tsx`:
- Loading state: show spinner/skeleton while API call in flight
- Empty state: when API returns `[]`, show subtle "No violations" indicator
- Error state: when API 500s, show error badge instead of silent failure
- This lets users distinguish "no violations found" from "system not working"

---

## Files Affected

### New Files

| File | Purpose |
|------|---------|
| `hub-app/src/pages/territories/CreateTerritoryModal.tsx` | Confirmation modal with pre-filled city/number after drawing |

### Modified Files

| File | Changes |
|------|---------|
| `hub-app/src/pages/territories/TerritoryMap.tsx` | Wire "+ New Territory" to enter CreationFlow on map, add creation mode state |
| `hub-app/src/pages/territories/CreationFlow.tsx` | On complete: call suggest API, open CreateTerritoryModal |
| `hub-app/src/pages/territories/TerritoryEditor.tsx` | Add "Snap All" button to toolbar, snap preview overlay |
| `hub-app/src/pages/territories/SnapEngine.ts` | Add `snapAll()` function |
| `hub-app/src/pages/territories/TerritoryDetail.tsx` | Fix edit button permission timing, add loading state |
| `hub-app/src/pages/territories/ViolationBadges.tsx` | Add loading/empty/error state indicators |
| `hub-app/src/hooks/useSnapEngine.ts` | Add dynamic bbox refresh on pan |
| `hub-app/src/lib/territory-api.ts` | Add `suggestTerritory()` function |
| `hub-api/src/routes/territories.ts` | Add `POST /territories/suggest` endpoint |

### Existing (No Changes Needed)

| File | Reason |
|------|--------|
| `VertexHandle.tsx` | Magnet snap already works during drag |
| `MidpointHandle.tsx` | Click-to-insert already works |
| `EditHUD.tsx` | Status bar already shows relevant info |
| `useUndoRedo.ts` | Stack already supports batch push |
| `geometry-utils.ts` | Validation already sufficient |
| `GET /territories/snap-context` | Already returns roads/buildings/water GeoJSON |
| `updateTerritoryBoundaries()` | Already runs auto-fix pipeline |

---

## Out of Scope

- Full-screen editor page (existing inline editor is sufficient)
- Mobile-specific touch interactions
- Configurable snap threshold UI (hardcoded in code, adjustable by devs)
- Split workflow enhancements
- Undo/redo state recovery (hooks exist, wiring deferred)
- Freehand polygon simplification (Douglas-Peucker)
- Area/perimeter display in HUD
