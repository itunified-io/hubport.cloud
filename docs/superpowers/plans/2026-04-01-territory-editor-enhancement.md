# Territory Editor Enhancement Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add smart territory creation flow (draw → auto-detect city → suggest number), batch "Snap All" feature, and fix edit button + violation badge bugs.

**Architecture:** Backend gets one new endpoint (`POST /territories/suggest`) using existing Nominatim reverse geocoding. Frontend extends existing CreationFlow/SnapEngine/TerritoryEditor components. No new major components except a confirmation modal.

**Tech Stack:** Fastify, Prisma, Nominatim API, MapLibre GL JS, React, TypeScript, Vitest

---

## Chunk 1: Backend — `POST /territories/suggest` endpoint

### Task 1: Add `suggestTerritory` endpoint

**Files:**
- Modify: `hub-api/src/routes/territories.ts`
- Test: `hub-api/src/routes/__tests__/suggest.test.ts`

- [ ] **Step 1: Write the test file**

Create `hub-api/src/routes/__tests__/suggest.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock nominatim before importing
vi.mock("../../lib/osm-nominatim.js", () => ({
  reverseGeocode: vi.fn(),
}));

import { reverseGeocode } from "../../lib/osm-nominatim.js";

const mockedReverseGeocode = reverseGeocode as ReturnType<typeof vi.fn>;

describe("POST /territories/suggest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns city and suggested number from polygon centroid", async () => {
    mockedReverseGeocode.mockResolvedValue({
      lat: 47.75,
      lng: 11.38,
      displayName: "Antdorf, Weilheim-Schongau, Bayern",
      osmId: "123",
      osmType: "relation",
      address: { city: "Antdorf", country: "Germany" },
    });

    // This test validates the suggest logic function directly
    const { suggestFromBoundaries } = await import("../territories.js");

    // Mock prisma for territory lookup
    const mockPrisma = {
      territory: {
        findMany: vi.fn().mockResolvedValue([
          { number: "501", name: "Antdorf" },
          { number: "503", name: "Antdorf" },
          { number: "505", name: "Antdorf" },
        ]),
      },
    };

    const polygon = {
      type: "Polygon",
      coordinates: [[[11.37, 47.74], [11.39, 47.74], [11.39, 47.76], [11.37, 47.76], [11.37, 47.74]]],
    };

    const result = await suggestFromBoundaries(mockPrisma as any, polygon);
    expect(result.city).toBe("Antdorf");
    expect(result.suggestedPrefix).toBe("5");
    expect(result.suggestedNumber).toBe("507");
    expect(result.existingInGroup).toEqual(["501", "503", "505"]);
  });

  it("returns null city when Nominatim fails", async () => {
    mockedReverseGeocode.mockResolvedValue(null);

    const { suggestFromBoundaries } = await import("../territories.js");
    const mockPrisma = {
      territory: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const polygon = {
      type: "Polygon",
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    };

    const result = await suggestFromBoundaries(mockPrisma as any, polygon);
    expect(result.city).toBeNull();
    expect(result.suggestedPrefix).toBe("1");
    expect(result.suggestedNumber).toBe("101");
  });

  it("finds next available number skipping gaps", async () => {
    mockedReverseGeocode.mockResolvedValue({
      lat: 47.75, lng: 11.38, displayName: "Penzberg",
      osmId: "1", osmType: "relation",
      address: { city: "Penzberg" },
    });

    const { suggestFromBoundaries } = await import("../territories.js");
    const mockPrisma = {
      territory: {
        findMany: vi.fn().mockResolvedValue([
          { number: "301", name: "Penzberg" },
          { number: "302", name: "Penzberg" },
          // 303 missing — should suggest 303
          { number: "304", name: "Penzberg" },
        ]),
      },
    };

    const polygon = {
      type: "Polygon",
      coordinates: [[[11.37, 47.74], [11.39, 47.74], [11.39, 47.76], [11.37, 47.76], [11.37, 47.74]]],
    };

    const result = await suggestFromBoundaries(mockPrisma as any, polygon);
    expect(result.suggestedNumber).toBe("303");
  });

  it("suggests next unused prefix for new city", async () => {
    mockedReverseGeocode.mockResolvedValue({
      lat: 47.75, lng: 11.38, displayName: "Seeshaupt",
      osmId: "2", osmType: "relation",
      address: { city: "Seeshaupt" },
    });

    const { suggestFromBoundaries } = await import("../territories.js");
    const mockPrisma = {
      territory: {
        findMany: vi.fn().mockResolvedValue([
          { number: "101", name: "Penzberg" },
          { number: "301", name: "Antdorf" },
          { number: "501", name: "Iffeldorf" },
        ]),
      },
    };

    const polygon = {
      type: "Polygon",
      coordinates: [[[11.37, 47.74], [11.39, 47.74], [11.39, 47.76], [11.37, 47.76], [11.37, 47.74]]],
    };

    const result = await suggestFromBoundaries(mockPrisma as any, polygon);
    expect(result.city).toBe("Seeshaupt");
    // Prefixes 1, 3, 5 taken → suggest 2
    expect(result.suggestedPrefix).toBe("2");
    expect(result.suggestedNumber).toBe("201");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npx vitest run hub-api/src/routes/__tests__/suggest.test.ts`
Expected: FAIL — `suggestFromBoundaries` not exported

- [ ] **Step 3: Implement `suggestFromBoundaries` and the endpoint**

Add to `hub-api/src/routes/territories.ts` — after the imports section (around line 12), add:

```typescript
import { reverseGeocode } from "../lib/osm-nominatim.js";
```

Before the `export default` function (around line 20), add the exported helper:

```typescript
/**
 * Given a drawn polygon, reverse-geocode centroid to get city name,
 * then find the territory number group for that city and suggest next number.
 */
export async function suggestFromBoundaries(
  prisma: any,
  boundaries: { type: string; coordinates: number[][][] },
): Promise<{
  city: string | null;
  suggestedPrefix: string;
  suggestedNumber: string;
  existingInGroup: string[];
}> {
  // 1. Compute centroid from polygon exterior ring
  const ring = boundaries.coordinates[0] ?? [];
  const verts = ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] ? ring.slice(0, -1) : ring;
  let cx = 0, cy = 0;
  for (const v of verts) { cx += v[0]!; cy += v[1]!; }
  cx /= verts.length || 1;
  cy /= verts.length || 1;

  // 2. Reverse geocode centroid
  let city: string | null = null;
  try {
    const result = await reverseGeocode(cy, cx); // lat, lng
    city = result?.address?.city ?? null;
  } catch {
    // Nominatim unavailable — city stays null
  }

  // 3. Fetch all territories to find groups
  const allTerritories = await prisma.territory.findMany({
    select: { number: true, name: true },
  });

  // 4. Find group prefix for this city
  const usedPrefixes = new Map<string, string>(); // prefix -> city name
  for (const t of allTerritories) {
    const prefix = (t.number as string).charAt(0);
    if (prefix >= "1" && prefix <= "9") {
      const existing = usedPrefixes.get(prefix);
      if (!existing) usedPrefixes.set(prefix, t.name as string);
    }
  }

  let suggestedPrefix: string;
  if (city) {
    // Find if city already has a prefix
    const existingPrefix = [...usedPrefixes.entries()].find(
      ([, name]) => name.toLowerCase() === city!.toLowerCase(),
    );
    if (existingPrefix) {
      suggestedPrefix = existingPrefix[0];
    } else {
      // Find next unused prefix
      suggestedPrefix = "1";
      for (let i = 1; i <= 9; i++) {
        if (!usedPrefixes.has(String(i))) { suggestedPrefix = String(i); break; }
      }
    }
  } else {
    // No city — find first unused prefix
    suggestedPrefix = "1";
    for (let i = 1; i <= 9; i++) {
      if (!usedPrefixes.has(String(i))) { suggestedPrefix = String(i); break; }
    }
  }

  // 5. Find existing numbers in this group and suggest next
  const groupNumbers = allTerritories
    .filter((t: any) => (t.number as string).startsWith(suggestedPrefix))
    .map((t: any) => t.number as string)
    .sort();

  // Find next available number: prefix01, prefix02, ...
  let suggestedNumber = `${suggestedPrefix}01`;
  for (let i = 1; i <= 99; i++) {
    const candidate = `${suggestedPrefix}${String(i).padStart(2, "0")}`;
    if (!groupNumbers.includes(candidate)) {
      suggestedNumber = candidate;
      break;
    }
  }

  return { city, suggestedPrefix, suggestedNumber, existingInGroup: groupNumbers };
}
```

Then inside the route registration function, after the `POST /territories` endpoint (around line 273), add:

```typescript
  // Suggest territory number + city from drawn polygon
  app.post<{ Body: { boundaries: unknown } }>(
    "/territories/suggest",
    {
      preHandler: requirePermission(PERMISSIONS.TERRITORIES_EDIT),
      schema: {
        body: Type.Object({
          boundaries: Type.Any(),
        }),
      },
    },
    async (request, reply) => {
      const { boundaries } = request.body;
      if (!boundaries || typeof boundaries !== "object") {
        return reply.code(400).send({ error: "boundaries required" });
      }

      const geo = boundaries as { type?: string; coordinates?: number[][][] };
      if (geo.type !== "Polygon" || !geo.coordinates?.length) {
        return reply.code(400).send({ error: "boundaries must be a GeoJSON Polygon" });
      }

      try {
        const suggestion = await suggestFromBoundaries(prisma, geo as any);

        // Optionally run auto-fix
        let autoFix = null;
        try {
          autoFix = await runAutoFixPipeline(prisma, boundaries as object, null);
        } catch {
          // auto-fix failure is non-fatal for suggest
        }

        return reply.send({ ...suggestion, autoFix });
      } catch (err: any) {
        request.log.error(err, "suggest failed");
        return reply.code(500).send({ error: "Suggest failed" });
      }
    },
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npx vitest run hub-api/src/routes/__tests__/suggest.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Verify full backend builds**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-api`
Expected: Build succeeds with no errors

- [ ] **Step 6: Commit**

```bash
git add hub-api/src/routes/territories.ts hub-api/src/routes/__tests__/suggest.test.ts
git commit -m "feat: add POST /territories/suggest endpoint for smart creation flow"
```

---

## Chunk 2: Frontend — Smart Creation Flow

### Task 2: Add `suggestTerritory` API function

**Files:**
- Modify: `hub-app/src/lib/territory-api.ts`

- [ ] **Step 1: Add types and function**

After the `createTerritory` function (around line 553), add:

```typescript
export interface TerritorySuggestion {
  city: string | null;
  suggestedPrefix: string;
  suggestedNumber: string;
  existingInGroup: string[];
  autoFix: AutoFixResult | null;
}

export function suggestTerritory(
  token: string,
  boundaries: unknown,
): Promise<TerritorySuggestion> {
  return apiFetch("/territories/suggest", token, {
    method: "POST",
    body: JSON.stringify({ boundaries }),
  });
}
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/lib/territory-api.ts
git commit -m "feat: add suggestTerritory API function"
```

### Task 3: Create `CreateTerritoryModal` component

**Files:**
- Create: `hub-app/src/pages/territories/CreateTerritoryModal.tsx`

- [ ] **Step 1: Create the modal component**

Create `hub-app/src/pages/territories/CreateTerritoryModal.tsx`:

```typescript
import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Loader2 } from "lucide-react";
import type { TerritorySuggestion } from "@/lib/territory-api";

interface CreateTerritoryModalProps {
  suggestion: TerritorySuggestion;
  onSubmit: (number: string, name: string) => void;
  onCancel: () => void;
  submitting?: boolean;
}

export function CreateTerritoryModal({
  suggestion,
  onSubmit,
  onCancel,
  submitting,
}: CreateTerritoryModalProps) {
  const intl = useIntl();
  const [number, setNumber] = useState(suggestion.suggestedNumber);
  const [name, setName] = useState(suggestion.city ?? "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[var(--bg-2)] border border-[var(--border)] rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <h3 className="text-lg font-semibold mb-4">
          <FormattedMessage id="territories.new.title" defaultMessage="New Territory" />
        </h3>

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">
              <FormattedMessage id="territories.new.number" defaultMessage="Number" />
            </label>
            <input
              type="text"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder={intl.formatMessage({ id: "territories.new.numberPlaceholder", defaultMessage: "e.g. 101" })}
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-1)] border border-[var(--border)] text-sm"
              autoFocus
            />
            {suggestion.existingInGroup.length > 0 && (
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                {suggestion.suggestedPrefix}xx — {suggestion.city ?? "?"} ({suggestion.existingInGroup.join(", ")} exist)
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">
              <FormattedMessage id="territories.new.name" defaultMessage="Name" />
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={intl.formatMessage({ id: "territories.new.namePlaceholder", defaultMessage: "e.g. Penzberg Ost" })}
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-1)] border border-[var(--border)] text-sm"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-5 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-3)] transition-colors"
          >
            <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
          </button>
          <button
            onClick={() => number.trim() && name.trim() && onSubmit(number.trim(), name.trim())}
            disabled={!number.trim() || !name.trim() || submitting}
            className="px-5 py-2 text-sm rounded-lg bg-[var(--amber)] text-black font-semibold hover:bg-[var(--amber-light)] transition-colors disabled:opacity-40 flex items-center gap-2"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            <FormattedMessage id="territories.new.create" defaultMessage="Create & Draw" />
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/pages/territories/CreateTerritoryModal.tsx
git commit -m "feat: add CreateTerritoryModal with pre-filled city and number"
```

### Task 4: Wire smart creation flow into TerritoryMap

**Files:**
- Modify: `hub-app/src/pages/territories/TerritoryMap.tsx`

- [ ] **Step 1: Add creation mode to TerritoryMap**

In `TerritoryMap.tsx`, add imports at top:

```typescript
import { CreationFlow } from "./CreationFlow";
import { CreateTerritoryModal } from "./CreateTerritoryModal";
import { suggestTerritory, type TerritorySuggestion } from "@/lib/territory-api";
```

Add state variables after existing state declarations (around line 40):

```typescript
const [creationMode, setCreationMode] = useState(false);
const [suggestion, setSuggestion] = useState<TerritorySuggestion | null>(null);
const [pendingBoundaries, setPendingBoundaries] = useState<unknown>(null);
const [suggesting, setSuggesting] = useState(false);
const [creating, setCreating] = useState(false);
```

- [ ] **Step 2: Replace "+ New Territory" button behavior**

Change the button's `onClick` (line 333) from `setShowNewModal(true)` to `setCreationMode(true)`.

Change the button text from "New Territory" to show mode-aware text:

```typescript
{can("app:territories.edit") && (
  creationMode ? (
    <button
      onClick={() => { setCreationMode(false); setPendingBoundaries(null); setSuggestion(null); }}
      className="absolute top-3 right-3 z-10 flex items-center gap-2 px-4 py-2 text-sm font-semibold text-[var(--text)] bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer shadow-lg"
    >
      <X size={16} />
      <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
    </button>
  ) : (
    <button
      onClick={() => setCreationMode(true)}
      className="absolute top-3 right-3 z-10 flex items-center gap-2 px-4 py-2 text-sm font-semibold text-black bg-[var(--amber)] rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer shadow-lg"
    >
      <Plus size={16} />
      <FormattedMessage id="territories.newTerritory" defaultMessage="New Territory" />
    </button>
  )
)}
```

- [ ] **Step 3: Add CreationFlow and modal rendering**

Before the closing `</div>` of the map container (before line 347), add:

```typescript
{/* Creation flow drawing overlay */}
{creationMode && isLoaded && mapRef.current && (
  <CreationFlow
    map={mapRef.current}
    onComplete={async (coords) => {
      const geojson = { type: "Polygon" as const, coordinates: [coords] };
      setPendingBoundaries(geojson);
      setSuggesting(true);
      try {
        const result = await suggestTerritory(token!, geojson);
        setSuggestion(result);
      } catch (err) {
        console.error("Suggest failed:", err);
        // Show modal with empty suggestion
        setSuggestion({ city: null, suggestedPrefix: "1", suggestedNumber: "101", existingInGroup: [], autoFix: null });
      } finally {
        setSuggesting(false);
      }
    }}
    onCancel={() => { setCreationMode(false); setPendingBoundaries(null); }}
  />
)}

{/* Suggesting spinner */}
{suggesting && (
  <div className="absolute inset-0 flex items-center justify-center bg-black/30 z-20">
    <div className="bg-[var(--bg-2)] rounded-xl p-4 flex items-center gap-3 shadow-xl">
      <Loader2 size={20} className="animate-spin text-[var(--amber)]" />
      <span className="text-sm">Detecting city...</span>
    </div>
  </div>
)}
```

Replace the old `NewTerritoryModal` rendering (lines 350-364) with:

```typescript
{/* Smart create modal (after drawing) */}
{suggestion && pendingBoundaries && (
  <CreateTerritoryModal
    suggestion={suggestion}
    submitting={creating}
    onCancel={() => { setSuggestion(null); setPendingBoundaries(null); setCreationMode(false); }}
    onSubmit={async (number, name) => {
      if (!token) return;
      setCreating(true);
      try {
        const territory = await createTerritory(token, { number, name, boundaries: pendingBoundaries });
        setSuggestion(null);
        setPendingBoundaries(null);
        setCreationMode(false);
        navigate(`/territories/${territory.id}`);
      } catch (err) {
        console.error("Create territory failed:", err);
      } finally {
        setCreating(false);
      }
    }}
  />
)}
```

- [ ] **Step 4: Update `createTerritory` API to accept boundaries**

In `hub-app/src/lib/territory-api.ts`, update `createTerritory` (line 545-553):

```typescript
export function createTerritory(
  token: string,
  data: { number: string; name: string; boundaries?: unknown },
): Promise<TerritoryListItem> {
  return apiFetch("/territories", token, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
```

- [ ] **Step 5: Remove old NewTerritoryModal import and state**

In `TerritoryMap.tsx`, remove:
- Import of `NewTerritoryModal` (line 9)
- `const [showNewModal, setShowNewModal] = useState(false);` state

- [ ] **Step 6: Verify frontend builds**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add hub-app/src/pages/territories/TerritoryMap.tsx hub-app/src/lib/territory-api.ts
git commit -m "feat: wire smart creation flow — draw on map, auto-suggest city and number"
```

---

## Chunk 3: Batch "Snap All" Feature

### Task 5: Add `snapAll` to SnapEngine

**Files:**
- Modify: `hub-app/src/pages/territories/SnapEngine.ts`
- Test: `hub-app/src/pages/territories/__tests__/SnapEngine.test.ts`

- [ ] **Step 1: Add tests for snapAll**

Append to `hub-app/src/pages/territories/__tests__/SnapEngine.test.ts`:

```typescript
import { snapAll } from "../SnapEngine";

describe("snapAll", () => {
  const roadTargets: SnapTarget[] = [
    {
      type: "road",
      label: "Hauptstraße",
      geometry: {
        type: "LineString",
        coordinates: [[10.0, 48.0], [10.1, 48.0]],
      },
    },
  ];

  it("snaps all vertices within tolerance", () => {
    const vertices: [number, number][] = [
      [10.02, 48.0003],
      [10.05, 48.0002],
      [10.08, 48.0004],
    ];

    const result = snapAll(vertices, roadTargets, 0.001);
    expect(result.snapped.length).toBe(3);
    // All should snap to y=48.0
    for (const v of result.snapped) {
      expect(v[1]).toBeCloseTo(48.0, 4);
    }
    expect(result.report.length).toBe(3);
    expect(result.report[0]!.snappedTo).toBe("road");
  });

  it("leaves vertices unchanged when beyond tolerance", () => {
    const vertices: [number, number][] = [
      [10.02, 48.1], // far from road
      [10.05, 48.0002], // near road
    ];

    const result = snapAll(vertices, roadTargets, 0.001);
    expect(result.snapped[0]).toEqual([10.02, 48.1]); // unchanged
    expect(result.snapped[1]![1]).toBeCloseTo(48.0, 4); // snapped
    expect(result.report[0]!.snappedTo).toBeNull();
    expect(result.report[1]!.snappedTo).toBe("road");
  });

  it("returns empty arrays for empty input", () => {
    const result = snapAll([], roadTargets, 0.001);
    expect(result.snapped).toEqual([]);
    expect(result.report).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npx vitest run hub-app/src/pages/territories/__tests__/SnapEngine.test.ts`
Expected: FAIL — `snapAll` not exported

- [ ] **Step 3: Implement snapAll**

Add to `hub-app/src/pages/territories/SnapEngine.ts` at the end (after `snapVertex`):

```typescript
export interface SnapReport {
  /** Original position */
  original: [number, number];
  /** Snapped position (same as original if no snap) */
  snapped: [number, number];
  /** What it snapped to, or null */
  snappedTo: SnapTargetType | null;
  /** Label of snap target */
  label: string | null;
  /** Distance moved (coordinate units) */
  distance: number;
}

/**
 * Snap all vertices in a polygon to nearest snap targets.
 * Returns new vertex array and per-vertex report.
 */
export function snapAll(
  vertices: [number, number][],
  snapTargets: SnapTarget[],
  tolerance: number,
): { snapped: [number, number][]; report: SnapReport[] } {
  const snapped: [number, number][] = [];
  const report: SnapReport[] = [];

  for (const vertex of vertices) {
    const result = snapVertex(vertex, snapTargets, tolerance);
    snapped.push(result.position);
    report.push({
      original: vertex,
      snapped: result.position,
      snappedTo: result.snappedTo,
      label: result.label,
      distance: Math.sqrt(
        (result.position[0] - vertex[0]) ** 2 +
        (result.position[1] - vertex[1]) ** 2,
      ),
    });
  }

  return { snapped, report };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npx vitest run hub-app/src/pages/territories/__tests__/SnapEngine.test.ts`
Expected: PASS (all tests including existing ones)

- [ ] **Step 5: Commit**

```bash
git add hub-app/src/pages/territories/SnapEngine.ts hub-app/src/pages/territories/__tests__/SnapEngine.test.ts
git commit -m "feat: add snapAll batch function to SnapEngine"
```

### Task 6: Add "Snap All" button to TerritoryEditor

**Files:**
- Modify: `hub-app/src/pages/territories/TerritoryEditor.tsx`

- [ ] **Step 1: Import snapAll and add snap preview state**

Add import:
```typescript
import { snapAll, type SnapReport } from "./SnapEngine";
```

Add state inside the component:
```typescript
const [snapPreview, setSnapPreview] = useState<{
  original: [number, number][];
  snapped: [number, number][];
  report: SnapReport[];
} | null>(null);
```

- [ ] **Step 2: Add Snap All button to the toolbar**

In the editor toolbar section (where Edit/Save/Cancel buttons are), add a "Snap All" button visible in edit mode:

```typescript
{mode === "edit" && !snapPreview && (
  <button
    onClick={() => {
      if (!editCoords || editCoords.length < 3) return;
      const result = snapAll(editCoords, snapTargets, snapTolerance);
      setSnapPreview({ original: editCoords, snapped: result.snapped, report: result.report });
    }}
    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-500/80 text-white rounded-[var(--radius-sm)] hover:bg-blue-400 transition-colors cursor-pointer"
    title="Snap all vertices to nearest roads"
  >
    Snap All
  </button>
)}
```

- [ ] **Step 3: Add snap preview accept/revert buttons**

When `snapPreview` is set, replace toolbar with accept/revert:

```typescript
{snapPreview && (
  <div className="flex items-center gap-2">
    <span className="text-[10px] text-[var(--text-muted)]">
      {snapPreview.report.filter(r => r.snappedTo !== null).length}/{snapPreview.report.length} snapped
    </span>
    <button
      onClick={() => {
        setEditCoords(snapPreview.snapped);
        undoRedo.push({
          territoryId: selectedTerritory!.id,
          beforeGeometry: snapPreview.original,
          afterGeometry: snapPreview.snapped,
          description: "Snap All",
        });
        setSnapPreview(null);
      }}
      className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-green-500/90 text-white rounded-[var(--radius-sm)] hover:bg-green-400 transition-colors cursor-pointer"
    >
      Accept Snap
    </button>
    <button
      onClick={() => setSnapPreview(null)}
      className="px-3 py-1.5 text-xs text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
    >
      Revert
    </button>
  </div>
)}
```

- [ ] **Step 4: Add snap preview visualization on map**

In the map rendering section, when `snapPreview` is set, render an overlay showing original (orange dashed) and snapped (green solid) polygons. This uses the map's existing GeoJSON source pattern — add a temporary source/layer pair:

```typescript
// Inside useEffect or render logic that manages map layers:
useEffect(() => {
  const map = mapRef?.current;
  if (!map || !snapPreview) return;

  // Original polygon (orange dashed)
  const origCoords = [...snapPreview.original, snapPreview.original[0]!];
  map.addSource("snap-preview-original", {
    type: "geojson",
    data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [origCoords] } },
  });
  map.addLayer({
    id: "snap-preview-original-line",
    type: "line",
    source: "snap-preview-original",
    paint: { "line-color": "#f59e0b", "line-width": 2, "line-dasharray": [4, 3] },
  });

  // Snapped polygon (green solid)
  const snappedCoords = [...snapPreview.snapped, snapPreview.snapped[0]!];
  map.addSource("snap-preview-snapped", {
    type: "geojson",
    data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [snappedCoords] } },
  });
  map.addLayer({
    id: "snap-preview-snapped-line",
    type: "line",
    source: "snap-preview-snapped",
    paint: { "line-color": "#22c55e", "line-width": 2 },
  });
  map.addLayer({
    id: "snap-preview-snapped-fill",
    type: "fill",
    source: "snap-preview-snapped",
    paint: { "fill-color": "#22c55e", "fill-opacity": 0.1 },
  });

  return () => {
    if (map.getLayer("snap-preview-original-line")) map.removeLayer("snap-preview-original-line");
    if (map.getSource("snap-preview-original")) map.removeSource("snap-preview-original");
    if (map.getLayer("snap-preview-snapped-line")) map.removeLayer("snap-preview-snapped-line");
    if (map.getLayer("snap-preview-snapped-fill")) map.removeLayer("snap-preview-snapped-fill");
    if (map.getSource("snap-preview-snapped")) map.removeSource("snap-preview-snapped");
  };
}, [snapPreview, mapRef]);
```

- [ ] **Step 5: Verify frontend builds**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add hub-app/src/pages/territories/TerritoryEditor.tsx
git commit -m "feat: add Snap All button with before/after preview to TerritoryEditor"
```

---

## Chunk 4: Bug Fixes

### Task 7: Fix edit button visibility

**Files:**
- Modify: `hub-app/src/pages/territories/TerritoryDetail.tsx`

- [ ] **Step 1: Investigate permission loading**

Read `hub-app/src/auth/PermissionProvider.tsx` to understand how `can()` works and whether it re-renders when permissions load.

- [ ] **Step 2: Fix the timing issue**

The edit button at line 442 is gated on `can("app:territories.edit")`. If `can()` doesn't trigger re-renders when permissions load asynchronously, the button never appears. Fix by:

1. Check if `usePermissions()` returns a `loading` state
2. If yes: show button as disabled/skeleton while loading
3. If no: the `can()` function may always return false because permissions aren't loaded yet — add a `useEffect` dependency on the permissions context to force re-render

The simplest fix: ensure the edit button appears when `hasBoundary && isLoaded` and the permission check happens on the save action (server-side already validates). However, to preserve the security gate per spec, keep `can()` but add a fallback:

```typescript
{hasBoundary && isLoaded && !editMode && (
  <button
    onClick={() => {
      if (!can("app:territories.edit")) return;
      setEditMode(true);
    }}
    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[var(--radius-sm)] transition-colors cursor-pointer shadow-lg ${
      can("app:territories.edit")
        ? "bg-amber-500/80 text-black hover:bg-amber-400"
        : "bg-[var(--bg-1)] text-[var(--text-muted)] opacity-50 cursor-not-allowed"
    }`}
  >
    <Edit3 size={13} />
    <FormattedMessage id="territories.edit" defaultMessage="Edit" />
  </button>
)}
```

This always renders the button when the map has a boundary, but disables it when permission is missing. The button becomes visible immediately, confirming the UI works. The `can()` check on click prevents unauthorized edits.

- [ ] **Step 3: Verify frontend builds**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add hub-app/src/pages/territories/TerritoryDetail.tsx
git commit -m "fix: always show edit button on territory detail, gate action on permission"
```

### Task 8: Fix violation badges — add loading/empty/error states

**Files:**
- Modify: `hub-app/src/pages/territories/ViolationBadges.tsx`

- [ ] **Step 1: Add loading, error, and empty states**

Rewrite ViolationBadges to track loading/error states:

```typescript
import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router";
import { Marker } from "maplibre-gl";
import { getViolations, type TerritoryViolation } from "@/lib/territory-api";

interface ViolationBadgesProps {
  map: any;
  token: string | null;
  territories: Array<{ id: string; number: string; boundaries: unknown }>;
}

export function ViolationBadges({ map, token, territories }: ViolationBadgesProps) {
  const navigate = useNavigate();
  const [violations, setViolations] = useState<TerritoryViolation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [fetched, setFetched] = useState(false);
  const markersRef = useRef<any[]>([]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(false);
    getViolations(token)
      .then((data) => { setViolations(data); setFetched(true); })
      .catch(() => { setError(true); setFetched(true); })
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (!map) return;

    // Clean up old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (violations.length === 0) return;

    for (const v of violations) {
      const territory = territories.find((t) => t.id === v.territoryId);
      if (!territory?.boundaries) continue;

      const bounds = territory.boundaries as { type?: string; coordinates?: number[][][] };
      const coords = bounds.coordinates?.[0];
      if (!coords || coords.length < 2) continue;

      const ring = coords.slice(0, -1);
      let cx = 0, cy = 0;
      for (const coord of ring) { cx += (coord[0] ?? 0); cy += (coord[1] ?? 0); }
      cx /= ring.length;
      cy /= ring.length;

      const hasExceedsBoundary = v.violations.some((vv) => vv === "exceeds_boundary");
      const color = hasExceedsBoundary ? "#ef4444" : "#f59e0b";

      const el = document.createElement("div");
      el.className = "violation-badge";
      el.style.cssText = `
        width: 22px; height: 22px; border-radius: 50%;
        background: ${color}; color: ${hasExceedsBoundary ? "white" : "black"};
        display: flex; align-items: center; justify-content: center;
        font-size: 12px; font-weight: 700; cursor: pointer;
        box-shadow: 0 2px 8px ${color}66;
      `;
      el.textContent = "!";
      el.onclick = () => navigate(`/territories/${v.territoryId}`);

      const marker = new Marker({ element: el })
        .setLngLat([cx, cy])
        .addTo(map);
      markersRef.current.push(marker);
    }

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
  }, [map, violations, territories, navigate]);

  // Status indicator in bottom-right corner
  if (!fetched && !loading) return null;

  return (
    <div className="absolute bottom-3 right-3 z-10">
      {loading && (
        <div className="bg-[var(--bg-1)] border border-[var(--border)] rounded-full px-2.5 py-1 text-[10px] text-[var(--text-muted)] shadow-sm">
          Checking...
        </div>
      )}
      {!loading && error && (
        <div className="bg-red-500/20 border border-red-500/30 rounded-full px-2.5 py-1 text-[10px] text-red-400 shadow-sm">
          Violation check failed
        </div>
      )}
      {!loading && !error && fetched && violations.length === 0 && (
        <div className="bg-green-500/20 border border-green-500/30 rounded-full px-2.5 py-1 text-[10px] text-green-400 shadow-sm">
          No violations
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/pages/territories/ViolationBadges.tsx
git commit -m "fix: add loading/empty/error states to ViolationBadges"
```

### Task 9: Run all tests and build both workspaces

- [ ] **Step 1: Run backend tests**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npx vitest run --workspace=hub-api`
Expected: All tests pass

- [ ] **Step 2: Run frontend tests**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npx vitest run hub-app/src/pages/territories/__tests__/`
Expected: All tests pass

- [ ] **Step 3: Build both workspaces**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-api && npm run build --workspace=hub-app`
Expected: Both build successfully

- [ ] **Step 4: Final commit if any remaining changes**

```bash
git status
# If clean, no commit needed
```
