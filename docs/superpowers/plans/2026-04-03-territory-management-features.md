# Territory Management Features — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement three independent territory management features: delete boundary, branch KML import, and bulk fix violations.

**Architecture:** Each feature adds a new API endpoint in hub-api and corresponding UI in hub-app. All share the existing `TerritoryBoundaryVersion` audit trail. No new dependencies, permissions, or Dockerfile changes needed.

**Tech Stack:** Fastify + Prisma (hub-api), React + MapLibre GL + react-intl (hub-app), TypeBox schemas, GeoJSON

**Spec:** `docs/superpowers/specs/2026-04-03-territory-management-features-design.md`

---

## Chunk 1: Delete Territory Polygon

### Task 1: Backend — DELETE /territories/:id/boundaries

**Files:**
- Modify: `hub-api/src/routes/territories.ts` (after the existing DELETE /territories/:id endpoint at line 586)

- [ ] **Step 1: Add the DELETE /territories/:id/boundaries endpoint**

Add after the existing `app.delete("/territories/:id", ...)` block (line 586):

```typescript
// Delete territory boundary (polygon only) — preserves territory + addresses
app.delete<{ Params: IdParamsType }>(
  "/territories/:id/boundaries",
  {
    preHandler: requirePermission(PERMISSIONS.TERRITORIES_EDIT),
    schema: { params: IdParams },
  },
  async (request, reply) => {
    const { id } = request.params;
    const territory = await prisma.territory.findUnique({ where: { id } });

    if (!territory) {
      return reply.code(404).send({ error: "Territory not found" });
    }
    if (!territory.boundaries) {
      return reply.code(400).send({ error: "Territory has no boundary" });
    }

    // Save PREVIOUS boundary in version history (enables future restore)
    await createBoundaryVersion(
      id,
      territory.boundaries as object,
      "boundary_deleted",
      `Boundary deleted for territory #${territory.number}`
    );

    // Null out boundaries, preserve everything else
    const updated = await prisma.territory.update({
      where: { id },
      data: { boundaries: null } as any,
    });

    return reply.code(200).send(updated);
  },
);
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-api`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add hub-api/src/routes/territories.ts
git commit -m "feat: add DELETE /territories/:id/boundaries endpoint"
```

### Task 2: Frontend — API client + i18n

**Files:**
- Modify: `hub-app/src/lib/territory-api.ts` (add `deleteBoundary()` function after `getVersions` around line 623)
- Modify: `hub-app/src/i18n/messages/en-US.json`
- Modify: `hub-app/src/i18n/messages/de-DE.json`

- [ ] **Step 1: Add `deleteBoundary()` to territory-api.ts**

Add after the `getVersions()` function (around line 623):

```typescript
export function deleteBoundary(
  token: string,
  territoryId: string,
): Promise<TerritoryListItem> {
  return apiFetch(`/territories/${territoryId}/boundaries`, token, {
    method: "DELETE",
  });
}
```

- [ ] **Step 2: Add English i18n keys to en-US.json**

Add before the closing `}`:

```json
"territory.boundary.delete": "Delete Boundary",
"territory.boundary.delete.confirm": "Are you sure you want to delete the boundary for territory {number} \u2014 {name}? This cannot be undone.",
"territory.boundary.delete.success": "Boundary deleted"
```

- [ ] **Step 3: Add German i18n keys to de-DE.json**

Add before the closing `}`:

```json
"territory.boundary.delete": "Grenze l\u00f6schen",
"territory.boundary.delete.confirm": "M\u00f6chten Sie die Grenze f\u00fcr Gebiet {number} \u2014 {name} wirklich l\u00f6schen? Dies kann nicht r\u00fcckg\u00e4ngig gemacht werden.",
"territory.boundary.delete.success": "Grenze gel\u00f6scht"
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add hub-app/src/lib/territory-api.ts hub-app/src/i18n/messages/en-US.json hub-app/src/i18n/messages/de-DE.json
git commit -m "feat: add deleteBoundary API client + i18n keys"
```

### Task 3: Frontend — Kebab menu + confirmation modal on TerritoryDetail

**Files:**
- Modify: `hub-app/src/pages/territories/TerritoryDetail.tsx`

- [ ] **Step 1: Add imports**

Add to the lucide-react imports (line 5 area): `MoreVertical, Trash2`
Add to the territory-api imports (line 16 area): `deleteBoundary`
Add: `import { useIntl } from "react-intl";`

- [ ] **Step 2: Add state variables for kebab menu and delete modal**

Inside the component, after the existing state declarations (around line 80-90), add:

```typescript
const intl = useIntl();
const [kebabOpen, setKebabOpen] = useState(false);
const [showDeleteBoundaryModal, setShowDeleteBoundaryModal] = useState(false);
const [deletingBoundary, setDeletingBoundary] = useState(false);
```

- [ ] **Step 3: Add delete boundary handler**

After the existing handlers (e.g., after `handleEditSave`), add:

```typescript
const handleDeleteBoundary = useCallback(async () => {
  if (!token || !territory) return;
  setDeletingBoundary(true);
  try {
    await deleteBoundary(token, territory.id);
    setShowDeleteBoundaryModal(false);
    setKebabOpen(false);
    // Refresh territory data
    const updated = await getTerritory(territory.id, token);
    setTerritory(updated);
    // Success toast
    toast.success(intl.formatMessage({ id: "territory.boundary.delete.success" }));
  } catch (err) {
    console.error("Delete boundary failed:", err);
    toast.error("Failed to delete boundary");
  } finally {
    setDeletingBoundary(false);
  }
}, [token, territory, intl]);
```

Note: Check if `toast` is already imported (it should be from react-hot-toast). If not, add `import toast from "react-hot-toast";`.

- [ ] **Step 4: Add kebab menu button to the toolbar**

In the toolbar section (around line 1022, after the ExportDropdown and before the expand/minimize button), add the kebab menu. It should be rendered when `!editMode && !clipMode`:

```tsx
{/* Kebab menu */}
{!editMode && !clipSegment && can("app:territories.edit") && territory?.boundaries && (
  <div className="relative">
    <button
      onClick={() => setKebabOpen((v) => !v)}
      className="p-2 rounded-[var(--radius-sm)] bg-[var(--bg-1)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer shadow-lg"
    >
      <MoreVertical size={16} />
    </button>
    {kebabOpen && (
      <>
        <div className="fixed inset-0 z-40" onClick={() => setKebabOpen(false)} />
        <div className="absolute right-0 top-full mt-1 z-50 bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] shadow-xl min-w-[180px]">
          <button
            onClick={() => { setKebabOpen(false); setShowDeleteBoundaryModal(true); }}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
          >
            <Trash2 size={13} />
            <FormattedMessage id="territory.boundary.delete" />
          </button>
        </div>
      </>
    )}
  </div>
)}
```

- [ ] **Step 5: Add confirmation modal**

Add just before the closing `</div>` of the component's return, alongside other modals:

```tsx
{/* Delete Boundary Confirmation Modal */}
{showDeleteBoundaryModal && territory && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div className="bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius)] p-6 max-w-md mx-4 shadow-2xl">
      <h3 className="text-sm font-semibold text-[var(--text)] mb-3">
        <FormattedMessage id="territory.boundary.delete" />
      </h3>
      <p className="text-sm text-[var(--text-muted)] mb-6">
        <FormattedMessage
          id="territory.boundary.delete.confirm"
          values={{ number: territory.number, name: territory.name }}
        />
      </p>
      <div className="flex justify-end gap-2">
        <button
          onClick={() => setShowDeleteBoundaryModal(false)}
          disabled={deletingBoundary}
          className="px-4 py-2 text-xs font-medium border border-[var(--border)] text-[var(--text-muted)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
        >
          <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
        </button>
        <button
          onClick={handleDeleteBoundary}
          disabled={deletingBoundary}
          className="px-4 py-2 text-xs font-semibold bg-red-500 text-white rounded-[var(--radius-sm)] hover:bg-red-600 transition-colors cursor-pointer disabled:opacity-50"
        >
          {deletingBoundary ? "..." : <FormattedMessage id="territory.boundary.delete" />}
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 6: Verify build**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add hub-app/src/pages/territories/TerritoryDetail.tsx
git commit -m "feat: add kebab menu with Delete Boundary action + confirmation modal"
```

---

## Chunk 2: KML Branch Import

### Task 4: Backend — Extract KML parser to shared utility

**Files:**
- Create: `hub-api/src/lib/kml-parser.ts`
- Modify: `hub-api/src/routes/import.ts`

- [ ] **Step 1: Create `hub-api/src/lib/kml-parser.ts`**

Extract the `ParsedPolygon` interface and `parseKmlPolygons()` function from `import.ts` (lines 34-90) into a new shared file:

```typescript
/**
 * Shared KML parser — extracts Placemark polygons from KML strings.
 * Used by both standard KML import and branch KML import.
 */

export interface ParsedPolygon {
  name: string | null;
  coordinates: number[][][]; // [ring[point[lng, lat, alt?]]]
}

/**
 * Minimal KML XML parser -- extracts Placemark polygons.
 * Does not require a full XML parser dependency.
 */
export function parseKmlPolygons(kml: string): ParsedPolygon[] {
  const results: ParsedPolygon[] = [];

  const placemarkRegex = /<Placemark[^>]*>([\s\S]*?)<\/Placemark>/gi;
  let placemarkMatch: RegExpExecArray | null;

  while ((placemarkMatch = placemarkRegex.exec(kml)) !== null) {
    const content = placemarkMatch[1]!;

    const nameMatch = content.match(/<name[^>]*>([^<]*)<\/name>/i);
    const name = nameMatch ? nameMatch[1]!.trim() : null;

    const coordsRegex = /<coordinates[^>]*>\s*([\s\S]*?)\s*<\/coordinates>/gi;
    let coordsMatch: RegExpExecArray | null;
    const rings: number[][][] = [];

    while ((coordsMatch = coordsRegex.exec(content)) !== null) {
      const coordStr = coordsMatch[1]!.trim();
      const points = coordStr
        .split(/\s+/)
        .filter((s) => s.length > 0)
        .map((s) => {
          const parts = s.split(",").map(Number);
          return parts.length >= 2 ? parts : null;
        })
        .filter((p): p is number[] => p !== null && !p.some(isNaN));

      if (points.length >= 3) {
        const first = points[0]!;
        const last = points[points.length - 1]!;
        if (first[0] !== last[0] || first[1] !== last[1]) {
          points.push([...first]);
        }
        rings.push(points);
      }
    }

    if (rings.length > 0) {
      results.push({ name, coordinates: rings });
    }
  }

  return results;
}
```

- [ ] **Step 2: Update `import.ts` to import from shared parser**

In `hub-api/src/routes/import.ts`:

1. Add import at the top (after the existing imports, around line 9):
   ```typescript
   import { parseKmlPolygons, type ParsedPolygon } from "../lib/kml-parser.js";
   ```

2. Delete the local `ParsedPolygon` interface (lines 34-37) and `parseKmlPolygons` function (lines 39-90).

- [ ] **Step 3: Verify build**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-api`
Expected: Build succeeds, no behavior change

- [ ] **Step 4: Commit**

```bash
git add hub-api/src/lib/kml-parser.ts hub-api/src/routes/import.ts
git commit -m "refactor: extract parseKmlPolygons into shared kml-parser.ts"
```

### Task 5: Backend — POST /territories/import/kml/branch endpoint

**Files:**
- Modify: `hub-api/src/routes/import.ts` (add new endpoint inside `importRoutes()`)

- [ ] **Step 1: Add the branch KML import endpoint**

Add after the existing KML import endpoint (after line 293), inside `importRoutes()`:

```typescript
// ─── Branch KML import ──────────────────────────────────────────
app.post<{ Body: KmlBodyType }>(
  "/territories/import/kml/branch",
  {
    preHandler: requirePermission(PERMISSIONS.TERRITORIES_IMPORT),
    schema: { body: KmlBody },
  },
  async (request, reply) => {
    const polygons = parseKmlPolygons(request.body.kml);

    if (polygons.length === 0) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "No valid polygons found in KML",
      });
    }

    let updated = 0;
    let created = 0;
    let skipped = 0;
    const warnings: string[] = [];

    // Extract territory number from Placemark name
    const numberRegex = /^T?-?(\d+)/i;

    for (const poly of polygons) {
      if (poly.coordinates.length === 0) {
        skipped++;
        warnings.push(`Skipped placemark "${poly.name ?? "(unnamed)"}": no polygon geometry`);
        continue;
      }

      // Extract territory number
      const nameStr = poly.name ?? "";
      const numMatch = nameStr.match(numberRegex);
      if (!numMatch) {
        skipped++;
        warnings.push(`Skipped placemark "${nameStr}": no territory number found`);
        continue;
      }
      const territoryNumber = numMatch[1]!;

      // Convert to GeoJSON
      const geojsonCoords = poly.coordinates.map((ring) =>
        ring.map((pt) => [pt[0]!, pt[1]!]),
      );
      const boundaries =
        poly.coordinates.length === 1
          ? { type: "Polygon" as const, coordinates: geojsonCoords }
          : { type: "MultiPolygon" as const, coordinates: geojsonCoords.map((ring) => [ring]) };

      // Find existing territory by number
      const existing = await prisma.territory.findFirst({
        where: { number: territoryNumber },
      });

      if (existing) {
        // Update existing territory boundary
        try {
          // Save previous boundary in version history
          if (existing.boundaries) {
            const lastVersion = await prisma.territoryBoundaryVersion.findFirst({
              where: { territoryId: existing.id },
              orderBy: { version: "desc" },
              select: { version: true },
            });
            const nextVersion = (lastVersion?.version ?? 0) + 1;
            await prisma.territoryBoundaryVersion.create({
              data: {
                territoryId: existing.id,
                version: nextVersion,
                boundaries: existing.boundaries as any,
                changeType: "branch_import",
                changeSummary: `Previous boundary before branch KML import`,
              },
            });
          }

          // Run auto-fix pipeline on new boundary
          let finalBoundaries: object = boundaries;
          try {
            const { runAutoFixPipeline } = await import("../lib/postgis-helpers.js");
            const autoFix = await runAutoFixPipeline(prisma, boundaries, existing.id);
            finalBoundaries = autoFix.clipped;
          } catch {
            // PostGIS not available, use as-is
          }

          await prisma.territory.update({
            where: { id: existing.id },
            data: { boundaries: finalBoundaries } as any,
          });
          updated++;
        } catch (err) {
          warnings.push(`Failed to update territory #${territoryNumber}: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        // Create new territory
        try {
          await prisma.territory.create({
            data: {
              number: territoryNumber,
              name: nameStr.replace(numberRegex, "").trim() || `Territory ${territoryNumber}`,
              type: "territory",
              boundaries,
            },
          });
          created++;
        } catch (err) {
          warnings.push(`Failed to create territory #${territoryNumber}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    return reply.code(200).send({ updated, created, skipped, warnings });
  },
);
```

- [ ] **Step 2: Add `runAutoFixPipeline` import at top of file**

At the top of `import.ts`, add:
```typescript
import { runAutoFixPipeline } from "../lib/postgis-helpers.js";
```

Then replace the dynamic `import()` in the endpoint with the static import. (Or keep the dynamic import for PostGIS-optional environments -- either approach works. The dynamic import is safer for environments without PostGIS.)

- [ ] **Step 3: Verify build**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-api`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add hub-api/src/routes/import.ts
git commit -m "feat: add POST /territories/import/kml/branch endpoint"
```

### Task 6: Frontend — Branch KML Import card + API client

**Files:**
- Modify: `hub-app/src/lib/territory-api.ts`
- Modify: `hub-app/src/pages/territories/ImportWizard.tsx`
- Modify: `hub-app/src/i18n/messages/en-US.json`
- Modify: `hub-app/src/i18n/messages/de-DE.json`

- [ ] **Step 1: Add `importBranchKml()` to territory-api.ts**

Add after the existing `importKml()` function (around line 500):

```typescript
export interface ImportBranchKmlResult {
  updated: number;
  created: number;
  skipped: number;
  warnings: string[];
}

export async function importBranchKml(file: File, token: string): Promise<ImportBranchKmlResult> {
  const kml = await file.text();
  return apiFetch("/territories/import/kml/branch", token, {
    method: "POST",
    body: JSON.stringify({ kml, name: file.name.replace(/\.kml$/i, "") }),
  });
}
```

- [ ] **Step 2: Add English i18n keys**

Add to `en-US.json`:

```json
"import.branch.title": "Branch KML Import",
"import.branch.subtitle": "Update territory boundaries from branch KML files",
"import.branch.updated": "{count} territories updated",
"import.branch.created": "{count} new territories created",
"import.branch.skipped": "{count} skipped (no polygon)",
"import.branch.warnings": "{count} warnings"
```

- [ ] **Step 3: Add German i18n keys**

Add to `de-DE.json`:

```json
"import.branch.title": "Branch-KML-Import",
"import.branch.subtitle": "Gebietsgrenzen aus Branch-KML-Dateien aktualisieren",
"import.branch.updated": "{count} Gebiete aktualisiert",
"import.branch.created": "{count} neue Gebiete erstellt",
"import.branch.skipped": "{count} \u00fcbersprungen (kein Polygon)",
"import.branch.warnings": "{count} Warnungen"
```

- [ ] **Step 4: Update ImportWizard.tsx — add mode type and third card**

In `hub-app/src/pages/territories/ImportWizard.tsx`:

1. Update the `ImportMode` type (line 23) to include `"branch-kml"`:
   ```typescript
   type ImportMode = "select" | "kml" | "branch-kml" | "csv-upload" | "csv-preview" | "csv-confirm" | "done";
   ```

2. Add imports for the new API function and icon:
   ```typescript
   import { importBranchKml, type ImportBranchKmlResult } from "@/lib/territory-api";
   import { GitBranch } from "lucide-react";
   ```
   (Check if `GitBranch` is already imported from lucide-react. If not, add it.)

3. Add state for branch result:
   ```typescript
   const [branchResult, setBranchResult] = useState<ImportBranchKmlResult | null>(null);
   ```

4. Change the card grid from `sm:grid-cols-2` to `sm:grid-cols-3` (line 133).

5. Add the third card after the CSV card (after line 161):
   ```tsx
   <button
     onClick={() => setMode("branch-kml")}
     className="flex flex-col items-center gap-3 p-8 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] hover:border-[var(--amber)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
   >
     <GitBranch size={32} className="text-[var(--amber)]" />
     <span className="text-sm font-semibold text-[var(--text)]">
       <FormattedMessage id="import.branch.title" />
     </span>
     <span className="text-xs text-[var(--text-muted)] text-center">
       <FormattedMessage id="import.branch.subtitle" />
     </span>
   </button>
   ```

6. Add the branch KML upload mode section (after the KML upload block, similar structure):
   ```tsx
   {mode === "branch-kml" && (
     <div className="max-w-md">
       <label className="flex flex-col items-center gap-4 p-12 border-2 border-dashed border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] hover:border-[var(--amber)] transition-colors cursor-pointer">
         {loading ? (
           <>
             <Loader2 size={32} className="text-[var(--amber)] animate-spin" />
             <span className="text-sm text-[var(--text-muted)]">
               <FormattedMessage id="territories.importing" defaultMessage="Importing..." />
             </span>
           </>
         ) : (
           <>
             <Upload size={32} className="text-[var(--text-muted)]" />
             <span className="text-sm text-[var(--text-muted)]">
               <FormattedMessage
                 id="territories.kmlDrop"
                 defaultMessage="Drop a KML file here or click to browse"
               />
             </span>
           </>
         )}
         <input
           type="file"
           accept=".kml"
           className="hidden"
           disabled={loading}
           onChange={async (e) => {
             const file = e.target.files?.[0];
             if (!file || !token) return;
             setLoading(true);
             setError(null);
             try {
               const result = await importBranchKml(file, token);
               setBranchResult(result);
               setMode("done");
             } catch (err: any) {
               setError(err.message ?? "Branch KML import failed");
             } finally {
               setLoading(false);
             }
           }}
         />
       </label>
     </div>
   )}
   ```

7. In the `mode === "done"` block, add branch result display alongside the existing KML result display:
   ```tsx
   {branchResult && (
     <div className="space-y-2">
       <p className="text-sm text-[var(--text)]">
         <FormattedMessage id="import.branch.updated" values={{ count: branchResult.updated }} />
       </p>
       <p className="text-sm text-[var(--text)]">
         <FormattedMessage id="import.branch.created" values={{ count: branchResult.created }} />
       </p>
       {branchResult.skipped > 0 && (
         <p className="text-sm text-[var(--text-muted)]">
           <FormattedMessage id="import.branch.skipped" values={{ count: branchResult.skipped }} />
         </p>
       )}
       {branchResult.warnings.length > 0 && (
         <details className="text-xs text-[var(--text-muted)]">
           <summary className="cursor-pointer">
             <FormattedMessage id="import.branch.warnings" values={{ count: branchResult.warnings.length }} />
           </summary>
           <ul className="mt-1 space-y-0.5 pl-4 list-disc">
             {branchResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
           </ul>
         </details>
       )}
     </div>
   )}
   ```

- [ ] **Step 5: Verify build**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add hub-app/src/lib/territory-api.ts hub-app/src/pages/territories/ImportWizard.tsx hub-app/src/i18n/messages/en-US.json hub-app/src/i18n/messages/de-DE.json
git commit -m "feat: add Branch KML Import card + API client"
```

---

## Chunk 3: Bulk Fix Violations

### Task 7: Backend — POST /territories/fix/bulk endpoint

**Files:**
- Modify: `hub-api/src/routes/territories.ts`

- [ ] **Step 1: Add TypeBox schema for bulk fix request**

Add after the existing schema definitions (around line 48, before `createBoundaryVersion`):

```typescript
const BulkFixBody = Type.Object({
  territoryIds: Type.Array(Type.String({ format: "uuid" }), { minItems: 1, maxItems: 50 }),
});
type BulkFixBodyType = Static<typeof BulkFixBody>;
```

- [ ] **Step 2: Add the POST /territories/fix/bulk endpoint**

Add after the DELETE /territories/:id/boundaries endpoint:

```typescript
// Bulk fix violations — auto-fix pipeline on multiple territories
app.post<{ Body: BulkFixBodyType }>(
  "/territories/fix/bulk",
  {
    preHandler: requirePermission(PERMISSIONS.TERRITORIES_EDIT),
    schema: { body: BulkFixBody },
  },
  async (request, reply) => {
    const { territoryIds } = request.body;

    // Fetch all requested territories
    const territories = await prisma.territory.findMany({
      where: { id: { in: territoryIds } },
      orderBy: { number: "asc" },
    });

    if (territories.length === 0) {
      return reply.code(404).send({ error: "No territories found" });
    }

    let fixed = 0;
    const failed: Array<{ id: string; number: string; error: string }> = [];

    for (const territory of territories) {
      if (!territory.boundaries) {
        failed.push({ id: territory.id, number: territory.number, error: "No boundary" });
        continue;
      }

      try {
        // Save previous boundary for undo
        await createBoundaryVersion(
          territory.id,
          territory.boundaries as object,
          "bulk_fix",
          `Previous boundary before bulk fix`
        );

        // Run auto-fix pipeline
        const autoFix = await runAutoFixPipeline(
          prisma,
          territory.boundaries as object,
          territory.id
        );

        if (autoFix.geometryModified) {
          await prisma.territory.update({
            where: { id: territory.id },
            data: { boundaries: autoFix.clipped } as any,
          });
        }

        fixed++;
      } catch (err) {
        failed.push({
          id: territory.id,
          number: territory.number,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return reply.send({ fixed, failed });
  },
);
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-api`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add hub-api/src/routes/territories.ts
git commit -m "feat: add POST /territories/fix/bulk endpoint"
```

### Task 8: Frontend — API client + i18n for bulk fix

**Files:**
- Modify: `hub-app/src/lib/territory-api.ts`
- Modify: `hub-app/src/i18n/messages/en-US.json`
- Modify: `hub-app/src/i18n/messages/de-DE.json`

- [ ] **Step 1: Add `bulkFixViolations()` to territory-api.ts**

Add after the `deleteBoundary()` function:

```typescript
export interface BulkFixResult {
  fixed: number;
  failed: Array<{ id: string; number: string; error: string }>;
}

export function bulkFixViolations(
  token: string,
  territoryIds: string[],
): Promise<BulkFixResult> {
  return apiFetch("/territories/fix/bulk", token, {
    method: "POST",
    body: JSON.stringify({ territoryIds }),
  });
}
```

- [ ] **Step 2: Add English i18n keys**

Add to `en-US.json`:

```json
"territory.fix.button": "Fix Violations",
"territory.fix.selectAll": "Select All",
"territory.fix.selected": "{count} selected",
"territory.fix.run": "Fix Selected",
"territory.fix.success": "{count, plural, one {# territory fixed} other {# territories fixed}}",
"territory.fix.partial": "{fixed} fixed, {failed} failed"
```

- [ ] **Step 3: Add German i18n keys**

Add to `de-DE.json`:

```json
"territory.fix.button": "Verst\u00f6\u00dfe beheben",
"territory.fix.selectAll": "Alle ausw\u00e4hlen",
"territory.fix.selected": "{count} ausgew\u00e4hlt",
"territory.fix.run": "Ausgew\u00e4hlte beheben",
"territory.fix.success": "{count, plural, one {# Gebiet behoben} other {# Gebiete behoben}}",
"territory.fix.partial": "{fixed} behoben, {failed} fehlgeschlagen"
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add hub-app/src/lib/territory-api.ts hub-app/src/i18n/messages/en-US.json hub-app/src/i18n/messages/de-DE.json
git commit -m "feat: add bulkFixViolations API client + i18n keys"
```

### Task 9: Frontend — Make ViolationBadges selectable in fix mode

**Files:**
- Modify: `hub-app/src/pages/territories/ViolationBadges.tsx`

- [ ] **Step 1: Extend props interface**

Update the `ViolationBadgesProps` interface to support fix mode:

```typescript
interface ViolationBadgesProps {
  map: any;
  maplibreModule: React.RefObject<any | null>;
  token: string | null;
  territories: Array<{ id: string; number: string; boundaries: unknown }>;
  fixMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onViolationsLoaded?: (violations: TerritoryViolation[]) => void;
}
```

- [ ] **Step 2: Update component signature and destructuring**

```typescript
export function ViolationBadges({
  map, maplibreModule, token, territories,
  fixMode = false, selectedIds, onToggleSelect, onViolationsLoaded,
}: ViolationBadgesProps) {
```

- [ ] **Step 3: Call onViolationsLoaded when violations are fetched**

In the fetch useEffect (line 20-28), after `setViolations(data)`, add:

```typescript
.then((data) => {
  setViolations(data);
  setFetched(true);
  onViolationsLoaded?.(data);
})
```

- [ ] **Step 4: Update marker rendering for fix mode**

In the marker creation loop (lines 46-79), modify the click handler and styling to support selection:

```typescript
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
  const isSelected = fixMode && selectedIds?.has(v.territoryId);
  const baseColor = hasExceedsBoundary ? "#ef4444" : "#f59e0b";
  const color = isSelected ? "#f59e0b" : baseColor;
  const size = isSelected ? "28px" : "22px";

  const el = document.createElement("div");
  el.className = "violation-badge";
  el.style.cssText = `
    width: ${size}; height: ${size}; border-radius: 50%;
    background: ${color}; color: ${isSelected ? "black" : hasExceedsBoundary ? "white" : "black"};
    display: flex; align-items: center; justify-content: center;
    font-size: ${isSelected ? "14px" : "12px"}; font-weight: 700; cursor: pointer;
    box-shadow: 0 2px 8px ${color}66;
    ${isSelected ? "border: 2px solid white;" : ""}
    transition: all 0.15s ease;
  `;
  el.textContent = isSelected ? "\u2713" : "!";

  if (fixMode) {
    el.onclick = () => onToggleSelect?.(v.territoryId);
  } else {
    el.onclick = () => navigate(`/territories/${v.territoryId}`);
  }

  const marker = new MarkerClass({ element: el })
    .setLngLat([cx, cy])
    .addTo(map);
  markersRef.current.push(marker);
}
```

- [ ] **Step 5: Add fixMode and selectedIds to the useEffect dependency array**

Update the dependency array on the marker useEffect:

```typescript
}, [map, violations, territories, navigate, fixMode, selectedIds, onToggleSelect]);
```

- [ ] **Step 6: Verify build**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add hub-app/src/pages/territories/ViolationBadges.tsx
git commit -m "feat: make ViolationBadges selectable in fix mode"
```

### Task 10: Frontend — Fix Violations mode on TerritoryMap

**Files:**
- Modify: `hub-app/src/pages/territories/TerritoryMap.tsx`

- [ ] **Step 1: Add imports**

Add to imports:
```typescript
import { bulkFixViolations, type TerritoryViolation } from "@/lib/territory-api";
import toast from "react-hot-toast";
import { useIntl } from "react-intl";
import { ShieldAlert, CheckSquare, X } from "lucide-react";
```

(Check which of these are already imported and only add the missing ones.)

- [ ] **Step 2: Add fix mode state**

Inside the TerritoryMap component, add state variables:

```typescript
const intl = useIntl();
const [fixMode, setFixMode] = useState(false);
const [fixSelectedIds, setFixSelectedIds] = useState<Set<string>>(new Set());
const [fixRunning, setFixRunning] = useState(false);
const [violationList, setViolationList] = useState<TerritoryViolation[]>([]);
```

- [ ] **Step 3: Add handlers**

```typescript
const handleToggleFixSelect = useCallback((id: string) => {
  setFixSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}, []);

const handleSelectAllViolations = useCallback(() => {
  setFixSelectedIds(new Set(violationList.map((v) => v.territoryId)));
}, [violationList]);

const handleFixSelected = useCallback(async () => {
  if (!token || fixSelectedIds.size === 0) return;
  setFixRunning(true);
  try {
    const result = await bulkFixViolations(token, Array.from(fixSelectedIds));
    if (result.failed.length === 0) {
      toast.success(intl.formatMessage({ id: "territory.fix.success" }, { count: result.fixed }));
    } else {
      toast(intl.formatMessage({ id: "territory.fix.partial" }, { fixed: result.fixed, failed: result.failed.length }));
    }
    // Exit fix mode and refresh
    setFixMode(false);
    setFixSelectedIds(new Set());
    // Trigger re-fetch of territories + violations by incrementing a key or similar
    // The simplest approach: reload the page data
    window.location.reload();
  } catch (err) {
    toast.error("Bulk fix failed");
    console.error(err);
  } finally {
    setFixRunning(false);
  }
}, [token, fixSelectedIds, intl]);

const handleViolationsLoaded = useCallback((violations: TerritoryViolation[]) => {
  setViolationList(violations);
}, []);
```

- [ ] **Step 4: Add "Fix Violations" button to the map toolbar**

In the toolbar area (near the existing buttons like Create Territory), add a Fix Violations button that is only visible when violations exist and user has permission:

```tsx
{violationList.length > 0 && can("app:territories.edit") && !fixMode && (
  <button
    onClick={() => setFixMode(true)}
    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-500/20 border border-amber-500/40 text-amber-400 rounded-[var(--radius-sm)] hover:bg-amber-500/30 transition-colors cursor-pointer"
  >
    <ShieldAlert size={13} />
    <FormattedMessage id="territory.fix.button" />
    <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-amber-500/30 rounded-full">
      {violationList.length}
    </span>
  </button>
)}
```

- [ ] **Step 5: Add fix mode floating toolbar**

When fix mode is active and at least one badge is selected, show a floating toolbar:

```tsx
{fixMode && (
  <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-2 bg-[var(--bg-2)] border border-[var(--amber)]/40 rounded-[var(--radius)] shadow-xl">
    <span className="text-xs text-[var(--text-muted)]">
      <FormattedMessage id="territory.fix.selected" values={{ count: fixSelectedIds.size }} />
    </span>
    <button
      onClick={handleSelectAllViolations}
      className="px-2 py-1 text-[10px] font-medium border border-[var(--border)] text-[var(--text-muted)] rounded hover:bg-[var(--glass)] transition-colors cursor-pointer"
    >
      <FormattedMessage id="territory.fix.selectAll" />
    </button>
    <button
      onClick={handleFixSelected}
      disabled={fixSelectedIds.size === 0 || fixRunning}
      className="px-3 py-1 text-xs font-semibold bg-amber-500/80 text-black rounded hover:bg-amber-400 transition-colors cursor-pointer disabled:opacity-50"
    >
      {fixRunning ? "..." : <FormattedMessage id="territory.fix.run" />}
    </button>
    <button
      onClick={() => { setFixMode(false); setFixSelectedIds(new Set()); }}
      className="p-1 text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
    >
      <X size={14} />
    </button>
  </div>
)}
```

- [ ] **Step 6: Pass fix mode props to ViolationBadges**

Update the ViolationBadges usage (around line 389):

```tsx
<ViolationBadges
  map={isLoaded ? mapRef.current : null}
  maplibreModule={maplibreModule}
  token={token}
  territories={territories}
  fixMode={fixMode}
  selectedIds={fixSelectedIds}
  onToggleSelect={handleToggleFixSelect}
  onViolationsLoaded={handleViolationsLoaded}
/>
```

- [ ] **Step 7: Verify build**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build --workspace=hub-app`
Expected: Build succeeds

- [ ] **Step 8: Commit**

```bash
git add hub-app/src/pages/territories/TerritoryMap.tsx
git commit -m "feat: add Fix Violations mode on TerritoryMap"
```

---

## Chunk 4: Version Bump, CHANGELOG, Build

### Task 11: Version bump + CHANGELOG + build

**Files:**
- Modify: `package.json` (root)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump version**

Update `package.json` version from `2026.04.03.8` to `2026.04.03.9`.

- [ ] **Step 2: Update CHANGELOG.md**

Add a new entry at the top:

```markdown
## v2026.04.03.9

### Territory Management Features
- **Delete Boundary**: Kebab menu on TerritoryDetail to delete a territory polygon without removing the territory itself (`DELETE /territories/:id/boundaries`)
- **Branch KML Import**: New import card to update existing territory boundaries by matching territory numbers from branch-tool KML files (`POST /territories/import/kml/branch`)
- **Bulk Fix Violations**: Fix mode on map view to select and auto-fix multiple violated territories at once (`POST /territories/fix/bulk`)
- Extracted KML parser into shared `kml-parser.ts` utility
- Added i18n keys for all three features (EN + DE)
```

- [ ] **Step 3: Full build**

Run: `cd /Users/buecheleb/github/itunified-io/hubport.cloud && npm run build`
Expected: Both hub-api and hub-app build successfully

- [ ] **Step 4: Commit all**

```bash
git add package.json CHANGELOG.md
git commit -m "chore: bump version to v2026.04.03.9 + CHANGELOG"
```

- [ ] **Step 5: Tag and Docker build + deploy**

Follow the standard release workflow:
1. Create annotated tag: `git tag -a v2026.04.03.9 -m "v2026.04.03.9: territory management features"`
2. Docker multi-platform build + push
3. Deploy to penzberg-north-uat tenant (local Mac Docker)
4. Verify all three features work
