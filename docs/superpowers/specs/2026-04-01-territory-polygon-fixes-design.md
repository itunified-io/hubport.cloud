# Territory Polygon Fixes — Design Spec

**Date:** 2026-04-01
**Status:** Approved
**Bugs Fixed:** #3 (edit boundary), #4 (new territory), polygon-exceeds-boundary, polygon-overlap

## Problem

Four territory polygon bugs exist:

1. **Polygons exceed congregation boundary** — No spatial validation clips territory polygons to the congregation boundary. Imported KML boundaries often extend beyond the congregation's assigned area.
2. **Territory polygons overlap each other** — No detection or prevention of overlapping territory boundaries. Multiple territories can claim the same geographic area.
3. **Edit polygon not working** — TerritoryDetail has no "Edit" button. TerritoryEditor component exists but is never mounted.
4. **New Territory creation not working** — The "+ New Territory" button navigates to `?draw=true` but nothing reads that query param. CreationFlow component exists but is never mounted.

## Approach

**PostGIS Raw SQL Pipeline (server-authoritative).** All spatial operations run server-side using PostGIS functions via Prisma `$queryRaw` / `$executeRaw` (tagged template literals for parameterized queries). PostGIS is already available (DB uses `postgis/postgis:16-3.4-alpine`). No client-side geometry manipulation (no Turf.js). Note: client-side geometry utilities (haversine, circle/rectangle creation) remain allowed for measurement/display — only spatial operations (clip, intersect, difference) must be server-side.

**Architecture note:** hubport.cloud is single-tenant — each tenant has its own Docker stack + database. No cross-tenant data leakage concern; spatial queries do not need tenantId filtering.

---

## 1. Backend: PostGIS Pipeline + Versioning

### 1.1 Prisma Schema Addition

New model in `hub-api/prisma/schema.prisma`:

```prisma
model TerritoryBoundaryVersion {
  id            String   @id @default(uuid())
  territoryId   String
  version       Int      // 1, 2, 3... per territory
  boundaries    Json     // GeoJSON snapshot
  changeType    String   // "creation" | "manual_edit" | "auto_clip" | "import" | "restore"
  changeSummary String?  // human-readable
  createdAt     DateTime @default(now())

  territory     Territory @relation(fields: [territoryId], references: [id], onDelete: Cascade)

  @@index([territoryId, version])
}
```

Add `boundaryVersions TerritoryBoundaryVersion[]` relation to Territory model.

### 1.2 postgis-helpers.ts — Spatial Functions

New file: `hub-api/src/lib/postgis-helpers.ts`

Four core functions using raw SQL:

1. **`validateGeometry(geojson)`** — `ST_AsGeoJSON(ST_MakeValid(ST_GeomFromGeoJSON($1)))` → valid GeoJSON
2. **`clipToCongregation(geojson, congregationId)`** — `ST_Intersection(territory, congregation)` → clipped GeoJSON or null (skip if no congregation boundary)
3. **`clipToNeighbors(geojson, excludeTerritoryId)`** — For each neighbor: `ST_Difference(geojson, neighbor.boundaries)` → `{ clipped, removedFrom[] }`
4. **`detectOverlaps(geojson, excludeTerritoryId)`** — `ST_Intersects` + `ST_Area(ST_Intersection(...)::geography)` → `OverlapInfo[]`

### 1.3 Auto-Fix Pipeline

Sequential pipeline: Input → ① Validate (ST_MakeValid) → ② Congregation clip (ST_Intersection) → ③ Neighbor clip (ST_Difference × N) → ④ Overlap detect (ST_Intersects) → Output (clipped GeoJSON + metadata)

**Error handling:** If ST_Intersection produces an empty geometry (territory polygon is entirely outside the congregation boundary), return HTTP 422 with message: "Territory polygon does not intersect the congregation boundary. Please redraw."

### 1.4 API Endpoints

| Method | Path | Description | New? |
|--------|------|-------------|------|
| `POST` | `/territories/:id/preview-fix` | Dry-run auto-fix, return diff. No DB write. | New |
| `POST` | `/territories/preview-fix` | Same for new territory (no excludeId). Body: `{ boundaries: GeoJSON }` | New |
| `PUT` | `/territories/:id` | Now runs auto-fix pipeline + creates version | Modified |
| `POST` | `/territories` | Now runs auto-fix pipeline + creates v1 | Modified |
| `GET` | `/territories/:id/versions` | List boundary versions (without boundaries JSON) | New |
| `POST` | `/territories/:id/restore` | Two-step: first returns preview (same shape as preview-fix), client shows dialog, then `PUT /territories/:id` saves with accepted geometry | New |
| `GET` | `/territories/violations` | Detect violations across all territories for map badges | New |

**Preview response shape:**
```typescript
{
  original: GeoJSON,
  clipped: GeoJSON,
  applied: string[],       // ["Clipped to congregation boundary", "Removed overlap with #302"]
  overlaps: OverlapInfo[],
  geometryModified: boolean
}
```

**PUT/POST response addition:**
```typescript
{
  ...territory,
  autoFix: { applied[], overlaps[], geometryModified }
}
```

---

## 2. Frontend: Edit, Create, Preview, Violations

### 2.1 Wire "Edit Boundary" in TerritoryDetail

Add an "Edit" button in the map controls bar (next to GPS, Field Work, expand). Permission-gated to `app:territories.edit`. Clicking toggles TerritoryEditor inline — vertex handles appear on the polygon. On save, calls `PUT /territories/:id` which runs auto-fix pipeline.

### 2.2 Wire "New Territory" Creation

Flow:
1. Click "+ New Territory" → modal: enter number + name
2. `POST /territories` with number + name (no boundaries yet)
3. Navigate to `/territories/:newId` → TerritoryDetail opens
4. Auto-enter CreationFlow (draw mode) since no boundary exists
5. User draws polygon (click-to-place or shift+drag lasso)
6. Close polygon → auto-fix preview → accept → saves as v1

Key decision: Create territory record first (number + name only), then redirect to detail page where CreationFlow activates automatically. Avoids building a full drawing mode into the map view page.

### 2.3 Auto-Fix Preview Dialog

Overlay dialog that appears when `geometryModified: true` from the auto-fix pipeline:
- Map showing both polygons overlaid (original as dashed red, after-fix as solid green)
- List of applied fixes ("Clipped to congregation boundary", "Removed overlap with #302")
- Cancel / Accept & Save buttons

If no violations (clean geometry), saves directly with no preview — instant save.

### 2.4 Violation Badges on Map View

On map load, call `GET /territories/violations`. Display warning badges on violating territory polygons:
- Red badge (!) = exceeds congregation boundary
- Amber badge (!) = overlaps another territory

Click badge → navigate to territory detail → Edit → auto-fix preview → save.

---

## 3. Version History & Restore

### 3.1 Version History Dropdown

Below map controls in TerritoryDetail, a version dropdown showing boundary history:
- Each entry: version number, changeType label, date, summary
- Current version highlighted with "current" badge
- Previous versions show "restore ↩" action

### 3.2 Restore Flow

1. User clicks "restore ↩" on a previous version
2. Client calls `POST /territories/:id/restore { versionId }` — this is a **preview-only** call (no DB write)
3. Server loads old boundaries → runs auto-fix pipeline (old geometry may now violate current neighbors)
4. Returns preview response (same shape as preview-fix)
5. Client shows preview dialog if `geometryModified: true`
6. Accept → client calls `PUT /territories/:id` with the accepted geometry → saves + creates new version (changeType: "restore", summary: "Restored from v1")

**Non-destructive:** Restore never overwrites history. It creates a new version. The full chain is always preserved.

### 3.3 When Versions Are Created

| changeType | Trigger |
|------------|---------|
| `creation` | New territory gets first boundary via CreationFlow → v1 |
| `manual_edit` | User edits via vertex handles → new version on save |
| `auto_clip` | Auto-fix pipeline modifies geometry during a non-user-initiated operation (e.g., congregation boundary change triggers re-clip) → new version. When a user edit triggers auto-clipping, the changeType is `manual_edit` and the clip details are captured in `changeSummary`. |
| `import` | KML/CSV import sets boundary → v1 or new version |
| `restore` | User restores a previous version → new version with reference |

### 3.4 Permissions

| Action | Permission | New? |
|--------|-----------|------|
| View version history | `app:territories.view` | No |
| Edit boundary | `app:territories.edit` | No |
| Restore a version | `app:territories.edit` | No |
| Create territory | `app:territories.edit` | No |
| View violations | `app:territories.view` | No |

No new permissions needed.

---

## 4. RBAC: Territory Servant Role + Flag Mapping

### 4.1 Current State (broken)

The `territory_servant` congregation flag exists in `CONGREGATION_FLAGS` but `FLAG_TO_APP_ROLE` has no mapping for it. Publishers flagged as territory servant get zero territory permissions automatically.

### 4.2 Fix: New Seed Role + Flag Mapping

**New seed role in `seed-roles.ts`:**
```
Territory Servant
  - View: TERRITORIES_VIEW, ADDRESSES_VIEW, ASSIGNMENTS_VIEW, PUBLISHERS_VIEW, CAMPAIGNS_VIEW
  - Edit: TERRITORIES_EDIT, TERRITORIES_ASSIGN, TERRITORIES_IMPORT, TERRITORIES_SHARE
  - Addresses: ADDRESSES_EDIT, ADDRESSES_IMPORT, OSM_REFRESH, OSM_EDIT
  - Gap: GAP_DETECTION_VIEW, GAP_DETECTION_RUN
  - Assignments: ASSIGNMENTS_MANAGE
  - Standard: MEETINGS_VIEW, FIELD_SERVICE_VIEW, CHAT_VIEW, CHAT_SEND
```

**Flag mapping in `permissions.ts`:**
```typescript
FLAG_TO_APP_ROLE: {
  service_overseer: "Service Overseer",
  territory_servant: "Territory Servant",  // NEW
}
```

### 4.3 Territory Servant vs Service Overseer Assistant

| Capability | Territory Servant (auto from flag) | SO Assistant (manual) |
|------------|-----------------------------------|----------------------|
| Edit boundaries | ✅ | ✅ |
| Import KML/CSV | ✅ | ❌ |
| Assign territories | ✅ | ✅ |
| Share territories | ✅ | ❌ |
| Manage addresses & OSM | ✅ | ✅ |
| Gap detection | ✅ | ✅ |
| Delete territories | ❌ | ❌ |
| Split territories | ❌ | ❌ |
| Manage campaigns | ❌ | ✅ |

Territory Servant = boundary specialist (import, share, edit). SO Assistant = operational helper (campaigns, assignments).

### 4.4 Fine-Grained Manual Role Assignment

The existing "Roles" tab in publisher detail already supports manual `AppRoleMember` assignment. The tab shows:

- **Auto-mapped section** (read-only) — roles derived from congregation flags via `FLAG_TO_APP_ROLE`. Shown with a lock icon and note that they can only be changed via congregation record.
- **Manual section** — any seed role can be assigned to any publisher regardless of congregation position. Add via dropdown, remove via × button.

Permissions are additive: effective permissions = union of all assigned roles (auto + manual).

**Permission gating:** Only users with `app:publishers.edit` can manage others' roles. Regular publishers see their own roles read-only.

**Existing API endpoints** (in `permissions.ts`):
- `GET /roles` — list all roles
- `POST /roles/:id/members` — assign publisher to role
- `DELETE /roles/:id/members/:publisherId` — remove from role

**Addition needed:** `GET /publishers/:id/roles` endpoint (in `publishers.ts` route file) that returns `{ autoMapped: [...], manual: [...] }` split for the Roles tab UI.

---

## 5. Migration Plan

### 5.1 Bootstrap v1 Snapshots

One-time migration runs on first deploy via Prisma seed script:
1. Prisma migration adds `TerritoryBoundaryVersion` table
2. For each Territory WHERE boundaries IS NOT NULL: create version record `{ version: 1, changeType: "import", changeSummary: "Initial snapshot from existing boundary" }`
3. Idempotent — skips territories that already have version records
4. Runs on `db push` / container restart (seed script)

### 5.2 Initial Violation Detection

On first map load after deploy:
1. `GET /territories/violations` scans all territory boundaries
2. Existing violations appear as warning badges
3. User fixes each manually: click badge → detail → Edit → auto-fix preview → save

**No auto-fix on deploy.** Existing boundaries are NOT automatically clipped. The user sees violations and fixes them one-by-one. This preserves intentional boundary decisions.

### 5.3 No Breaking Changes

| Concern | Impact |
|---------|--------|
| `GET /territories` | Unchanged — same JSON shape |
| `PUT /territories/:id` | Enhanced — adds `autoFix` field, backward-compatible |
| Territories without boundaries | No version record — get v1 when first drawn |
| Congregation boundary territory | Excluded from violations check |
| KML import | Now runs auto-fix pipeline automatically |

### 5.4 Seed Role Migration

Seed script runs on every deploy (idempotent upsert). New "Territory Servant" role gets created automatically. `FLAG_TO_APP_ROLE` picks it up on next login/token refresh. Existing users with `territory_servant` flag get permissions immediately on next login — no manual action needed.

---

## Scope Summary

| Component | Layer | Bug Fixed |
|-----------|-------|-----------|
| `postgis-helpers.ts` | Backend | Boundary violations + overlaps |
| Auto-fix pipeline in `PUT /territories/:id` | Backend | Boundary violations + overlaps |
| Preview endpoints `POST /territories/:id/preview-fix` + `POST /territories/preview-fix` | Backend | Boundary violations + overlaps |
| `TerritoryBoundaryVersion` model + endpoints | Backend + DB | Versioning |
| Preview dialog (original vs clipped overlay) | Frontend | Boundary violations + overlaps |
| Warning badges on map view | Frontend | Overlap detection |
| Wire "Edit boundary" button in TerritoryDetail | Frontend | Bug #3 |
| Wire CreationFlow into TerritoryMap "New Territory" | Frontend | Bug #4 |
| Version history dropdown + restore in TerritoryDetail | Frontend | Versioning |
| Territory Servant seed role + flag mapping | Backend | RBAC gap |
| Fine-grained role assignment in publisher Roles tab | Frontend | Manual RBAC |
| `GET /publishers/:id/roles` endpoint | Backend | Manual RBAC |
| v1 snapshot migration + violations scan | Migration | Existing data |
