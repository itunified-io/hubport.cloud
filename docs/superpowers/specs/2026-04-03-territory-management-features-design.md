# Territory Management Features — Design Spec

**Date:** 2026-04-03
**Status:** Approved
**Scope:** hubport.cloud hub-app + hub-api

## Overview

Three independent features for territory management:

1. **Delete Territory Polygon** — remove a boundary from a single territory without deleting the territory itself
2. **KML Branch Import** — import branch-tool KML files to update boundaries on existing territories
3. **Bulk Fix Violations** — select and auto-fix multiple violated territories from the map view

---

## Feature 1: Delete Territory Polygon

### Problem

Users cannot remove a polygon boundary from a territory without deleting the entire territory. The only options today are editing/replacing the boundary or deleting the whole territory (losing assignments, addresses, etc.).

### Solution

A "Delete Boundary" action in a kebab menu (⋮) on TerritoryDetail that sets `boundaries: null` while preserving all other territory data.

### UI

**Kebab Menu (⋮):**
- New button at the end of the TerritoryDetail toolbar (after Export/Expand buttons)
- Only visible when `!editMode && !clipMode`
- Contains: "Delete Boundary" item with Trash icon, red text
- Only shown when the territory has a boundary (`boundaries !== null`)
- Requires `app:territories.edit` permission

**Confirmation Modal:**
- Shows territory number + name
- Warning text explaining the action is destructive
- "Delete" button (red) + "Cancel" button
- On confirm: calls API, closes modal, refreshes territory data
- Success toast after deletion

### Backend

**New endpoint:** `DELETE /territories/:id/boundaries`

- Saves the PREVIOUS boundary in a `TerritoryBoundaryVersion` record with `changeType: "boundary_deleted"` (enables future undo/restore). Note: the existing `createBoundaryVersion` helper stores the new state — this endpoint must store the old state instead, so a small adaptation is needed.
- Sets `boundaries: null` on the territory record
- Does NOT touch addresses — they remain linked to the territory
- Requires `TERRITORIES_EDIT` permission
- Returns 200 with updated territory
- Returns 404 if territory not found
- Returns 400 if territory has no boundary (defensive guard — UI already hides the action in this case)

### RBAC

Reuses existing `TERRITORIES_EDIT` permission — no new permission needed. Same users who can edit boundaries can delete them.

### i18n

| Key | EN | DE |
|-----|----|----|
| `territory.boundary.delete` | Delete Boundary | Grenze löschen |
| `territory.boundary.delete.confirm` | Are you sure you want to delete the boundary for territory {number} — {name}? This cannot be undone. | Möchten Sie die Grenze für Gebiet {number} — {name} wirklich löschen? Dies kann nicht rückgängig gemacht werden. |
| `territory.boundary.delete.success` | Boundary deleted | Grenze gelöscht |

### Files to Create/Modify

| File | Change |
|------|--------|
| `hub-app/src/pages/territories/TerritoryDetail.tsx` | Add kebab menu (⋮) with "Delete Boundary" action + confirmation modal |
| `hub-api/src/routes/territories.ts` | Add `DELETE /territories/:id/boundaries` endpoint |
| `hub-app/src/i18n/messages/en-US.json` | Add boundary delete messages |
| `hub-app/src/i18n/messages/de-DE.json` | Add German translations |

---

## Feature 2: KML Branch Import

### Problem

KML import currently only creates new territories. There is no way to import a KML file from the branch tool and update boundaries on existing territories by matching territory numbers. The CSV import supports a branch-tool boundary format, but KML does not.

### Solution

A third import card on the Import page: "Branch KML Import". Parses KML Placemarks, matches them to existing territories by number extracted from `<name>`, and updates their boundaries. Unmatched Placemarks fall back to creating new territories.

### UI

**Import Page — New Card:**
- Third card alongside existing "KML Import" and "CSV Import"
- Icon: GitBranch or similar
- Title: "Branch KML Import"
- Subtitle: "Update territory boundaries from branch KML files"
- Same file upload flow as existing KML Import (drag & drop or file picker)

**Results Summary:**
- After import, show: "X territories updated, Y new territories created, Z skipped (no polygon)"
- List of updated/created territories with numbers

**Existing KML Import unchanged** — stays as "create new territories only."

### Backend

**New endpoint:** `POST /territories/import/kml/branch`

**Parser refactoring:** The existing `parseKmlPolygons()` function in `import.ts` is currently a private function. It must be exported (or extracted into a shared utility like `hub-api/src/lib/kml-parser.ts`) so both the existing KML import and the branch import can reuse it. No logic changes needed — just make it accessible.

**Territory number extraction from Placemark `<name>`:**
Branch-tool KML files use Placemark names like `"101"`, `"101 Parkstraße"`, or `"T-101"`. The extraction rule:
1. Match regex `/^T?-?(\d+)/i` against the Placemark `<name>` value
2. Use the captured digit group as the territory number (preserve as-is, no padding)
3. If no digits found, skip the Placemark with a warning

**Processing flow:**
- For each Placemark with a Polygon/MultiPolygon:
  1. Extract territory number from `<name>` using the regex above
  2. Search for existing territory with matching `number`
  3. **Found** → update `boundaries` with parsed GeoJSON polygon, create `TerritoryBoundaryVersion` history record, run auto-fix pipeline (clip to congregation boundary, resolve overlaps)
  4. **Not found** → create new territory with `type: "territory"` (NOT `"congregation_boundary"`)
- Placemarks without polygon geometry are skipped with a warning
- Returns `{ updated: number, created: number, skipped: number, warnings: string[] }`
- Requires `TERRITORIES_IMPORT` permission

### RBAC

Reuses existing `TERRITORIES_IMPORT` permission.

### i18n

| Key | EN | DE |
|-----|----|----|
| `import.branch.title` | Branch KML Import | Branch-KML-Import |
| `import.branch.subtitle` | Update territory boundaries from branch KML files | Gebietsgrenzen aus Branch-KML-Dateien aktualisieren |
| `import.branch.updated` | {count} territories updated | {count} Gebiete aktualisiert |
| `import.branch.created` | {count} new territories created | {count} neue Gebiete erstellt |
| `import.branch.skipped` | {count} skipped (no polygon) | {count} übersprungen (kein Polygon) |
| `import.branch.warnings` | {count} warnings | {count} Warnungen |

### Files to Create/Modify

| File | Change |
|------|--------|
| `hub-app/src/pages/territories/ImportWizard.tsx` | Add third card for Branch KML Import |
| `hub-api/src/lib/kml-parser.ts` | Extract `parseKmlPolygons()` from `import.ts` into shared utility (export it) |
| `hub-api/src/routes/import.ts` | Refactor to import from `kml-parser.ts`; add `POST /territories/import/kml/branch` endpoint |
| `hub-app/src/lib/territory-api.ts` | Add `importBranchKml()` API client function |
| `hub-app/src/i18n/messages/en-US.json` | Add branch import messages |
| `hub-app/src/i18n/messages/de-DE.json` | Add German translations |

---

## Feature 3: Bulk Fix Violations

### Problem

Territory violations (exceeds congregation boundary, overlaps with neighbors) require fixing one territory at a time — the user must open each territory, enter edit mode, and manually clip or adjust. With many violations, this is tedious.

### Solution

A "Fix Violations" mode on the map view where the user can select multiple violated territories and run the auto-fix pipeline on all of them at once. Previous boundaries are saved via `TerritoryBoundaryVersion` for undo capability.

### UI

**Map View — Fix Violations Button:**
- New button on the map toolbar, only visible when:
  - Violations exist (violation count > 0)
  - User has `app:territories.edit` permission
- Click enters "fix mode"

**Fix Mode:**
- Violation badge markers become selectable (click to toggle amber highlight)
- "Select All" option to select all violated territories
- Floating toolbar appears when ≥1 selected:
  - "{count} selected" count display
  - "Fix Selected" button (amber/primary)
  - "Cancel" button
- Normal map interactions (pan, zoom) still work
- Clicking a non-violated territory does nothing in fix mode

**Execution:**
- Click "Fix Selected" → immediately runs auto-fix on each selected territory
- Shows toast with results: "5 fixed, 1 failed" (or "All 5 territories fixed")
- Badges refresh automatically (re-fetch violations)
- Fix mode exits after execution

**Undo:** Each fixed territory has its previous boundary saved in `TerritoryBoundaryVersion`. Revert is possible via the version history (not part of this scope — the records are already written by the auto-fix pipeline).

### Backend

**New endpoint:** `POST /territories/fix/bulk`

```
Request:
{
  territoryIds: string[],   // UUIDs, minItems: 1, maxItems: 50
}

Response:
{
  fixed: number,
  failed: Array<{ id: string, number: string, error: string }>
}
```

**Processing order:** Territories are processed in ascending territory number order for deterministic results. Since `runAutoFixPipeline()` clips against neighbors (which may also be in the batch), order matters. Two-pass approach:
1. **Pass 1 — Clip to congregation boundary:** For all selected territories, clip boundaries to the congregation boundary. This resolves all `exceeds_boundary` violations without neighbor dependencies.
2. **Pass 2 — Resolve overlaps:** For all selected territories (in number order), clip against neighbors. Since pass 1 already ran, overlaps are resolved against the latest boundary state.

Each territory gets a `TerritoryBoundaryVersion` record before modification (stores previous boundary for undo).

- If pipeline fails for one territory, continue with the rest (partial success)
- Requires `TERRITORIES_EDIT` permission
- Returns 400 if no territory IDs provided or if `territoryIds` exceeds `maxItems: 50`
- Returns 404 if none of the IDs exist

### RBAC

Reuses existing `TERRITORIES_EDIT` permission.

### i18n

| Key | EN | DE |
|-----|----|----|
| `territory.fix.button` | Fix Violations | Verstöße beheben |
| `territory.fix.selectAll` | Select All | Alle auswählen |
| `territory.fix.selected` | {count, plural, one {# selected} other {# selected}} | {count, plural, one {# ausgewählt} other {# ausgewählt}} |
| `territory.fix.run` | Fix Selected | Ausgewählte beheben |
| `territory.fix.success` | {count, plural, one {# territory fixed} other {# territories fixed}} | {count, plural, one {# Gebiet behoben} other {# Gebiete behoben}} |
| `territory.fix.partial` | {fixed} fixed, {failed} failed | {fixed} behoben, {failed} fehlgeschlagen |

### Files to Create/Modify

| File | Change |
|------|--------|
| `hub-app/src/pages/territories/TerritoryMap.tsx` | Add "Fix Violations" button + fix mode state management |
| `hub-app/src/pages/territories/ViolationBadges.tsx` | Extend with new props: `fixMode: boolean`, `selectedIds: Set<string>`, `onToggleSelect: (id: string) => void`. In fix mode, badges become clickable for selection (amber highlight when selected). Parent manages selected state and provides violation list for "Select All". |
| `hub-api/src/routes/territories.ts` | Add `POST /territories/fix/bulk` endpoint |
| `hub-app/src/lib/territory-api.ts` | Add `bulkFixViolations()` API client function |
| `hub-app/src/i18n/messages/en-US.json` | Add fix mode messages |
| `hub-app/src/i18n/messages/de-DE.json` | Add German translations |

---

## Dependencies

All three features share:
- No new npm dependencies required
- No new permissions — reuse `TERRITORIES_EDIT` and `TERRITORIES_IMPORT`
- No Dockerfile changes
- All use existing `TerritoryBoundaryVersion` for audit/undo

## Implementation Order

These are independent features and can be built in any order. Recommended:

1. **Delete Territory Polygon** — smallest scope, self-contained
2. **KML Branch Import** — medium scope, reuses existing KML parser
3. **Bulk Fix Violations** — largest scope, involves map interaction state
