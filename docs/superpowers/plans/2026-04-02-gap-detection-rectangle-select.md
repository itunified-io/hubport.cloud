# Gap Detection — Rectangle Select & Ignore Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Shift+drag rectangle selection on the gap detection map to bulk-ignore multiple uncovered buildings at once, with satellite verification.

**Architecture:** Frontend-only change. Extend the MapLibre `MapInstance` interface with 3 new methods, add a `changeStyle` generation counter to prevent stale handler races, then add rectangle selection logic + confirmation bar to `GapDetection.tsx`. No backend changes — the existing `ignoreBuildings()` API already accepts arrays.

**Tech Stack:** React, MapLibre GL JS, TypeScript

**Spec:** `docs/superpowers/specs/2026-04-02-gap-detection-rectangle-select-ignore-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `hub-app/src/hooks/useMapLibre.ts` | Modify | Extend `MapInstance` interface; add generation counter to `changeStyle` |
| `hub-app/src/pages/territories/GapDetection.tsx` | Modify | Rectangle selection, highlight, confirmation bar, satellite toggle, bulk ignore |

---

## Task 1: Extend MapInstance Interface

**Files:**
- Modify: `hub-app/src/hooks/useMapLibre.ts:12-35` (MapInstance interface)

- [ ] **Step 1: Add missing methods to MapInstance interface**

In `hub-app/src/hooks/useMapLibre.ts`, add to the `MapInstance` interface (after the existing `unproject` method at ~line 33):

```typescript
queryRenderedFeatures: (
  geometry?: [[number, number], [number, number]],
  options?: { layers?: string[] },
) => Array<{ properties: Record<string, unknown>; [key: string]: unknown }>;
dragPan: { enable: () => void; disable: () => void };
setPaintProperty: (layerId: string, name: string, value: unknown) => void;
```

- [ ] **Step 2: Add generation counter to changeStyle**

In `hub-app/src/hooks/useMapLibre.ts`, add a `styleChangeGenRef` near the other refs (~line 128):

```typescript
const styleChangeGenRef = useRef(0);
```

Then modify the `changeStyle` function (~line 229) to increment the generation and capture it in the handler closure:

```typescript
const changeStyle = useCallback(
  (key: string) => {
    const map = mapRef.current;
    if (!map || !MAP_STYLES[key]) return;
    setActiveStyle(key);
    map.setStyle(MAP_STYLES[key].url);

    // Increment generation — stale handlers from previous changeStyle calls become no-ops
    const gen = ++styleChangeGenRef.current;

    const handler = () => {
      if (styleChangeGenRef.current !== gen) return; // stale — skip
      if (styleReadyCb.current) styleReadyCb.current();
    };
    map.on("styledata", handler);
    setTimeout(() => map.off("styledata", handler), 5_000);
  },
  [],
);
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`

Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add hub-app/src/hooks/useMapLibre.ts
git commit -m "feat: extend MapInstance interface for rectangle selection (#NNN)"
```

---

## Task 2: Add Rectangle Selection State and Refs

**Files:**
- Modify: `hub-app/src/pages/territories/GapDetection.tsx:45-78` (state declarations)

- [ ] **Step 1: Add selection state variables**

After the existing state declarations (~line 77), add:

```typescript
// ─── Rectangle selection state ──────────────────────────────────
const [isSelecting, setIsSelecting] = useState(false);
const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
const [selectionEnd, setSelectionEnd] = useState<{ x: number; y: number } | null>(null);
const [selectedFeatures, setSelectedFeatures] = useState<GeoJsonFeature[]>([]);
const [selectIgnoreReason, setSelectIgnoreReason] = useState(IGNORE_REASONS[0].value);
const [isIgnoring, setIsIgnoring] = useState(false);

// Refs for synchronous access in map event handlers
const isSelectingRef = useRef(false);
const justFinishedSelectingRef = useRef(false);
const selectedFeaturesRef = useRef<GeoJsonFeature[]>([]);
const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
```

- [ ] **Step 2: Add ref sync effect**

After the state declarations, add:

```typescript
// Keep selectedFeatures ref in sync with state (for onStyleReady closure)
useEffect(() => {
  selectedFeaturesRef.current = selectedFeatures;
}, [selectedFeatures]);
```

- [ ] **Step 3: Clear selection on run change**

Find the existing `useEffect` that shows gaps when `selectedRunId` changes (~line 263):

```typescript
useEffect(() => {
  if (!selectedRun || !isLoaded) return;
  showGapsOnMap(selectedRun);
}, [selectedRunId]);
```

Add `setSelectedFeatures([])` at the start of this effect:

```typescript
useEffect(() => {
  setSelectedFeatures([]);
  if (!selectedRun || !isLoaded) return;
  showGapsOnMap(selectedRun);
}, [selectedRunId]);
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`

- [ ] **Step 5: Commit**

```bash
git add hub-app/src/pages/territories/GapDetection.tsx
git commit -m "feat: add rectangle selection state for gap detection (#NNN)"
```

---

## Task 3: Implement Selection Highlighting Helper

**Files:**
- Modify: `hub-app/src/pages/territories/GapDetection.tsx` (add helper function)

- [ ] **Step 1: Add applySelectionHighlight function**

After `showGapsOnMap()` (~line 203), add:

```typescript
/** Apply yellow highlight to selected gap markers via paint property expressions. */
function applySelectionHighlight(osmIds: string[]) {
  const map = mapRef.current;
  if (!map || !map.getLayer("gap-markers") || osmIds.length === 0) return;

  map.setPaintProperty("gap-markers", "circle-color", [
    "match",
    ["get", "osmId"],
    ...osmIds.flatMap((id) => [id, "#facc15"]),
    "#f97316", // default orange
  ]);
  map.setPaintProperty("gap-markers", "circle-radius", [
    "match",
    ["get", "osmId"],
    ...osmIds.flatMap((id) => [id, 8]),
    5, // default
  ]);
}

/** Reset gap marker paint to default (remove selection highlight). */
function clearSelectionHighlight() {
  const map = mapRef.current;
  if (!map || !map.getLayer("gap-markers")) return;
  map.setPaintProperty("gap-markers", "circle-color", "#f97316");
  map.setPaintProperty("gap-markers", "circle-radius", 5);
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/pages/territories/GapDetection.tsx
git commit -m "feat: add selection highlighting helpers for gap markers (#NNN)"
```

---

## Task 4: Implement Shift+Drag Mouse Handlers

**Files:**
- Modify: `hub-app/src/pages/territories/GapDetection.tsx` (add useEffect for mouse events)

- [ ] **Step 1: Add Shift+drag event handlers**

After the existing click handler `useEffect` (~line 241), add a new `useEffect` for rectangle selection:

```typescript
// ─── Rectangle selection: Shift+drag ────────────────────────────
useEffect(() => {
  const map = mapRef.current;
  if (!map || !isLoaded) return;
  const canvas = map.getCanvas();

  function handleMouseDown(e: MouseEvent) {
    if (!e.shiftKey || isIgnoring) return;
    e.preventDefault();
    e.stopPropagation();
    map!.dragPan.disable();
    const rect = canvas.getBoundingClientRect();
    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    selectionStartRef.current = point;
    setSelectionStart(point);
    setSelectionEnd(point);
    setIsSelecting(true);
    isSelectingRef.current = true;
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isSelectingRef.current) return;
    const rect = canvas.getBoundingClientRect();
    setSelectionEnd({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  function handleMouseUp(e: MouseEvent) {
    if (!isSelectingRef.current) return;
    isSelectingRef.current = false;
    setIsSelecting(false);
    map!.dragPan.enable();

    // Read start from ref (not React state) to avoid stale closure
    const start = selectionStartRef.current;
    const rect = canvas.getBoundingClientRect();
    const end = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    // If drag distance < 5px, treat as click (not selection)
    if (
      start &&
      Math.abs(end.x - start.x) < 5 &&
      Math.abs(end.y - start.y) < 5
    ) {
      setSelectionStart(null);
      setSelectionEnd(null);
      return;
    }

    if (!start) return;

    // Query features in screen-pixel bbox
    const sw: [number, number] = [
      Math.min(start.x, end.x),
      Math.max(start.y, end.y),
    ];
    const ne: [number, number] = [
      Math.max(start.x, end.x),
      Math.min(start.y, end.y),
    ];
    const features = map!.queryRenderedFeatures([sw, ne], {
      layers: ["gap-markers"],
    });

    // Clear rectangle overlay
    setSelectionStart(null);
    setSelectionEnd(null);

    if (features.length === 0) {
      // TODO: show toast "No buildings in selection"
      return;
    }

    // Convert to GeoJsonFeature array
    const geoFeatures: GeoJsonFeature[] = features.map((f) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [0, 0] }, // geometry not needed for ignore
      properties: f.properties,
    }));

    setSelectedFeatures(geoFeatures);
    setSelectIgnoreReason(IGNORE_REASONS[0].value);

    // Highlight selected markers
    const osmIds = features
      .map((f) => f.properties?.osmId as string)
      .filter(Boolean);
    applySelectionHighlight(osmIds);

    // Switch to satellite for visual verification
    if (activeStyle !== "satellite") {
      changeStyle("satellite");
    }

    // Prevent click handler from firing
    justFinishedSelectingRef.current = true;
    requestAnimationFrame(() => {
      justFinishedSelectingRef.current = false;
    });
  }

  canvas.addEventListener("mousedown", handleMouseDown);
  canvas.addEventListener("mousemove", handleMouseMove);
  canvas.addEventListener("mouseup", handleMouseUp);

  return () => {
    canvas.removeEventListener("mousedown", handleMouseDown);
    canvas.removeEventListener("mousemove", handleMouseMove);
    canvas.removeEventListener("mouseup", handleMouseUp);
  };
}, [mapRef, isLoaded, isIgnoring, activeStyle]);
```

- [ ] **Step 2: Guard existing click handler against selection**

In the existing click handler (`handleClick` at ~line 214), add an early return at the top:

```typescript
function handleClick(e: maplibregl.MapGeoJSONFeature) {
  // Don't open popup if we just finished a rectangle selection
  if (justFinishedSelectingRef.current) return;
  // ... existing code
}
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`

- [ ] **Step 4: Commit**

```bash
git add hub-app/src/pages/territories/GapDetection.tsx
git commit -m "feat: implement shift+drag rectangle selection for gap markers (#NNN)"
```

---

## Task 5: Update onStyleReady for Selection Persistence

**Files:**
- Modify: `hub-app/src/pages/territories/GapDetection.tsx:245-253` (onStyleReady callback)

- [ ] **Step 1: Extend onStyleReady callback**

Replace the existing `onStyleReady` effect (~line 245) with one that also re-applies selection highlighting:

```typescript
useEffect(() => {
  onStyleReady(() => {
    layersAdded.current = false;
    // Re-add territory boundary layers (fills, outlines, labels, congregation)
    addMapLayers();
    layersAdded.current = true;
    // Re-add gap markers for current run
    if (selectedRun) showGapsOnMap(selectedRun);
    // Re-apply selection highlighting if active (via ref to avoid stale closure)
    const currentFeatures = selectedFeaturesRef.current;
    if (currentFeatures.length > 0) {
      const osmIds = currentFeatures
        .map((f) => (f.properties?.osmId as string) ?? "")
        .filter(Boolean);
      applySelectionHighlight(osmIds);
    }
  });
}, [addMapLayers, showGapsOnMap, runs, selectedRunId]);
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/pages/territories/GapDetection.tsx
git commit -m "feat: persist selection highlighting across style changes (#NNN)"
```

---

## Task 6: Add Rectangle Overlay and Confirmation Bar UI

**Files:**
- Modify: `hub-app/src/pages/territories/GapDetection.tsx` (render section)

- [ ] **Step 1: Add rectangle overlay**

Inside the map container `<div>` (after the popup rendering at ~line 489), add the selection rectangle:

```tsx
{/* Rectangle selection overlay */}
{isSelecting && selectionStart && selectionEnd && (
  <div
    style={{
      position: "absolute",
      left: Math.min(selectionStart.x, selectionEnd.x),
      top: Math.min(selectionStart.y, selectionEnd.y),
      width: Math.abs(selectionEnd.x - selectionStart.x),
      height: Math.abs(selectionEnd.y - selectionStart.y),
      border: "2px solid #3b82f6",
      backgroundColor: "rgba(59, 130, 246, 0.15)",
      pointerEvents: "none",
      zIndex: 10,
    }}
  />
)}
```

- [ ] **Step 2: Add confirmation bar**

Below the rectangle overlay, add the confirmation bar:

```tsx
{/* Rectangle selection confirmation bar */}
{selectedFeatures.length > 0 && (
  <div className="absolute bottom-4 left-4 right-4 z-20 flex items-center gap-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] px-4 py-3 shadow-lg">
    <span className="text-sm font-medium whitespace-nowrap">
      {selectedFeatures.length} {intl.formatMessage({ id: "gap.buildings" })} selected
    </span>
    <select
      value={selectIgnoreReason}
      onChange={(e) => setSelectIgnoreReason(e.target.value)}
      className="flex-1 min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
    >
      {IGNORE_REASONS.map((r) => (
        <option key={r.value} value={r.value}>
          {r.label}
        </option>
      ))}
    </select>
    <button
      onClick={handleRectangleIgnore}
      disabled={isIgnoring}
      className="rounded-md bg-[var(--amber)] px-3 py-1.5 text-sm font-medium text-black hover:opacity-90 disabled:opacity-50 cursor-pointer"
    >
      {isIgnoring ? "…" : intl.formatMessage({ id: "gap.ignore" })}
    </button>
    <button
      onClick={handleRectangleCancel}
      className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:bg-[var(--glass)] cursor-pointer"
    >
      {intl.formatMessage({ id: "common.cancel" })}
    </button>
  </div>
)}
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`

- [ ] **Step 4: Commit**

```bash
git add hub-app/src/pages/territories/GapDetection.tsx
git commit -m "feat: add rectangle overlay and confirmation bar for bulk ignore (#NNN)"
```

---

## Task 7: Implement Bulk Ignore and Cancel Handlers

**Files:**
- Modify: `hub-app/src/pages/territories/GapDetection.tsx` (add handler functions)

- [ ] **Step 1: Add handleRectangleIgnore function**

After the existing `handleBulkIgnore` (~line 391), add:

```typescript
/** Handle bulk ignore from rectangle selection. */
async function handleRectangleIgnore() {
  if (!selectedRun || !user?.access_token || selectedFeatures.length === 0) return;
  setIsIgnoring(true);

  const buildings = selectedFeatures.map((f) => ({
    territoryId: selectedRun.territoryId,
    osmId: (f.properties?.osmId as string) ?? "",
    reason: selectIgnoreReason,
    lat: f.properties?.lat as number | undefined,
    lng: f.properties?.lng as number | undefined,
    streetAddress: f.properties?.streetAddress as string | undefined,
    buildingType: f.properties?.buildingType as string | undefined,
  }));

  try {
    const result = await ignoreBuildings(buildings, user.access_token);
    // Clear selection and revert to street view
    setSelectedFeatures([]);
    clearSelectionHighlight();
    if (activeStyle === "satellite") changeStyle("street");
    // Re-fetch runs to update counts (use existing fetchRuns for auto-select logic)
    await fetchRuns();
    // TODO: toast success — `${result.created.length} buildings ignored`
  } catch {
    // TODO: toast error — "Failed to ignore buildings — please try again"
    // Keep selection active so user can retry
  } finally {
    setIsIgnoring(false);
  }
}
```

- [ ] **Step 2: Add handleRectangleCancel function**

```typescript
/** Cancel rectangle selection — clear highlights, revert to street view. */
function handleRectangleCancel() {
  setSelectedFeatures([]);
  clearSelectionHighlight();
  if (activeStyle === "satellite") changeStyle("street");
}
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`

- [ ] **Step 4: Commit**

```bash
git add hub-app/src/pages/territories/GapDetection.tsx
git commit -m "feat: implement bulk ignore and cancel for rectangle selection (#NNN)"
```

---

## Task 8: Verify End-to-End

- [ ] **Step 1: Build hub-app**

```bash
cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app
```

- [ ] **Step 2: Verify by manual testing**

Follow the verification steps from the spec:
1. Navigate to Lückenerkennung → Run Gap Detection
2. Hold Shift, drag rectangle over cluster of orange dots
3. Verify: selected buildings highlighted, map switches to satellite
4. Select reason "Shed / Barn", click Ignore
5. Verify: buildings disappear, uncovered count decreases
6. Test Cancel — selection clears, map reverts, no changes
7. Test empty selection — toast message, no dialog
