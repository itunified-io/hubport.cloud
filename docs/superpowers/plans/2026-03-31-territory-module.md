# Territory Module Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. Chunks 3-8 can run in parallel after Chunks 1-2 complete.

**Goal:** Implement the complete territory module for hubport.cloud across 4 specs: drawing UX, address/OSM management, territory operations, and sharing/RBAC refactor.

**Architecture:** Fastify 5 hub-api backend with Prisma 6 + PostGIS, React 19 hub-app frontend with MapLibre GL JS, central-api for cross-tenant sharing. BullMQ + Redis for async OSM refresh. All routes migrated from `requireRole()` to `requirePermission()`.

**Tech Stack:** TypeScript, Fastify 5, Prisma 6, PostGIS, React 19, MapLibre GL JS, BullMQ, Redis, Vitest, Tailwind CSS 4, react-intl (i18n DE/EN)

**Repo:** `~/github/itunified-io/hubport.cloud` (monorepo: hub-api, hub-app, central-api, setup-wizard)

**Spec Documents:**
- Spec 1: `docs/superpowers/specs/2026-03-31-territory-drawing-ux-design.md`
- Spec 2: `docs/superpowers/specs/2026-03-31-territory-address-osm-design.md`
- Spec 3: `docs/superpowers/specs/2026-03-31-territory-operations-design.md`
- Spec 4: `docs/superpowers/specs/2026-03-31-territory-sharing-rbac-design.md`

---

## Dependency Graph

```
Chunk 1: RBAC Foundation ─────────┐
Chunk 2: Database Models ─────────┤
                                  ├─→ Chunk 3: Drawing UX (frontend)
                                  ├─→ Chunk 4: Address/OSM Backend
                                  │        └──→ Chunk 5: Address/OSM Frontend
                                  ├─→ Chunk 6: Operations Backend
                                  │        └──→ Chunk 7: Operations Frontend
                                  └─→ Chunk 8: Sharing & Discovery
```

Chunks 1 and 2 MUST complete before any other chunk starts. After that, Chunks 3, 4, 6, 8 can run in parallel. Chunks 5 depends on 4; Chunk 7 depends on 6.

---

## File Structure

### Hub-API New Files
```
hub-api/src/
├── lib/
│   ├── bull.ts                      # BullMQ queue init + Redis connection
│   ├── postgis-helpers.ts           # PostGIS spatial SQL helpers (carry from frozen hub)
│   ├── osm-overpass.ts              # Overpass API client (carry from frozen hub)
│   ├── osm-nominatim.ts            # Nominatim geocoding client (carry from frozen hub)
│   ├── geometry-utils.ts           # (note: also carry to hub-app/src/lib/ — Douglas-Peucker for lasso)
│   ├── share-service.ts            # Share link CRUD, code generation, hashing
│   ├── adaptive-due-date.ts        # Due date calculation formula (Spec 3)
│   └── campaign-report.ts          # Campaign result report generation
├── routes/
│   ├── addresses.ts                 # Address CRUD + visit logging
│   ├── gap-detection.ts            # Gap detection runs, ignore list, proposals
│   ├── local-osm.ts                # Local OSM feature CRUD
│   ├── heatmap.ts                  # Heatmap data aggregation (6 modes)
│   ├── import.ts                   # KML/CSV import
│   ├── campaigns.ts                # Campaign CRUD + lifecycle
│   ├── field-groups.ts             # Field groups + location sharing
│   ├── assignments.ts              # Assignment CRUD, due dates, Kanban board data
│   ├── meeting-points.ts           # Meeting point CRUD per campaign
│   └── territory-shares.ts        # Public share link CRUD + redeem
├── workers/
│   └── osm-refresh.ts              # BullMQ worker for async OSM refresh
└── jobs/
    ├── assignment-overdue-check.ts   # Daily overdue check (06:00 UTC)
    ├── campaign-auto-close.ts       # Daily campaign close check (06:00 UTC)
    └── share-log-purge.ts          # Daily access log cleanup (03:00 UTC)
```

### Hub-API Modified Files
```
hub-api/src/
├── index.ts                         # Register new routes
├── lib/
│   ├── permissions.ts               # Add all new permission constants
│   ├── rbac.ts                      # Add requireAnyPermission(), keep requirePermission()
│   ├── policy-engine.ts             # Add dynamic conductor/assistant resolution
│   └── seed-roles.ts               # Add new permissions to AppRoles
├── routes/
│   ├── territories.ts               # Migrate to requirePermission(), add snap-context
│   ├── publishers.ts                # Migrate to requirePermission()
│   ├── meetings.ts                  # Migrate to requirePermission()
│   ├── meeting-periods.ts           # Migrate to requirePermission()
│   ├── meeting-assignments.ts       # Migrate to requirePermission()
│   ├── speakers.ts                  # Migrate to requirePermission()
│   ├── public-talks.ts              # Migrate to requirePermission()
│   ├── sharing.ts                   # Migrate + add territory sync + discovery proxy
│   ├── congregation-settings.ts     # Migrate to requirePermission()
│   ├── permissions.ts (routes)      # Migrate to requirePermission()
│   ├── chat.ts                      # Migrate to requirePermission()
│   ├── audit.ts                     # Migrate to requirePermission()
│   └── service-groups.ts            # Migrate to requirePermission()
└── prisma/
    └── schema.prisma                # Add all new models + fields
```

### Hub-App New Files
```
hub-app/src/
├── pages/territories/
│   ├── TerritoryEditor.tsx          # Main editor: vertex handles, snap engine, undo/redo
│   ├── VertexHandle.tsx             # Draggable vertex circle
│   ├── MidpointHandle.tsx           # Clickable midpoint, converts to vertex
│   ├── SnapEngine.ts               # Pure function: drag pos + targets → snapped pos
│   ├── ScissorsAffordance.tsx       # Split icon on polygon edge hover
│   ├── SplitFlow.tsx               # Modal: draw cut line → name new territory
│   ├── CreationFlow.tsx            # Click-to-place + lasso drawing
│   ├── EditHUD.tsx                 # Bottom overlay: undo/redo + save status
│   ├── ContextMenu.tsx             # Right-click / long-press menu
│   ├── AddressPanel.tsx            # Address list + detail sidebar
│   ├── AddressForm.tsx             # Create/edit address form
│   ├── VisitLogger.tsx             # Quick-entry visit form
│   ├── VisitHistory.tsx            # Chronological visit list
│   ├── GapDetection.tsx            # Gap detection page
│   ├── LocalOsmEditor.tsx          # Local OSM feature drawing UI
│   ├── HeatmapControl.tsx          # Map toolbar dropdown
│   ├── HeatmapLegend.tsx           # Color/icon legend overlay
│   ├── ImportWizard.tsx            # KML/CSV import flow
│   ├── OsmRefreshStatus.tsx        # Queue status + refresh button
│   ├── KanbanBoard.tsx             # Territory assignment Kanban
│   ├── KanbanCard.tsx              # Territory card component
│   ├── CampaignList.tsx            # Campaign management list
│   ├── CampaignForm.tsx            # Create/edit campaign
│   ├── CampaignDetail.tsx          # Campaign detail + meeting points
│   ├── CampaignReport.tsx          # Campaign result report
│   ├── MeetingPointManager.tsx     # Conductor/assistant assignment
│   ├── PublisherSidebar.tsx        # Kanban publisher list with capacity
│   ├── AssignDialog.tsx            # Territory assignment dialog
│   ├── FieldGroupPanel.tsx         # Field group management (conductor view)
│   ├── FieldGroupJoin.tsx          # Field group join/leave (publisher view)
│   ├── LocationShareConsent.tsx    # Location sharing opt-in dialog
│   ├── LocationMap.tsx             # Real-time location sharing map
│   ├── ShareLinkManager.tsx        # Public share link management
│   ├── ShareRedeemPage.tsx         # Public share redeem page (no auth)
│   └── DiscoverySearch.tsx         # Central congregation discovery
├── hooks/
│   ├── useTerritoryEditor.ts       # Editor state management
│   ├── useSnapEngine.ts            # Snap context fetch + engine
│   ├── useUndoRedo.ts              # Undo/redo stack
│   └── useMapLibre.ts              # MapLibre instance management
└── lib/
    └── territory-api.ts            # API client for all territory endpoints
```

### Hub-App Modified Files
```
hub-app/src/
├── App.tsx                          # Add new routes
├── components/Sidebar.tsx           # Add territory module nav items
└── pages/territories/
    ├── TerritoryList.tsx            # Enhance with heatmap toggle
    └── TerritoryMap.tsx             # Integrate TerritoryEditor
```

### Central-API New/Modified Files
```
central-api/src/
├── routes/sharing.ts                # Add discovery endpoint, depth filtering
├── prisma/schema.prisma             # Add Tenant discovery fields
└── lib/
    ├── haversine.ts                 # Geoproximity distance calculation
    └── sharing-depth-filter.ts      # Depth-based territory data filtering
```

### Docker
```
docker-compose.yml                   # Add redis service
```

---

## Chunk 1: RBAC Foundation

**Spec:** 4 (Sharing & RBAC)
**Layer:** hub-api
**Depends on:** Nothing
**Blocks:** All other chunks

This chunk migrates ALL hub-api routes from `requireRole()` to `requirePermission()`, adds all new permission constants, updates AppRole seeds, and adds dynamic conductor/assistant resolution.

### Task 1.1: Add New Permission Constants

**Files:**
- Modify: `hub-api/src/lib/permissions.ts`

- [ ] **Step 1: Read existing permissions.ts**

Read the full file to understand the current structure and naming conventions.

- [ ] **Step 2: Write tests for new permission constants**

Create: `hub-api/src/lib/__tests__/permissions.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { PERMISSIONS } from '../permissions.js';

describe('PERMISSIONS', () => {
  // Territory Drawing (Spec 1)
  it('has territory drawing permissions', () => {
    expect(PERMISSIONS.TERRITORIES_DELETE).toBe('app:territories.delete');
    expect(PERMISSIONS.TERRITORIES_SPLIT).toBe('app:territories.split');
    expect(PERMISSIONS.TERRITORIES_IMPORT).toBe('app:territories.import');
    expect(PERMISSIONS.TERRITORIES_SHARE).toBe('app:territories.share');
  });

  // Address & OSM (Spec 2)
  it('has address and OSM permissions', () => {
    expect(PERMISSIONS.ADDRESSES_VIEW).toBe('app:addresses.view');
    expect(PERMISSIONS.ADDRESSES_EDIT).toBe('app:addresses.edit');
    expect(PERMISSIONS.ADDRESSES_IMPORT).toBe('app:addresses.import');
    expect(PERMISSIONS.OSM_REFRESH).toBe('app:osm.refresh');
    expect(PERMISSIONS.OSM_EDIT).toBe('app:osm.edit');
    expect(PERMISSIONS.GAP_DETECTION_VIEW).toBe('app:gapDetection.view');
    expect(PERMISSIONS.GAP_DETECTION_RUN).toBe('app:gapDetection.run');
  });

  // Territory Operations (Spec 3)
  it('has territory operations permissions', () => {
    expect(PERMISSIONS.ASSIGNMENTS_VIEW).toBe('app:assignments.view');
    expect(PERMISSIONS.ASSIGNMENTS_MANAGE).toBe('app:assignments.manage');
    expect(PERMISSIONS.CAMPAIGNS_VIEW).toBe('app:campaigns.view');
    expect(PERMISSIONS.CAMPAIGNS_MANAGE).toBe('app:campaigns.manage');
    expect(PERMISSIONS.CAMPAIGNS_CONDUCT).toBe('app:campaigns.conduct');
    expect(PERMISSIONS.CAMPAIGNS_ASSIST).toBe('app:campaigns.assist');
    expect(PERMISSIONS.CAMPAIGNS_REPORT).toBe('app:campaigns.report');
    expect(PERMISSIONS.CAMPAIGNS_LOCATION_SHARE).toBe('app:campaigns.location_share');
    expect(PERMISSIONS.LOCATION_VIEW).toBe('app:location.view');
  });

  // Groups (Spec 4)
  it('has group permissions', () => {
    expect(PERMISSIONS.GROUPS_VIEW).toBe('app:groups.view');
    expect(PERMISSIONS.GROUPS_EDIT).toBe('app:groups.edit');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd ~/github/itunified-io/hubport.cloud && npx vitest run hub-api/src/lib/__tests__/permissions.test.ts`
Expected: FAIL — new permission constants don't exist yet

- [ ] **Step 4: Add new permission constants to permissions.ts**

Add all new constants to the existing `PERMISSIONS` object. Follow the naming convention already established (SCREAMING_SNAKE_CASE keys, dot-separated string values with `app:` prefix).

Add to `BASE_ROLE_PERMISSIONS`:
- `publisher`: add `ADDRESSES_VIEW`, `ASSIGNMENTS_VIEW`, `CAMPAIGNS_VIEW`, `CAMPAIGNS_LOCATION_SHARE`
- `elder`: add ALL new permissions
- `admin`: already has `*` wildcard, no changes

Add to `PAGE_PERMISSIONS`:
- `'/territories'`: add `PERMISSIONS.ADDRESSES_VIEW`
- `'/territories/campaigns'`: `[PERMISSIONS.CAMPAIGNS_VIEW]`
- `'/territories/gap-detection'`: `[PERMISSIONS.GAP_DETECTION_VIEW]`
- `'/territories/kanban'`: `[PERMISSIONS.ASSIGNMENTS_VIEW]`

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ~/github/itunified-io/hubport.cloud && npx vitest run hub-api/src/lib/__tests__/permissions.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd ~/github/itunified-io/hubport.cloud && git add hub-api/src/lib/permissions.ts hub-api/src/lib/__tests__/permissions.test.ts && git commit -m "feat: add territory module permission constants (Spec 4)"
```

### Task 1.2: Add `requireAnyPermission()` Middleware

**Files:**
- Modify: `hub-api/src/lib/rbac.ts`

- [ ] **Step 1: Read existing rbac.ts**

Read the full file to understand `requirePermission()` implementation.

- [ ] **Step 2: Write tests for requireAnyPermission**

Create: `hub-api/src/lib/__tests__/rbac.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireAnyPermission } from '../rbac.js';

// Follow the pattern from existing api-token-auth.test.ts for mocking Fastify request/reply
const mockReply = () => {
  const reply: any = { code: vi.fn().mockReturnThis(), send: vi.fn() };
  return reply;
};

describe('requireAnyPermission', () => {
  it('passes if user has ANY listed permission', async () => {
    const handler = requireAnyPermission('app:a', 'app:b');
    const request = { policyCtx: { effectivePermissions: ['app:b'] } } as any;
    const reply = mockReply();
    await handler(request, reply);
    expect(reply.code).not.toHaveBeenCalled();
  });

  it('returns 403 if user has NONE of the listed permissions', async () => {
    const handler = requireAnyPermission('app:a', 'app:b');
    const request = { policyCtx: { effectivePermissions: ['app:c'] } } as any;
    const reply = mockReply();
    await handler(request, reply);
    expect(reply.code).toHaveBeenCalledWith(403);
  });

  it('returns 401 if policyCtx is missing', async () => {
    const handler = requireAnyPermission('app:a');
    const request = {} as any;
    const reply = mockReply();
    await handler(request, reply);
    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it('passes if user has wildcard permission', async () => {
    const handler = requireAnyPermission('app:a', 'app:b');
    const request = { policyCtx: { effectivePermissions: ['*'] } } as any;
    const reply = mockReply();
    await handler(request, reply);
    expect(reply.code).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

- [ ] **Step 4: Implement `requireAnyPermission()`**

Add to `rbac.ts` alongside existing `requirePermission()`:

```typescript
export function requireAnyPermission(...permissions: string[]): FastifyPreHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const ctx = request.policyCtx;
    if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

    const hasAny = permissions.some(p => ctx.effectivePermissions.includes(p) || ctx.effectivePermissions.includes('*'));
    if (!hasAny) {
      return reply.code(403).send({
        error: 'Forbidden',
        requiredPermissions: permissions,
        logic: 'any'
      });
    }
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

- [ ] **Step 6: Commit**

```bash
cd ~/github/itunified-io/hubport.cloud && git add hub-api/src/lib/rbac.ts hub-api/src/lib/__tests__/rbac.test.ts && git commit -m "feat: add requireAnyPermission middleware (Spec 4)"
```

### Task 1.3: Add Dynamic Conductor/Assistant Permission Resolution

**Files:**
- Modify: `hub-api/src/lib/policy-engine.ts`

- [ ] **Step 1: Read existing policy-engine.ts**

Understand the `buildContext()` and `can()` methods.

- [ ] **Step 2: Write tests for dynamic permission resolution**

Create: `hub-api/src/lib/__tests__/policy-engine-dynamic.test.ts`

Test cases:
- User who IS a conductor on an active campaign gets `campaigns.conduct`, `campaigns.assist`, `assignments.manage`, `location.view`
- User who IS an assistant on an active campaign gets `campaigns.assist`, `location.view`
- User who is NEITHER conductor nor assistant gets no dynamic permissions
- Dynamic permissions include `scopes.territoryIds` for territory isolation
- Campaign in non-active status (draft, closed) does NOT grant dynamic permissions
- User with both static and dynamic permissions gets the union

- [ ] **Step 3: Run test to verify it fails**

- [ ] **Step 4: Implement dynamic resolution in `buildContext()`**

After static permission resolution, query `CampaignMeetingPoint` for active campaigns where user is conductor or in assistantIds. Merge dynamic permissions and set `scopes.territoryIds` on the context.

- [ ] **Step 5: Run test to verify it passes**

- [ ] **Step 6: Commit**

```bash
cd ~/github/itunified-io/hubport.cloud && git add hub-api/src/lib/policy-engine.ts hub-api/src/lib/__tests__/policy-engine-dynamic.test.ts && git commit -m "feat: add dynamic conductor/assistant permission resolution (Spec 4)"
```

### Task 1.4: Update AppRole Seeds

**Files:**
- Modify: `hub-api/src/lib/seed-roles.ts`

- [ ] **Step 1: Read existing seed-roles.ts**

- [ ] **Step 2: Add new permissions to each AppRole**

Per Spec 4 seed script section:
- **Service Overseer:** Add `territories.delete`, `territories.split`, `territories.import`, `territories.share`, `addresses.*`, `osm.*`, `gapDetection.*`, `assignments.*`, `campaigns.manage/view/report`, `location.view`
- **Service Overseer Assistant:** Add `addresses.view/edit`, `osm.refresh/edit`, `gapDetection.view/run`, `assignments.view/manage`, `campaigns.view/assist/report`, `location.view`, `groups.view/edit`
- **Publisher base permissions** are handled in `BASE_ROLE_PERMISSIONS` (Task 1.1), not in seed-roles

- [ ] **Step 3: Commit**

```bash
cd ~/github/itunified-io/hubport.cloud && git add hub-api/src/lib/seed-roles.ts && git commit -m "feat: add territory module permissions to AppRole seeds (Spec 4)"
```

### Task 1.5: Migrate All Existing Routes to requirePermission()

**Files:**
- Modify: ALL route files in `hub-api/src/routes/`

This is the bulk migration. For each route file, replace `requireRole("elder")` → `requirePermission(PERMISSIONS.X)` and `requireRole("publisher")` → `requirePermission(PERMISSIONS.Y)` per the mapping in Spec 4.

- [ ] **Step 1: Migrate territories.ts**

Replace guards per Spec 4 route migration table. Example:
- `GET /territories`: `requireRole("publisher")` → `requirePermission(PERMISSIONS.TERRITORIES_VIEW)`
- `POST /territories`: `requireRole("elder")` → `requirePermission(PERMISSIONS.TERRITORIES_EDIT)`
- `DELETE /territories/:id`: `requireRole("elder")` → `requirePermission(PERMISSIONS.TERRITORIES_DELETE)`
- `POST /territories/:id/assign`: `requireRole("elder")` → `requireAnyPermission(PERMISSIONS.ASSIGNMENTS_MANAGE, PERMISSIONS.CAMPAIGNS_ASSIST)`

- [ ] **Step 2: Commit territories.ts**

```bash
cd ~/github/itunified-io/hubport.cloud && git add hub-api/src/routes/territories.ts && git commit -m "refactor: migrate territory routes to requirePermission (Spec 4)"
```

- [ ] **Step 3: Migrate publishers.ts**

- [ ] **Step 4: Commit publishers.ts**

- [ ] **Step 5: Migrate meetings.ts, meeting-periods.ts, meeting-assignments.ts**

- [ ] **Step 6: Commit meeting routes**

- [ ] **Step 7: Migrate speakers.ts, public-talks.ts**

- [ ] **Step 8: Commit speaker routes**

- [ ] **Step 9: Migrate sharing.ts**

- [ ] **Step 10: Commit sharing.ts**

- [ ] **Step 11: Migrate congregation-settings.ts, permissions.ts (routes), chat.ts, audit.ts, service-groups.ts**

Note: Check the actual route files in hub-api/src/routes/ for any additional unmigrated files (e.g., `cleaning.ts` if it exists). Migrate any remaining route files that still use `requireRole()`.

- [ ] **Step 12: Commit remaining routes**

- [ ] **Step 13: Remove `requireRole()` function from rbac.ts**

After all routes are migrated, remove the legacy `requireRole()` function and all its imports. The function definition in `rbac.ts` and all `import { requireRole }` statements in route files should be removed.

- [ ] **Step 14: Verify build compiles**

Run: `cd ~/github/itunified-io/hubport.cloud && npx tsc --noEmit -p hub-api/tsconfig.json`
Expected: No errors

- [ ] **Step 15: Commit cleanup**

```bash
cd ~/github/itunified-io/hubport.cloud && git add -A && git commit -m "refactor: remove legacy requireRole, complete migration to requirePermission (Spec 4)"
```

---

## Chunk 2: Database Models

**Spec:** 2, 3, 4
**Layer:** hub-api (Prisma) + central-api (Prisma)
**Depends on:** Chunk 1 (permissions must exist for seed)
**Blocks:** All feature chunks (3-8)

### Task 2.1: Add Hub-API Prisma Models (Spec 2 — Address & OSM)

**Files:**
- Modify: `hub-api/prisma/schema.prisma`

- [ ] **Step 1: Read existing schema.prisma**

- [ ] **Step 2: Add Address model with all fields from Spec 2**

Add enums: `AddressType`, `AddressStatus`, `AddressSource`, `VisitOutcome`. Add models: `Address`, `AddressVisit`. Add relation on Territory model: `addresses Address[]`.

- [ ] **Step 3: Add LocalOsmFeature model**

Add enum: `LocalOsmType`. Add model with all fields from Spec 2.

- [ ] **Step 4: Add IgnoredOsmBuilding model**

- [ ] **Step 5: Add OsmRefreshQueue model**

Add relation on Territory model: `osmRefreshJobs OsmRefreshQueue[]`.

- [ ] **Step 6: Add GapDetectionRun model**

- [ ] **Step 7: Commit**

```bash
cd ~/github/itunified-io/hubport.cloud && git add hub-api/prisma/schema.prisma && git commit -m "feat: add Address, OSM, and gap detection Prisma models (Spec 2)"
```

### Task 2.2: Add Hub-API Prisma Models (Spec 3 — Operations)

**Files:**
- Modify: `hub-api/prisma/schema.prisma`

- [ ] **Step 1: Add Campaign model with all fields from Spec 3**

Add enum: `CampaignType` (memorial, convention, special, letter_writing, custom). Add model with JSON fields for `territoryIds` and `resultReport`.

- [ ] **Step 2: Add CampaignMeetingPoint model**

JSON field for `assistantIds`.

- [ ] **Step 3: Add CampaignFieldGroup model**

Add enum: `FieldGroupStatus` (open, in_field, closed).

- [ ] **Step 4: Add LocationShare model**

- [ ] **Step 5: Modify TerritoryAssignment model**

Add fields: `campaignId String?`, `isSuspended Boolean @default(false)`, `returnedBy String?`, `groupId String?`. DO NOT add FK relations for memberId/groupId (deliberately unlinked per Spec 3 ID Convention).

- [ ] **Step 6: Add TenantSettings new fields**

Add all new fields from Specs 3+4 TenantSettings sections: `defaultCheckoutDays Int @default(120)` (Spec 3 — used by adaptive due date formula, unit is days), `overdueReminderDays Int @default(14)`, `returnedVisibleDays Int @default(30)`, `osmRefreshCooldownHours Int @default(24)`, `gapDetectionMinArea Int @default(50)`, `defaultShareScope String @default("boundary")`, `defaultShareDays Int @default(30)`, `shareMaxDays Int @default(90)`, `autoSyncTerritories Boolean @default(false)`, `requirePINForFullShare Boolean @default(false)`.

Note: Spec 4 uses `defaultDueMonths` but Spec 3 uses `defaultCheckoutDays` (days, default 120) in the adaptive due date formula. Use `defaultCheckoutDays` as the canonical field name since Spec 3's formula depends on it directly.

- [ ] **Step 7: Add `shareExcluded Boolean @default(false)` to Territory model**

- [ ] **Step 8: Commit**

```bash
cd ~/github/itunified-io/hubport.cloud && git add hub-api/prisma/schema.prisma && git commit -m "feat: add Campaign, Assignment, and TenantSettings Prisma models (Spec 3+4)"
```

### Task 2.3: Add Hub-API Prisma Models (Spec 4 — Sharing)

**Files:**
- Modify: `hub-api/prisma/schema.prisma`

- [ ] **Step 1: Add TerritoryShare model**

With `codeHash`, `scope`, `pinHash`, `pinAttempts`, `expiresAt`, `revokedAt`, `revokedBy`, `isActive`. Add relation on Territory: `shares TerritoryShare[]`.

- [ ] **Step 2: Add ShareAccessLog model**

With `ipHash`, `userAgent`, relation to TerritoryShare.

- [ ] **Step 3: Add `depth String @default("boundary")` to SharingVisibility model**

- [ ] **Step 4: Commit**

```bash
cd ~/github/itunified-io/hubport.cloud && git add hub-api/prisma/schema.prisma && git commit -m "feat: add TerritoryShare and ShareAccessLog Prisma models (Spec 4)"
```

### Task 2.4: Add Central-API Prisma Model Changes

**Files:**
- Modify: `central-api/prisma/schema.prisma`

- [ ] **Step 1: Add discovery fields to Tenant model**

Add: `discoverable Boolean @default(false)`, `centroidLat Float?`, `centroidLng Float?`, `circuitNumber String?`, `region String?`, `country String?`, `city String?`.

- [ ] **Step 2: Add `syncedAt` field to SharedTerritory model**

Add: `syncedAt DateTime @default(now())` alongside existing `updatedAt`.

- [ ] **Step 3: Commit**

```bash
cd ~/github/itunified-io/hubport.cloud && git add central-api/prisma/schema.prisma && git commit -m "feat: add Tenant discovery fields and SharedTerritory.syncedAt (Spec 4)"
```

### Task 2.5: Run Prisma Migrations

- [ ] **Step 1: Generate hub-api Prisma client**

Run: `cd ~/github/itunified-io/hubport.cloud/hub-api && npx prisma generate`

- [ ] **Step 2: Generate central-api Prisma client**

Run: `cd ~/github/itunified-io/hubport.cloud/central-api && npx prisma generate`

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd ~/github/itunified-io/hubport.cloud && npx tsc --noEmit -p hub-api/tsconfig.json && npx tsc --noEmit -p central-api/tsconfig.json`

- [ ] **Step 4: Add PostGIS raw SQL migration for Address.point column**

Create: `hub-api/prisma/migrations/add_address_point_column.sql`

```sql
ALTER TABLE "Address" ADD COLUMN IF NOT EXISTS point geometry(Point, 4326);
CREATE INDEX IF NOT EXISTS idx_address_point ON "Address" USING GIST (point);
```

This runs after `prisma db push`. Add the PostGIS column creation to `docker-entrypoint.sh` (or the existing startup script) to run after `npx prisma db push`:

```bash
# After prisma db push, apply PostGIS extensions
psql "$DATABASE_URL" -f prisma/migrations/add_address_point_column.sql
```

- [ ] **Step 4b: Wire PostGIS migration into docker-entrypoint.sh**

Modify `docker-entrypoint.sh` to execute the raw SQL migration after `prisma db push`. Verify the column exists by running `psql "$DATABASE_URL" -c "SELECT column_name FROM information_schema.columns WHERE table_name='Address' AND column_name='point'"`.

- [ ] **Step 5: Commit**

```bash
cd ~/github/itunified-io/hubport.cloud && git add -A && git commit -m "feat: generate Prisma clients and add PostGIS migration (Specs 2-4)"
```

### Task 2.6: Add Redis to Docker Stack

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Read existing docker-compose.yml**

- [ ] **Step 2: Add redis service**

Add per Spec 2:
```yaml
redis:
  image: redis:7-alpine
  restart: unless-stopped
  volumes:
    - redis-data:/data
  command: redis-server --appendonly yes --maxmemory 128mb --maxmemory-policy allkeys-lru
```

Add `redis-data` to the `volumes:` section. Add `REDIS_URL: redis://redis:6379` to the hubport service environment.

- [ ] **Step 3: Commit**

```bash
cd ~/github/itunified-io/hubport.cloud && git add docker-compose.yml && git commit -m "feat: add Redis to Docker stack for BullMQ (Spec 2)"
```

---

## Chunk 3: Territory Drawing UX

**Spec:** 1 (Drawing UX)
**Layer:** hub-app (frontend only) + one new hub-api endpoint
**Depends on:** Chunks 1-2
**Blocks:** Nothing

### Task 3.1: Snap Context API Endpoint

**Files:**
- Modify: `hub-api/src/routes/territories.ts`
- Create: `hub-api/src/lib/postgis-helpers.ts` (carry from frozen hub)
- Create: `hub-api/src/lib/osm-overpass.ts` (carry from frozen hub)
- Create: `hub-api/src/lib/osm-nominatim.ts` (carry from frozen hub — used by address geocoding in Chunk 4)
- Create: `hub-app/src/lib/geometry-utils.ts` (carry from frozen hub — Douglas-Peucker, polygon cleanup)

- [ ] **Step 1: Carry over `postgis-helpers.ts` from frozen hub**

Copy spatial SQL helpers from `~/github/itunified-io/hub/services/hub-api/src/lib/postgis-helpers.ts`. Adapt imports for hubport.cloud (prisma client path, TypeScript config). Verify TypeScript compiles: `npx tsc --noEmit -p hub-api/tsconfig.json`.

- [ ] **Step 2: Carry over `osm-overpass.ts` and `osm-nominatim.ts` from frozen hub**

Copy Overpass API client and Nominatim geocoding client from frozen hub. Adapt imports. Verify compiles.

- [ ] **Step 3: Carry over `geometry-utils.ts` from frozen hub to hub-app**

Copy `geometry-utils.ts` (Douglas-Peucker simplification, polygon cleanup). Adapt for hub-app TypeScript config. This is used by CreationFlow (Task 3.6) for freehand lasso simplification.

- [ ] **Step 4: Write test for snap-context endpoint**

Create: `hub-api/src/routes/__tests__/snap-context.test.ts`

Test: valid bbox returns combined GeoJSON, invalid bbox returns 400, permission check enforced. Follow existing route test patterns.

- [ ] **Step 5: Run test to verify it fails**

- [ ] **Step 6: Add `GET /territories/snap-context` endpoint to territories.ts**

Query params: `bbox` (format: `minLng,minLat,maxLng,maxLat`). Combines `queryRoadsInBBox()`, `queryBuildingsInBBox()`, `queryWaterBodiesInBBox()` from osm-overpass.ts. Returns combined GeoJSON response. Permission: `requirePermission(PERMISSIONS.TERRITORIES_VIEW)`.

- [ ] **Step 7: Run test to verify it passes**

- [ ] **Step 8: Commit**

```bash
cd ~/github/itunified-io/hubport.cloud && git add -A && git commit -m "feat: add snap-context endpoint, PostGIS/OSM/geometry helpers (Spec 1)"
```

### Task 3.2: Snap Engine (Pure Function)

**Files:**
- Create: `hub-app/src/pages/territories/SnapEngine.ts`

- [ ] **Step 1: Write tests for snap engine**

Create: `hub-app/src/pages/territories/__tests__/SnapEngine.test.ts`

Test snap priority order: neighbor edge > road > congregation boundary > building. Test tolerance (15px). Test Alt/Option override disables snapping. Test multiple candidates — highest priority wins, ties by distance.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement SnapEngine**

Pure function: `snapVertex(dragPosition, snapTargets, tolerance) → { position, label, snappedTo }`. Uses R-tree (rbush) for spatial indexing. Evaluates candidates in priority order.

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
cd ~/github/itunified-io/hubport.cloud && git add -A && git commit -m "feat: implement SnapEngine with priority-based snapping (Spec 1)"
```

### Task 3.3: Undo/Redo Stack Hook

**Files:**
- Create: `hub-app/src/hooks/useUndoRedo.ts`

- [ ] **Step 1: Write tests**

Test: push, undo, redo, max 50 entries, optimistic apply, rollback on failure.

- [ ] **Step 2: Implement useUndoRedo hook**

Stack of `{ territoryId, beforeGeometry, afterGeometry, description, timestamp, sequenceNumber }`. Exposes `undo()`, `redo()`, `push()`, `canUndo`, `canRedo`, `syncStatus`.

- [ ] **Step 3: Run tests to verify pass**

Run: `cd ~/github/itunified-io/hubport.cloud && npx vitest run hub-app/src/hooks/__tests__/useUndoRedo.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd ~/github/itunified-io/hubport.cloud && git add hub-app/src/hooks/useUndoRedo.ts hub-app/src/hooks/__tests__/useUndoRedo.test.ts && git commit -m "feat: implement useUndoRedo hook with optimistic apply (Spec 1)"
```

### Task 3.4: Vertex Handle Components

**Files:**
- Create: `hub-app/src/pages/territories/VertexHandle.tsx`
- Create: `hub-app/src/pages/territories/MidpointHandle.tsx`
- Create: `hub-app/src/pages/territories/ContextMenu.tsx`

- [ ] **Step 1: Implement VertexHandle**

Draggable white circle positioned via `map.project()`/`map.unproject()`. On drag: fires `pointermove` through snap engine, updates GeoJSON source for live preview. On drop: pushes to undo stack, fires `updateTerritory()` API call in background.

- [ ] **Step 2: Implement MidpointHandle**

Smaller, semi-transparent circle on edge midpoints. On click/tap: converts to full vertex, creates two new midpoints on adjacent edges.

- [ ] **Step 3: Implement ContextMenu**

Desktop: right-click vertex. Tablet: long-press. Options: "Delete vertex" (min 3 enforced).

- [ ] **Step 4: Commit**

### Task 3.5: MapLibre Instance Hook

**Files:**
- Create: `hub-app/src/hooks/useMapLibre.ts`

- [ ] **Step 1: Implement useMapLibre hook**

Wraps MapLibre GL JS map instance lifecycle: initialization, cleanup, ref management. Provides `mapRef`, `isLoaded`, `addSource()`, `addLayer()`, `fitBounds()`. Used by TerritoryEditor, LocationMap, and any component needing map access.

- [ ] **Step 2: Commit**

```bash
cd ~/github/itunified-io/hubport.cloud && git add hub-app/src/hooks/useMapLibre.ts && git commit -m "feat: add useMapLibre hook for map instance management (Spec 1)"
```

### Task 3.6: Territory Editor Main Component

**Files:**
- Create: `hub-app/src/pages/territories/TerritoryEditor.tsx`
- Create: `hub-app/src/hooks/useTerritoryEditor.ts`
- Create: `hub-app/src/hooks/useSnapEngine.ts`

- [ ] **Step 1: Implement useTerritoryEditor hook**

Manages: selected territory, vertex handles state, edit mode (select/create/split), snap context cache, keyboard shortcuts (Cmd+Z, Cmd+Shift+Z). Fetches snap context via `/territories/snap-context?bbox=...` on viewport change (>50% change threshold).

- [ ] **Step 2: Implement useSnapEngine hook**

Wraps SnapEngine pure function. Manages R-tree build on snap context load. Throttles to 16ms (one per frame). Handles Alt/Option key to disable snapping.

- [ ] **Step 3: Implement TerritoryEditor**

Main component replacing TerritoryStudioV2. Renders: territory polygons (GeoJSON source), vertex handles (when selected), midpoint handles, snap feedback badge. Handles: click to select, drag to reshape, keyboard shortcuts. Checks `hasPermission('app:territories.edit')` before rendering handles.

- [ ] **Step 4: Commit**

### Task 3.6: Creation Flow (Click-to-Place + Lasso)

**Files:**
- Create: `hub-app/src/pages/territories/CreationFlow.tsx`

- [ ] **Step 1: Implement click-to-place mode**

Enter via "Draw boundary" button. Click to place vertices. Double-click or click first vertex to close polygon. Auto-snap completed polygon.

- [ ] **Step 2: Implement freehand lasso mode**

Hold Shift + click-drag. On mouse-up: convert to clean polygon via Douglas-Peucker from `geometry-utils.ts` (tolerance ~5m at current zoom, convert screen pixels to meters using map zoom level). Auto-snap vertices.

- [ ] **Step 3: Both modes clip to congregation boundary and subtract water bodies**

- [ ] **Step 4: Commit**

### Task 3.7: Split Flow (Scissors)

**Files:**
- Create: `hub-app/src/pages/territories/ScissorsAffordance.tsx`
- Create: `hub-app/src/pages/territories/SplitFlow.tsx`

- [ ] **Step 1: Implement ScissorsAffordance**

On polygon edge hover (desktop): show scissors icon (✂️). Permission check: `hasPermission('app:territories.split')`.

- [ ] **Step 2: Implement SplitFlow**

On scissors click: enter split mode (crosshair cursor). Draw cut line across territory. Double-click to confirm. Calls `POST /territories/studio/deterministic-plan` with split operation. Shows dialog: name/number the new territory. On confirm: `PUT /territories/:id` + `POST /territories`.

- [ ] **Step 3: Commit**

### Task 3.8: Edit HUD

**Files:**
- Create: `hub-app/src/pages/territories/EditHUD.tsx`

- [ ] **Step 1: Implement minimal bottom bar overlay**

Left: undo/redo hints (keyboard on desktop, icon buttons on tablet). Right: save status ("Saved ✓" / "Saving..." / "Error — tap to retry"). Render only when territory is selected and user has edit permission.

- [ ] **Step 2: Commit**

### Task 3.9: Integrate TerritoryEditor into Existing Map

**Files:**
- Modify: `hub-app/src/pages/territories/TerritoryMap.tsx`
- Modify: `hub-app/src/App.tsx`

- [ ] **Step 1: Replace/wrap TerritoryMap with TerritoryEditor**

TerritoryMap becomes the view-only map. TerritoryEditor wraps it and adds editing capabilities when user has permission. Non-editors see the existing view.

- [ ] **Step 2: Verify existing territory display is unaffected**

Run dev server, navigate to territory map. Confirm: territories still render correctly, click-to-select works, no console errors. This is the highest-risk step — modifying existing production code.

- [ ] **Step 3: Add route in App.tsx if needed**

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd ~/github/itunified-io/hubport.cloud && npx tsc --noEmit -p hub-app/tsconfig.json`

- [ ] **Step 5: Commit**

---

## Chunk 4: Address & OSM Backend

**Spec:** 2 (Address & OSM Management)
**Layer:** hub-api
**Depends on:** Chunks 1-2
**Blocks:** Chunk 5 (frontend)

### Task 4.1: BullMQ Queue Setup

**Files:**
- Create: `hub-api/src/lib/bull.ts`

- [ ] **Step 1: Write tests**

Test queue initialization, Redis connection handling, graceful shutdown. Test 503 response when Redis unavailable.

- [ ] **Step 2: Implement bull.ts**

```typescript
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

export const osmRefreshQueue = new Queue('osm-refresh', { connection });

export function isRedisAvailable(): Promise<boolean> {
  return connection.ping().then(() => true).catch(() => false);
}
```

- [ ] **Step 3: Run tests, commit**

### Task 4.2: OSM Refresh Worker

**Files:**
- Create: `hub-api/src/workers/osm-refresh.ts`

- [ ] **Step 1: Write tests**

Test: worker processes job, fetches buildings via Overpass (uses `osm-overpass.ts`), geocodes via `osm-nominatim.ts`, matches by osmNodeId, creates/updates addresses, respects local OSM overrides, updates queue entry with counters.

- [ ] **Step 2: Implement worker**

BullMQ Worker on `osm-refresh` queue. Concurrency: 1. For each job: fetch buildings in territory polygon → match against existing addresses → create/update → check LocalOsmFeature overrides → update OsmRefreshQueue status.

- [ ] **Step 3: Run tests, commit**

### Task 4.3: Address Routes

**Files:**
- Create: `hub-api/src/routes/addresses.ts`

- [ ] **Step 1: Write tests for address CRUD**

Test: list addresses in territory, create address, update address, delete address (cascades visits), bulk create (max 500 limit), publisher scoping (only own assigned territory).

- [ ] **Step 2: Implement address routes**

Per Spec 2 API endpoints table. Include PostGIS point management: set `point = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)` on create/update when coordinates provided.

- [ ] **Step 3: Implement DNC auto-revert logic**

On `GET /territories/:id/addresses`: run `UPDATE "Address" SET status='active', "doNotCallReason"=NULL, "doNotVisitUntil"=NULL WHERE "territoryId"=$1 AND "doNotVisitUntil" < NOW() AND status='do_not_call'`. Return `meta.revertedCount`.

- [ ] **Step 4: Implement visit logging**

`POST /territories/:id/addresses/:addrId/visits`: Create immutable AddressVisit. Denormalize `lastVisitDate` and `lastVisitOutcome` on Address. Update Territory.lastWorkedDate.

- [ ] **Step 5: Register in index.ts, commit**

### Task 4.4: OSM Refresh Routes

**Files:**
- Add to: `hub-api/src/routes/addresses.ts` (or create separate `hub-api/src/routes/osm-refresh.ts`)

- [ ] **Step 1: Implement `POST /territories/:id/osm-refresh`**

Check Redis available (503 if not). Check cooldown: read `TenantSettings.osmRefreshCooldownHours`, compare against last completed OsmRefreshQueue entry for this territory — reject with 429 if within cooldown window. Check duplicate (already queued/processing → 409). Queue job. Return job ID. Permission: `requirePermission(PERMISSIONS.OSM_REFRESH)`.

- [ ] **Step 2: Implement `POST /territories/osm-refresh/bulk`**

Same as single but for array of territoryIds.

- [ ] **Step 3: Implement `GET /territories/osm-refresh/queue`**

Return last 50 jobs with status + counters.

- [ ] **Step 4: Commit**

### Task 4.5: Gap Detection Routes

**Files:**
- Create: `hub-api/src/routes/gap-detection.ts`

- [ ] **Step 1: Write tests**

Test: run detection (synchronous), proper timeout handling, ignore/un-ignore buildings, coverage proposals, publisher filtering.

- [ ] **Step 2: Implement gap detection run**

`POST /territories/gap-detection/run`: Synchronous with 120s timeout. Fetch congregation boundary → query buildings via Overpass → `ST_Contains` checks using `postgis-helpers.ts` `findAddressesInBoundary()` (batch 500 at a time) → filter ignored buildings → address sync (3-step: update existing territory-attached addresses, re-attach pooled addresses by matching osmNodeId, create new addresses for remaining buildings). Return summary with counts.

- [ ] **Step 3: Implement ignore/un-ignore endpoints**

Batch ignore, single un-ignore, list ignored.

- [ ] **Step 4: Implement coverage proposals**

`POST /territories/gap-detection/proposals`: Use PostGIS helpers for proposal generation + scoring.

- [ ] **Step 5: Implement run history**

Retention: last 3 completed + 3 failed. Auto-prune: when a new run completes, delete the oldest completed run if count > 3; same for failed runs independently.

- [ ] **Step 6: Register in index.ts, commit**

### Task 4.6: Local OSM Feature Routes

**Files:**
- Create: `hub-api/src/routes/local-osm.ts`

- [ ] **Step 1: Write tests**

Test: CRUD for each feature type, geometry validation per type, required properties validation, bbox filtering, unique osmId per tenant.

- [ ] **Step 2: Implement local-osm routes**

Per Spec 2. Validate geometry (RFC 7946, type-specific rules). Validate required properties per featureType.

- [ ] **Step 3: Extend snap-context endpoint to include local streets**

Modify `GET /territories/snap-context` in territories.ts: query LocalOsmFeature where `featureType = 'street'` within bbox, merge into road set.

Note: This modifies the same endpoint created in Task 3.1 Step 6. If Chunks 3 and 4 run in parallel, this step should wait until Task 3.1 is merged to avoid conflicts.

- [ ] **Step 4: Register in index.ts, commit**

### Task 4.7: Heatmap Routes

**Files:**
- Create: `hub-api/src/routes/heatmap.ts`

- [ ] **Step 1: Write tests for each heatmap mode**

Test all 6 modes: recency, density, dnc, language, gaps, status. Test bbox requirement for address-level modes. Test timeRange parameter for density.

- [ ] **Step 2: Implement heatmap endpoint**

`GET /territories/heatmap?mode=X`: Switch on mode. Territory-level modes aggregate from Territory/Address tables. Address-level modes return GeoJSON FeatureCollection with bbox filtering (required param). Max 2000 points — if exceeded, return clustered aggregates (group by geohash prefix) instead of truncating.

- [ ] **Step 3: Register in index.ts, commit**

### Task 4.8: Import Routes

**Files:**
- Create: `hub-api/src/routes/import.ts`

- [ ] **Step 1: Write tests**

Test: KML parsing, CSV column detection, CSV preview, bulk create, duplicate detection, territory CSV import.

- [ ] **Step 2: Implement KML import**

`POST /territories/import/kml`: Parse XML, extract Placemarks with Polygons, run auto-fix pipeline, duplicate detection.

- [ ] **Step 3: Implement CSV import**

Preview: detect columns by header matching (case-insensitive, flexible). Return mapping + first 10 rows + duplicate count. User can adjust column mapping before confirming. Confirm: bulk create with max 5000 rows per CSV file (note: this is distinct from the max 500 per-request limit in address CRUD routes — CSV import uses a dedicated higher-limit path). Territory CSV support.

- [ ] **Step 4: Register in index.ts, commit**

### Task 4.9: End-of-Chunk Verification

- [ ] **Step 1: Verify full hub-api build compiles**

Run: `cd ~/github/itunified-io/hubport.cloud && npx tsc --noEmit -p hub-api/tsconfig.json`
Expected: No errors

- [ ] **Step 2: Run all hub-api tests**

Run: `cd ~/github/itunified-io/hubport.cloud && npx vitest run hub-api/`
Expected: All pass

- [ ] **Step 3: Commit if any lint/type fixes needed**

---

## Chunk 5: Address & OSM Frontend

**Spec:** 2
**Layer:** hub-app
**Depends on:** Chunk 4 (backend endpoints must exist)
**Blocks:** Nothing

### Task 5.1: Territory API Client

**Files:**
- Create: `hub-app/src/lib/territory-api.ts`

- [ ] **Step 1: Implement API client functions for Address & OSM scope only**

Typed wrapper around `fetch()` for Chunk 5 endpoints only. Functions: `listAddresses()`, `createAddress()`, `updateAddress()`, `deleteAddress()`, `logVisit()`, `getVisitHistory()`, `refreshOsm()`, `getOsmQueue()`, `runGapDetection()`, `getGapRuns()`, `ignoreBuildings()`, `getLocalOsmFeatures()`, `createLocalOsmFeature()`, `getHeatmap()`, `importKml()`, `previewCsv()`, `confirmCsvImport()`, `getSnapContext()`.

Note: Campaign, sharing, and discovery API functions will be added by Chunks 7 and 8 when they extend this file.

- [ ] **Step 2: Commit**

### Task 5.2: Address Panel & Form

**Files:**
- Create: `hub-app/src/pages/territories/AddressPanel.tsx`
- Create: `hub-app/src/pages/territories/AddressForm.tsx`

- [ ] **Step 1: Implement AddressPanel**

Sidebar panel showing address list for selected territory. Sortable, filterable by status. DNC addresses shown with red icon, dimmed. "Show archived" toggle. When `meta.revertedCount > 0` in the API response, show a toast: "X addresses reverted from do-not-call (expired)".

- [ ] **Step 2: Implement AddressForm**

Create/edit form with all fields. DNC workflow: status toggle → reason field (required) → optional expiry date. Language autocomplete from congregation's known languages.

- [ ] **Step 3: Commit**

### Task 5.3: Visit Logger & History

**Files:**
- Create: `hub-app/src/pages/territories/VisitLogger.tsx`
- Create: `hub-app/src/pages/territories/VisitHistory.tsx`

- [ ] **Step 1: Implement VisitLogger**

Quick-entry: outcome picker (6 options with icons), notes text field, date picker (defaults to now). Submit creates immutable visit record.

- [ ] **Step 2: Implement VisitHistory**

Chronological list (newest first). Each entry: date, publisher name, outcome icon, notes.

- [ ] **Step 3: Commit**

### Task 5.4: Heatmap Control & Legend

**Files:**
- Create: `hub-app/src/pages/territories/HeatmapControl.tsx`
- Create: `hub-app/src/pages/territories/HeatmapLegend.tsx`

- [ ] **Step 1: Implement HeatmapControl**

Map toolbar dropdown. 6 modes: Visit Recency, Visit Density, Do-Not-Visit, Language, Uncovered Gaps, Address Status. Time range sub-selector for density mode (3m/6m/12m). Address-level modes (DNC, language, status) must send `bbox` parameter from current map viewport and re-fetch when viewport changes (debounce 500ms).

- [ ] **Step 2: Implement MapLibre heatmap layers**

Territory fill colors for recency/density. Marker clustering for address-level modes (cluster at low zoom, individual at zoom ≥15). Legend shows color/icon mapping per mode.

- [ ] **Step 3: Commit**

### Task 5.5: Gap Detection Page

**Files:**
- Create: `hub-app/src/pages/territories/GapDetection.tsx`

- [ ] **Step 1: Implement gap detection page**

"Run Detection" button with loading spinner (120s max). Results on map as orange markers. Click marker → popover with territory picker: if building is inside exactly one territory, pre-select it; if inside none, show nearest 5 by centroid distance. Actions: "Add to territory", "Ignore", "Override type". Bulk actions. Run history sidebar (last 3 completed + 3 failed).

- [ ] **Step 2: Add route in App.tsx**

- [ ] **Step 3: Commit**

### Task 5.6: Local OSM Editor

**Files:**
- Create: `hub-app/src/pages/territories/LocalOsmEditor.tsx`

- [ ] **Step 1: Implement local OSM editor**

"Local data" toggle on map toolbar. When active: show local features as distinct layer (dashed outlines). "Add feature" button → mode selector: Building/Street/POI/Custom. Per-type drawing interactions per Spec 2 table.

- [ ] **Step 2: Commit**

### Task 5.7: OSM Refresh Status

**Files:**
- Create: `hub-app/src/pages/territories/OsmRefreshStatus.tsx`

- [ ] **Step 1: Implement status indicator**

Per-territory refresh button. Polls queue (3s interval while jobs active). Shows: queued/processing/completed/failed with counters. "Refresh OSM" button disabled during cooldown period — read `TenantSettings.osmRefreshCooldownHours` from tenant settings API and compare against last completed job timestamp from queue status response.

- [ ] **Step 2: Commit**

### Task 5.8: Import Wizard

**Files:**
- Create: `hub-app/src/pages/territories/ImportWizard.tsx`

- [ ] **Step 1: Implement KML import flow**

File upload (max 10MB) → server processes → show results (created, skipped, warnings).

- [ ] **Step 2: Implement CSV import flow**

File upload → preview (detected columns, first 10 rows, duplicate count) → column mapping adjustment UI (user can remap auto-detected columns via dropdowns) → confirm. Supports both territory and address CSV.

- [ ] **Step 3: Add route in App.tsx, commit**

---

## Chunk 6: Territory Operations Backend

**Spec:** 3 (Territory Operations)
**Layer:** hub-api
**Depends on:** Chunks 1-2
**Blocks:** Chunk 7 (frontend)

### Task 6.1: Campaign Routes

**Files:**
- Create: `hub-api/src/routes/campaigns.ts` (campaign lifecycle only)
- Create: `hub-api/src/routes/meeting-points.ts` (meeting point CRUD, separate from campaigns)
- Create: `hub-api/src/lib/campaign-report.ts` (report generation logic)

- [ ] **Step 1: Write tests for campaign CRUD**

Create: `hub-api/src/routes/__tests__/campaigns.test.ts`

Test: create (draft), list, get detail, update, activate (check overlapping territories → 409), close (manual), auto-close (end date passed). Test campaign types: memorial, convention, special, letter_writing, custom.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement campaign CRUD**

Per Spec 3. Campaign lifecycle: `draft → active → closed → archived`. On activate: check no overlapping active campaigns for same territories (409 if conflict). Suspend regular assignments for included territories. On close: unsuspend, extend due dates by `closedAt - startDate`.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Implement campaign activation effects**

Set `isSuspended = true` on regular TerritoryAssignments for campaign territories. Send `campaign_activated` notification.

- [ ] **Step 6: Implement campaign close effects**

Close sequence per Spec 3 (in order):
1. Deactivate all campaign-specific TerritoryAssignments (set `returnedAt = now()`)
2. Close all FieldGroups (set status = `closed`)
3. Null all LocationShare coordinates and set `deactivatedAt = now()`
4. Unsuspend regular TerritoryAssignments (set `isSuspended = false`)
5. Extend due dates: `dueDate += campaign.closedAt - campaign.startDate` (preserve null dueDate — don't set it)
6. Update territory lastWorkedDate from campaign visit data
7. Set campaign status to `closed`, `closedAt = now()`
8. Generate result report via `campaign-report.ts` (store in `resultReport` JSON)
9. Send `campaign_closed` notification

Note: Step 3 (LocationShares) requires joining through FieldGroups → MeetingPoints → Campaign to find all active shares.

- [ ] **Step 7: Implement meeting point routes (separate file)**

Create `hub-api/src/routes/meeting-points.ts`: CRUD for meeting points per campaign. Conductor and assistant assignment. Permission: `requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE)` for create/update/delete.

- [ ] **Step 8: Register in index.ts, commit**

### Task 6.2: Assignment Enhancements

**Files:**
- Create: `hub-api/src/lib/adaptive-due-date.ts` (extracted formula)
- Create: `hub-api/src/routes/assignments.ts` (assignment-specific routes)
- Modify: `hub-api/src/routes/territories.ts`

- [ ] **Step 1: Write tests for adaptive due date formula**

Create: `hub-api/src/lib/__tests__/adaptive-due-date.test.ts`

Test cases:
- Normal case: territory with 50 addresses, avg 40 per territory, 3 past assignments → calculated days
- Division-by-zero guard: avgAddresses = 0 → fallback to `defaultCheckoutDays`
- New congregation: fewer than 3 past assignments → fallback to `defaultCheckoutDays`
- Territory with 0 addresses → fallback to `defaultCheckoutDays`
- Null dueDate territory → returns null (preserve null)

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement `adaptive-due-date.ts`**

Pure function: `calculateSuggestedDue(territory, tenantSettings, pastAssignments) → Date | null`. Formula: `baseDays = TenantSettings.defaultCheckoutDays`, `addressRatio = territory.addressCount / avgAddressCount`, `historyRatio = avgDaysCompleted / baseDays`, `suggestedDays = baseDays * addressRatio * historyRatio` (clamped to `[baseDays * 0.5, baseDays * 2.0]`).

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Implement `GET /territories/:id/suggested-due` route**

In `assignments.ts`. Uses `adaptive-due-date.ts`. Permission: `requirePermission(PERMISSIONS.ASSIGNMENTS_MANAGE)`.

- [ ] **Step 6: Enhance assign/return endpoints**

Assign: support `campaignId`, `groupId`. Return: add `returnedBy`. Kanban board data endpoint: `GET /territories/board`.

- [ ] **Step 7: Implement board/publishers endpoint**

`GET /territories/board/publishers`: Available publishers with assignment counts.

- [ ] **Step 8: Register assignments.ts in index.ts, commit**

### Task 6.3: Field Groups & Location Sharing

**Files:**
- Create: `hub-api/src/routes/field-groups.ts`

- [ ] **Step 1: Write tests**

Test: create group, join group, start/close group, location sharing (start, update position, stop, auto-deactivate on expiry/group close), coordinate nulling on deactivation.

- [ ] **Step 2: Implement field group routes**

CRUD + lifecycle: `open → in_field → closed`. Auto-join for meeting point attendees.

- [ ] **Step 3: Implement location sharing routes**

Start sharing (duration choice: 1h/4h/8h), update position (30s polling), stop sharing. On deactivation: null coordinates. On group close: deactivate all active shares.

- [ ] **Step 4: Register in index.ts, commit**

### Task 6.4: Campaign Result Reports

**Files:**
- Create: `hub-api/src/lib/campaign-report.ts`
- Add to: `hub-api/src/routes/campaigns.ts`

- [ ] **Step 1: Write tests for report generation**

Create: `hub-api/src/lib/__tests__/campaign-report.test.ts`

Test: summary aggregation (total territories, addresses, visits per outcome), per-territory breakdown, per-publisher stats, per-meeting-point comparison. Test empty campaign (no visits).

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement `campaign-report.ts`**

Pure function: `generateCampaignReport(campaign, territories, visits, meetingPoints) → CampaignReport`. Computes summary, per-territory breakdown, per-publisher stats, per-meeting-point comparison stats. Returns structured JSON.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Implement report export (CSV)**

`GET /campaigns/:id/report/export`: CSV download. Per Spec 3 — PDF deferred.

- [ ] **Step 6: Commit**

### Task 6.5: Scheduled Jobs

**Files:**
- Create: `hub-api/src/jobs/assignment-overdue-check.ts`
- Create: `hub-api/src/jobs/campaign-auto-close.ts`

- [ ] **Step 1: Implement overdue check job**

Daily 06:00 UTC. Check active, non-suspended assignments where `dueDate - now() <= overdueReminderDays` AND no existing notification. One reminder per assignment.

- [ ] **Step 2: Implement campaign auto-close job**

Daily 06:00 UTC. Check active campaigns where `endDate < now()`. Run close effects (Task 6.1 Step 6).

- [ ] **Step 3: Register jobs in index.ts startup**

Use `node-cron` with expression `0 6 * * *` (06:00 UTC daily). Do NOT use `setInterval` for wall-clock scheduling — it drifts and doesn't survive restarts.

```typescript
import cron from 'node-cron';
cron.schedule('0 6 * * *', () => { checkOverdueAssignments(); autoCloseCampaigns(); }, { timezone: 'UTC' });
```

- [ ] **Step 4: Commit**

---

## Chunk 7: Territory Operations Frontend

**Spec:** 3
**Layer:** hub-app
**Depends on:** Chunk 6 (backend)
**Blocks:** Nothing

### Task 7.1: Kanban Board

**Files:**
- Create: `hub-app/src/pages/territories/KanbanBoard.tsx`
- Create: `hub-app/src/pages/territories/KanbanCard.tsx`
- Create: `hub-app/src/pages/territories/PublisherSidebar.tsx`
- Create: `hub-app/src/pages/territories/AssignDialog.tsx`

DnD library: use `@dnd-kit/core` + `@dnd-kit/sortable` (already available or install).

- [ ] **Step 1: Implement KanbanBoard**

5 columns: Available (gray), Assigned (blue), Due Soon (amber), Overdue (red), Returned (green). Drag-and-drop territory cards between columns triggers assign/return API calls. Filters: type, campaign. Search by territory number/name. Uses two API calls: `GET /territories/board` for board data, `GET /territories/board/publishers` for publisher sidebar.

- [ ] **Step 2: Implement KanbanCard**

Territory number + name, assigned publisher avatar + name, due date with color coding, progress bar (addresses worked / total), quick-action buttons (assign, extend, return).

- [ ] **Step 3: Implement PublisherSidebar**

Right sidebar showing publisher list from `GET /territories/board/publishers`. Each publisher shows: name, current territory count, capacity indicator (green/amber/red based on last-6-assignment average). Publishers are drag sources — drag publisher onto Available card to assign.

- [ ] **Step 4: Implement AssignDialog**

Modal opened on drag Available → Assigned or drag publisher → card. Contains: publisher/group picker (search), suggested due date from `GET /territories/:id/suggested-due` (editable), notes field, confirm button.

- [ ] **Step 5: Add route in App.tsx**

- [ ] **Step 6: Commit**

### Task 7.2: Campaign Management UI

**Files:**
- Create: `hub-app/src/pages/territories/CampaignList.tsx`
- Create: `hub-app/src/pages/territories/CampaignForm.tsx`
- Create: `hub-app/src/pages/territories/CampaignDetail.tsx`

- [ ] **Step 1: Implement CampaignList**

Table/cards showing campaigns with status badges (draft/active/closed/archived). Filter by status, type. Action buttons per status.

- [ ] **Step 2: Implement CampaignForm (create wizard + edit)**

Multi-step creation wizard: 1) name + type (dropdown with 5 predefined + custom), 2) select territories (multi-select with map preview), 3) set start/end dates + description. Edit mode: single-page form (only for draft campaigns). Note: spec names the creation component `CampaignCreate` as a wizard — this implementation merges create and edit into one form with different step flows.

- [ ] **Step 3: Implement CampaignDetail**

Active campaign dashboard: territory map with campaign boundaries highlighted, meeting points list, progress stats (territories assigned, addresses worked, visits logged).

- [ ] **Step 4: Add routes in App.tsx, commit**

### Task 7.3: Meeting Point & Conductor UI

**Files:**
- Create: `hub-app/src/pages/territories/MeetingPointManager.tsx`

- [ ] **Step 1: Implement meeting point management**

Within CampaignDetail: list meeting points on map. Add/edit meeting point: location (map click), conductor assignment (publisher search), assistant list (multi-select). Map shows meeting point pins with conductor name. This component is rendered as a tab/section inside `CampaignDetail.tsx` — modify CampaignDetail to import and render `MeetingPointManager` with campaign ID as prop.

- [ ] **Step 2: Commit**

### Task 7.4: Field Group & Location Sharing UI

**Files:**
- Create: `hub-app/src/pages/territories/FieldGroupPanel.tsx` (conductor view: create, manage, start/close groups)
- Create: `hub-app/src/pages/territories/FieldGroupJoin.tsx` (publisher view: see open groups, join/leave)
- Create: `hub-app/src/pages/territories/LocationMap.tsx`
- Create: `hub-app/src/pages/territories/LocationShareConsent.tsx`

- [ ] **Step 1: Implement FieldGroupPanel (conductor view)**

Create group button (requires `app:campaigns.conduct`). Assign territories to group. Group lifecycle buttons: Start Field Service → Close Group. Member list with status. Auto-join for meeting point attendees.

- [ ] **Step 2: Implement FieldGroupJoin (publisher view)**

For publishers with `app:campaigns.view`: list open groups they can join. Join/leave buttons. Shows group conductor, assigned territories, member count.

- [ ] **Step 3: Implement LocationShareConsent**

Separate component for opt-in consent dialog. "Share your location for [1h/4h/8h]?" with privacy explanation. "Not now" option that does NOT leave a record. Duration picker. Permission: `app:campaigns.location_share`.

- [ ] **Step 4: Implement LocationMap**

Real-time map overlay showing group members' positions. Publisher markers with name labels. Auto-deactivate on expiry. Poll every 30s. On 410 response (expired share): stop polling, show "Sharing ended" message.

- [ ] **Step 5: Commit**

### Task 7.5: Campaign Report UI

**Files:**
- Create: `hub-app/src/pages/territories/CampaignReport.tsx`

- [ ] **Step 1: Implement report view**

Summary stats cards (total territories, addresses, visits, outcomes). Per-territory breakdown table. Per-publisher stats. Per-meeting-point comparison chart (horizontal bar chart showing visits per meeting point — use CSS-based bars, no chart library). CSV export button.

- [ ] **Step 2: Commit**

---

## Chunk 8: Sharing & Discovery

**Spec:** 4 (Sharing & RBAC — sharing features)
**Layer:** hub-api + central-api + hub-app
**Depends on:** Chunks 1-2
**Blocks:** Nothing

### Task 8.1: Share Service

**Files:**
- Create: `hub-api/src/lib/share-service.ts`

- [ ] **Step 1: Write tests**

Test: code generation (16 bytes, base64url), SHA256 hashing with pepper, PIN hashing, PIN brute-force lockout (5 attempts), share expiration check, constant-time comparison.

- [ ] **Step 2: Implement ShareService**

`generateCode()`: 16 bytes crypto random → base64url. `hashCode(code)`: SHA256(code + SHARE_CODE_PEPPER). `hashPin(pin)`: same pattern. `verifyCode(code, hash)`: constant-time compare. `checkExpiration(share)`: expiresAt < now. `incrementPinAttempts(share)`: auto-revoke at 5.

- [ ] **Step 3: Run tests, commit**

### Task 8.2: Public Share Link Routes

**Files:**
- Create: `hub-api/src/routes/territory-shares.ts`

- [ ] **Step 1: Write tests**

Test: create share (3 scopes), redeem (valid/expired/revoked/invalid → all 404), PIN protection, rate limiting, access logging, share listing with stats.

- [ ] **Step 2: Implement share routes**

Per Spec 4. All authenticated routes use `requirePermission(PERMISSIONS.TERRITORIES_SHARE)`.

- `POST /territories/:id/share`: Create with scope (boundary/addresses/full), optional PIN, configurable expiry (`expiresInDays`).
  Validations: reject if `Territory.shareExcluded = true` (409); validate `expiresInDays <= TenantSettings.shareMaxDays` (400); if `scope = 'full'` AND `TenantSettings.requirePINForFullShare = true`, PIN is required (400 if missing).
- `DELETE /territories/:id/share/:shareId`: Revoke (soft-delete: set `revokedAt`, `revokedBy`)
- `GET /territories/:id/shares`: List with access stats (count, last access)
- `GET /territories/shared/:code`: Public redeem (no auth, rate-limited). Security: all invalid states (expired, revoked, not found) return same 404 "Link not found or expired" (enumeration prevention). PIN-incorrect returns 403 (generic, no attempt count leaked). PIN brute-force (5 attempts) auto-revokes → subsequent requests return 404. All comparisons use constant-time `timingSafeEqual`.

- [ ] **Step 3: Implement access logging**

Create ShareAccessLog on every successful redeem. Hash IP with SHA256 + pepper. Add access log purge job.

- [ ] **Step 4: Create `hub-api/src/jobs/share-log-purge.ts`**

Daily 03:00 UTC. Delete ShareAccessLog entries older than 90 days.

- [ ] **Step 5: Register routes + job in index.ts, commit**

### Task 8.3: Central Discovery Endpoint

**Files:**
- Modify: `central-api/src/routes/sharing.ts`
- Create: `central-api/src/lib/haversine.ts`

- [ ] **Step 1: Write tests for Haversine formula**

- [ ] **Step 2: Implement haversine.ts**

`distanceKm(lat1, lng1, lat2, lng2)`: Standard Haversine formula returning distance in km.

- [ ] **Step 3: Implement `GET /sharing/discover` endpoint**

Query params: q, lat, lng, radiusKm, circuit, region, country, limit, offset. At least one filter required (400 if none). Only `discoverable = true` tenants. Results sorted by distance when `lat`+`lng` provided, otherwise alphabetically by name. Include `partnershipStatus` for requesting tenant — resolve by checking SharingApproval table for existing requests between requesting tenant and each result (`none | pending | approved | rejected`).

- [ ] **Step 4: Implement `PUT /tenants/:id/discovery` endpoint**

Update discovery profile fields on Tenant model.

- [ ] **Step 5: Commit**

### Task 8.4: Territory Sync Enhancement

**Files:**
- Modify: `hub-api/src/routes/sharing.ts`
- Modify: `central-api/src/routes/sharing.ts`

- [ ] **Step 1: Implement structured territory sync (hub-api)**

`POST /sharing/territories/sync`: Collect all territories where `shareExcluded = false`. Build structured data (full depth). Push to central-api.

- [ ] **Step 2: Create `central-api/src/lib/sharing-depth-filter.ts`**

Pure function: `filterByDepth(territories, depth: 'boundary' | 'addresses' | 'full') → filtered[]`. Strips fields per depth level: `boundary` = geometry only; `addresses` = geometry + address list (no visit data); `full` = everything.

Write test: `central-api/src/lib/__tests__/sharing-depth-filter.test.ts` — test all 3 depth levels with sample territory data.

- [ ] **Step 2b: Integrate depth filter into GET /sharing/territories**

Modify `GET /sharing/territories`: Accept `depth` query param. Apply `filterByDepth()` to response.

- [ ] **Step 3: Implement auto-sync on boundary save**

After `PUT /territories/:id` with boundary change: if `autoSyncTerritories = true` AND active partnerships with territories category → fire sync in background. Failure must NOT affect the save response — wrap in try/catch, log error, do NOT throw.

- [ ] **Step 4: Implement `GET /sharing/territories/:partnerId` (hub-api)**

Check SharingVisibility: read the `depth` field from the SharingVisibility record for this partner. Pass `depth` as query parameter when fetching from central-api. If no SharingVisibility record exists, default to `"boundary"` (security-first).

- [ ] **Step 5: Commit**

### Task 8.5: Sharing Frontend

**Files:**
- Create: `hub-app/src/pages/territories/ShareLinkManager.tsx`
- Create: `hub-app/src/pages/territories/ShareRedeemPage.tsx`
- Create: `hub-app/src/pages/territories/DiscoverySearch.tsx`

- [ ] **Step 1: Implement ShareLinkManager**

Within territory detail: "Share" tab showing active shares with stats. Create share dialog: scope picker, expiry slider, optional PIN. Revoke button with confirmation.

- [ ] **Step 2: Implement ShareRedeemPage**

Public page (no auth required). Route: `/shared/t/:code`. Renders territory boundary on MapLibre map. Shows addresses if scope allows. PIN entry dialog if protected — PIN-incorrect shows generic "Incorrect PIN" without revealing attempt count. Error states: expired, invalid, revoked all show same generic "Link not found or expired" message (enumeration prevention — same UI for all failure modes).

- [ ] **Step 3: Implement DiscoverySearch**

Within sharing page: search form with fields for name, location (map click for lat/lng), radius slider, circuit, region, country. Results list with distance, partnership status. "Request sharing" button for unconnected congregations — triggers existing `POST /sharing/requests` SharingApproval flow (same as public talk sharing).

- [ ] **Step 4: Add sharing depth control to partner detail**

Enhance existing sharing UI: add depth dropdown (boundary/addresses/full) per partner with territories enabled.

- [ ] **Step 5: Add routes in App.tsx, commit**

---

## Sidebar Navigation Updates

After all chunks complete:

**Files:**
- Modify: `hub-app/src/components/Sidebar.tsx`

- [ ] **Step 1: Add territory module nav items**

Under "Territories" section:
- Map (existing)
- Kanban Board (new, requires `app:assignments.view`)
- Campaigns (new, requires `app:campaigns.view`)
- Gap Detection (new, requires `app:gapDetection.view`)
- Import (new, requires `app:territories.import`)

- [ ] **Step 2: Commit**

---

## i18n

All new UI components must include both German and English translations via `react-intl`. Add message keys to the existing intl message files for all user-facing strings. Use the existing i18n pattern in the codebase.

---

## Testing Strategy

- **Unit tests:** Vitest for all pure functions (SnapEngine, ShareService, Haversine, permission constants, policy engine dynamic resolution)
- **Route tests:** Vitest with mocked Prisma for all new route handlers (follow central-api test patterns)
- **Frontend:** Manual testing via running dev server — no component test framework currently set up
- **Integration:** Deploy to UAT environment after all chunks complete. Test full flows end-to-end.

---

## Parallel Execution Strategy

With subagent-driven-development, the optimal execution order is:

1. **Sequential:** Chunk 1 (RBAC) → Chunk 2 (Database Models)
2. **Parallel batch 1:** Chunk 3 (Drawing UX) + Chunk 4 (Address/OSM Backend) + Chunk 6 (Operations Backend) + Chunk 8 (Sharing)
3. **Parallel batch 2:** Chunk 5 (Address/OSM Frontend) + Chunk 7 (Operations Frontend)
4. **Final:** Sidebar navigation updates + i18n sweep

This maximizes parallelism: 4 subagents work simultaneously in batch 1, 2 in batch 2.
