# Smart Resolve Triage Workflow — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Smart Resolve into a staged triage workflow where users review and classify uncertain buildings before gap resolution actions become available.

**Architecture:** New `BuildingOverride` Prisma model for user corrections. Override CRUD endpoints added to existing gap-detection routes. Frontend refactored from single scrollable sidebar to two-tab layout (Buildings + Gaps). Gap analysis engine applies overrides to severity classification and adds per-gap `unreviewedCount`.

**Tech Stack:** Prisma + PostgreSQL (data model), Fastify + TypeBox (API), React + TypeScript + MapLibre GL (frontend), react-intl (i18n)

**Spec:** `docs/superpowers/specs/2026-04-04-smart-resolve-triage-workflow-design.md`

---

## Chunk 1: Data Model + API

### Task 1: Add BuildingOverride Prisma model

**Files:**
- Modify: `hub-api/prisma/schema.prisma`

- [ ] **Step 1: Add BuildingOverride model to schema**

Add after the `IgnoredOsmBuilding` model:

```prisma
model BuildingOverride {
  id                String    @id @default(uuid())
  osmId             String    @unique
  overriddenType    String?
  overriddenAddress String?
  triageStatus      String    @default("unreviewed") /// unreviewed, confirmed_residential, ignored, needs_visit
  notes             String?
  reviewedBy        String?
  reviewedAt        DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
}
```

Note: `triageStatus` is a String (not Prisma enum) to avoid migrations when values change. Validated at application level.

- [ ] **Step 2: Verify schema is valid**

Run: `cd hub-api && npx prisma format`
Expected: Schema formatted without errors.

- [ ] **Step 3: Commit**

```bash
git add hub-api/prisma/schema.prisma
git commit -m "feat: add BuildingOverride model for triage workflow"
```

---

### Task 2: Add building type validation constants

**Files:**
- Modify: `hub-api/src/lib/gap-analysis.ts`

- [ ] **Step 1: Add shared building type sets and severity classifier**

Add below existing type sets at the top of the file. These will be used by both the gap analysis engine and the override validation:

```typescript
// ─── Shared severity classification (used by overrides + analysis) ───

export const ALLOWED_BUILDING_TYPES = new Set([
  // Residential (red)
  "house", "apartments", "residential", "detached", "semidetached_house", "terrace", "cabin",
  // Mixed (orange)
  "farm", "farm_auxiliary",
  // Non-residential (gray)
  "garage", "garages", "commercial", "industrial", "retail",
  "shed", "barn", "church", "public",
  "warehouse", "office", "school", "hospital", "hotel", "supermarket",
  "service", "construction", "boathouse", "cowshed", "ruins",
  "roof", "hut", "transformer_tower", "bridge", "bunker",
  "carport", "kiosk", "toilets", "pavilion", "greenhouse",
  // Uncertain (yellow)
  "yes", "unknown",
]);

export const RESIDENTIAL_TYPES_FULL = new Set([
  "house", "apartments", "residential", "detached", "semidetached_house", "terrace", "cabin",
]);
export const MIXED_TYPES_FULL = new Set(["farm", "farm_auxiliary"]);
export const IGNORABLE_TYPES_FULL = new Set([
  "garage", "garages", "commercial", "industrial", "retail",
  "shed", "barn", "church", "public",
  "warehouse", "office", "school", "hospital", "hotel", "supermarket",
  "service", "construction", "boathouse", "cowshed", "ruins",
  "roof", "hut", "transformer_tower", "bridge", "bunker",
  "carport", "kiosk", "toilets", "pavilion", "greenhouse",
]);

export type SeverityLevel = "high" | "medium" | "low" | "ignorable";

export function classifySeverity(
  effectiveType: string | undefined,
  effectiveHasAddress: boolean,
): SeverityLevel {
  if (!effectiveType || effectiveType === "unknown") return "low";
  if (RESIDENTIAL_TYPES_FULL.has(effectiveType)) return "high";
  if (MIXED_TYPES_FULL.has(effectiveType)) return "medium";
  if (effectiveType === "yes") return effectiveHasAddress ? "medium" : "low";
  if (IGNORABLE_TYPES_FULL.has(effectiveType)) return "ignorable";
  return "low";
}
```

- [ ] **Step 2: Commit**

```bash
git add hub-api/src/lib/gap-analysis.ts
git commit -m "feat: add shared severity classification constants and function"
```

---

### Task 3: Add override CRUD endpoints

**Files:**
- Modify: `hub-api/src/routes/gap-detection.ts`

- [ ] **Step 1: Add TypeBox schemas and imports**

At the top of the file, add import for the building type validation:

```typescript
import { ALLOWED_BUILDING_TYPES } from "../lib/gap-analysis.js";
```

Add schemas after existing schemas (after `OsmIdParams`):

```typescript
const TRIAGE_STATUSES = ["unreviewed", "confirmed_residential", "ignored", "needs_visit"] as const;

const OverrideBody = Type.Object({
  overriddenType: Type.Optional(Type.String()),
  overriddenAddress: Type.Optional(Type.String()),
  triageStatus: Type.Optional(Type.Union(TRIAGE_STATUSES.map(s => Type.Literal(s)))),
  notes: Type.Optional(Type.String()),
});
type OverrideBodyType = Static<typeof OverrideBody>;

const OverrideOsmIdParams = Type.Object({
  osmId: Type.String(),
});
type OverrideOsmIdParamsType = Static<typeof OverrideOsmIdParams>;

const BatchOverrideBody = Type.Object({
  overrides: Type.Array(
    Type.Object({
      osmId: Type.String(),
      overriddenType: Type.Optional(Type.String()),
      overriddenAddress: Type.Optional(Type.String()),
      triageStatus: Type.Optional(Type.Union(TRIAGE_STATUSES.map(s => Type.Literal(s)))),
      notes: Type.Optional(Type.String()),
    }),
    { minItems: 1, maxItems: 200 },
  ),
});
type BatchOverrideBodyType = Static<typeof BatchOverrideBody>;

const OverrideQuerystring = Type.Object({
  triageStatus: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 1000 })),
  offset: Type.Optional(Type.Number({ minimum: 0 })),
});
type OverrideQuerystringType = Static<typeof OverrideQuerystring>;
```

- [ ] **Step 2: Add GET /overrides endpoint**

Add inside the `gapDetectionRoutes` function, after the existing routes:

```typescript
  // ─── List building overrides ────────────────────────────────────
  app.get<{ Querystring: OverrideQuerystringType }>(
    "/territories/gap-detection/overrides",
    {
      preHandler: requirePermission(PERMISSIONS.GAP_DETECTION_VIEW),
      schema: { querystring: OverrideQuerystring },
    },
    async (request) => {
      const { triageStatus, limit = 200, offset = 0 } = request.query;
      const where = triageStatus ? { triageStatus } : {};

      const [overrides, total] = await Promise.all([
        prisma.buildingOverride.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          take: limit,
          skip: offset,
        }),
        prisma.buildingOverride.count({ where }),
      ]);

      return { overrides, total };
    },
  );
```

- [ ] **Step 3: Add PUT /overrides/:osmId endpoint**

```typescript
  // ─── Create/update building override ────────────────────────────
  app.put<{ Params: OverrideOsmIdParamsType; Body: OverrideBodyType }>(
    "/territories/gap-detection/overrides/:osmId",
    {
      preHandler: requirePermission(PERMISSIONS.GAP_DETECTION_RUN),
      schema: { params: OverrideOsmIdParams, body: OverrideBody },
    },
    async (request, reply) => {
      const osmId = decodeURIComponent(request.params.osmId);
      const { overriddenType, overriddenAddress, triageStatus, notes } = request.body;
      const publisherId = request.user?.sub ?? "system";

      // Validate building type if provided
      if (overriddenType && !ALLOWED_BUILDING_TYPES.has(overriddenType)) {
        return reply.code(400).send({ error: `Invalid building type: ${overriddenType}` });
      }

      const override = await prisma.buildingOverride.upsert({
        where: { osmId },
        create: {
          osmId,
          overriddenType: overriddenType ?? null,
          overriddenAddress: overriddenAddress ?? null,
          triageStatus: triageStatus ?? "unreviewed",
          notes: notes ?? null,
          reviewedBy: publisherId,
          reviewedAt: new Date(),
        },
        update: {
          ...(overriddenType !== undefined && { overriddenType }),
          ...(overriddenAddress !== undefined && { overriddenAddress }),
          ...(triageStatus !== undefined && { triageStatus }),
          ...(notes !== undefined && { notes }),
          reviewedBy: publisherId,
          reviewedAt: new Date(),
        },
      });

      return override;
    },
  );
```

- [ ] **Step 4: Add POST /overrides/batch endpoint**

```typescript
  // ─── Batch triage overrides ─────────────────────────────────────
  app.post<{ Body: BatchOverrideBodyType }>(
    "/territories/gap-detection/overrides/batch",
    {
      preHandler: requirePermission(PERMISSIONS.GAP_DETECTION_RUN),
      schema: { body: BatchOverrideBody },
    },
    async (request, reply) => {
      const publisherId = request.user?.sub ?? "system";

      // Validate all building types
      for (const item of request.body.overrides) {
        if (item.overriddenType && !ALLOWED_BUILDING_TYPES.has(item.overriddenType)) {
          return reply.code(400).send({ error: `Invalid building type: ${item.overriddenType}` });
        }
      }

      // Deduplicate: last entry wins
      const deduped = new Map<string, typeof request.body.overrides[0]>();
      for (const item of request.body.overrides) {
        deduped.set(item.osmId, item);
      }

      const results = await prisma.$transaction(
        Array.from(deduped.values()).map((item) =>
          prisma.buildingOverride.upsert({
            where: { osmId: item.osmId },
            create: {
              osmId: item.osmId,
              overriddenType: item.overriddenType ?? null,
              overriddenAddress: item.overriddenAddress ?? null,
              triageStatus: item.triageStatus ?? "unreviewed",
              notes: item.notes ?? null,
              reviewedBy: publisherId,
              reviewedAt: new Date(),
            },
            update: {
              ...(item.overriddenType !== undefined && { overriddenType: item.overriddenType }),
              ...(item.overriddenAddress !== undefined && { overriddenAddress: item.overriddenAddress }),
              ...(item.triageStatus !== undefined && { triageStatus: item.triageStatus }),
              ...(item.notes !== undefined && { notes: item.notes }),
              reviewedBy: publisherId,
              reviewedAt: new Date(),
            },
          }),
        ),
      );

      return { updated: results.length };
    },
  );
```

- [ ] **Step 5: Add DELETE /overrides/:osmId endpoint**

```typescript
  // ─── Delete building override ───────────────────────────────────
  app.delete<{ Params: OverrideOsmIdParamsType }>(
    "/territories/gap-detection/overrides/:osmId",
    {
      preHandler: requirePermission(PERMISSIONS.GAP_DETECTION_RUN),
      schema: { params: OverrideOsmIdParams },
    },
    async (request, reply) => {
      const osmId = decodeURIComponent(request.params.osmId);

      // Idempotent: 204 whether override exists or not
      await prisma.buildingOverride.deleteMany({ where: { osmId } });
      return reply.code(204).send();
    },
  );
```

- [ ] **Step 6: Commit**

```bash
git add hub-api/src/routes/gap-detection.ts
git commit -m "feat: add building override CRUD endpoints for triage workflow"
```

---

### Task 4: Update gap analysis engine with override support

**Files:**
- Modify: `hub-api/src/lib/gap-analysis.ts`

- [ ] **Step 1: Update runGapAnalysis to load and apply overrides**

In `runGapAnalysis`, after loading ignored buildings (step 4), add:

```typescript
  // Step 4b: Load building overrides
  const overrideRows = await prisma.buildingOverride.findMany();
  const overrideMap = new Map(overrideRows.map((r: { osmId: string; overriddenType: string | null; overriddenAddress: string | null; triageStatus: string }) => [r.osmId, r]));
```

Then update the building classification inside the gap loop. Replace `const residentialCount = gapBuildings.filter(isResidential).length;` with:

```typescript
    // Classify buildings using overrides
    let residentialCount = 0;
    let unreviewedCount = 0;

    for (const b of gapBuildings) {
      const override = overrideMap.get(b.osmId);
      const effectiveType = override?.overriddenType ?? b.buildingType ?? "unknown";
      const effectiveHasAddress = (override?.overriddenAddress != null) || b.hasAddress;
      const severity = classifySeverity(effectiveType, effectiveHasAddress);

      // Triage-based counting
      if (override?.triageStatus === "ignored" || override?.triageStatus === "needs_visit") {
        // Excluded from residential count
      } else if (override?.triageStatus === "confirmed_residential") {
        residentialCount++;
      } else if (severity === "high" || severity === "medium") {
        residentialCount++;
      } else if (severity === "low") {
        // Unreviewed uncertain — excluded from count, tracked for gate
        unreviewedCount++;
      }
      // severity === "ignorable" → excluded
    }
```

- [ ] **Step 2: Add unreviewedCount to GapAnalysis interface**

Update the `GapAnalysis` interface:

```typescript
export interface GapAnalysis {
  gapId: string;
  gapPolygon: object;
  areaMeter2: number;
  residentialCount: number;
  totalBuildingCount: number;
  unreviewedCount: number;  // NEW
  recommendation: "new_territory" | "expand_neighbors";
  neighborAssignments: NeighborAssignment[];
}
```

And add `unreviewedCount` to the gap result push:

```typescript
    gapResults.push({
      gapId: randomUUID(),
      gapPolygon: gap.geojson,
      areaMeter2: gap.areaMeter2,
      residentialCount,
      totalBuildingCount,
      unreviewedCount,  // NEW
      recommendation,
      neighborAssignments,
    });
```

- [ ] **Step 3: Commit**

```bash
git add hub-api/src/lib/gap-analysis.ts
git commit -m "feat: apply building overrides to gap analysis classification"
```

---

### Task 5: Add frontend API client functions

**Files:**
- Modify: `hub-app/src/lib/territory-api.ts`

- [ ] **Step 1: Add types**

```typescript
export type TriageStatus = "unreviewed" | "confirmed_residential" | "ignored" | "needs_visit";

export interface BuildingOverride {
  id: string;
  osmId: string;
  overriddenType: string | null;
  overriddenAddress: string | null;
  triageStatus: TriageStatus;
  notes: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BuildingOverridesResponse {
  overrides: BuildingOverride[];
  total: number;
}

export interface OverrideInput {
  overriddenType?: string;
  overriddenAddress?: string;
  triageStatus?: TriageStatus;
  notes?: string;
}

export interface BatchOverrideInput {
  osmId: string;
  overriddenType?: string;
  overriddenAddress?: string;
  triageStatus?: TriageStatus;
  notes?: string;
}
```

- [ ] **Step 2: Add API functions**

```typescript
export function fetchBuildingOverrides(
  token: string,
  options?: { triageStatus?: TriageStatus; limit?: number; offset?: number },
): Promise<BuildingOverridesResponse> {
  const params = new URLSearchParams();
  if (options?.triageStatus) params.set("triageStatus", options.triageStatus);
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.offset) params.set("offset", String(options.offset));
  const qs = params.toString();
  return apiFetch(`/territories/gap-detection/overrides${qs ? `?${qs}` : ""}`, token);
}

export function upsertBuildingOverride(
  token: string,
  osmId: string,
  data: OverrideInput,
): Promise<BuildingOverride> {
  return apiFetch(`/territories/gap-detection/overrides/${encodeURIComponent(osmId)}`, token, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function batchOverrides(
  token: string,
  overrides: BatchOverrideInput[],
): Promise<{ updated: number }> {
  return apiFetch("/territories/gap-detection/overrides/batch", token, {
    method: "POST",
    body: JSON.stringify({ overrides }),
  });
}

export function deleteBuildingOverride(
  token: string,
  osmId: string,
): Promise<void> {
  return apiFetch(`/territories/gap-detection/overrides/${encodeURIComponent(osmId)}`, token, {
    method: "DELETE",
  });
}
```

- [ ] **Step 3: Update GapAnalysisItem to include unreviewedCount**

In the existing `GapAnalysisItem` interface, add:

```typescript
  unreviewedCount: number;
```

- [ ] **Step 4: Commit**

```bash
git add hub-app/src/lib/territory-api.ts
git commit -m "feat: add building override API client functions"
```

---

## Chunk 2: Frontend — Tab Layout + Building Triage

### Task 6: Create BuildingTriageList component

**Files:**
- Create: `hub-app/src/components/territories/BuildingTriageList.tsx`

- [ ] **Step 1: Create the component**

This component renders the enhanced building list with inline triage actions. It receives the building features from the gap detection run and the overrides map, and provides callbacks for triage actions.

Key features:
- Severity-colored dot per building (using override-aware classification)
- Clickable type chip → dropdown of allowed building types
- Clickable address → inline text input
- Triage action icons: ✅ confirm, 🚫 ignore, 👁 needs visit
- Status badge for already-triaged items (clickable to change)
- Bulk select checkboxes + batch toolbar
- Filter by triage status dropdown
- "Edited" indicator when override differs from OSM

The component should import `ALLOWED_BUILDING_TYPES` equivalent constants from a shared location. Since the frontend can't import from hub-api, define the same constants in a new utility:

Create the building type constants inline in the component (they mirror the backend sets):

```typescript
const RESIDENTIAL_TYPES = new Set([
  "house", "apartments", "residential", "detached", "semidetached_house", "terrace", "cabin",
]);
const MIXED_TYPES = new Set(["farm", "farm_auxiliary"]);
const IGNORABLE_TYPES = new Set([
  "garage", "garages", "commercial", "industrial", "retail",
  "shed", "barn", "church", "public",
  "warehouse", "office", "school", "hospital", "hotel", "supermarket",
  "service", "construction", "boathouse", "cowshed", "ruins",
  "roof", "hut", "transformer_tower", "bridge", "bunker",
  "carport", "kiosk", "toilets", "pavilion", "greenhouse",
]);
```

Props interface:

```typescript
interface BuildingTriageListProps {
  features: GeoJsonFeature[];
  overrides: Map<string, BuildingOverride>;
  token: string;
  onOverrideChange: (osmId: string, override: BuildingOverride) => void;
  onBatchOverride: (osmIds: string[], triageStatus: TriageStatus) => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
}
```

Implement as a scrollable list with the building items described in the spec. Each list item shows:
- Checkbox for bulk select
- Severity color dot (computed from effective type with override applied)
- OSM ID
- Type chip (clickable → dropdown)
- Address (clickable → inline edit)
- Triage action buttons or status badge

Use FormattedMessage for all user-visible strings. Note: this project uses `defaultMessage` as the primary mechanism — no separate i18n JSON files. German translations are handled via the existing intl provider config.

**Sorting:** Items should be sorted by: (1) unreviewed uncertain (yellow) first, (2) unreviewed non-uncertain, (3) confirmed, (4) needs visit, (5) ignored (grayed out, at bottom). Within each group, sort by building type name.

- [ ] **Step 2: Commit**

```bash
git add hub-app/src/components/territories/BuildingTriageList.tsx
git commit -m "feat: add BuildingTriageList component with inline triage actions"
```

---

### Task 7: Refactor GapDetection.tsx to tab layout

**Files:**
- Modify: `hub-app/src/pages/territories/GapDetection.tsx`

- [ ] **Step 1: Add tab state and override state**

Add state for tabs and overrides:

```typescript
const [activeTab, setActiveTab] = useState<"buildings" | "gaps">("buildings");
const [overrides, setOverrides] = useState<Map<string, BuildingOverride>>(new Map());
const [statusFilter, setStatusFilter] = useState("all");
```

Add an effect to load overrides on mount and after detection runs:

```typescript
const loadOverrides = useCallback(async () => {
  if (!token) return;
  try {
    const data = await fetchBuildingOverrides(token, { limit: 1000 });
    setOverrides(new Map(data.overrides.map(o => [o.osmId, o])));
  } catch { /* ignore */ }
}, [token]);

useEffect(() => { loadOverrides(); }, [loadOverrides]);
```

- [ ] **Step 2: Add override handlers**

```typescript
const handleOverrideChange = useCallback(async (osmId: string, override: BuildingOverride) => {
  setOverrides(prev => new Map(prev).set(osmId, override));
}, []);

const handleBatchOverride = useCallback(async (osmIds: string[], triageStatus: TriageStatus) => {
  if (!token) return;
  try {
    await batchOverrides(token, osmIds.map(osmId => ({ osmId, triageStatus })));
    await loadOverrides();
  } catch { /* ignore */ }
}, [token, loadOverrides]);
```

- [ ] **Step 3: Restructure sidebar JSX to use tabs**

Replace the current single-column sidebar with a tab layout. The global actions (Run Detection, Populate Addresses, stats row, coverage bar) stay above the tab bar. Below is the tab bar with two tabs, then conditional content:

```tsx
{/* Tab bar */}
<div className="flex border-b border-[var(--border)]">
  <button
    onClick={() => setActiveTab("buildings")}
    className={`flex-1 py-2 text-xs font-medium text-center transition-colors ${
      activeTab === "buildings"
        ? "text-[var(--text)] border-b-2 border-[var(--amber)]"
        : "text-[var(--text-muted)] hover:text-[var(--text)]"
    }`}
  >
    <FormattedMessage id="gap.tab.buildings" defaultMessage="Buildings" />
    {unreviewedCount > 0 && (
      <span className="ml-1.5 px-1.5 py-0.5 text-[9px] rounded-full bg-[var(--amber)]/10 text-[var(--amber)]">
        {unreviewedCount}
      </span>
    )}
  </button>
  <button
    onClick={() => setActiveTab("gaps")}
    className={`flex-1 py-2 text-xs font-medium text-center transition-colors ${
      activeTab === "gaps"
        ? "text-[var(--text)] border-b-2 border-[var(--amber)]"
        : "text-[var(--text-muted)] hover:text-[var(--text)]"
    }`}
  >
    <FormattedMessage id="gap.tab.gaps" defaultMessage="Gaps" />
    {gapCount > 0 && (
      <span className="ml-1.5 px-1.5 py-0.5 text-[9px] rounded-full bg-[var(--amber)]/10 text-[var(--amber)]">
        {gapCount}
      </span>
    )}
  </button>
</div>
```

- [ ] **Step 4: Move building list to Buildings tab**

The existing building list (severity chips, building rows with checkboxes, ignore actions) moves into the `activeTab === "buildings"` section. Add the triage progress bar above the list and integrate `BuildingTriageList`:

```tsx
{activeTab === "buildings" && (
  <div className="flex-1 overflow-y-auto">
    {/* Triage progress bar */}
    {unreviewedCount > 0 && (
      <div className="px-4 py-2">
        <div className="flex justify-between text-[9px] text-[var(--text-muted)] mb-1">
          <span>{reviewedCount}/{totalUncertainCount} uncertain reviewed</span>
        </div>
        <div className="h-1 bg-[var(--glass)] rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--amber)] rounded-full transition-all"
            style={{ width: `${(reviewedCount / totalUncertainCount) * 100}%` }}
          />
        </div>
      </div>
    )}
    <BuildingTriageList
      features={currentFeatures}
      overrides={overrides}
      token={token}
      onOverrideChange={handleOverrideChange}
      onBatchOverride={handleBatchOverride}
      statusFilter={statusFilter}
      onStatusFilterChange={setStatusFilter}
    />
  </div>
)}
```

- [ ] **Step 5: Move GapResolutionSection to Gaps tab**

```tsx
{activeTab === "gaps" && (
  <div className="flex-1 overflow-y-auto">
    <GapResolutionSection
      token={token}
      onGapPolygonsChange={handleGapPolygonsChange}
      onResolved={handleGapResolved}
      onHighlightGap={handleHighlightGap}
      overrides={overrides}
    />
  </div>
)}
```

- [ ] **Step 6: Compute triage progress values**

Add a `useMemo` to compute the triage progress from the current features and overrides:

```typescript
const { unreviewedCount, reviewedCount, totalUncertainCount } = useMemo(() => {
  if (!currentFeatures.length) return { unreviewedCount: 0, reviewedCount: 0, totalUncertainCount: 0 };

  let uncertain = 0;
  let reviewed = 0;

  for (const f of currentFeatures) {
    const osmId = f.properties.osmId as string;
    const override = overrides.get(osmId);
    const effectiveType = override?.overriddenType ?? (f.properties.buildingType as string) ?? "unknown";
    const effectiveHasAddress = (override?.overriddenAddress != null) || !!(f.properties.streetAddress);

    // Classify severity — reuse the same sets defined in BuildingTriageList / GapDetection
    const isYellow = !SEVERITY_HIGH_TYPES.has(effectiveType)
      && !SEVERITY_MEDIUM_TYPES.has(effectiveType)
      && !SEVERITY_IGNORABLE_TYPES.has(effectiveType)
      && !(effectiveType === "yes" && effectiveHasAddress);

    // Note: SEVERITY_HIGH_TYPES, SEVERITY_MEDIUM_TYPES, SEVERITY_IGNORABLE_TYPES
    // are the existing constants already defined at the top of GapDetection.tsx

    if (isYellow) {
      uncertain++;
      if (override && override.triageStatus !== "unreviewed") {
        reviewed++;
      }
    }
  }

  return { unreviewedCount: uncertain - reviewed, reviewedCount: reviewed, totalUncertainCount: uncertain };
}, [currentFeatures, overrides]);
```

- [ ] **Step 7: Commit**

```bash
git add hub-app/src/pages/territories/GapDetection.tsx
git commit -m "feat: refactor gap detection sidebar to two-tab layout"
```

---

### Task 8: Update GapResolutionSection with triage gate

**Files:**
- Modify: `hub-app/src/components/territories/GapResolutionSection.tsx`

- [ ] **Step 1: Add overrides prop and triage gate**

Update the props interface:

```typescript
interface GapResolutionSectionProps {
  token: string;
  onGapPolygonsChange: (polygons: object[]) => void;
  onResolved: () => void;
  onHighlightGap: (polygon: object | null) => void;
  overrides: Map<string, BuildingOverride>;  // NEW
}
```

- [ ] **Step 2: Show unreviewedCount per gap card**

In the gap card rendering, add triage gate UI. If `gap.unreviewedCount > 0`:
- Show message: "{N} uncertain buildings remaining"
- Primary resolution buttons disabled
- Add secondary "Force resolve (N unreviewed)" text button

```tsx
{gap.unreviewedCount > 0 && !isResolved && (
  <div className="text-[9px] text-[var(--amber)] flex items-center gap-1 px-1.5 py-1 rounded bg-[var(--amber)]/5">
    <AlertCircle size={10} />
    <FormattedMessage
      id="gap.unreviewedRemaining"
      defaultMessage="{count} uncertain buildings remaining"
      values={{ count: gap.unreviewedCount }}
    />
  </div>
)}
```

Disable primary action buttons (Create Territory, Expand Neighbors) when `gap.unreviewedCount > 0` by adding `disabled={gap.unreviewedCount > 0}` to both buttons.

Add force-resolve variant that shows both actions but de-emphasized:

```tsx
{gap.unreviewedCount > 0 && !isResolved && !isResolving && !showForm && (
  <div className="text-center pt-1">
    <span className="text-[9px] text-[var(--text-muted)]">
      <FormattedMessage
        id="gap.forceResolve"
        defaultMessage="Force resolve ({count} unreviewed):"
        values={{ count: gap.unreviewedCount }}
      />
    </span>
    <div className="flex gap-1.5 mt-1">
      <button onClick={() => setNewTerritoryForm({ gapId: gap.gapId, name: "", number: "" })}
        className="flex-1 py-1 text-[9px] text-[var(--text-muted)] hover:text-[var(--text)] border border-[var(--border)] rounded-[var(--radius-sm)] cursor-pointer">
        <Plus size={8} className="inline mr-0.5" />New
      </button>
      <button onClick={() => handleExpandNeighbors(gap)}
        disabled={gap.neighborAssignments.length === 0}
        className="flex-1 py-1 text-[9px] text-[var(--text-muted)] hover:text-[var(--text)] border border-[var(--border)] rounded-[var(--radius-sm)] cursor-pointer disabled:opacity-40">
        <ArrowUpRight size={8} className="inline mr-0.5" />Expand
      </button>
    </div>
  </div>
)}
```

Also add a "View buildings" link per gap card that switches to Buildings tab filtered by gap:

```tsx
<button
  onClick={() => { /* switch to buildings tab, pass gap polygon for filtering */ }}
  className="text-[9px] text-[var(--amber)] hover:underline cursor-pointer"
>
  <FormattedMessage id="gap.viewBuildings" defaultMessage="View buildings →" />
</button>
```

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/components/territories/GapResolutionSection.tsx
git commit -m "feat: add triage gate to gap resolution section"
```

---

## Chunk 3: Build, Deploy, Verify

### Task 9: Build and deploy

**Files:**
- Modify: `package.json` (version bump)

- [ ] **Step 1: Bump version**

Update `package.json` version to next CalVer.

- [ ] **Step 2: Build Docker image**

```bash
docker buildx build --platform linux/arm64 --push \
  -t ghcr.io/itunified-io/hubport.cloud:<version> \
  -t ghcr.io/itunified-io/hubport.cloud:latest .

Note: Tenant server is arm64 (Mac). Use `linux/arm64` only for faster builds during development. For production releases, use `linux/amd64,linux/arm64` per ADR-0070.
```

- [ ] **Step 3: Clean up Docker cache**

```bash
docker image prune -f && docker buildx prune --keep-storage=2GB -f
```

- [ ] **Step 4: Deploy to tenant stack**

```bash
cd ~/hubport.cloud/penzberg-north-uat
docker compose pull hubport && docker compose up -d hubport
```

- [ ] **Step 5: Purge CF cache**

Purge the hubport.cloud zone cache.

- [ ] **Step 6: Verify container health**

Check logs: `docker logs --tail 10 penzberg-north-uat-hubport-1`

- [ ] **Step 7: Commit version bump if not already committed**

---

### Task 10: Manual verification

- [ ] **Step 1: Run detection** → verify buildings show with severity colors
- [ ] **Step 2: Verify tab layout** → Buildings and Gaps tabs visible, switching works
- [ ] **Step 3: Click type chip** on yellow building → dropdown opens, select "house" → turns red
- [ ] **Step 4: Click address placeholder** → type address → saves, "edited" indicator shows
- [ ] **Step 5: Click triage icons** → confirm/ignore/needs-visit works, status badge shows
- [ ] **Step 6: Bulk select** → batch toolbar appears, "Ignore All" works
- [ ] **Step 7: Triage progress bar** → updates as buildings are reviewed
- [ ] **Step 8: Switch to Gaps tab** → gap cards show accurate residential counts
- [ ] **Step 9: Unreviewed gate** → resolution buttons disabled when uncertain buildings remain
- [ ] **Step 10: Force resolve** → secondary button works to bypass gate, both Create Territory and Expand Neighbors available
- [ ] **Step 11: IgnoredOsmBuilding precedence** → building in both `IgnoredOsmBuilding` and `BuildingOverride` is hard-removed from results (override irrelevant)
- [ ] **Step 12: Building list sorting** → ignored items appear at the bottom, unreviewed uncertain at the top
