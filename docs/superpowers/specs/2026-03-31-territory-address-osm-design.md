# Territory Address & OSM Management — Design Spec

**Date:** 2026-03-31
**Status:** Draft
**Target repo:** hubport.cloud (territory module)
**Source reference:** Frozen `itunified-io/hub` codebase
**Related spec:** `2026-03-31-territory-drawing-ux-design.md` (Spec 1 — boundary drawing UX)

## Scope

This is **Spec 2 of 4** for the territory module:

| Spec | Scope | Status |
|------|-------|--------|
| 1. Drawing UX | Vertex manipulation, snap engine, split, lasso, auto-fix | Done |
| **2. Address & OSM** | **OSM fetching, gap detection, local OSM layer, addresses, visits, heatmap, import** | **This document** |
| 3. Territory Operations | Assignment, campaigns, visit tracking workflows | Planned |
| 4. Sharing & RBAC | Cross-tenant sharing, RBAC role planning | Planned |

## Data Models

### Address (full carry-over from frozen hub)

```prisma
model Address {
  addressId       String        @id @default(uuid())
  tenantId        String
  territoryId     String?       // null = pooled (unattached)
  streetAddress   String        @db.VarChar(500)
  apartment       String?       @db.VarChar(100)
  city            String?       @db.VarChar(255)
  postalCode      String?       @db.VarChar(20)
  latitude        Float?
  longitude       Float?
  // point — PostGIS Point column, managed via raw SQL (see PostGIS Point Management section)
  type            AddressType   @default(residential)
  status          AddressStatus @default(active)
  languageSpoken  String?       @db.VarChar(50)
  bellCount       Int?
  doNotCallReason String?
  doNotVisitUntil DateTime?
  lastVisitDate   DateTime?     // denormalized from most recent AddressVisit
  lastVisitOutcome VisitOutcome?
  notes           String?
  osmNodeId       String?       @db.VarChar(100)
  source          AddressSource @default(manual)
  sortOrder       Int           @default(0)
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  territory       Territory?    @relation(fields: [territoryId], references: [id])
  visits          AddressVisit[]

  @@index([tenantId])
  @@index([tenantId, territoryId])
  @@index([tenantId, status])
}

enum AddressType {
  residential
  business
  apartment_building
  rural
}

enum AddressStatus {
  active
  do_not_call
  not_at_home
  moved
  deceased
  foreign_language
  archived
}

enum AddressSource {
  manual
  osm
  csv_import
}
```

#### PostGIS Point Management

The `point` column is a PostGIS `geometry(Point, 4326)` column added via raw SQL migration (not managed by Prisma):

```sql
ALTER TABLE "Address" ADD COLUMN point geometry(Point, 4326);
CREATE INDEX idx_address_point ON "Address" USING GIST (point);
```

**When populated:**
- On address create: if `latitude` and `longitude` are provided, set `point = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)`
- On address update: if coordinates change, update `point` accordingly
- If coordinates are null, `point` is null

**Used by:** `ST_Contains()` queries in gap detection and `findAddressesInBoundary()`.

### AddressVisit

Visits are **immutable audit records** — once logged, they cannot be edited or deleted. This ensures a reliable visit history for territory management.

```prisma
model AddressVisit {
  visitId    String       @id @default(uuid())
  tenantId   String
  addressId  String
  memberId   String?      // Keycloak user ID (sub claim from JWT)
  visitDate  DateTime     @default(now())
  outcome    VisitOutcome
  notes      String?
  createdAt  DateTime     @default(now())

  address    Address      @relation(fields: [addressId], references: [addressId], onDelete: Cascade)

  @@index([tenantId])
  @@index([tenantId, addressId])
  @@index([addressId, visitDate(sort: Desc)])
}

enum VisitOutcome {
  contacted
  not_at_home
  do_not_call
  moved
  letter_sent
  phone_attempted
}
```

`memberId` is the Keycloak `sub` claim from the JWT. Publisher name for visit history display is resolved by looking up the Member model via `keycloakId` match.

### LocalOsmFeature (new — replaces OsmBuildingOverride)

A full local GeoJSON layer where users can add, correct, or annotate any geographic feature. Overrides OSM data for the tenant. Persists across OSM refreshes.

```prisma
model LocalOsmFeature {
  id          String          @id @default(uuid())
  tenantId    String
  osmId       String?         @db.VarChar(100) // null for user-created features
  featureType LocalOsmType
  geometry    Json            // GeoJSON Point, LineString, or Polygon
  properties  Json            // structured per featureType (see Required Properties table)
  createdBy   String
  updatedBy   String
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  @@unique([tenantId, osmId]) // one override per OSM entity per tenant
  @@index([tenantId])
  @@index([tenantId, featureType])
}

enum LocalOsmType {
  building_override  // correct/enrich existing OSM building
  street             // add missing street not yet in OSM
  poi                // mark planning-relevant location
  custom             // freeform annotation
}
```

#### Required Properties Per Feature Type

| Type | Required | Optional |
|------|----------|----------|
| `building_override` | — | streetName, houseNumber, buildingType, notes |
| `street` | name | notes |
| `poi` | name, poiCategory | notes |
| `custom` | label | color (hex string, default `#FF6B00`), notes |

`poiCategory` values: `park`, `school`, `church`, `community`, `commercial`, `other`.

At least one property must be set for `building_override` (otherwise the override is meaningless). Server validates required properties per `featureType` on create/update — returns 400 with specific field errors if violated.

#### Geometry Validation

Server validates GeoJSON geometry on create/update:

- Must be valid GeoJSON per RFC 7946
- `building_override`: must be Point
- `street`: must be LineString with ≥2 coordinates
- `poi`: must be Point
- `custom`: must be Point, LineString (≥2 coords), or Polygon (≥4 coords, first = last, no self-intersections checked via `ST_IsValid()`)
- Coordinates must be WGS84 (SRID 4326), longitude range [-180, 180], latitude range [-90, 90]
- Invalid geometry returns 400: `{ error: "invalid_geometry", details: "..." }`

### IgnoredOsmBuilding (carry-over)

```prisma
model IgnoredOsmBuilding {
  id            String   @id @default(uuid())
  tenantId      String
  osmId         String   @db.VarChar(100)
  reason        String   // garage_carport | shed_barn | commercial_industrial | church_public | unoccupied_ruins | not_a_residence | duplicate | other
  evidence      String   // satellite | local_visit | osm_tags
  notes         String?
  ignoredBy     String
  latitude      Float?
  longitude     Float?
  streetAddress String?
  buildingType  String?  @db.VarChar(100)
  createdAt     DateTime @default(now())

  @@unique([tenantId, osmId])
  @@index([tenantId])
}
```

### OsmRefreshQueue (carry-over + enhanced)

```prisma
model OsmRefreshQueue {
  id              String    @id @default(uuid())
  tenantId        String
  territoryId     String
  status          String    // queued | processing | completed | failed
  error           String?
  lastRefreshed   DateTime?
  buildingsFound  Int?      // NEW: result counter
  addressesCreated Int?     // NEW: result counter
  addressesUpdated Int?     // NEW: result counter
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  territory       Territory @relation(fields: [territoryId], references: [id])

  @@index([tenantId, status])
}
```

### GapDetectionRun (carry-over)

```prisma
model GapDetectionRun {
  runId          String    @id @default(uuid())
  tenantId       String
  status         String    // pending | running | completed | failed
  totalBuildings Int?
  coveredCount   Int?
  gapCount       Int?
  resultGeoJson  Json?     // FeatureCollection of gap buildings as Points
  startedAt      DateTime  @default(now())
  completedAt    DateTime?
  createdBy      String

  @@index([tenantId, status])
}
```

## OSM Refresh Pipeline

### User Flow

1. User clicks "Refresh OSM data" on a territory (or bulk-selects multiple territories)
2. Server creates `OsmRefreshQueue` entry per territory, returns job IDs
3. BullMQ worker picks up jobs, processes one at a time (Overpass rate limit: 1 req/s)
4. Worker fetches buildings via `queryBuildingsInPolygon()` for the territory boundary
5. For each building: match against existing addresses by `osmNodeId` → update if exists, create if new
6. **Local OSM precedence:** When creating/updating an address, check `LocalOsmFeature` for a `building_override` with matching `osmId`. If found, local properties (streetName, houseNumber, buildingType) take precedence over OSM data.
7. On completion: update queue entry with `status: completed` + result counters
8. Client polls `GET /territories/osm-refresh/queue` for status updates (polling interval: 3s while any job is `queued` or `processing`)

### BullMQ Setup

- **Queue name:** `osm-refresh`
- **Concurrency:** 1 (Overpass rate limiting — existing `osm-overpass.ts` already has retry with exponential backoff)
- **Retry:** 3 attempts with exponential backoff (matches `osm-overpass.ts` retry logic)
- **Job timeout:** 60s per territory
- **Redis:** Added to tenant Docker stack (also available for future session caching)

### API Endpoints

| Endpoint | Method | Permission | Purpose |
|----------|--------|------------|---------|
| `/territories/:id/osm-refresh` | POST | `app:addresses.import` | Queue single territory refresh |
| `/territories/osm-refresh/bulk` | POST | `app:addresses.import` | Queue multiple territories (new). Body: `{ territoryIds: string[] }` |
| `/territories/osm-refresh/queue` | GET | `app:territories.view` | List last 50 jobs with status + counters, ordered by `createdAt DESC` |

### Duplicate Prevention

Before queuing, check if territory already has a `queued` or `processing` entry. If so, return `{ status: 'already_queued', id }` with 200 OK instead of creating a duplicate.

### Error Handling

- **Redis unavailable:** If Redis connection fails when queuing a job, return 503: `{ error: "queue_unavailable", message: "Background job system is temporarily unavailable. Please try again later." }`. Do not fall back to synchronous processing.
- **Overpass failures:** BullMQ retries 3 times with exponential backoff. After final failure, job status set to `failed` with error message from Overpass. User sees "Failed" status in queue list with error details.
- **Worker crash:** BullMQ `stalledInterval` (30s) detects stalled jobs and re-queues them automatically.

## Gap Detection

### User Flow

1. User navigates to gap detection page, clicks "Run Detection"
2. Server runs **synchronously** with a **120s timeout** (loading spinner in UI):
   - Fetches congregation boundary (territory with `type: 'congregation_boundary'`)
   - Queries OSM buildings within congregation polygon via `queryBuildingsInPolygon()`
   - Batch `ST_Contains` checks (500 at a time) to confirm buildings inside congregation boundary
   - For each building: check if covered by any non-congregation territory boundary
   - Filter out `IgnoredOsmBuilding` entries (persistent across runs)
   - Address sync: update existing territory-attached addresses, re-attach pooled addresses, create new addresses
3. Returns: `{ runId, status, totalBuildings, coveredCount, gapCount, ignoredCount, importedCount }`
4. Results displayed on map as gap markers (GeoJSON FeatureCollection)

### Error Handling

- **Overpass failure during gap detection:** If `queryBuildingsInPolygon()` fails after 3 retries, the run is saved with `status: 'failed'` and the error message. Returns 500: `{ error: "overpass_unavailable", runId, message: "Could not fetch building data from OpenStreetMap. Please try again later." }`
- **Timeout (>120s):** Request is aborted. Run saved with `status: 'failed'`, `error: 'timeout'`. Returns 504: `{ error: "detection_timeout", runId, message: "Detection took too long. This may happen with very large congregation boundaries." }`
- **No congregation boundary:** Returns 400: `{ error: "no_congregation_boundary", message: "Gap detection requires a congregation boundary. Please create one first." }`

### Gap Results UI

- Gap buildings shown as orange markers on map
- Click gap marker → popover with building info + actions:
  - **"Add to territory"** — opens territory picker. User selects which territory to assign the address to. If the building point is inside exactly one territory boundary (`ST_Contains`), that territory is pre-selected. If inside none, list shows nearest 5 territories by centroid distance.
  - **"Ignore"** — opens ignore dialog with reason + evidence dropdowns
  - **"Override type"** — reclassify building type (creates `LocalOsmFeature` with type `building_override`)
- **Bulk actions:** select multiple gaps → bulk ignore or bulk assign to a chosen territory

### Run History

- **Retention:** Last 3 completed runs kept. Auto-prune older completed runs when a new run completes. Failed runs are also pruned (keep last 3 across all statuses). The `GET /territories/gap-detection/runs` endpoint returns all retained runs (up to 6: 3 completed + 3 failed max).
- Each run shows summary stats + can re-display its result GeoJSON on map
- Ignored buildings filtered from current run display but restorable

### Coverage Proposals

`POST /territories/gap-detection/proposals` generates candidate territory boundaries to cover detected gaps using `generateCoverageProposalForTerritory()` PostGIS helper. Proposals scored by 4-factor weighted scoring: density, compactness, area, complexity (from `proposal-scoring.ts`).

**Request:**
```json
{
  "maxCandidates": 5,
  "minAreaM2": 10000,
  "includeIgnored": false
}
```

**Response:**
```json
{
  "proposals": [
    {
      "id": "proposal-1",
      "boundary": { "type": "Polygon", "coordinates": [...] },
      "score": 0.85,
      "scores": { "density": 0.9, "compactness": 0.8, "area": 0.85, "complexity": 0.85 },
      "buildingCount": 42,
      "areaM2": 25000,
      "suggestedNumber": "T-NEW-1"
    }
  ]
}
```

### API Endpoints

| Endpoint | Method | Permission | Purpose |
|----------|--------|------------|---------|
| `/territories/gap-detection/run` | POST | `app:gap_detection.run` | Run gap detection (synchronous, 120s timeout) |
| `/territories/gap-detection/runs` | GET | `app:gap_detection.view` | List retained runs (up to 6) |
| `/territories/gap-detection/runs/:runId` | GET | `app:gap_detection.view` | Get run details + result GeoJSON |
| `/territories/gap-detection/runs/:runId` | DELETE | `app:gap_detection.run` | Delete specific run |
| `/territories/gap-detection/ignore` | POST | `app:gap_detection.run` | Batch ignore buildings |
| `/territories/gap-detection/ignore/:osmId` | DELETE | `app:gap_detection.run` | Un-ignore building |
| `/territories/gap-detection/ignored` | GET | `app:gap_detection.view` | List all ignored buildings |
| `/territories/gap-detection/proposals` | POST | `app:gap_detection.run` | Generate coverage proposals |

## Local OSM Feature Layer

### Purpose

Tenant-local ground truth that overrides OSM wherever users have made corrections. Persists across OSM refreshes. Serves both territory planning context (better map data for boundary decisions) and address accuracy (correct street names for publishers working territories).

### Drawing UI

- Accessed via a **"Local data" toggle button** on the map toolbar (separate from territory editor)
- When active: existing local features shown as a distinct layer (dashed outlines, different color palette from territory polygons)
- **"Add feature"** button opens a mode selector: Building / Street / POI / Custom

**Per-type interactions:**

| Type | Interaction | Dialog |
|------|------------|--------|
| Building override | Click existing OSM building marker | Edit panel: street name, house number, building type, notes |
| Street | Click-to-place vertices on map, double-click to finish | Name dialog (name is required) |
| POI | Click on map to place pin | Category picker (required) + name (required) |
| Custom | Choose geometry type (point/line/polygon), draw it | Label (required) + color picker + notes |

### Integration with Other Systems

- **Snap engine** (from Spec 1): The `GET /territories/snap-context?bbox=...` endpoint (defined in Spec 1) is extended to include local streets. Local streets from `LocalOsmFeature` where `featureType = 'street'` are returned alongside OSM roads in the snap context response. The snap engine treats them at **priority 2** (same level as OSM roads — merged into the road set). This avoids adding a new priority level; local streets are simply additional road segments.
- **Gap detection:** Building overrides influence building classification. `IgnoredOsmBuilding` checked against local features.
- **OSM refresh:** When creating addresses for buildings with a local override, local properties (streetName, houseNumber) take precedence over OSM data
- **Heatmap:** POIs shown as overlay markers on all heatmap modes

### API Endpoints

| Endpoint | Method | Permission | Purpose |
|----------|--------|------------|---------|
| `/territories/local-osm` | GET | `app:territories.view` | Fetch local features. Query params: `bbox` (format: `minLng,minLat,maxLng,maxLat`), `featureType` (optional filter) |
| `/territories/local-osm` | POST | `app:territories.edit` | Create feature (validates geometry + required properties per type) |
| `/territories/local-osm/:id` | PUT | `app:territories.edit` | Update feature |
| `/territories/local-osm/:id` | DELETE | `app:territories.edit` | Delete feature |

## Address Management

### Address CRUD

Standard create/read/update/delete for addresses within a territory.

| Endpoint | Method | Permission | Purpose |
|----------|--------|------------|---------|
| `/territories/:id/addresses` | GET | `app:addresses.view` | List addresses in territory |
| `/territories/:id/addresses` | POST | `app:addresses.edit` | Create single address |
| `/territories/:id/addresses/bulk` | POST | `app:addresses.edit` | Bulk create (max 500). If >500, return 400: `{ error: "bulk_limit_exceeded", max: 500, received: N }` |
| `/territories/:id/addresses/:addrId` | PUT | `app:addresses.edit` | Update address |
| `/territories/:id/addresses/:addrId` | DELETE | `app:addresses.edit` | Delete address (cascades visits) |

### Do-Not-Visit Workflow

1. Publisher or overseer sets `status: do_not_call` on an address
2. **Required:** `doNotCallReason` (free text — "aggressive dog", "private property", "requested no visits")
3. **Optional:** `doNotVisitUntil` (date — temporary DNC). If null, DNC is permanent.
4. Map display: DNC addresses shown with a red "no entry" icon, dimmed opacity
5. DNC addresses remain in the territory but are excluded from work counts and visit statistics

**Auto-revert logic:**
- Runs on `GET /territories/:id/addresses` only (not on territory detail — avoids unnecessary writes on every territory view)
- Server checks addresses in the requested territory where `doNotVisitUntil < now()` AND `status = do_not_call`
- Reverts to `status: active`, clears `doNotCallReason` and `doNotVisitUntil`
- Uses a single `UPDATE ... WHERE` statement (no N+1 queries, no concurrency issues — idempotent)
- Returns count of reverted addresses in response metadata: `{ addresses: [...], meta: { revertedCount: 3 } }`
- Client shows toast if `revertedCount > 0`: "3 addresses returned to active — do-not-visit period expired"

### Language Tracking

- `languageSpoken` field on Address (free text)
- UI offers autocomplete from congregation's known languages (aggregated from existing address data via `SELECT DISTINCT languageSpoken FROM "Address" WHERE tenantId = $1 AND languageSpoken IS NOT NULL`)
- Used by language heatmap mode
- Address filtering: "Show all Spanish-speaking addresses across all territories"
- Foreign-language groups can filter territory maps to only show addresses matching their language

### Ignore vs Archive

Two separate mechanisms for different concerns:

| Mechanism | Model | Purpose | Visibility |
|-----------|-------|---------|------------|
| **Ignore OSM building** | `IgnoredOsmBuilding` | Exclude from gap detection. Not a real address. | Hidden from gap results, visible in "Ignored" list |
| **Archive address** | `Address.status = archived` | Soft-delete. Address existed but is no longer relevant. | Hidden from default views, visible with "Show archived" filter |

### Publisher Permission Scoping

Publishers with `app:addresses.edit` can only modify addresses in their currently assigned territory. This is enforced in the route handler:

1. Extract `userId` (Keycloak `sub`) from JWT
2. Query `TerritoryAssignment` for an active assignment (where `publisherId` matches a Member with matching `keycloakId` AND `returnedAt IS NULL`) for the requested territory
3. If no active assignment exists, return 403: `{ error: "not_assigned", message: "You can only edit addresses in your assigned territory" }`

This check applies to: address create, update, delete, and visit logging. Service Overseers and Tenant Admins bypass this check (they can edit any territory's addresses).

## Visit Tracking

### Logging a Visit

1. Publisher opens territory → taps address → "Log visit" button
2. Quick-entry form:
   - **Outcome** (required): contacted | not_at_home | do_not_call | moved | letter_sent | phone_attempted
   - **Notes** (optional): free text
   - **Date** (defaults to now, editable for backdating)
   - `memberId` auto-set from JWT `sub` claim (Keycloak user ID)
3. On save:
   - Creates `AddressVisit` record (immutable — no edit/delete endpoints)
   - Denormalizes `lastVisitDate` and `lastVisitOutcome` on parent `Address`
   - Updates `Territory.lastWorkedDate` to visit timestamp

### Visit History

- Address detail panel shows chronological visit list (newest first)
- Each entry: date, publisher name (resolved from Member model via `keycloakId`), outcome icon, notes
- Territory detail shows aggregate: total visits this month, contacted vs not-at-home ratio

### API Endpoints

| Endpoint | Method | Permission | Purpose |
|----------|--------|------------|---------|
| `/territories/:id/addresses/:addrId/visits` | GET | `app:addresses.view` | List visits for address (newest first) |
| `/territories/:id/addresses/:addrId/visits` | POST | `app:addresses.edit` | Log a visit (publisher scoping enforced) |

## Heatmap Visualization

All heatmaps render as MapLibre GL layers on top of territory polygons. User toggles between modes via a dropdown in the map toolbar.

### Heatmap Modes

| Mode | Data Source | Rendering | Level |
|------|-----------|-----------|-------|
| **Visit recency** | `Territory.lastWorkedDate` | Territory fill: red (>4 months) → yellow (2-4 months) → green (<2 months). Thresholds configurable per congregation. | Territory |
| **Visit density** | `AddressVisit` count per territory over selected time range | Territory fill opacity scales with visit count. Dense = opaque, sparse = transparent. | Territory |
| **Do-not-visit** | `Address` where `status = do_not_call` | Red dot markers, clustered at low zoom. Cluster count badge. | Address |
| **Language** | `Address.languageSpoken` | Colored dot markers per language. Legend shows language → color mapping. | Address |
| **Uncovered gaps** | `GapDetectionRun.resultGeoJson` from latest run | Orange building markers (same as gap detection results). | Building |
| **Address status** | `Address.status` | Icon markers per status: green checkmark (active), red circle (DNC), gray arrow (moved), etc. | Address |

### Heatmap API

| Endpoint | Method | Permission | Purpose |
|----------|--------|------------|---------|
| `/territories/heatmap` | GET | `app:territories.view` | Aggregated heatmap data |

**Query parameters:**
- `mode` (required): `recency` | `density` | `dnc` | `language` | `gaps` | `status`
- `timeRange` (optional, for density mode): `3m` | `6m` | `12m`. Default: `6m`. Other modes ignore this parameter.
- `bbox` (optional, for address-level modes): `minLng,minLat,maxLng,maxLat` (comma-separated floats, WGS84). Required for `dnc`, `language`, `status` modes to limit response size. Territory-level modes (`recency`, `density`) return all territories regardless of bbox.

**Response contracts per mode:**

```json
// mode=recency
{
  "mode": "recency",
  "territories": [
    {
      "territoryId": "uuid",
      "number": "T-1",
      "lastWorkedDate": "2026-01-15T10:00:00Z",
      "status": "overdue",
      "daysSinceLastVisit": 75
    }
  ]
}

// mode=density
{
  "mode": "density",
  "timeRange": "6m",
  "territories": [
    {
      "territoryId": "uuid",
      "number": "T-1",
      "visitCount": 142,
      "addressCount": 35
    }
  ]
}

// mode=dnc | mode=language | mode=status
{
  "mode": "dnc",
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [lng, lat] },
      "properties": {
        "addressId": "uuid",
        "status": "do_not_call",
        "languageSpoken": "Spanish",
        "territoryNumber": "T-1"
      }
    }
  ]
}

// mode=gaps
{
  "mode": "gaps",
  "runId": "uuid",
  "completedAt": "2026-03-30T14:00:00Z",
  "type": "FeatureCollection",
  "features": [...]
}
```

### Performance

- **Territory-level heatmaps** (recency, density): use polygon fills — fast even for 200+ territories. Data is small (one row per territory).
- **Address-level heatmaps** (DNC, language, status): use marker clustering at low zoom, individual markers at zoom ≥15. Server returns GeoJSON points with only the fields needed for rendering.
- **Viewport filtering:** Address-level heatmaps require `bbox` parameter. Only return addresses within the current viewport. Max 2000 points per response (if exceeded, return clustered aggregates instead).

### Bbox Parameter Format

All endpoints accepting `bbox` use the same format: `minLng,minLat,maxLng,maxLat` — four comma-separated float values in WGS84 (SRID 4326). Example: `bbox=8.5,47.3,8.6,47.4`.

This applies to: `/territories/heatmap`, `/territories/local-osm`, `/territories/snap-context` (Spec 1).

## KML/CSV Import

Carried over from frozen hub with one improvement.

### KML Import

1. Upload `.kml` file (max 10MB)
2. Server parses XML — each `<Placemark>` with a `<Polygon>` becomes a territory (name from `<name>` tag, boundary from `<coordinates>`)
3. **Validation:** XML must be valid KML. Placemarks without `<Polygon>` are skipped (logged in warnings). Z-coordinates in KML are ignored (only lng/lat used). Coordinate system is WGS84 per KML spec.
4. Auto-fix pipeline runs on each imported boundary (validate → water clip → congregation clip)
5. Duplicate detection: skip territories where `number` already exists (case-insensitive match)
6. Returns import summary:

```json
{
  "created": 12,
  "skipped": 2,
  "skippedDetails": [
    { "name": "T-5", "reason": "duplicate_number" }
  ],
  "warnings": [
    { "placemark": "Meeting Point", "reason": "no_polygon_geometry" }
  ],
  "errors": []
}
```

### CSV Import

Two-step flow: preview → confirm.

1. **Preview:** Upload CSV (max 5MB, UTF-8 encoding). Server detects columns by **header matching** — first row must contain headers. Supported headers (case-insensitive, flexible matching):
   - `street`, `streetAddress`, `street_address`, `address` → `streetAddress`
   - `apt`, `apartment`, `unit` → `apartment`
   - `city`, `town` → `city`
   - `zip`, `postal`, `postalCode`, `postal_code` → `postalCode`
   - `lat`, `latitude` → `latitude`
   - `lng`, `lon`, `longitude` → `longitude`
   - `type` → `type`
   - `language`, `languageSpoken`, `language_spoken` → `languageSpoken`
   - `notes`, `comment`, `comments` → `notes`

   If no `streetAddress` column is detected, return 400: `{ error: "missing_required_column", column: "streetAddress" }`.

   Preview response includes: detected column mapping, first 10 rows as preview, duplicate count (matches by `streetAddress + apartment` within target territory).

2. **Confirm:** User confirms/adjusts column mapping → server creates addresses in bulk (max 5000 per CSV).

### CSV Territory Import (new)

CSV can also create territories (not just addresses). Detected by presence of `territory_number` or `number` column header. Additional territory columns: `territory_name`/`name`, `wkt_boundary`/`boundary` (WKT format).

- Supported WKT types: `POLYGON` and `MULTIPOLYGON` only. SRID assumed 4326 (WGS84).
- Malformed WKT: row is skipped with warning.
- If CSV has both territory columns and address columns, creates territories first then assigns addresses by matching territory number.

### API Endpoints

| Endpoint | Method | Permission | Purpose |
|----------|--------|------------|---------|
| `/territories/import/kml` | POST | `app:territories.import` | KML file upload (multipart/form-data) |
| `/territories/import/csv/preview` | POST | `app:territories.import` | CSV preview with column detection + duplicate count |
| `/territories/import/csv` | POST | `app:territories.import` | CSV confirm and create |

## Permissions Summary

This spec introduces permissions for address and OSM management. For the complete permission set including boundary editing, see also Spec 1.

| Permission | Purpose | Roles |
|------------|---------|-------|
| `app:territories.view` | View territories, heatmaps, local OSM features | All authenticated |
| `app:territories.edit` | Edit boundaries (Spec 1), create/edit local OSM features | Service Overseer, SO Assistant, Tenant Admin |
| `app:territories.delete` | Delete territories (Spec 1) | Service Overseer, Tenant Admin |
| `app:territories.split` | Split territories via scissors (Spec 1) | Service Overseer, Tenant Admin |
| `app:territories.import` | KML/CSV import | Service Overseer, Tenant Admin |
| `app:addresses.view` | View addresses and visit history | All authenticated |
| `app:addresses.edit` | Create/update/delete addresses, log visits, set DNC | Service Overseer, SO Assistant, Tenant Admin, Publisher (own territory only) |
| `app:addresses.import` | OSM refresh (queue jobs) | Service Overseer, Tenant Admin |
| `app:gap_detection.view` | View gap detection runs and ignored buildings | Service Overseer, SO Assistant, Tenant Admin |
| `app:gap_detection.run` | Run detection, ignore/un-ignore buildings, proposals | Service Overseer, Tenant Admin |

**Publisher permission scoping:** Publishers with `app:addresses.edit` can only modify addresses and log visits in territories where they have an active assignment (`TerritoryAssignment` with `returnedAt IS NULL`). See the Publisher Permission Scoping section for enforcement details.

## Infrastructure Dependencies

### New: Redis

BullMQ requires Redis. Added to the tenant Docker stack:

```yaml
redis:
  image: redis:7-alpine
  restart: unless-stopped
  volumes:
    - redis-data:/data
  command: redis-server --appendonly yes --maxmemory 128mb --maxmemory-policy allkeys-lru
```

Redis is used for:
- BullMQ job queue (OSM refresh)
- Future: session caching, rate limiting

**Migration for existing tenants:** Redis is added to the `docker-compose.yml` template. Existing deployed tenants receive Redis on their next stack update (the installer's `update` command pulls the latest compose file and runs `docker compose up -d`, which adds new services without disrupting existing ones). No data migration needed — Redis starts empty, and BullMQ creates its queues on first use.

### Existing: PostGIS

All spatial queries use existing `postgis-helpers.ts` functions. No new PostGIS extensions needed.

### Existing: OSM Clients

- `osm-overpass.ts` — buildings, roads, water bodies (carried from frozen hub)
- `osm-nominatim.ts` — geocoding (carried from frozen hub)

## Components to Build

### API (hub-api)

| Component | Purpose |
|-----------|---------|
| `routes/addresses.ts` | Address CRUD + visit logging (extracted from monolithic territories.ts) |
| `routes/gap-detection.ts` | Gap detection runs, ignore list, proposals (extracted) |
| `routes/local-osm.ts` | Local OSM feature CRUD with geometry validation |
| `routes/heatmap.ts` | Heatmap data aggregation (6 modes) |
| `routes/import.ts` | KML/CSV import with column detection (extracted) |
| `workers/osm-refresh.ts` | BullMQ worker for async OSM refresh |
| `lib/bull.ts` | BullMQ queue initialization + Redis connection |

### UI (hub-app)

| Component | Purpose |
|-----------|---------|
| `AddressPanel` | Address list + detail view within territory |
| `AddressForm` | Create/edit address form with all fields |
| `VisitLogger` | Quick-entry visit logging (outcome picker + notes) |
| `VisitHistory` | Chronological visit list for an address |
| `GapDetection` | Gap detection page: run, view results, ignore, proposals |
| `LocalOsmEditor` | Local OSM feature drawing + editing UI |
| `HeatmapControl` | Map toolbar dropdown for heatmap mode selection |
| `HeatmapLegend` | Color/icon legend overlay for active heatmap |
| `ImportWizard` | KML/CSV import flow (preview, column mapping, confirm) |
| `OsmRefreshStatus` | Queue status indicator + refresh button per territory |

## Success Criteria

1. OSM refresh runs asynchronously via BullMQ — user sees progress and results without blocking
2. Gap detection identifies uncovered buildings within congregation boundary accurately
3. Users can create, edit, and delete local OSM features (buildings, streets, POIs, custom) on the map
4. Local OSM overrides take precedence over raw OSM data during address creation
5. Local streets appear in snap engine alongside OSM roads
6. Addresses support full lifecycle: create → visit → DNC → auto-revert → archive
7. DNC auto-revert works correctly on address list load (expired `doNotVisitUntil` reverts to active)
8. All 6 heatmap modes render correctly on MapLibre with appropriate clustering at low zoom
9. KML import creates territories with auto-fix pipeline; CSV import supports both territories and addresses
10. Publisher can log visits and set DNC on their assigned territory only (enforced server-side)
11. Redis unavailability returns 503 (no silent failure or fallback)
12. Zero regression on existing territory CRUD, boundary editing, and sharing features
