# Territory Polygon Fixes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 territory polygon bugs (boundary clipping, overlap detection, edit button, new territory creation) and add versioning, RBAC fix, and migration.

**Architecture:** Server-authoritative PostGIS pipeline via `$queryRaw`/`$executeRaw` tagged templates. Auto-fix runs on every boundary save: validate → congregation clip → neighbor clip → overlap detect. Preview endpoint for dry-run. Non-destructive version history.

**Tech Stack:** PostGIS 3.4, Prisma, Fastify, MapLibre GL JS, React, TypeScript

**Spec:** `docs/superpowers/specs/2026-04-01-territory-polygon-fixes-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `hub-api/prisma/schema.prisma` | Modify | Add TerritoryBoundaryVersion model |
| `hub-api/src/lib/postgis-helpers.ts` | Modify | Add clipToCongregation, clipToNeighbors, detectOverlaps, runAutoFixPipeline |
| `hub-api/src/lib/seed-roles.ts` | Modify | Add Territory Servant role |
| `hub-api/src/lib/permissions.ts` | Modify | Add territory_servant to FLAG_TO_APP_ROLE |
| `hub-api/src/routes/territories.ts` | Modify | Add preview-fix, violations, versions, restore endpoints; modify PUT/POST with auto-fix |
| `hub-api/src/routes/publishers.ts` | Modify | Add GET /publishers/:id/roles endpoint |
| `hub-api/prisma/seed.ts` | Modify | Add v1 snapshot bootstrap for existing territories |
| `hub-app/src/lib/territory-api.ts` | Modify | Add previewFix, getViolations, getVersions, restoreVersion API functions |
| `hub-app/src/pages/territories/TerritoryDetail.tsx` | Modify | Add Edit button, version dropdown, wire TerritoryEditor + CreationFlow |
| `hub-app/src/pages/territories/TerritoryMap.tsx` | Modify | Wire New Territory modal + violation badges |
| `hub-app/src/pages/territories/AutoFixPreview.tsx` | Create | Preview dialog showing original vs clipped overlay |
| `hub-app/src/pages/territories/ViolationBadges.tsx` | Create | Map overlay component for violation warning badges |
| `hub-app/src/pages/territories/VersionHistory.tsx` | Create | Version dropdown component with restore action |
| `hub-app/src/pages/territories/NewTerritoryModal.tsx` | Create | Modal for entering number + name when creating territory |

---

## Chunk 1: Backend Foundation (Schema, PostGIS, RBAC)

### Task 1: Add TerritoryBoundaryVersion Prisma Model

**Files:**
- Modify: `hub-api/prisma/schema.prisma` (Territory model ~line 249, add new model after line 267)

- [ ] **Step 1: Add TerritoryBoundaryVersion model to schema**

In `hub-api/prisma/schema.prisma`, add after the Territory model (after the closing `}` around line 267):

```prisma
model TerritoryBoundaryVersion {
  id            String   @id @default(uuid())
  territoryId   String
  version       Int
  boundaries    Json
  changeType    String   // "creation" | "manual_edit" | "auto_clip" | "import" | "restore"
  changeSummary String?
  createdAt     DateTime @default(now())

  territory     Territory @relation(fields: [territoryId], references: [id], onDelete: Cascade)

  @@index([territoryId, version])
}
```

Add to the Territory model's relations (inside the Territory model block):

```prisma
  boundaryVersions TerritoryBoundaryVersion[]
```

- [ ] **Step 2: Run Prisma generate to validate schema**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npx prisma generate --schema=hub-api/prisma/schema.prisma`
Expected: Prisma Client generated successfully

- [ ] **Step 3: Commit**

```bash
git add hub-api/prisma/schema.prisma
git commit -m "feat: add TerritoryBoundaryVersion model to Prisma schema"
```

---

### Task 2: Extend postgis-helpers.ts with Spatial Functions

**Files:**
- Modify: `hub-api/src/lib/postgis-helpers.ts` (existing file, ~135 lines)

The existing file already has `upsertBoundary`, `clearBoundary`, `getBoundaryAsGeoJSON`, `getAllBoundariesAsFeatureCollection`, `validateGeoJSONPolygon`. We add 4 new functions + a pipeline orchestrator.

- [ ] **Step 1: Add Prisma namespace import + clipToCongregation function**

First, ensure `Prisma` namespace is imported at top of file (needed for `Prisma.sql` and `Prisma.empty` in later functions):

```typescript
import { PrismaClient, Prisma } from "@prisma/client";
```

Then append to `hub-api/src/lib/postgis-helpers.ts`:

```typescript
/**
 * Clip a geometry to the congregation boundary using ST_Intersection.
 * Returns null if no congregation boundary exists (skip step).
 * Throws 422 if result is empty (territory entirely outside congregation).
 */
export async function clipToCongregation(
  prisma: PrismaClient,
  geojson: object
): Promise<{ clipped: object; wasModified: boolean } | null> {
  // Find congregation boundary
  const congregation = await prisma.territory.findFirst({
    where: { type: "congregation_boundary", boundaries: { not: null } },
    select: { boundaries: true },
  });
  if (!congregation || !congregation.boundaries) return null;

  const result = await prisma.$queryRaw<
    Array<{ clipped: string; is_empty: boolean; original_area: number; clipped_area: number }>
  >`
    SELECT
      ST_AsGeoJSON(ST_Intersection(
        ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(geojson)})),
        ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(congregation.boundaries)}))
      )) as clipped,
      ST_IsEmpty(ST_Intersection(
        ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(geojson)})),
        ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(congregation.boundaries)}))
      )) as is_empty,
      ST_Area(ST_GeomFromGeoJSON(${JSON.stringify(geojson)})::geography) as original_area,
      ST_Area(ST_Intersection(
        ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(geojson)})),
        ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(congregation.boundaries)}))
      )::geography) as clipped_area
  `;

  if (!result[0] || result[0].is_empty) {
    const error = new Error("Territory polygon does not intersect the congregation boundary. Please redraw.");
    (error as any).statusCode = 422;
    throw error;
  }

  const clipped = JSON.parse(result[0].clipped);
  const wasModified = Math.abs(result[0].original_area - result[0].clipped_area) > 0.1; // >0.1 m²
  return { clipped, wasModified };
}
```

- [ ] **Step 2: Add clipToNeighbors function**

Append to the same file:

```typescript
/**
 * Subtract all neighboring territory polygons from the input geometry.
 * Returns the clipped geometry and list of territories that were clipped from.
 */
export async function clipToNeighbors(
  prisma: PrismaClient,
  geojson: object,
  excludeTerritoryId: string | null
): Promise<{ clipped: object; removedFrom: Array<{ id: string; number: string; name: string }> }> {
  // Find all territories that intersect with our geometry
  const neighbors = await prisma.$queryRaw<
    Array<{ id: string; number: string; name: string; boundaries: string }>
  >`
    SELECT t.id, t.number, t.name, t.boundaries::text as boundaries
    FROM "Territory" t
    WHERE t.boundaries IS NOT NULL
      AND t.type = 'territory'
      ${excludeTerritoryId ? Prisma.sql`AND t.id != ${excludeTerritoryId}` : Prisma.empty}
      AND ST_Intersects(
        ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(geojson)})),
        ST_MakeValid(ST_GeomFromGeoJSON(t.boundaries::text))
      )
  `;

  if (neighbors.length === 0) {
    return { clipped: geojson, removedFrom: [] };
  }

  let currentGeojson = geojson;
  const removedFrom: Array<{ id: string; number: string; name: string }> = [];

  for (const neighbor of neighbors) {
    const result = await prisma.$queryRaw<Array<{ diff: string; was_modified: boolean }>>`
      SELECT
        ST_AsGeoJSON(ST_Difference(
          ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(currentGeojson)})),
          ST_MakeValid(ST_GeomFromGeoJSON(${neighbor.boundaries}))
        )) as diff,
        NOT ST_Equals(
          ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(currentGeojson)})),
          ST_Difference(
            ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(currentGeojson)})),
            ST_MakeValid(ST_GeomFromGeoJSON(${neighbor.boundaries}))
          )
        ) as was_modified
    `;

    if (result[0]?.was_modified) {
      currentGeojson = JSON.parse(result[0].diff);
      removedFrom.push({ id: neighbor.id, number: neighbor.number, name: neighbor.name });
    }
  }

  return { clipped: currentGeojson, removedFrom };
}
```

- [ ] **Step 3: Add detectOverlaps function**

```typescript
export interface OverlapInfo {
  territoryId: string;
  number: string;
  name: string;
  overlapAreaM2: number;
}

/**
 * Detect remaining overlaps with other territories (informational only).
 */
export async function detectOverlaps(
  prisma: PrismaClient,
  geojson: object,
  excludeTerritoryId: string | null
): Promise<OverlapInfo[]> {
  const overlaps = await prisma.$queryRaw<OverlapInfo[]>`
    SELECT
      t.id as "territoryId",
      t.number,
      t.name,
      ST_Area(ST_Intersection(
        ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(geojson)})),
        ST_MakeValid(ST_GeomFromGeoJSON(t.boundaries::text))
      )::geography) as "overlapAreaM2"
    FROM "Territory" t
    WHERE t.boundaries IS NOT NULL
      AND t.type = 'territory'
      ${excludeTerritoryId ? Prisma.sql`AND t.id != ${excludeTerritoryId}` : Prisma.empty}
      AND ST_Intersects(
        ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(geojson)})),
        ST_MakeValid(ST_GeomFromGeoJSON(t.boundaries::text))
      )
      AND ST_Area(ST_Intersection(
        ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(geojson)})),
        ST_MakeValid(ST_GeomFromGeoJSON(t.boundaries::text))
      )::geography) > 0.1
  `;

  return overlaps;
}
```

- [ ] **Step 4: Add runAutoFixPipeline orchestrator**

```typescript
export interface AutoFixResult {
  original: object;
  clipped: object;
  applied: string[];
  overlaps: OverlapInfo[];
  geometryModified: boolean;
}

/**
 * Run the full auto-fix pipeline: validate → congregation clip → neighbor clip → overlap detect.
 */
export async function runAutoFixPipeline(
  prisma: PrismaClient,
  geojson: object,
  excludeTerritoryId: string | null
): Promise<AutoFixResult> {
  const original = geojson;
  const applied: string[] = [];
  let current = geojson;

  // Step 1: Validate geometry
  const validated = await prisma.$queryRaw<Array<{ valid: string }>>`
    SELECT ST_AsGeoJSON(ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(current)}))) as valid
  `;
  current = JSON.parse(validated[0].valid);

  // Step 2: Congregation clip
  const congResult = await clipToCongregation(prisma, current);
  if (congResult) {
    if (congResult.wasModified) {
      applied.push("Clipped to congregation boundary");
    }
    current = congResult.clipped;
  }

  // Step 3: Neighbor clip
  const neighborResult = await clipToNeighbors(prisma, current, excludeTerritoryId);
  current = neighborResult.clipped;
  for (const removed of neighborResult.removedFrom) {
    applied.push(`Removed overlap with #${removed.number} ${removed.name}`);
  }

  // Step 4: Overlap detect (informational)
  const overlaps = await detectOverlaps(prisma, current, excludeTerritoryId);

  const geometryModified = applied.length > 0;

  return { original, clipped: current, applied, overlaps, geometryModified };
}
```

- [ ] **Step 5: Commit**

```bash
git add hub-api/src/lib/postgis-helpers.ts
git commit -m "feat: add PostGIS auto-fix pipeline (clip, overlap detect, orchestrator)"
```

---

### Task 3: Add Territory Servant Seed Role + Flag Mapping

**Files:**
- Modify: `hub-api/src/lib/seed-roles.ts` (add new role to SYSTEM_ROLES array)
- Modify: `hub-api/src/lib/permissions.ts` (add territory_servant to FLAG_TO_APP_ROLE)

- [ ] **Step 1: Add Territory Servant role to seed-roles.ts**

Add to the `SYSTEM_ROLES` array in `hub-api/src/lib/seed-roles.ts`, after the existing Service Overseer Assistant role:

```typescript
{
  name: "Territory Servant",
  description: "Territory management — draw, edit, assign, import boundaries",
  scope: "all",
  permissions: [
    PERMISSIONS.TERRITORIES_VIEW,
    PERMISSIONS.TERRITORIES_EDIT,
    PERMISSIONS.TERRITORIES_ASSIGN,
    PERMISSIONS.TERRITORIES_IMPORT,
    PERMISSIONS.TERRITORIES_SHARE,
    PERMISSIONS.ADDRESSES_VIEW,
    PERMISSIONS.ADDRESSES_EDIT,
    PERMISSIONS.ADDRESSES_IMPORT,
    PERMISSIONS.OSM_REFRESH,
    PERMISSIONS.OSM_EDIT,
    PERMISSIONS.GAP_DETECTION_VIEW,
    PERMISSIONS.GAP_DETECTION_RUN,
    PERMISSIONS.ASSIGNMENTS_VIEW,
    PERMISSIONS.ASSIGNMENTS_MANAGE,
    PERMISSIONS.PUBLISHERS_VIEW,
    PERMISSIONS.CAMPAIGNS_VIEW,
    PERMISSIONS.MEETINGS_VIEW,
    PERMISSIONS.FIELD_SERVICE_VIEW,
    PERMISSIONS.CHAT_VIEW,
    PERMISSIONS.CHAT_SEND,
  ],
},
```

- [ ] **Step 2: Add territory_servant to FLAG_TO_APP_ROLE in permissions.ts**

In `hub-api/src/lib/permissions.ts`, find the `FLAG_TO_APP_ROLE` object and add:

```typescript
territory_servant: "Territory Servant",
```

- [ ] **Step 3: Commit**

```bash
git add hub-api/src/lib/seed-roles.ts hub-api/src/lib/permissions.ts
git commit -m "feat: add Territory Servant seed role + flag mapping"
```

---

## Chunk 2: Backend API Endpoints

**IMPORTANT: Route registration order.** All non-parameterized routes (`/territories/violations`, `/territories/preview-fix`, `/territories/snap-context`) MUST be registered BEFORE any `/:id` parameterized routes. Register new routes in this order in the file:
1. `GET /territories` (existing)
2. `GET /territories/violations` (new)
3. `POST /territories/preview-fix` (new)
4. `POST /territories` (existing, modified)
5. `GET /territories/:id` (existing)
6. `POST /territories/:id/preview-fix` (new)
7. `GET /territories/:id/versions` (new)
8. `POST /territories/:id/restore` (new)
9. `PUT /territories/:id` (existing, modified)
10. `DELETE /territories/:id` (existing)

### Task 4: Add Preview-Fix Endpoints

**Files:**
- Modify: `hub-api/src/routes/territories.ts`

- [ ] **Step 1: Import new functions at top of territories.ts**

Add imports:

```typescript
import { runAutoFixPipeline, type AutoFixResult } from "../lib/postgis-helpers.js";
```

- [ ] **Step 2: Add POST /territories/:id/preview-fix endpoint**

Add before the existing PUT endpoint:

```typescript
// Preview auto-fix without saving (dry run)
app.post<{ Params: { id: string }; Body: { boundaries: unknown } }>(
  "/territories/:id/preview-fix",
  { preHandler: [requirePermission(PERMISSIONS.TERRITORIES_EDIT)] },
  async (request, reply) => {
    const { id } = request.params;
    const { boundaries } = request.body;

    if (!boundaries) {
      return reply.code(400).send({ error: "boundaries required" });
    }

    try {
      const result = await runAutoFixPipeline(prisma, boundaries as object, id);
      return reply.send(result);
    } catch (err: any) {
      if (err.statusCode === 422) {
        return reply.code(422).send({ error: err.message });
      }
      throw err;
    }
  }
);
```

- [ ] **Step 3: Add POST /territories/preview-fix endpoint (no excludeId)**

```typescript
// Preview auto-fix for new territory (no ID to exclude)
app.post<{ Body: { boundaries: unknown } }>(
  "/territories/preview-fix",
  { preHandler: [requirePermission(PERMISSIONS.TERRITORIES_EDIT)] },
  async (request, reply) => {
    const { boundaries } = request.body;

    if (!boundaries) {
      return reply.code(400).send({ error: "boundaries required" });
    }

    try {
      const result = await runAutoFixPipeline(prisma, boundaries as object, null);
      return reply.send(result);
    } catch (err: any) {
      if (err.statusCode === 422) {
        return reply.code(422).send({ error: err.message });
      }
      throw err;
    }
  }
);
```

- [ ] **Step 4: Commit**

```bash
git add hub-api/src/routes/territories.ts
git commit -m "feat: add preview-fix endpoints for territory auto-fix dry run"
```

---

### Task 5: Add Violations Endpoint

**Files:**
- Modify: `hub-api/src/routes/territories.ts`

- [ ] **Step 1: Import detectOverlaps**

Add to the existing imports from postgis-helpers:

```typescript
import { runAutoFixPipeline, detectOverlaps, clipToCongregation, type AutoFixResult, type OverlapInfo } from "../lib/postgis-helpers.js";
```

- [ ] **Step 2: Add GET /territories/violations endpoint**

Add early in the route file (before parameterized routes like `/:id`):

```typescript
// Detect violations across all territories for map badges
app.get(
  "/territories/violations",
  { preHandler: [requirePermission(PERMISSIONS.TERRITORIES_VIEW)] },
  async (request, reply) => {
    const territories = await prisma.territory.findMany({
      where: { type: "territory", boundaries: { not: null } },
      select: { id: true, number: true, name: true, boundaries: true },
    });

    const congregation = await prisma.territory.findFirst({
      where: { type: "congregation_boundary", boundaries: { not: null } },
      select: { boundaries: true },
    });

    const violations: Array<{
      territoryId: string;
      number: string;
      name: string;
      violations: string[];
    }> = [];

    for (const territory of territories) {
      const territoryViolations: string[] = [];

      // Check congregation boundary violation
      if (congregation?.boundaries) {
        const exceedsResult = await prisma.$queryRaw<Array<{ exceeds: boolean }>>`
          SELECT NOT ST_CoveredBy(
            ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(territory.boundaries)})),
            ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(congregation.boundaries)}))
          ) as exceeds
        `;
        if (exceedsResult[0]?.exceeds) {
          territoryViolations.push("exceeds_boundary");
        }
      }

      // Check neighbor overlaps
      const overlaps = await detectOverlaps(
        prisma,
        territory.boundaries as object,
        territory.id
      );
      for (const overlap of overlaps) {
        territoryViolations.push(`overlaps_${overlap.number}`);
      }

      if (territoryViolations.length > 0) {
        violations.push({
          territoryId: territory.id,
          number: territory.number,
          name: territory.name,
          violations: territoryViolations,
        });
      }
    }

    return reply.send(violations);
  }
);
```

- [ ] **Step 3: Commit**

```bash
git add hub-api/src/routes/territories.ts
git commit -m "feat: add GET /territories/violations endpoint for map badges"
```

---

### Task 6: Add Version History + Restore Endpoints

**Files:**
- Modify: `hub-api/src/routes/territories.ts`

- [ ] **Step 1: Add GET /territories/:id/versions endpoint**

```typescript
// List boundary versions (without full boundaries JSON)
app.get<{ Params: { id: string } }>(
  "/territories/:id/versions",
  { preHandler: [requirePermission(PERMISSIONS.TERRITORIES_VIEW)] },
  async (request, reply) => {
    const { id } = request.params;

    const versions = await prisma.territoryBoundaryVersion.findMany({
      where: { territoryId: id },
      select: {
        id: true,
        version: true,
        changeType: true,
        changeSummary: true,
        createdAt: true,
      },
      orderBy: { version: "desc" },
    });

    return reply.send(versions);
  }
);
```

- [ ] **Step 2: Add POST /territories/:id/restore endpoint (preview-only)**

```typescript
// Preview restoring a previous version (dry run — no DB write)
app.post<{ Params: { id: string }; Body: { versionId: string } }>(
  "/territories/:id/restore",
  { preHandler: [requirePermission(PERMISSIONS.TERRITORIES_EDIT)] },
  async (request, reply) => {
    const { id } = request.params;
    const { versionId } = request.body;

    const version = await prisma.territoryBoundaryVersion.findFirst({
      where: { id: versionId, territoryId: id },
    });

    if (!version) {
      return reply.code(404).send({ error: "Version not found" });
    }

    try {
      const result = await runAutoFixPipeline(
        prisma,
        version.boundaries as object,
        id
      );
      return reply.send(result);
    } catch (err: any) {
      if (err.statusCode === 422) {
        return reply.code(422).send({ error: err.message });
      }
      throw err;
    }
  }
);
```

- [ ] **Step 3: Commit**

```bash
git add hub-api/src/routes/territories.ts
git commit -m "feat: add version history + restore preview endpoints"
```

---

### Task 7: Modify PUT/POST Territories with Auto-Fix Pipeline

**Files:**
- Modify: `hub-api/src/routes/territories.ts`

- [ ] **Step 1: Create a helper to save boundary version**

Add helper function in territories.ts (before the route definitions):

```typescript
async function createBoundaryVersion(
  territoryId: string,
  boundaries: object,
  changeType: string,
  changeSummary?: string
) {
  // Get next version number
  const lastVersion = await prisma.territoryBoundaryVersion.findFirst({
    where: { territoryId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const nextVersion = (lastVersion?.version ?? 0) + 1;

  await prisma.territoryBoundaryVersion.create({
    data: {
      territoryId,
      version: nextVersion,
      boundaries: boundaries as any,
      changeType,
      changeSummary,
    },
  });

  return nextVersion;
}
```

- [ ] **Step 2: Modify PUT /territories/:id to run auto-fix pipeline**

Replace the existing PUT handler body. The current handler does a simple Prisma update. The new version checks if boundaries changed, runs the pipeline, saves with version:

```typescript
// In the PUT /territories/:id handler, after getting the update data:
const data = request.body;

// Check if boundaries are being updated
if (data.boundaries) {
  try {
    const autoFix = await runAutoFixPipeline(prisma, data.boundaries as object, id);

    // Use clipped geometry instead of raw input
    data.boundaries = autoFix.clipped;

    // Save territory
    const territory = await prisma.territory.update({
      where: { id },
      data: data as any,
    });

    // Create version record
    const changeSummary = autoFix.applied.length > 0
      ? autoFix.applied.join("; ")
      : undefined;
    await createBoundaryVersion(
      id,
      autoFix.clipped as object,
      "manual_edit",
      changeSummary
    );

    return reply.send({ ...territory, autoFix });
  } catch (err: any) {
    if (err.statusCode === 422) {
      return reply.code(422).send({ error: err.message });
    }
    throw err;
  }
} else {
  // No boundary change — simple update
  const territory = await prisma.territory.update({
    where: { id },
    data: data as any,
  });
  return reply.send(territory);
}
```

- [ ] **Step 3: Modify POST /territories to run auto-fix pipeline when boundaries present**

In the POST handler, after creating the territory, if boundaries are present:

```typescript
const data = request.body;
let autoFix: AutoFixResult | undefined;

if (data.boundaries) {
  try {
    autoFix = await runAutoFixPipeline(prisma, data.boundaries as object, null);
    data.boundaries = autoFix.clipped;
  } catch (err: any) {
    if (err.statusCode === 422) {
      return reply.code(422).send({ error: err.message });
    }
    throw err;
  }
}

const territory = await prisma.territory.create({
  data: data as any,
});

// Create v1 if boundaries were provided
if (data.boundaries) {
  const changeSummary = autoFix?.applied.length
    ? autoFix.applied.join("; ")
    : undefined;
  await createBoundaryVersion(
    territory.id,
    data.boundaries as object,
    "creation",
    changeSummary
  );
}

return reply.code(201).send({ ...territory, autoFix });
```

- [ ] **Step 4: Commit**

```bash
git add hub-api/src/routes/territories.ts
git commit -m "feat: integrate auto-fix pipeline into PUT/POST territory endpoints"
```

---

### Task 8: Add GET /publishers/:id/roles Endpoint

**Files:**
- Modify: `hub-api/src/routes/publishers.ts`

- [ ] **Step 1: Import FLAG_TO_APP_ROLE**

Add import at top of publishers.ts:

```typescript
import { FLAG_TO_APP_ROLE, CONGREGATION_FLAGS } from "../lib/permissions.js";
```

- [ ] **Step 2: Add the endpoint**

```typescript
// Get roles assigned to a publisher (auto-mapped + manual split)
app.get<{ Params: { id: string } }>(
  "/publishers/:id/roles",
  { preHandler: [requirePermission(PERMISSIONS.PUBLISHERS_VIEW)] },
  async (request, reply) => {
    const { id } = request.params;

    const publisher = await prisma.publisher.findUnique({
      where: { id },
      select: {
        congregationRole: true,
        congregationFlags: true,
        appRoles: {
          include: { role: { select: { id: true, name: true, description: true, scope: true } } },
        },
      },
    });

    if (!publisher) {
      return reply.code(404).send({ error: "Publisher not found" });
    }

    // Derive auto-mapped roles from congregation flags (stored as String[])
    const flags = (publisher.congregationFlags as string[]) || [];
    const autoMapped: Array<{ roleName: string; fromFlag: string }> = [];
    for (const [flag, roleName] of Object.entries(FLAG_TO_APP_ROLE)) {
      if (flags.includes(flag)) {
        autoMapped.push({ roleName, fromFlag: flag });
      }
    }

    // Manual roles = AppRoleMember records
    const manual = publisher.appRoles.map((arm) => ({
      id: arm.role.id,
      name: arm.role.name,
      description: arm.role.description,
      scope: arm.role.scope,
      validFrom: arm.validFrom,
      validTo: arm.validTo,
    }));

    return reply.send({ autoMapped, manual });
  }
);
```

- [ ] **Step 3: Commit**

```bash
git add hub-api/src/routes/publishers.ts
git commit -m "feat: add GET /publishers/:id/roles endpoint (auto-mapped + manual split)"
```

---

## Chunk 3: Frontend — Core Fixes (Edit, Create, Preview)

### Task 9: Add API Functions to territory-api.ts

**Files:**
- Modify: `hub-app/src/lib/territory-api.ts`

- [ ] **Step 1: Add types for auto-fix and versions**

Add to the types section at the top of `hub-app/src/lib/territory-api.ts`:

```typescript
export interface OverlapInfo {
  territoryId: string;
  number: string;
  name: string;
  overlapAreaM2: number;
}

export interface AutoFixResult {
  original: unknown;
  clipped: unknown;
  applied: string[];
  overlaps: OverlapInfo[];
  geometryModified: boolean;
}

export interface BoundaryVersion {
  id: string;
  version: number;
  changeType: string;
  changeSummary: string | null;
  createdAt: string;
}

export interface TerritoryViolation {
  territoryId: string;
  number: string;
  name: string;
  violations: string[];
}
```

- [ ] **Step 2: Add API functions**

Add to the functions section. **Important:** Use `apiFetch` (private helper in this file) and `getApiUrl()` from `./config` — these are already imported/defined. All new functions follow the same pattern as existing ones (e.g., `getTerritory`, `listAddresses`).

```typescript
export async function createTerritory(
  token: string,
  data: { number: string; name: string }
): Promise<TerritoryListItem> {
  return apiFetch(`${getApiUrl()}/territories`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function updateTerritoryBoundaries(
  token: string,
  territoryId: string,
  boundaries: unknown
): Promise<TerritoryListItem & { autoFix?: AutoFixResult }> {
  return apiFetch(`${getApiUrl()}/territories/${territoryId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ boundaries }),
  });
}

export async function previewFix(
  token: string,
  territoryId: string | null,
  boundaries: unknown
): Promise<AutoFixResult> {
  const url = territoryId
    ? `${getApiUrl()}/territories/${territoryId}/preview-fix`
    : `${getApiUrl()}/territories/preview-fix`;
  return apiFetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ boundaries }),
  });
}

export async function getViolations(token: string): Promise<TerritoryViolation[]> {
  return apiFetch(`${getApiUrl()}/territories/violations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getVersions(token: string, territoryId: string): Promise<BoundaryVersion[]> {
  return apiFetch(`${getApiUrl()}/territories/${territoryId}/versions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function restoreVersion(
  token: string,
  territoryId: string,
  versionId: string
): Promise<AutoFixResult> {
  return apiFetch(`${getApiUrl()}/territories/${territoryId}/restore`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ versionId }),
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/lib/territory-api.ts
git commit -m "feat: add territory API functions for preview-fix, violations, versions, restore"
```

---

### Task 10: Create AutoFixPreview Dialog Component

**Files:**
- Create: `hub-app/src/pages/territories/AutoFixPreview.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { FormattedMessage } from "react-intl";
import type { AutoFixResult } from "@/lib/territory-api";

interface AutoFixPreviewProps {
  result: AutoFixResult;
  onAccept: () => void;
  onCancel: () => void;
}

export function AutoFixPreview({ result, onAccept, onCancel }: AutoFixPreviewProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[var(--bg-2)] border border-[var(--border)] rounded-xl p-6 max-w-lg w-full mx-4 shadow-2xl">
        <h3 className="text-lg font-semibold mb-4">
          <FormattedMessage id="territories.autoFix.title" defaultMessage="Boundary will be adjusted" />
        </h3>

        <ul className="space-y-2 mb-6">
          {result.applied.map((fix, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-[var(--text-muted)]">
              <span className="text-amber-400 mt-0.5">•</span>
              {fix}
            </li>
          ))}
        </ul>

        {result.overlaps.length > 0 && (
          <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-xs text-red-400 font-medium mb-1">
              <FormattedMessage id="territories.autoFix.remainingOverlaps" defaultMessage="Remaining overlaps (informational):" />
            </p>
            {result.overlaps.map((o) => (
              <p key={o.territoryId} className="text-xs text-[var(--text-muted)]">
                #{o.number} {o.name} — {Math.round(o.overlapAreaM2)} m²
              </p>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-5 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-3)] transition-colors"
          >
            <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
          </button>
          <button
            onClick={onAccept}
            className="px-5 py-2 text-sm rounded-lg bg-green-600 text-white font-semibold hover:bg-green-500 transition-colors"
          >
            <FormattedMessage id="territories.autoFix.accept" defaultMessage="Accept & Save" />
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add hub-app/src/pages/territories/AutoFixPreview.tsx
git commit -m "feat: add AutoFixPreview dialog component"
```

---

### Task 11: Create NewTerritoryModal Component

**Files:**
- Create: `hub-app/src/pages/territories/NewTerritoryModal.tsx`

- [ ] **Step 1: Create the modal**

```tsx
import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";

interface NewTerritoryModalProps {
  onSubmit: (number: string, name: string) => void;
  onCancel: () => void;
}

export function NewTerritoryModal({ onSubmit, onCancel }: NewTerritoryModalProps) {
  const intl = useIntl();
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");

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
            className="px-5 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-3)] transition-colors"
          >
            <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
          </button>
          <button
            onClick={() => number.trim() && name.trim() && onSubmit(number.trim(), name.trim())}
            disabled={!number.trim() || !name.trim()}
            className="px-5 py-2 text-sm rounded-lg bg-[var(--amber)] text-black font-semibold hover:bg-[var(--amber-light)] transition-colors disabled:opacity-40"
          >
            <FormattedMessage id="territories.new.create" defaultMessage="Create & Draw" />
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add hub-app/src/pages/territories/NewTerritoryModal.tsx
git commit -m "feat: add NewTerritoryModal component for territory creation"
```

---

### Task 12: Wire Edit Button in TerritoryDetail

**Files:**
- Modify: `hub-app/src/pages/territories/TerritoryDetail.tsx`

This is the most complex frontend task. TerritoryDetail needs:
1. An "Edit" button in the map controls bar (permission-gated)
2. TerritoryEditor mounted inline when edit mode is active
3. CreationFlow mounted when territory has no boundary
4. AutoFixPreview dialog when saving triggers auto-fix

- [ ] **Step 1: Add imports**

Add to TerritoryDetail.tsx imports. **Note:** TerritoryEditor and CreationFlow use **named exports**. Also add `Edit3` to the lucide-react imports and `usePermissions` for permission gating.

```typescript
import { TerritoryEditor } from "./TerritoryEditor";
import { CreationFlow } from "./CreationFlow";
import { AutoFixPreview } from "./AutoFixPreview";
import { previewFix, updateTerritoryBoundaries, getTerritory, type AutoFixResult } from "@/lib/territory-api";
import { usePermissions } from "@/auth/PermissionProvider";
```

Add `Edit3` to the existing lucide-react import line:
```typescript
import { ..., Edit3 } from "lucide-react";
```

Inside the component function, add:
```typescript
const { can } = usePermissions();
```

- [ ] **Step 2: Add edit state**

Add state variables near existing state declarations:

```typescript
const [editMode, setEditMode] = useState(false);
const [creationMode, setCreationMode] = useState(false);
const [autoFixResult, setAutoFixResult] = useState<AutoFixResult | null>(null);
const [pendingBoundaries, setPendingBoundaries] = useState<unknown>(null);
```

- [ ] **Step 3: Add Edit button to map controls**

In the map controls bar (near GPS toggle, Field Work button, expand button), add the Edit button. Gate it with `can("app:territories.edit")`:

```tsx
{can("app:territories.edit") && hasBoundary && !editMode && (
  <button
    onClick={() => setEditMode(true)}
    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-500/80 text-black rounded-[var(--radius-sm)] hover:bg-amber-400 transition-colors"
  >
    <Edit3 size={13} />
    <FormattedMessage id="territories.edit" defaultMessage="Edit" />
  </button>
)}
```

- [ ] **Step 4: Add "Draw Boundary" button for territories without boundaries**

Replace the "No boundary defined" placeholder with a draw button:

```tsx
{!hasBoundary && can("app:territories.edit") && (
  <button
    onClick={() => setCreationMode(true)}
    className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-[var(--amber)] text-black rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors"
  >
    <MapPin size={16} />
    <FormattedMessage id="territories.drawBoundary" defaultMessage="Draw Boundary" />
  </button>
)}
```

- [ ] **Step 5: Add save handler with auto-fix preview**

**Important:** Use the existing `token` variable (line 54: `const token = user?.access_token ?? ""`), NOT a `getToken()` function. Use `updateTerritoryBoundaries` from `territory-api.ts`, NOT raw fetch.

```typescript
const handleBoundarySave = async (boundaries: unknown) => {
  if (!token) return;
  try {
    const result = await previewFix(token, territory?.id ?? null, boundaries);
    if (result.geometryModified) {
      setAutoFixResult(result);
      setPendingBoundaries(result.clipped);
    } else {
      await saveBoundary(result.clipped);
    }
  } catch (err) {
    console.error("Preview fix failed:", err);
  }
};

const saveBoundary = async (boundaries: unknown) => {
  if (!token || !territory) return;
  try {
    await updateTerritoryBoundaries(token, territory.id, boundaries);
    setEditMode(false);
    setCreationMode(false);
    setAutoFixResult(null);
    // Refresh territory data by re-fetching
    const refreshed = await getTerritory(territory.id, token);
    // Update component state with refreshed data (match existing pattern)
  } catch (err) {
    console.error("Save boundary failed:", err);
  }
};
```

- [ ] **Step 6: Mount TerritoryEditor and CreationFlow in JSX**

**This is critical — Bug #3 fix.** Add conditional rendering in the map area of TerritoryDetail:

```tsx
{/* Mount TerritoryEditor when edit mode is active */}
{editMode && territory && (
  <TerritoryEditor
    territories={[territory]}
    congregationBoundary={null}
    onSave={handleBoundarySave}
    onCancel={() => setEditMode(false)}
  />
)}

{/* Mount CreationFlow when no boundary exists and creation mode active */}
{creationMode && !hasBoundary && (
  <CreationFlow
    onComplete={handleBoundarySave}
    onCancel={() => setCreationMode(false)}
  />
)}
```

**Note:** Check the actual prop signatures of `TerritoryEditor` and `CreationFlow` — the above matches their exported interfaces (`TerritoryEditorProps` and `CreationFlowProps`).

- [ ] **Step 7: Mount AutoFixPreview dialog**

At the end of the component's return JSX:

```tsx
{autoFixResult && (
  <AutoFixPreview
    result={autoFixResult}
    onAccept={() => {
      saveBoundary(pendingBoundaries);
    }}
    onCancel={() => {
      setAutoFixResult(null);
      setPendingBoundaries(null);
    }}
  />
)}
```

- [ ] **Step 7: Commit**

```bash
git add hub-app/src/pages/territories/TerritoryDetail.tsx
git commit -m "feat: wire Edit button + CreationFlow + auto-fix preview in TerritoryDetail"
```

---

### Task 13: Wire New Territory Creation in TerritoryMap

**Files:**
- Modify: `hub-app/src/pages/territories/TerritoryMap.tsx`

- [ ] **Step 1: Add imports and state**

**Note:** Use `react-router` (not `react-router-dom`). Use the existing `token` from `useAuth()`.

```typescript
import { NewTerritoryModal } from "./NewTerritoryModal";
import { usePermissions } from "@/auth/PermissionProvider";
import { createTerritory } from "@/lib/territory-api";

// Inside component:
const [showNewModal, setShowNewModal] = useState(false);
const { can } = usePermissions();
```

- [ ] **Step 2: Replace "+ New Territory" button click handler**

Change the button onClick from `navigate("/territories/map?draw=true")` to `setShowNewModal(true)`. Also gate the button on permission:

```tsx
{can("app:territories.edit") && (
  <button
    onClick={() => setShowNewModal(true)}
    className="absolute top-3 right-3 z-10 flex items-center gap-2 px-4 py-2 text-sm font-semibold text-black bg-[var(--amber)] rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer shadow-lg"
  >
    <Plus size={16} />
    <FormattedMessage id="territories.newTerritory" defaultMessage="New Territory" />
  </button>
)}
```

- [ ] **Step 3: Add modal and creation handler**

**Important:** Use the typed `createTerritory` API function and existing `token` variable.

```tsx
{showNewModal && (
  <NewTerritoryModal
    onCancel={() => setShowNewModal(false)}
    onSubmit={async (number, name) => {
      if (!token) return;
      try {
        const territory = await createTerritory(token, { number, name });
        setShowNewModal(false);
        navigate(`/territories/${territory.id}`);
      } catch (err) {
        console.error("Create territory failed:", err);
      }
    }}
  />
)}
```

- [ ] **Step 4: Commit**

```bash
git add hub-app/src/pages/territories/TerritoryMap.tsx
git commit -m "feat: wire New Territory modal + creation flow in TerritoryMap"
```

---

## Chunk 4: Frontend — Enhancements (Violations, Versions)

### Task 14: Create ViolationBadges Component + Wire into TerritoryMap

**Files:**
- Create: `hub-app/src/pages/territories/ViolationBadges.tsx`
- Modify: `hub-app/src/pages/territories/TerritoryMap.tsx`

- [ ] **Step 1: Create ViolationBadges component**

```tsx
import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router";
import maplibregl from "maplibre-gl";
import { getViolations, type TerritoryViolation } from "@/lib/territory-api";

interface ViolationBadgesProps {
  map: maplibregl.Map | null;
  token: string | null;
  territories: Array<{ id: string; number: string; boundaries: unknown }>;
}

export function ViolationBadges({ map, token, territories }: ViolationBadgesProps) {
  const navigate = useNavigate();
  const [violations, setViolations] = useState<TerritoryViolation[]>([]);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!token) return;
    getViolations(token).then(setViolations).catch(console.error);
  }, [token]);

  useEffect(() => {
    if (!map || violations.length === 0) return;

    // Clean up old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    for (const v of violations) {
      const territory = territories.find((t) => t.id === v.territoryId);
      if (!territory?.boundaries) continue;

      // Get centroid from boundaries for marker placement
      const bounds = territory.boundaries as { coordinates: number[][][] };
      const coords = bounds.coordinates?.[0];
      if (!coords || coords.length < 2) continue;

      // Simple centroid (exclude closing vertex which duplicates first vertex)
      const ring = coords.slice(0, -1);
      let cx = 0, cy = 0;
      for (const [x, y] of ring) { cx += x; cy += y; }
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

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([cx, cy])
        .addTo(map);
      markersRef.current.push(marker);
    }

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
  }, [map, violations, territories, navigate]);

  return null; // Markers are added directly to the map
}
```

- [ ] **Step 2: Mount ViolationBadges in TerritoryMap**

In TerritoryMap.tsx, add:

```tsx
import { ViolationBadges } from "./ViolationBadges";

// In the JSX, after the map container:
<ViolationBadges
  map={mapRef.current}
  token={token}
  territories={territories}
/>
```

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/pages/territories/ViolationBadges.tsx hub-app/src/pages/territories/TerritoryMap.tsx
git commit -m "feat: add violation warning badges on territory map view"
```

---

### Task 15: Create VersionHistory Component + Wire into TerritoryDetail

**Files:**
- Create: `hub-app/src/pages/territories/VersionHistory.tsx`
- Modify: `hub-app/src/pages/territories/TerritoryDetail.tsx`

- [ ] **Step 1: Create VersionHistory component**

```tsx
import { useEffect, useState } from "react";
import { FormattedMessage } from "react-intl";
import { RotateCcw } from "lucide-react";
import { getVersions, restoreVersion, type BoundaryVersion, type AutoFixResult } from "@/lib/territory-api";

interface VersionHistoryProps {
  territoryId: string;
  token: string | null;
  canEdit: boolean;
  onRestore: (result: AutoFixResult) => void;
}

export function VersionHistory({ territoryId, token, canEdit, onRestore }: VersionHistoryProps) {
  const [versions, setVersions] = useState<BoundaryVersion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    getVersions(token, territoryId).then(setVersions).catch(console.error);
  }, [token, territoryId]);

  if (versions.length === 0) return null;

  const handleRestore = async (versionId: string) => {
    if (!token) return;
    setLoading(true);
    try {
      const result = await restoreVersion(token, territoryId, versionId);
      onRestore(result);
    } catch (err) {
      console.error("Restore preview failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const changeTypeLabel: Record<string, string> = {
    creation: "Created",
    manual_edit: "Manual edit",
    auto_clip: "Auto-clip",
    import: "KML import",
    restore: "Restored",
  };

  return (
    <div className="mt-2 px-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
        <FormattedMessage id="territories.versions.title" defaultMessage="Boundary History" />
      </div>
      <div className="space-y-1 max-h-32 overflow-y-auto">
        {versions.map((v, i) => (
          <div
            key={v.id}
            className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${
              i === 0
                ? "bg-purple-500/10 border border-purple-500/20"
                : "bg-[var(--bg-1)] border border-[var(--border)]"
            }`}
          >
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
              i === 0 ? "bg-purple-500 text-white" : "bg-[var(--bg-3)] text-[var(--text-muted)]"
            }`}>
              v{v.version}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{changeTypeLabel[v.changeType] || v.changeType}</div>
              {v.changeSummary && (
                <div className="text-[10px] text-[var(--text-muted)] truncate">{v.changeSummary}</div>
              )}
            </div>
            {i === 0 ? (
              <span className="text-[10px] text-purple-400">current</span>
            ) : canEdit ? (
              <button
                onClick={() => handleRestore(v.id)}
                disabled={loading}
                className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text)] flex items-center gap-1"
              >
                <RotateCcw size={10} />
                restore
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount VersionHistory in TerritoryDetail**

Add import and mount below the map controls in TerritoryDetail.tsx:

```tsx
import { VersionHistory } from "./VersionHistory";

// In JSX, below the map controls bar:
{hasBoundary && (
  <VersionHistory
    territoryId={territory.id}
    token={token}
    canEdit={can("app:territories.edit")}
    onRestore={(result) => {
      if (result.geometryModified) {
        setAutoFixResult(result);
        setPendingBoundaries(result.clipped);
      } else {
        saveBoundary(result.clipped);
      }
    }}
  />
)}
```

- [ ] **Step 3: Commit**

```bash
git add hub-app/src/pages/territories/VersionHistory.tsx hub-app/src/pages/territories/TerritoryDetail.tsx
git commit -m "feat: add version history dropdown with restore in TerritoryDetail"
```

---

### Task 16: Enhance Publisher Roles Tab (Auto-Mapped vs Manual Split)

**Files:**
- Modify: `hub-app/src/pages/publishers/PublisherForm.tsx`

The existing Roles tab already shows assigned roles with add/remove. We enhance it to show auto-mapped roles separately with a lock icon.

- [ ] **Step 1: Fetch auto-mapped roles from new endpoint**

In PublisherForm.tsx, add a state and fetch for the auto-mapped/manual split:

```typescript
const [autoMappedRoles, setAutoMappedRoles] = useState<Array<{ roleName: string; fromFlag: string }>>([]);

// In the useEffect that loads publisher data, add:
if (id) {
  fetch(`${apiUrl}/publishers/${id}/roles`, {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then((r) => r.json())
    .then((data) => setAutoMappedRoles(data.autoMapped || []))
    .catch(console.error);
}
```

- [ ] **Step 2: Add auto-mapped section above manual roles in Roles tab**

In the roles tab section (around lines 925-997), add before the manual roles list:

```tsx
{/* Auto-mapped roles from congregation flags */}
{autoMappedRoles.length > 0 && (
  <div className="mb-4">
    <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
      <FormattedMessage id="publishers.roles.autoMapped" defaultMessage="Auto-Mapped (from congregation flags)" />
    </div>
    <div className="space-y-1">
      {autoMappedRoles.map((r) => (
        <div key={r.fromFlag} className="flex items-center gap-2 px-4 py-2.5 bg-green-500/5 border border-green-500/10 rounded-lg">
          <Lock size={12} className="text-green-500" />
          <span className="text-sm">{r.roleName}</span>
          <span className="text-[10px] text-[var(--text-muted)]">
            (<FormattedMessage id="publishers.roles.fromFlag" defaultMessage="from flag" />)
          </span>
        </div>
      ))}
    </div>
    <p className="text-[10px] text-[var(--text-muted)] mt-1">
      <FormattedMessage
        id="publishers.roles.autoMappedHint"
        defaultMessage="These roles are set by congregation record flags and cannot be removed here."
      />
    </p>
  </div>
)}
```

Add `Lock` to the lucide-react imports.

- [ ] **Step 3: Add "Manual Roles" label above existing role list**

Before the existing assigned roles list, add:

```tsx
<div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
  <FormattedMessage id="publishers.roles.manual" defaultMessage="Manual Roles" />
</div>
```

- [ ] **Step 4: Commit**

```bash
git add hub-app/src/pages/publishers/PublisherForm.tsx
git commit -m "feat: enhance publisher Roles tab with auto-mapped vs manual split"
```

---

## Chunk 5: Migration + Build Verification

### Task 17: Add v1 Snapshot Bootstrap to Seed Script

**Files:**
- Modify: `hub-api/prisma/seed.ts`

- [ ] **Step 1: Add v1 snapshot function to seed script**

Add after the existing seed logic (e.g., after `seedSystemRoles()`):

```typescript
// Bootstrap v1 boundary snapshots for existing territories
async function bootstrapBoundaryVersions(prisma: PrismaClient) {
  const territories = await prisma.territory.findMany({
    where: { boundaries: { not: null } },
    select: { id: true, boundaries: true },
  });

  for (const territory of territories) {
    // Skip if already has version records (idempotent)
    const existing = await prisma.territoryBoundaryVersion.findFirst({
      where: { territoryId: territory.id },
    });
    if (existing) continue;

    await prisma.territoryBoundaryVersion.create({
      data: {
        territoryId: territory.id,
        version: 1,
        boundaries: territory.boundaries as any,
        changeType: "import",
        changeSummary: "Initial snapshot from existing boundary",
      },
    });
  }
}

// Call it in the main seed function:
await bootstrapBoundaryVersions(prisma);
```

- [ ] **Step 2: Commit**

```bash
git add hub-api/prisma/seed.ts
git commit -m "feat: add v1 boundary snapshot bootstrap to seed script"
```

---

### Task 18: Build Verification

- [ ] **Step 1: Build hub-api**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-api`
Expected: Build succeeds with no errors

- [ ] **Step 2: Build hub-app**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`
Expected: Build succeeds with no errors

- [ ] **Step 3: Fix any TypeScript errors**

If either build fails, fix the errors and re-run.

- [ ] **Step 4: Commit any build fixes**

```bash
git add -A
git commit -m "fix: resolve build errors from territory polygon fixes"
```

---

## Execution Order

1. **Chunk 1** (Tasks 1-3): Schema + PostGIS + RBAC — backend foundation, no frontend deps
2. **Chunk 2** (Tasks 4-8): API endpoints — depends on Chunk 1
3. **Chunk 3** (Tasks 9-13): Frontend core fixes — depends on Chunk 2 API functions
4. **Chunk 4** (Tasks 14-16): Frontend enhancements — depends on Chunk 3
5. **Chunk 5** (Tasks 17-18): Migration + build verification — final
