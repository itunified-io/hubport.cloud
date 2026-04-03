# Gap Detection — Rectangle Select & Ignore

**Date:** 2026-04-02
**Status:** Approved
**Author:** Claude + Benjamin

## Problem

The gap detection page shows 516 uncovered buildings as orange dots on the map. Many are non-residential (sheds, barns, garages) and need to be ignored. Currently, ignoring requires either clicking individual dots or checking boxes in the sidebar list. When dozens of buildings cluster in a rural area (all barns/sheds), this is tedious.

## Solution

Add **Shift+drag rectangle selection** on the map to select multiple uncovered buildings at once, verify them on satellite imagery, pick a reason, and bulk-ignore.

## Interaction Flow

1. User holds **Shift** and drags on the map — a semi-transparent blue rectangle appears
2. On mouse-up, all uncovered buildings (orange dots from `gap-markers` layer) inside the rectangle are identified
3. Selected buildings change appearance (highlighted with yellow/pulse)
4. Map **auto-switches to Satellite view** for visual verification
5. A **confirmation bar** appears: `"N buildings selected — [Reason ▾] [Ignore] [Cancel]"`
6. User selects reason from the 8 presets (Garage, Shed, Commercial, Church, Unoccupied, Not a residence, Duplicate, Other)
7. **Ignore** calls the existing `ignoreBuildings()` API with all selected features
8. Gap detection re-runs, ignored buildings disappear, map reverts to Street view
9. **Cancel** clears selection, reverts to Street view, no changes made

## Technical Design

### Frontend Only

No backend changes needed. The existing `POST /territories/gap-detection/ignore` endpoint already accepts an array of buildings. The `ignoreBuildings()` function in `hub-app/src/lib/territory-api.ts` (line 385) is ready:

```typescript
ignoreBuildings(
  data: Array<{
    territoryId: string; osmId: string; reason: string;
    notes?: string; lat?: number; lng?: number;
    streetAddress?: string; buildingType?: string;
  }>,
  token: string,
): Promise<{ created: string[]; skipped: string[] }>
```

Note: `territoryId` is NOT in feature properties — it must come from `selectedRun.territoryId`.

### MapLibre Rectangle Selection

**Event handling in GapDetection.tsx:**

```
Shift+mousedown → record start point (screen pixels), set selecting=true, stopPropagation
mousemove (while selecting) → render rectangle overlay
mouseup → compute screen-pixel bbox, query features, set selected state
```

**Feature query (screen-pixel bbox):**
- `map.queryRenderedFeatures()` requires **screen-pixel coordinates** (`[PointLike, PointLike]`), NOT geographic coordinates
- Compute bbox from `selectionStart` and `selectionEnd` (already in screen pixels from mouse events):
  ```typescript
  const sw: [number, number] = [Math.min(start.x, end.x), Math.max(start.y, end.y)];
  const ne: [number, number] = [Math.max(start.x, end.x), Math.min(start.y, end.y)];
  const features = map.queryRenderedFeatures([sw, ne], { layers: ["gap-markers"] });
  ```
- Extract feature properties: `osmId`, `lat`, `lng`, `streetAddress`, `buildingType`
- `territoryId` comes from `selectedRun.territoryId` (not from feature properties)

**Rectangle overlay:**
- Absolute-positioned `<div>` over the map container with `pointer-events: none`
- Blue border, semi-transparent blue fill (`rgba(59, 130, 246, 0.15)`, border `#3b82f6`)
- Positioned via CSS transform from start/current mouse coordinates (screen pixels)
- Removed on mouse-up

### Selection Highlighting

- Update the existing `gap-markers` layer paint with a `match` expression on osmId to highlight selected features
- Do NOT add a separate `gap-markers-selected` layer — `showGapsOnMap()` (line 178) removes and re-adds `gap-markers` layer each time, so a separate layer would be destroyed on re-render
- Paint update approach:
  ```typescript
  map.setPaintProperty("gap-markers", "circle-color", [
    "match", ["get", "osmId"],
    ...selectedOsmIds.flatMap(id => [id, "#facc15"]),
    "#f97316" // default orange
  ]);
  map.setPaintProperty("gap-markers", "circle-radius", [
    "match", ["get", "osmId"],
    ...selectedOsmIds.flatMap(id => [id, 8]),
    5 // default
  ]);
  ```

### Satellite Auto-Switch

- After selection, programmatically switch map style to satellite (reuse existing satellite tile source)
- Use `onStyleReady()` callback to re-add layers after style change
- **Important**: `onStyleReady` (in `useMapLibre.ts` line 241) stores a single callback in a ref. The existing callback (line 246 in GapDetection.tsx) resets `layersAdded`, re-adds territory layers, and calls `showGapsOnMap()`. The rectangle-select callback must **extend** this existing logic (add selection highlighting after `showGapsOnMap()` completes), not replace it. Wrap both in a single callback.
- **Stale closure prevention**: `selectedFeatures` changes frequently during use but `onStyleReady` stores a single callback in a ref. Accessing `selectedFeatures` directly via React state closure will be stale. Use a ref to hold the current value:
  ```typescript
  const selectedFeaturesRef = useRef<GeoJsonFeature[]>([]);
  useEffect(() => { selectedFeaturesRef.current = selectedFeatures; }, [selectedFeatures]);

  // In the onStyleReady callback:
  onStyleReady(() => {
    layersAdded.current = false;
    if (selectedRun) showGapsOnMap(selectedRun);
    // Access via ref, not state closure
    if (selectedFeaturesRef.current.length > 0) {
      applySelectionHighlight(selectedFeaturesRef.current.map(f => f.properties?.osmId));
    }
  });
  ```
- On Cancel/Ignore completion, switch back to Street view
- **Double-changeStyle race**: `changeStyle` registers a `styledata` listener per call with a 5s timeout cleanup. The satellite→street revert happens well within 5 seconds of the initial switch. Mitigate by adding a generation counter (or cancel ref) to the `changeStyle` handler so stale handlers from the first style change become no-ops when the second change fires. Implementation: store a `styleChangeGenRef` in `useMapLibre`, increment on each `changeStyle` call, capture the current generation in the handler closure, and skip execution if the generation has advanced.

### Confirmation Bar

- Floating bar positioned at bottom of map area (absolute, z-index above map)
- Contains:
  - Text: `"N buildings selected"`
  - Reason dropdown (same 8 `IGNORE_REASONS` already defined at line 34)
  - **Ignore** button (amber, calls bulk ignore)
  - **Cancel** button (ghost, clears selection)
- Default reason: first in list (Garage / Carport)

### State

New component state in GapDetection.tsx:

```typescript
const [isSelecting, setIsSelecting] = useState(false);
const [selectionStart, setSelectionStart] = useState<{x: number, y: number} | null>(null);
const [selectionEnd, setSelectionEnd] = useState<{x: number, y: number} | null>(null);
const [selectedFeatures, setSelectedFeatures] = useState<GeoJsonFeature[]>([]);
const [selectIgnoreReason, setSelectIgnoreReason] = useState(IGNORE_REASONS[0].value);
```

Note: Uses `GeoJsonFeature` from `hub-app/src/lib/territory-api.ts` (line 22), NOT `GeoJSON.Feature`.

### Preventing Click-Through on Selection

The existing `map.on("click", "gap-markers", handleClick)` (line 207) fires a popup on single-click. When Shift+drag ends, the mouseup event could also trigger this click handler. Prevention:

- Track `isSelecting` state via a ref (not just React state, for synchronous access in event handlers)
- While `isIgnoring` is true, early-return from the mousedown handler to prevent starting a new selection
- In the existing click handler, early-return if `isSelectingRef.current` was recently true
- Set a short flag (`justFinishedSelecting`) on mouseup, clear it on next animation frame
- This prevents the click event (which fires after mouseup) from opening a popup

### Error Handling

Wrap the `ignoreBuildings()` call in try/catch:
- On success: show toast with count of ignored buildings, clear selection, re-run gap detection
- On failure: show error toast ("Failed to ignore buildings — please try again"), keep selection active so user can retry
- Disable the Ignore button while the API call is in flight (`isIgnoring` state)

### MapInstance Interface Extensions

The `MapInstance` interface in `useMapLibre.ts` (line 12) does NOT include `queryRenderedFeatures`, `dragPan`, or `setPaintProperty`. These must be added:

```typescript
// Add to MapInstance interface in useMapLibre.ts
queryRenderedFeatures: (
  geometry?: [[number, number], [number, number]],
  options?: { layers?: string[] },
) => Array<{ properties: Record<string, unknown>; [key: string]: unknown }>;
dragPan: { enable: () => void; disable: () => void };
setPaintProperty: (layerId: string, name: string, value: unknown) => void;
```

### Selection State Lifecycle

- **Clear on run change**: When `selectedRunId` changes, clear `selectedFeatures` to prevent stale highlights from a previous run
- **Idempotent onStyleReady**: The `onStyleReady` callback may fire multiple times per style change (MapLibre `styledata` event fires per-source). Guard with `layersAdded.current` and only apply highlight if `selectedFeatures.length > 0`

### Edge Cases

- **Empty selection**: If rectangle contains no gap markers, show brief toast "No buildings in selection" and cancel
- **Shift+click (no drag)**: If mouse moves < 5px between mousedown and mouseup, treat as no selection (let existing click handler proceed)
- **Map pan disabled during drag**: Set `map.dragPan.disable()` on shift+mousedown, re-enable on mouseup
- **Style change preserves data**: After satellite switch, use `onStyleReady` callback to re-add `gaps` source/layers from stored GeoJSON and re-apply selection highlighting

## Files to Modify

| File | Change |
|------|--------|
| `hub-app/src/pages/territories/GapDetection.tsx` | Shift+drag handler, rectangle overlay, feature query, selection state, confirmation bar, satellite toggle |
| `hub-app/src/hooks/useMapLibre.ts` | Extend `MapInstance` interface with `queryRenderedFeatures`, `dragPan`, `setPaintProperty`; add generation counter to `changeStyle` to prevent stale handler race |

## Verification

1. Navigate to Lückenerkennung → Run Gap Detection
2. Hold Shift, drag rectangle over cluster of orange dots
3. Verify: selected buildings highlighted, map switches to satellite
4. Select reason "Shed / Barn", click Ignore
5. Verify: buildings disappear, uncovered count decreases
6. Re-run gap detection — ignored buildings stay excluded
7. Test Cancel — selection clears, map reverts, no changes
8. Test empty selection — toast message, no dialog
