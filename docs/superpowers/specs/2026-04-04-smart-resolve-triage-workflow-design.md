# Smart Resolve Triage Workflow

## Problem

The current Smart Resolve feature treats all uncovered buildings equally when recommending gap resolution actions. Yellow (uncertain, `building=yes`) and gray (non-residential) buildings inflate gap analysis counts, leading to inaccurate recommendations. Users have no way to verify, reclassify, or correct OSM building data before resolution. The result: auto-resolve proposals include non-residential buildings, and users must blindly trust OSM classification.

## Solution

Transform Smart Resolve into a staged triage workflow with two tabs. Users first review and classify uncertain buildings (Tab 1: Buildings), then resolve gaps using only verified residential data (Tab 2: Gaps). Resolution buttons are soft-gated behind triage completion per gap.

## Data Model

### Tenant Isolation

Each hubport.cloud tenant runs an isolated PostgreSQL database. `BuildingOverride` lives in the tenant database alongside `Territory`, `IgnoredOsmBuilding`, etc. No multi-tenant scoping or congregation FK is needed.

### New Table: `BuildingOverride`

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| id | UUID | PK, default uuid | |
| osmId | String | unique | Links to OSM building ID |
| overriddenType | String? | app-level validation | User-corrected building type |
| overriddenAddress | String? | | User-added/corrected street address |
| triageStatus | Enum | default `unreviewed` | `unreviewed`, `confirmed_residential`, `ignored`, `needs_visit` |
| notes | String? | | Optional user notes |
| reviewedBy | String? | | Keycloak sub (audit trail, no FK) |
| reviewedAt | DateTime? | | When triage happened |
| createdAt | DateTime | default now | |
| updatedAt | DateTime | auto-update | |

`reviewedBy` stores the Keycloak `sub` claim as a string for audit trail purposes. No FK constraint — deleted users should not cascade-delete triage history.

### Allowed Building Types

`overriddenType` is validated at the application level (not a Prisma enum) against the union of all severity sets. This avoids database migrations when OSM types change. Allowed values:

**Residential (red):** `house`, `apartments`, `residential`, `detached`, `semidetached_house`, `terrace`, `cabin`

**Mixed (orange):** `farm`, `farm_auxiliary`

**Non-residential (gray):** `garage`, `garages`, `commercial`, `industrial`, `retail`, `shed`, `barn`, `church`, `public`, `warehouse`, `office`, `school`, `hospital`, `hotel`, `supermarket`, `service`, `construction`, `boathouse`, `cowshed`, `ruins`, `roof`, `hut`, `transformer_tower`, `bridge`, `bunker`, `carport`, `kiosk`, `toilets`, `pavilion`, `greenhouse`

**Uncertain (yellow):** `yes`, `unknown`

### Severity Classification Rules

Given `effectiveType = override.overriddenType ?? osm.buildingType` and `effectiveHasAddress = override.overriddenAddress != null || osm.hasAddress`:

| effectiveType | effectiveHasAddress | Severity | Color |
|---------------|---------------------|----------|-------|
| In residential set | any | high | red |
| In mixed set | any | medium | orange |
| `yes` | true | medium | orange |
| `yes` | false | low | yellow |
| `unknown` or missing | any | low | yellow |
| In non-residential set | any | ignorable | gray |
| Anything else | any | low | yellow |

### Relationship to `IgnoredOsmBuilding`

`IgnoredOsmBuilding` performs hard removal: buildings with entries in that table are filtered out of gap detection results entirely (not returned from the runs endpoint). `BuildingOverride` with `triageStatus=ignored` is a soft classification: the building still appears in the Buildings tab (grayed out, at the bottom) but is excluded from gap analysis residential counts.

**Precedence rule:** if both tables have an entry for the same osmId, `IgnoredOsmBuilding` wins — the building is hard-removed from results and the override is irrelevant. No conflict.

### Migration

No data migration needed. The `BuildingOverride` table starts empty. Existing `IgnoredOsmBuilding` records continue to work as before. Users organically create overrides through triage interactions.

## UI Structure

### Sidebar Layout

The sidebar transforms from a single scrollable panel into two tabs. The header area (title, "Run Detection" button, "Populate Addresses from OSM" button) stays above the tabs since those actions apply globally. Both buttons are existing features (unchanged by this spec).

**Tab bar**: compact, below the global actions.
- **Tab 1: "Buildings"** — badge shows count of unreviewed uncertain buildings (e.g., "42")
- **Tab 2: "Gaps"** — badge shows unresolved gap count (e.g., "57 gaps")

### Buildings Tab

**Stats row** (unchanged): `11235 Buildings | 11124 In territories | 111 Uncovered`

**Coverage bar** (unchanged): percentage with green bar.

**Triage progress bar** (new): amber progress bar showing `{reviewed}/{total uncertain} reviewed`. The denominator is the count of uncovered buildings with yellow severity (uncertain: `yes` without address, `unknown`, unrecognized types). Red and gray buildings are pre-classified and do not count toward the triage denominator. The numerator is the count of those yellow buildings that have a `BuildingOverride` with `triageStatus != unreviewed`.

Only visible when there are unreviewed uncertain buildings.

**Filter controls**: severity-colored chips (existing) plus a status filter dropdown: All | Unreviewed | Confirmed | Needs Visit | Ignored.

**Building list items** (enhanced):

```
[checkbox] [severity dot] way/89155770    [type chip]    [triage icons]
                           Hauptstr. 12
```

- **Type chip**: clickable. Opens dropdown with the allowed building types listed above. Selecting a type saves the override via PUT, updates severity color immediately, and shows a small "edited" dot indicator.
- **Address text**: clickable (or "no address" placeholder). Opens inline text input. Enter to save via PUT. Shows "edited" dot when overridden.
- **Triage action icons** (right side, visible on hover or always on mobile):
  - Check icon: confirm residential
  - X-circle icon: ignore (not residential)
  - Eye icon: needs field visit
- **Already-triaged items**: show a subtle status badge instead of action icons (e.g., "confirmed" or "visit"). Click badge to change status.
- **Bulk select**: checkboxes enable batch toolbar: "Confirm All" / "Ignore All" / "Mark for Visit"

### Gaps Tab

**Soft gate definition**: "uncertain buildings" in the context of the triage gate means buildings with yellow severity (low) that have `triageStatus = unreviewed` or no `BuildingOverride` record. Red, orange, and gray buildings are already classified and do not block resolution.

If a gap has unreviewed uncertain buildings, its resolution buttons are disabled. Message: "Review uncertain buildings in the Buildings tab first" with count. A secondary "Force resolve (N unreviewed)" action is available but visually de-emphasized (text button, not filled).

**Gap cards** (enhanced from current):
- Stats now only count red severity + user-confirmed buildings as "residential"
- `unreviewedCount` shown per gap: "3 uncertain buildings remaining"
- Link back to Buildings tab filtered to that gap's buildings
- Recommendation badge and action buttons (Create Territory / Expand Neighbors) same as current, but driven by verified counts

## API Endpoints

### Building Overrides

| Method | Path | Permission | Purpose |
|--------|------|------------|---------|
| GET | `/territories/gap-detection/overrides` | `GAP_DETECTION_VIEW` | List overrides (paginated, filterable) |
| PUT | `/territories/gap-detection/overrides/:osmId` | `GAP_DETECTION_RUN` | Create/update single override |
| POST | `/territories/gap-detection/overrides/batch` | `GAP_DETECTION_RUN` | Batch triage (transactional) |
| DELETE | `/territories/gap-detection/overrides/:osmId` | `GAP_DETECTION_RUN` | Remove override (revert to OSM) |

### GET `/territories/gap-detection/overrides`

Query parameters:
- `triageStatus` (optional): filter by status (`unreviewed`, `confirmed_residential`, `ignored`, `needs_visit`)
- `limit` (optional, default 200, max 1000): pagination limit
- `offset` (optional, default 0): pagination offset

Returns `{ overrides: BuildingOverride[], total: number }`.

### PUT `/territories/gap-detection/overrides/:osmId`

Request body:
```json
{
  "overriddenType": "house",
  "overriddenAddress": "Bergstr. 5",
  "triageStatus": "confirmed_residential",
  "notes": "Verified on site visit"
}
```

All fields optional. Upserts by osmId. `overriddenType` validated against the allowed building types list — returns 400 for unknown types. Sets `reviewedBy` from JWT `sub` and `reviewedAt` to current time.

### POST `/territories/gap-detection/overrides/batch`

Request body:
```json
{
  "overrides": [
    { "osmId": "way/123", "triageStatus": "ignored" },
    { "osmId": "way/456", "triageStatus": "confirmed_residential" }
  ]
}
```

Max 200 items per batch. Wrapped in a `$transaction` — all-or-nothing. Returns 400 if limit exceeded or if any `overriddenType` value is invalid. Duplicate osmIds within the batch: last entry wins, applied as a single upsert (fields from earlier entries are discarded, not merged).

### DELETE `/territories/gap-detection/overrides/:osmId`

Removes the override for the given osmId. Building reverts to OSM data and severity. Returns 204 on success, 404 if no override exists for that osmId. Idempotent: calling DELETE on a non-existent osmId is safe.

### Concurrency

Last-write-wins. No optimistic locking. Multiple users triaging the same building simultaneously results in the last PUT winning. This is acceptable because triage is a collaborative review process, not a conflict-prone operation. The `reviewedBy` and `reviewedAt` fields record who made the last change.

## Gap Analysis Engine Changes

### Building Classification with Overrides

In `runGapAnalysis`:
1. Load all `BuildingOverride` records in a single query, keyed by osmId.
2. For each building in a gap, compute effective values:
   - `effectiveType = override?.overriddenType ?? building.buildingType`
   - `effectiveHasAddress = (override?.overriddenAddress != null) || building.hasAddress`
   - Apply the severity classification rules table above to get the effective severity.
3. Residential count for threshold decision:
   - **Counts as residential**: buildings with red (high) effective severity, OR any building with `triageStatus = confirmed_residential` regardless of severity
   - **Also counts**: orange (medium) severity buildings (farm, `yes` with address) — these are likely residential
   - **Excluded**: `triageStatus = ignored`, `triageStatus = needs_visit`, gray (ignorable) effective severity, yellow (low) severity with `triageStatus = unreviewed` or no override
4. Response includes per-gap `unreviewedCount`: number of yellow-severity buildings in that gap with `triageStatus = unreviewed` or no `BuildingOverride` record.

### Gap-to-Building Mapping

Each gap is a PostGIS polygon computed by `computeGapPolygons` (congregation boundary minus union of all territory polygons). Buildings are assigned to gaps via `isInsideBoundaries(building.lat, building.lng, gap.geojson)` — the same point-in-polygon check used throughout the system. A building belongs to a gap if its coordinates fall inside the gap polygon.

### Response Shape Change

`GapAnalysis` gains:
```typescript
unreviewedCount: number;  // yellow-severity buildings not yet triaged in this gap
```

## Field Work Mode Integration

Field Work Mode integration is a follow-up enhancement. For this spec, the scope is:

1. **Data layer only**: `BuildingOverride` records with `triageStatus = needs_visit` are queryable via the overrides API with `?triageStatus=needs_visit`.
2. **Future integration point**: Field Work Mode can query this endpoint to surface buildings as `building_verification` tasks. The task shape, GPS proximity logic, and completion flow will be designed when Field Work Mode gains task-type extensibility.
3. **Current UX**: buildings marked "needs visit" show an eye badge in the Buildings tab. Users complete visits outside the app, then return to update the triage status manually via the inline action buttons.

## Interaction Flow

1. **Run Detection** — 111 uncovered buildings found.
2. **Buildings tab** opens, showing severity-colored list with triage progress "0/42 uncertain reviewed" (42 yellow buildings out of 111 total uncovered — red and gray are pre-classified).
3. Gray and red buildings are already classified and do not need triage. User can still reclassify them via the type chip if needed, but they don't block resolution.
4. User works through yellow buildings:
   - Clicks type chip → selects "house" → turns red, counts as residential.
   - Clicks address placeholder → types address → saves inline.
   - Clicks eye icon on a remote building → marked for field visit.
   - Clicks X icon on a known shed → marked ignored.
5. Triage progress reaches 100%.
6. Switches to **Gaps tab** → resolution buttons active.
7. Gap cards show accurate residential counts. Resolves gaps as needed.

### Edge Cases

- **Red buildings**: not subject to triage gate. Already classified as residential. User can reclassify downward (e.g., "house" → "garage") — turns gray, excluded from counts.
- **Partial triage**: resolution buttons show "Force resolve (N unreviewed)" as secondary action. Not hard-blocked, just discouraged.
- **New detection run**: overrides persist. New buildings start as unreviewed. Orphaned overrides (building no longer in results) accumulate but are harmless — they are never joined against unless the osmId reappears. No automatic cleanup; accepted as a known limitation.
- **Override revert**: DELETE endpoint removes override, building reverts to OSM data and severity.
- **Both tables**: if `IgnoredOsmBuilding` and `BuildingOverride` exist for the same osmId, the building is hard-removed from results. The override is irrelevant.

## Files to Modify/Create

| File | Action |
|------|--------|
| `hub-api/prisma/schema.prisma` | Add `BuildingOverride` model |
| `hub-api/src/routes/gap-detection.ts` | Add override CRUD endpoints |
| `hub-api/src/lib/gap-analysis.ts` | Apply overrides to classification + add `unreviewedCount` |
| `hub-app/src/lib/territory-api.ts` | Add override API client functions |
| `hub-app/src/pages/territories/GapDetection.tsx` | Refactor to tab layout, integrate triage |
| `hub-app/src/components/territories/GapResolutionSection.tsx` | Update to respect triage gate |
| `hub-app/src/components/territories/BuildingTriageList.tsx` | NEW — building list with inline edit + triage actions |

## Verification

1. Run detection → buildings show with severity colors
2. Click type chip on yellow building → dropdown opens, select "house" → turns red, severity updates
3. Click address placeholder → type address → saves, "edited" badge shows
4. Set invalid building type via API → returns 400
5. Bulk select gray buildings → "Ignore All" → triage progress updates
6. Mark building for field visit → eye badge shows, queryable via `?triageStatus=needs_visit`
7. Switch to Gaps tab → cards show accurate residential counts (only red + confirmed)
8. Unreviewed uncertain buildings in a gap → resolution buttons disabled with count message
9. Force resolve available as secondary action on gated gaps
10. Create Territory / Expand Neighbors → works as before but with verified data
11. New detection run → overrides persist, previously triaged buildings retain status
12. Building in both `IgnoredOsmBuilding` and `BuildingOverride` → hard-removed from results
