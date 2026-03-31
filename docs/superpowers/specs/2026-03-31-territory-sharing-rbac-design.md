# Territory Sharing & RBAC Refactor — Design Spec

**Date:** 2026-03-31
**Status:** Draft
**Target repos:** hubport.cloud (hub-api + central-api)
**Source reference:** Frozen `itunified-io/hub` codebase, existing hubport.cloud sharing system
**Related specs:** Spec 1 (Drawing UX), Spec 2 (Address & OSM), Spec 3 (Territory Operations)

## Problem

hubport.cloud has two RBAC problems and one feature gap:

1. **Legacy enforcement:** All routes use `requireRole("elder"/"publisher")` guards — coarse-grained, no permission granularity. A publisher can't view territories without also seeing meetings. An elder gets full access to everything.

2. **Missing permissions:** Specs 1-3 define 15+ new permissions (split, import, OSM refresh, campaigns, assignments, location sharing) that don't exist in the current system. The 3 existing territory permissions (`view`, `edit`, `assign`) are insufficient.

3. **Territory sharing is a JSON blob:** The existing cross-tenant sharing system (SharingApproval, SharingVisibility) supports a `territories` category, but `SharedTerritory.data` is an unstructured JSON blob with no privacy controls, no configurable depth, and no public share links for non-hubport users.

## ID Convention

Consistent with Spec 3:
- **`memberId`**, **`conductorId`** — Member model UUIDs (internal to hubport)
- **`createdBy`**, **`revokedBy`**, **`assignedBy`**, **`closedBy`** — Keycloak `sub` claim strings (identity provider ID)
- These are deliberately not FK-linked — Keycloak is the source of truth for identity, Member is an application-level record

## Solution Overview

1. **Full RBAC refactor** — Define complete permission matrix for Specs 1-4. Migrate ALL hub-api routes from `requireRole()` to `requirePermission()`. Add dynamic conductor/assistant permission derivation.

2. **Public share links** — Carry over from frozen hub with enhancements: configurable scope (boundary/addresses/full), optional PIN protection, access logging.

3. **Cross-tenant territory sharing** — Extend existing sharing infrastructure with structured territory data, configurable sharing depth per partnership, and privacy controls per territory.

4. **Central discovery** — Extend central-api with geoproximity search, circuit/region tagging, and opt-in discoverability.

---

## Complete Permission Matrix

### Territory Drawing (Spec 1)

| Permission | Purpose |
|---|---|
| `app:territories.view` | View territories on map |
| `app:territories.edit` | Edit boundaries — drag vertices, lasso, create |
| `app:territories.delete` | Delete territories |
| `app:territories.split` | Split territories via scissors |
| `app:territories.import` | KML/CSV territory import |

### Address & OSM (Spec 2)

| Permission | Purpose |
|---|---|
| `app:addresses.view` | View addresses and visit history |
| `app:addresses.edit` | Add/edit/archive addresses, DNC, language |
| `app:addresses.import` | KML/CSV address import |
| `app:osm.refresh` | Trigger OSM data refresh |
| `app:osm.edit` | Add/edit local OSM features (streets, POIs) |
| `app:gapDetection.view` | View gap detection results |
| `app:gapDetection.run` | Run gap detection |

### Territory Operations (Spec 3)

| Permission | Purpose |
|---|---|
| `app:assignments.view` | View assignments, Kanban board |
| `app:assignments.manage` | Assign/return territories, set due dates |
| `app:campaigns.view` | View campaigns and results |
| `app:campaigns.manage` | Create/activate/close campaigns |
| `app:campaigns.conduct` | Conductor: manage meeting point, create field groups, assign within scope |
| `app:campaigns.assist` | Assistant: assign within meeting point scope, manage field groups |
| `app:campaigns.report` | Generate/export campaign reports |
| `app:campaigns.location_share` | Share real-time location during field service |
| `app:location.view` | View group members' shared locations |

### Groups & Sharing (Spec 4)

| Permission | Purpose |
|---|---|
| `app:groups.view` | View field service groups |
| `app:groups.edit` | Manage field service groups |
| `app:sharing.view` | View partnerships (existing) |
| `app:sharing.edit` | Request/approve/reject partnerships (existing) |
| `app:sharing.configure` | Toggle visibility per partner (existing) |
| `app:territories.share` | Create/revoke public share links |

### Existing Non-Territory Permissions (carry over, migrate enforcement)

| Permission | Purpose |
|---|---|
| `app:publishers.view` | View publisher list |
| `app:publishers.view_minimal` | View names only (no contact) |
| `app:publishers.edit` | Edit publisher records |
| `app:meetings.view` | View meeting schedules |
| `app:meetings.edit` | Edit meeting assignments |
| `app:settings.view` | View congregation settings |
| `app:settings.edit` | Edit settings |
| `app:roles.view` | View roles |
| `app:roles.edit` | Manage role assignments |
| `app:reports.view` | View reports |
| `app:speakers.view` | View speakers |
| `app:speakers.edit` | Edit speakers |
| `app:chat.view` | Access chat |
| `app:chat.send` | Send messages |

---

## Role → Permission Mapping

| Role | Territory & Related Permissions | Other Permissions |
|---|---|---|
| **Admin** | `*` (wildcard) | `*` |
| **Elder** | All territory, address, OSM, assignment, campaign, sharing, location permissions | publishers, meetings, settings, roles, reports, speakers, chat |
| **Service Overseer** | territories.view/edit/delete/split/import, addresses.*, osm.*, gapDetection.*, assignments.*, campaigns.manage/view/report, territories.share, location.view | publishers.view, reports.view, sharing.* |
| **Service Overseer Assistant** | territories.view/edit, addresses.view/edit, osm.*, gapDetection.*, assignments.*, campaigns.view/assist/report, location.view | publishers.view, groups.view/edit |
| **Conductor** | *(dynamic, scoped)* campaigns.conduct, campaigns.assist, assignments.manage, location.view | — |
| **Assistant** | *(dynamic, scoped)* campaigns.assist, location.view | — |
| **Publisher** | territories.view, addresses.view, assignments.view, campaigns.view, campaigns.location_share | publishers.view_minimal, meetings.view, chat.* |

Conductor and Assistant are not AppRoles — they are derived dynamically from `CampaignMeetingPoint` records (see Dynamic Role Scoping section).

---

## Enforcement Migration

### New Middleware

```typescript
function requirePermission(...permissions: string[]): FastifyPreHandler
```

- **Replaces the existing `requireRole()` function** in `rbac.ts` (which takes a single role string). This is a new function, not a modification — both coexist during migration, then `requireRole()` is removed.
- Accepts one or more permission strings — ALL must be satisfied (AND logic)
- Resolves effective permissions via `PolicyEngine.resolvePermissions(keycloakRoles, appRoleAssignments)`
- Returns 403 with `{ error: "Forbidden", requiredPermission: "app:territories.edit" }` on denial

```typescript
function requireAnyPermission(...permissions: string[]): FastifyPreHandler
```

- OR-logic variant — at least one permission must be satisfied

Both middleware functions:
1. Extract user context from JWT (Keycloak sub + roles)
2. Resolve static permissions (Keycloak base roles + AppRole assignments)
3. Resolve dynamic permissions (conductor/assistant from CampaignMeetingPoint)
4. Call `PolicyEngine.can(permission, resource, ctx)`

### Complete Route Migration

**Territory Routes (`territories.ts`):**

| Route | Before | After |
|---|---|---|
| `GET /territories` | `requireRole("publisher")` | `requirePermission("app:territories.view")` |
| `GET /territories/:id` | `requireRole("publisher")` | `requirePermission("app:territories.view")` |
| `POST /territories` | `requireRole("elder")` | `requirePermission("app:territories.edit")` |
| `PUT /territories/:id` | `requireRole("elder")` | `requirePermission("app:territories.edit")` |
| `DELETE /territories/:id` | `requireRole("elder")` | `requirePermission("app:territories.delete")` |
| `POST /territories/:id/assign` | `requireRole("elder")` | `requireAnyPermission("app:assignments.manage", "app:campaigns.assist")` |
| `POST /territories/:id/return` | `requireRole("elder")` | `requirePermission("app:assignments.manage")` |
| `GET /territories/:id/history` | `requireRole("publisher")` | `requirePermission("app:assignments.view")` |
| `GET /territories/assignments/active` | `requireRole("publisher")` | `requirePermission("app:assignments.view")` |
| `GET /territories/assignments/overdue` | `requireRole("elder")` | `requirePermission("app:assignments.manage")` |
| `GET /territories/:id/suggested-due` | `requireRole("elder")` | `requirePermission("app:assignments.manage")` |
| `POST /territories/import` | `requireRole("elder")` | `requirePermission("app:territories.import")` |
| `POST /territories/studio/deterministic-plan` | `requireRole("elder")` | `requirePermission("app:territories.split")` |
| `GET /territories/snap-context` | `requireRole("publisher")` | `requirePermission("app:territories.view")` |
| `GET /territories/board` | — (new) | `requirePermission("app:assignments.view")` |
| `GET /territories/board/publishers` | — (new) | `requirePermission("app:assignments.view")` |
| `POST /territories/:id/share` | — (new) | `requirePermission("app:territories.share")` |
| `DELETE /territories/:id/share/:shareId` | — (new) | `requirePermission("app:territories.share")` |
| `GET /territories/:id/shares` | — (new) | `requirePermission("app:territories.share")` |
| `GET /territories/shared/:code` | — (public) | No auth (rate-limited) |

**Address Routes (new, Spec 2):**

| Route | Permission |
|---|---|
| `GET /territories/:id/addresses` | `requirePermission("app:addresses.view")` |
| `POST /territories/:id/addresses` | `requirePermission("app:addresses.edit")` |
| `PUT /addresses/:id` | `requirePermission("app:addresses.edit")` |
| `DELETE /addresses/:id` | `requirePermission("app:addresses.edit")` |
| `POST /addresses/:id/visit` | `requirePermission("app:addresses.view")` |
| `PUT /addresses/:id/dnc` | `requirePermission("app:addresses.edit")` |
| `PUT /addresses/:id/language` | `requirePermission("app:addresses.edit")` |
| `POST /territories/:id/addresses/import` | `requirePermission("app:addresses.import")` |
| `GET /territories/:id/heatmap/:mode` | `requirePermission("app:addresses.view")` |

**OSM Routes (new, Spec 2):**

| Route | Permission |
|---|---|
| `POST /territories/:id/osm/refresh` | `requirePermission("app:osm.refresh")` |
| `GET /territories/:id/osm/status` | `requirePermission("app:territories.view")` |
| `GET /territories/:id/gap-detection` | `requirePermission("app:gapDetection.view")` |
| `POST /territories/:id/gap-detection/run` | `requirePermission("app:gapDetection.run")` |
| `POST /osm/features` | `requirePermission("app:osm.edit")` |
| `PUT /osm/features/:id` | `requirePermission("app:osm.edit")` |
| `DELETE /osm/features/:id` | `requirePermission("app:osm.edit")` |
| `POST /osm/buildings/:id/ignore` | `requirePermission("app:osm.edit")` |

**Campaign Routes (new, Spec 3):**

| Route | Permission |
|---|---|
| `POST /campaigns` | `requirePermission("app:campaigns.manage")` |
| `GET /campaigns` | `requirePermission("app:campaigns.view")` |
| `GET /campaigns/:id` | `requirePermission("app:campaigns.view")` |
| `PUT /campaigns/:id` | `requirePermission("app:campaigns.manage")` |
| `POST /campaigns/:id/activate` | `requirePermission("app:campaigns.manage")` |
| `POST /campaigns/:id/close` | `requirePermission("app:campaigns.manage")` |
| `GET /campaigns/:id/report` | `requirePermission("app:campaigns.report")` |
| `GET /campaigns/:id/report/export` | `requirePermission("app:campaigns.report")` |
| `POST /campaigns/:id/meeting-points` | `requirePermission("app:campaigns.manage")` |
| `POST /campaigns/field-groups` | `requireAnyPermission("app:campaigns.conduct", "app:campaigns.assist")` |
| `POST /campaigns/field-groups/:id/join` | `requirePermission("app:campaigns.location_share")` |
| `POST /campaigns/location/share` | `requirePermission("app:campaigns.location_share")` |
| `GET /campaigns/field-groups/:id/locations` | `requirePermission("app:location.view")` |

**Publishers (`publishers.ts`):**

| Route | Before | After |
|---|---|---|
| `GET /publishers` | `requireRole("publisher")` | `requireAnyPermission("app:publishers.view", "app:publishers.view_minimal")` |
| `GET /publishers/:id` | `requireRole("publisher")` | `requirePermission("app:publishers.view")` |
| `POST /publishers` | `requireRole("elder")` | `requirePermission("app:publishers.edit")` |
| `PUT /publishers/:id` | `requireRole("elder")` | `requirePermission("app:publishers.edit")` |
| `DELETE /publishers/:id` | `requireRole("elder")` | `requirePermission("app:publishers.edit")` |

**Meetings (`meetings.ts`):**

| Route | Before | After |
|---|---|---|
| `GET /meetings` | `requireRole("publisher")` | `requirePermission("app:meetings.view")` |
| `PUT /meetings/:id` | `requireRole("elder")` | `requirePermission("app:meetings.edit")` |

**Settings (`settings.ts`):**

| Route | Before | After |
|---|---|---|
| `GET /settings` | `requireRole("publisher")` | `requirePermission("app:settings.view")` |
| `PUT /settings` | `requireRole("elder")` | `requirePermission("app:settings.edit")` |

**Roles (`permissions.ts`):**

| Route | Before | After |
|---|---|---|
| `GET /roles` | `requireRole("elder")` | `requirePermission("app:roles.view")` |
| `PUT /roles/:id/assign` | `requireRole("elder")` | `requirePermission("app:roles.edit")` |

**Speakers (`speakers.ts`):**

| Route | Before | After |
|---|---|---|
| `GET /speakers` | `requireRole("elder")` | `requirePermission("app:speakers.view")` |
| `POST /speakers` | `requireRole("elder")` | `requirePermission("app:speakers.edit")` |
| `PUT /speakers/:id` | `requireRole("elder")` | `requirePermission("app:speakers.edit")` |

**Sharing (`sharing.ts`):**

| Route | Before | After |
|---|---|---|
| `GET /sharing/partners` | `requireRole("publisher")` | `requirePermission("app:sharing.view")` |
| `POST /sharing/partners` | `requireRole("elder")` | `requirePermission("app:sharing.edit")` |
| `DELETE /sharing/partners/:id` | `requireRole("elder")` | `requirePermission("app:sharing.edit")` |
| `GET /sharing/incoming` | `requireRole("elder")` | `requirePermission("app:sharing.edit")` |
| `POST /sharing/incoming/:id/approve` | `requireRole("elder")` | `requirePermission("app:sharing.edit")` |
| `POST /sharing/incoming/:id/reject` | `requireRole("elder")` | `requirePermission("app:sharing.edit")` |
| `PUT /sharing/partners/:id/visibility` | `requireRole("elder")` | `requirePermission("app:sharing.configure")` |
| `GET /sharing/discover` | — (new) | `requirePermission("app:sharing.view")` |
| `POST /sharing/territories/sync` | — (new) | `requirePermission("app:sharing.edit")` |
| `GET /sharing/territories/:partnerId` | — (new) | `requirePermission("app:sharing.view")` |

**Chat (`chat.ts`):**

| Route | Before | After |
|---|---|---|
| `GET /chat/*` | `requireRole("publisher")` | `requirePermission("app:chat.view")` |
| `POST /chat/*` | `requireRole("publisher")` | `requirePermission("app:chat.send")` |

---

## Dynamic Role Scoping

Conductors and assistants are not separate AppRoles — they are derived from `CampaignMeetingPoint` records at request time.

### Permission Resolution

```typescript
async resolvePermissions(
  userId: string,
  keycloakRoles: string[],
  appRoles: AppRole[]
): Promise<EffectivePermissions> {
  // 1. Static permissions from Keycloak base roles + AppRole assignments
  const staticPerms = resolveStaticPermissions(keycloakRoles, appRoles);

  // 2. Dynamic: check if user is conductor or assistant in active campaigns
  const meetingPoints = await prisma.campaignMeetingPoint.findMany({
    where: {
      campaign: { status: 'active' },
      OR: [
        { conductorId: userId },
        { assistantIds: { array_contains: userId } }
      ]
    },
    include: { campaign: { select: { territoryIds: true } } }
  });

  if (meetingPoints.length > 0) {
    const isConductor = meetingPoints.some(mp => mp.conductorId === userId);
    const dynamicPerms = isConductor
      ? ['app:campaigns.conduct', 'app:campaigns.assist', 'app:assignments.manage', 'app:location.view']
      : ['app:campaigns.assist', 'app:location.view'];

    const scopedTerritoryIds = meetingPoints
      .flatMap(mp => mp.campaign.territoryIds);

    return {
      permissions: [...new Set([...staticPerms, ...dynamicPerms])],
      scopes: { territoryIds: [...new Set(scopedTerritoryIds)] }
    };
  }

  return { permissions: staticPerms, scopes: null };
}
```

### Scope Enforcement

When a user with scoped permissions calls a territory-specific endpoint, the route handler verifies territory membership:

```typescript
// In route handler, after requireAnyPermission passes
if (ctx.scopes?.territoryIds && !ctx.scopes.territoryIds.includes(territoryId)) {
  return reply.code(403).send({
    error: "Forbidden",
    message: "Territory not in your campaign scope"
  });
}
```

**Scope is null for static roles** — Service Overseer has no territory restriction. Scope is only set when permissions derive from dynamic conductor/assistant records.

### Auto-Revocation

Dynamic permissions disappear automatically when:
- Campaign closes → no active campaign meeting points → no dynamic permissions
- Conductor removed from meeting point → immediate effect on next request
- Campaign status ≠ `active` → dynamic lookup returns empty

No cleanup job needed — permissions resolved on every request, not cached.

### Permission Hierarchy

```
Admin (wildcard)
  └── Elder (all app:* permissions)
       └── Service Overseer (full territory management, static AppRole)
            └── Service Overseer Assistant (limited territory, static AppRole)
                 └── Conductor (dynamic, scoped to campaign territories)
                      └── Assistant (dynamic, scoped, fewer permissions)
                           └── Publisher (view-only, location sharing)
```

---

## Public Share Links

### Data Model

```prisma
model TerritoryShare {
  shareId      String    @id @default(uuid())
  territoryId  String
  territory    Territory @relation(fields: [territoryId], references: [id], onDelete: Cascade)
  codeHash     String    @unique @db.VarChar(128)
  scope        String    @default("boundary")  // boundary | addresses | full
  pinHash      String?   @db.VarChar(128)
  pinAttempts  Int       @default(0)
  createdBy    String    @db.VarChar(255)       // Keycloak sub
  expiresAt    DateTime  @db.Timestamptz
  revokedAt    DateTime? @db.Timestamptz
  revokedBy    String?   @db.VarChar(255)       // Keycloak sub
  isActive     Boolean   @default(true)
  createdAt    DateTime  @default(now()) @db.Timestamptz

  accessLogs   ShareAccessLog[]

  @@index([territoryId])
}

model ShareAccessLog {
  id          String   @id @default(uuid())
  shareId     String
  share       TerritoryShare @relation(fields: [shareId], references: [shareId], onDelete: Cascade)
  accessedAt  DateTime @default(now()) @db.Timestamptz
  ipHash      String   @db.VarChar(128)   // SHA256(IP + pepper), not raw IP
  userAgent   String?  @db.VarChar(512)

  @@index([shareId])
}
```

### Share Scopes

| Scope | Data Included |
|---|---|
| `boundary` | Territory number, name, type, boundary GeoJSON |
| `addresses` | Above + active addresses (street, apartment, city, postal, lat/lng, type, bellCount, languageSpoken) |
| `full` | Above + assignment status (assigned/available), last worked date, address visit count |

**Excluded from ALL scopes:** Visit history details, DNC reasons, address notes, publisher names, campaign data.

**Note:** Territory `type` (regular, business, phone, etc.) is defined in Spec 1's Territory model. Share scope responses include `type` as it exists on the Territory model.

### PIN Protection

- Creator sets optional 4-6 digit PIN during share creation
- PIN hashed with SHA256 + pepper (same as share code pepper)
- Redeem endpoint requires `?pin=1234` — hashed and compared
- `pinAttempts` incremented on failure, share auto-revoked at 5 failures. Auto-revocation is permanent — the creator must generate a new share link. There is no counter reset or re-enable path.
- `TenantSettings.requirePINForFullShare` — when true, `full` scope shares must have a PIN

### Code Security

- 16 bytes cryptographically random, base64url encoded (128-bit entropy, 22 characters)
- Hashed: `SHA256(code + SHARE_CODE_PEPPER)` — only hash stored in DB
- Code returned once on creation — never retrievable after
- Pepper from Vault: `SHARE_CODE_PEPPER` env var (per-tenant override in TenantSettings, fallback to global)
- Constant-time comparison for all hash checks

### API Endpoints

**`POST /territories/:id/share`** — Create share link

Permission: `app:territories.share`

Request:
```json
{
  "scope": "addresses",
  "expiresInDays": 30,
  "pin": "1234"
}
```

Validation:
- `scope`: one of `boundary`, `addresses`, `full`
- `expiresInDays`: 1 to `TenantSettings.shareMaxDays` (default max 90)
- `pin`: 4-6 digits, optional (required for `full` scope if `requirePINForFullShare` is true)
- Territory must not be archived
- Territory must not have `shareExcluded = true`

Response (201):
```json
{
  "shareId": "uuid",
  "code": "base64url-22-chars",
  "scope": "addresses",
  "expiresAt": "2026-05-01T00:00:00Z",
  "hasPIN": true,
  "url": "https://<subdomain>.hubport.cloud/shared/t/<code>"
}
```

Error responses:
- 400: Invalid scope, expiresInDays out of range, PIN required but missing
- 404: Territory not found
- 409: Territory is archived or shareExcluded

**`DELETE /territories/:id/share/:shareId`** — Revoke share

Permission: `app:territories.share`

Response (200):
```json
{ "status": "revoked" }
```

Error responses:
- 404: Share not found or already revoked

**`GET /territories/:id/shares`** — List active shares with access stats

Permission: `app:territories.share`

Response (200):
```json
{
  "shares": [
    {
      "shareId": "uuid",
      "scope": "addresses",
      "hasPIN": true,
      "createdBy": "keycloak-sub",
      "expiresAt": "2026-05-01T00:00:00Z",
      "isActive": true,
      "createdAt": "2026-03-31T10:00:00Z",
      "accessCount": 14,
      "lastAccessedAt": "2026-04-02T08:30:00Z",
      "uniqueAccessors": 3
    }
  ]
}
```

**`GET /territories/shared/:code`** — Redeem share link (PUBLIC)

No authentication required.

Rate limit: 30 requests per minute per IP.

Query parameters:
- `pin` (string, optional) — required if share has PIN protection

Response (200, scope=addresses example):
```json
{
  "number": "T-5",
  "name": "North District",
  "type": "regular",
  "boundaryGeoJson": { "type": "Polygon", "coordinates": [[...]] },
  "addresses": [
    {
      "streetAddress": "Hauptstraße 12",
      "apartment": null,
      "city": "München",
      "postalCode": "80331",
      "latitude": 48.137,
      "longitude": 11.575,
      "type": "residential",
      "bellCount": 3,
      "languageSpoken": "de"
    }
  ]
}
```

Error responses:
- 404: Invalid code, expired, revoked, or inactive (constant-time, same response for all — no enumeration)
- 403: PIN required but not provided, or PIN incorrect (generic message, no attempt count leaked)
- 410: Share auto-revoked due to PIN brute-force (5 attempts)
- 429: Rate limit exceeded

### Access Logging

- Every successful redeem creates a `ShareAccessLog` entry
- IP address hashed with SHA256 + pepper (GDPR compliance — no raw IPs stored)
- User-agent stored for abuse pattern detection
- `accessCount`, `lastAccessedAt`, `uniqueAccessors` computed from logs for the shares list endpoint
- Scheduled job purges logs older than 90 days (daily, 03:00 UTC). Runs as a hub-api internal cron job (same pattern as overdue reminder and campaign auto-close jobs). In multi-tenant deployments, the job iterates all tenants sequentially.

---

## Cross-Tenant Territory Sharing

Extends the existing sharing infrastructure. No new connection flow — uses the existing `SharingApproval` system (central-api) with `territories` as an accepted category. The `SharingApproval` model already has `offeredCategories` (JSON array, set by requester) and `acceptedCategories` (JSON array, subset of offered, set on approval) — these fields exist in the current central-api schema and are used by the speaker sharing flow.

### Central Discovery Enhancement

**New fields on Tenant model (central-api):**

```prisma
model Tenant {
  // ... existing fields ...
  discoverable     Boolean  @default(false)
  centroidLat      Float?
  centroidLng      Float?
  circuitNumber    String?  @db.VarChar(20)
  region           String?  @db.VarChar(100)
  country          String?  @db.VarChar(2)      // ISO 3166-1 alpha-2
  city             String?  @db.VarChar(200)
}
```

- `discoverable` — opt-in flag. Only discoverable tenants appear in search results. Non-discoverable tenants can still be found via `GET /sharing/resolve/:subdomain` (direct lookup by subdomain).
- `centroidLat/Lng` — congregation boundary centroid, auto-calculated when boundary is synced to central-api. Null if no boundary synced yet.
- `circuitNumber` — e.g., "BA-23". Optional, set by tenant admin in settings.
- `region` — e.g., "Bayern". Optional, set by tenant admin in settings.
- `country` — ISO 3166-1 alpha-2 code (e.g., "DE"). Optional.

**New central-api endpoints:**

**`GET /sharing/discover`** — Search discoverable tenants

Auth: M2M (hub-api → central-api)

Query parameters:

| Param | Type | Required | Description |
|---|---|---|---|
| `q` | string | No | Search congregation name (ILIKE `%q%`) |
| `lat` | float | No | Center latitude for geoproximity |
| `lng` | float | No | Center longitude for geoproximity |
| `radiusKm` | int | No | Search radius (default 50, max 200) |
| `circuit` | string | No | Filter by circuit number (exact match) |
| `region` | string | No | Filter by region (ILIKE) |
| `country` | string | No | Filter by ISO country code (exact match) |
| `limit` | int | No | Max results (default 20, max 50) |
| `offset` | int | No | Skip first N results for pagination (default 0) |

At least one of `q`, `lat`+`lng`, `circuit`, `region`, or `country` must be provided. Returns 400 if no filter specified.

Response (200):
```json
{
  "results": [
    {
      "tenantId": "uuid",
      "name": "Congregation München-Nord",
      "subdomain": "muc-nord",
      "city": "München",
      "country": "DE",
      "circuitNumber": "BA-23",
      "region": "Bayern",
      "distanceKm": 4.2,
      "partnershipStatus": "none"
    }
  ],
  "total": 8
}
```

- `distanceKm` included only when `lat`+`lng` provided, null otherwise
- `partnershipStatus` resolved by checking SharingApproval for the requesting tenant: `none` | `pending` | `approved` | `rejected`
- Results sorted by distance when `lat`+`lng` provided, otherwise alphabetically by name
- Only tenants with `discoverable = true` are returned
- Geoproximity uses Haversine formula: `ACOS(SIN(lat1)*SIN(lat2) + COS(lat1)*COS(lat2)*COS(lng2-lng1)) * 6371`

**`PUT /tenants/:id/discovery`** — Update discovery profile

Auth: M2M (hub-api → central-api)

Request:
```json
{
  "discoverable": true,
  "centroidLat": 48.137,
  "centroidLng": 11.575,
  "circuitNumber": "BA-23",
  "region": "Bayern",
  "country": "DE",
  "city": "München"
}
```

Response (200):
```json
{ "status": "updated" }
```

### Territory Sharing Depth

**Enhanced SharingVisibility model (hub-api):**

```prisma
model SharingVisibility {
  id          String  @id @default(uuid())
  partnerId   String
  category    String  // "speakers" | "territories"
  minRole     String  // "enabled" | "disabled"
  depth       String  @default("boundary")  // boundary | addresses | full

  @@unique([partnerId, category])
}
```

`depth` controls what the partner sees when fetching shared territories:

| Depth | Synced Data |
|---|---|
| `boundary` | Territory number, name, type, boundary GeoJSON |
| `addresses` | Above + active addresses (street, lat/lng, type, bellCount, language) |
| `full` | Above + assignment status, last worked date |

`depth` is only meaningful when `category = "territories"` and `minRole = "enabled"`. For speakers, depth is ignored.

**Backward compatibility:** Existing `SharingVisibility` rows will get `depth = "boundary"` as the default. This is an intentional security-first default — existing partnerships that previously shared territories as an unstructured blob will now show boundaries only. Admins must explicitly set depth to `addresses` or `full` per partnership after migration. A post-migration notification should inform admins to review their sharing depth settings.

### Structured Territory Sync

The existing `SharedTerritory` model (central-api) stores territory data as JSON. The schema adds a `syncedAt` field (the existing `updatedAt` from `@updatedAt` is auto-managed by Prisma and tracks row-level updates; `syncedAt` captures the explicit sync timestamp from the hub-api push):

```prisma
model SharedTerritory {
  id          String   @id @default(uuid())
  tenantId    String   @unique
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  data        Json     // structured array, validated at application layer
  updatedAt   DateTime @updatedAt          // existing, Prisma-managed
  syncedAt    DateTime @default(now()) @db.Timestamptz  // new, set by sync endpoint
}
```

The `data` field stores the full territory array (all scopes). Depth filtering happens at read time.

**Full data structure per territory:**
```json
{
  "territoryId": "uuid",
  "number": "T-5",
  "name": "North District",
  "type": "regular",
  "boundaryGeoJson": { "type": "Polygon", "coordinates": [[...]] },
  "addresses": [
    {
      "streetAddress": "Hauptstraße 12",
      "city": "München",
      "latitude": 48.137,
      "longitude": 11.575,
      "type": "residential",
      "bellCount": 3,
      "languageSpoken": "de"
    }
  ],
  "assignmentStatus": "assigned",
  "lastWorkedDate": "2026-03-15"
}
```

**Depth filtering at read time (central-api):**
- `boundary`: strip `addresses`, `assignmentStatus`, `lastWorkedDate`
- `addresses`: strip `assignmentStatus`, `lastWorkedDate`
- `full`: return everything

The requesting hub-api passes the partner's `depth` setting as a query parameter when fetching: `GET /sharing/territories?tenantIds=A&depth=addresses`.

### Privacy Controls

**Per-territory exclusion:**

```prisma
model Territory {
  // ... existing fields ...
  shareExcluded  Boolean @default(false)
}
```

When `shareExcluded = true`:
- Territory is omitted from cross-tenant sync data
- Territory cannot have public share links created (`POST /territories/:id/share` returns 409)
- Use case: sensitive territories (foreign-language groups, special campaigns)

### Sync Flow

```
Hub-API (Tenant A)                    Central-API                         Hub-API (Tenant B)
      |                                    |                                    |
      |-- POST /sharing/territories/sync ->|                                    |
      |   (push all non-excluded           |                                    |
      |    territories, full depth)        |                                    |
      |<-- 200 { syncedAt } -------------|                                    |
      |                                    |                                    |
      |                                    |<-- GET /sharing/territories -------|
      |                                    |    ?tenantIds=A&depth=addresses     |
      |                                    |    (checks: approved partnership,   |
      |                                    |     territories in acceptedCategories,
      |                                    |     filters by depth)              |
      |                                    |-- depth-filtered response -------->|
```

**When does sync happen?**
- **Manual:** `POST /sharing/territories/sync` (overseer clicks "Sync territories")
- **Auto:** After territory boundary save, if `TenantSettings.autoSyncTerritories = true` AND tenant has active partnerships with `territories` in acceptedCategories. Runs in background — failure does not affect the save.
- **Staleness:** `syncedAt` timestamp shown to partner so they know data freshness

### Hub-API Sharing Endpoints

**`POST /sharing/territories/sync`** — Push territory data to central-api

Permission: `app:sharing.edit`

Collects all territories where `shareExcluded = false`, builds full-depth data array, pushes to central-api `PUT /sharing/territories/:tenantId`.

Response (200):
```json
{
  "syncedAt": "2026-03-31T14:00:00Z",
  "territoriesSynced": 24,
  "excludedCount": 2
}
```

**`GET /sharing/territories/:partnerId`** — Fetch partner's shared territories

Permission: `app:sharing.view`

Checks local SharingVisibility: if territories disabled for this partner, returns empty array. Otherwise calls central-api `GET /sharing/territories?tenantIds=:partnerId&depth=:localDepthSetting`.

Response (200):
```json
{
  "partnerId": "uuid",
  "partnerName": "Congregation München-Süd",
  "syncedAt": "2026-03-31T14:00:00Z",
  "depth": "addresses",
  "territories": [
    {
      "number": "T-12",
      "name": "Süd-Ost",
      "type": "regular",
      "boundaryGeoJson": { "type": "Polygon", "coordinates": [[...]] },
      "addresses": [
        {
          "streetAddress": "Lindwurmstraße 5",
          "city": "München",
          "latitude": 48.129,
          "longitude": 11.563,
          "type": "residential",
          "bellCount": 2,
          "languageSpoken": "de"
        }
      ]
    }
  ]
}
```

Error responses:
- 404: Partner not found or no approved partnership
- 403: Territories category not in acceptedCategories

---

## TenantSettings Extension

New fields needed across Specs 1-4, consolidated:

```prisma
model TenantSettings {
  // ... existing fields ...

  // Territory assignments (Spec 3)
  defaultDueMonths        Int      @default(4)
  overdueReminderDays     Int      @default(7)
  returnedVisibleDays     Int      @default(30)

  // OSM & addresses (Spec 2)
  osmRefreshCooldownHours Int      @default(24)
  gapDetectionMinArea     Float    @default(50.0)

  // Sharing (Spec 4)
  defaultShareScope       String   @default("boundary")
  defaultShareDays        Int      @default(30)
  shareMaxDays            Int      @default(90)
  autoSyncTerritories     Boolean  @default(true)
  requirePINForFullShare  Boolean  @default(true)
}
```

Discovery fields (`discoverable`, `circuitNumber`, `region`, `country`, `city`) live on the central-api `Tenant` model, not in TenantSettings. They are synced via `PUT /tenants/:id/discovery` when the overseer updates settings.

### Validation Rules

| Field | Min | Max | Note |
|---|---|---|---|
| `defaultDueMonths` | 1 | 12 | — |
| `overdueReminderDays` | 1 | 30 | — |
| `returnedVisibleDays` | 7 | 90 | — |
| `osmRefreshCooldownHours` | 1 | 168 | 168 = 1 week |
| `gapDetectionMinArea` | 10.0 | 500.0 | m² |
| `defaultShareScope` | — | — | One of: `boundary`, `addresses`, `full` |
| `defaultShareDays` | 1 | `shareMaxDays` | Cannot exceed max |
| `shareMaxDays` | 1 | 365 | — |

Settings API uses the existing `PUT /settings` endpoint with `requirePermission("app:settings.edit")`.

---

## Database Migration

### New Tables

| Table | Layer | Purpose |
|---|---|---|
| `TerritoryShare` | hub-api | Public share links with scope + PIN |
| `ShareAccessLog` | hub-api | Share access tracking (hashed IPs) |

### Modified Tables

| Table | Layer | Changes |
|---|---|---|
| `TenantSettings` | hub-api | Add 10 new fields (all with defaults) |
| `Territory` | hub-api | Add `shareExcluded Boolean @default(false)` |
| `SharingVisibility` | hub-api | Add `depth String @default("boundary")` |
| `Tenant` | central-api | Add `discoverable`, `centroidLat`, `centroidLng`, `circuitNumber`, `region`, `country`, `city` |

**All changes are additive.** All new fields have defaults. No breaking changes.

### Rollback

1. Drop `TerritoryShare`, `ShareAccessLog` tables
2. Remove new columns from `TenantSettings`, `Territory`, `SharingVisibility`
3. Remove new columns from central-api `Tenant`
4. Revert `requirePermission()` to `requireRole()` in all route files
5. Restore old permission constants in `permissions.ts`
6. Re-seed AppRoles with original permission sets

### Seed Script Update

`seed-roles.ts` must be updated to include all new permissions. The seed is idempotent (upserts on every `prisma db seed`).

**New permissions per AppRole:**

| AppRole | Permissions Added |
|---|---|
| Service Overseer | `app:territories.delete`, `app:territories.split`, `app:territories.import`, `app:territories.share`, `app:addresses.*` (view, edit, import), `app:osm.*` (refresh, edit), `app:gapDetection.*` (view, run), `app:assignments.*` (view, manage), `app:campaigns.manage`, `app:campaigns.view`, `app:campaigns.report`, `app:location.view` |
| Service Overseer Assistant | `app:addresses.view`, `app:addresses.edit`, `app:osm.refresh`, `app:osm.edit`, `app:gapDetection.view`, `app:gapDetection.run`, `app:assignments.view`, `app:assignments.manage`, `app:campaigns.view`, `app:campaigns.assist`, `app:campaigns.report`, `app:location.view`, `app:groups.view`, `app:groups.edit` |
| Publisher | `app:territories.view`, `app:addresses.view`, `app:assignments.view`, `app:campaigns.view`, `app:campaigns.location_share`, `app:publishers.view_minimal`, `app:meetings.view`, `app:chat.view`, `app:chat.send` |

Elder gets all `app:*` permissions via Keycloak base role mapping. Admin gets `*` wildcard.

---

## Components to Build

| Component | Layer | Purpose |
|---|---|---|
| `requirePermission()` | hub-api middleware | Permission-based route guard (AND logic) |
| `requireAnyPermission()` | hub-api middleware | Permission-based route guard (OR logic) |
| `PolicyEngine.resolvePermissions()` | hub-api lib | Static + dynamic permission resolution |
| `ShareService` | hub-api service | Share link CRUD, code generation, SHA256 hashing |
| `ShareRedeemHandler` | hub-api route | Public endpoint, rate-limited, constant-time responses |
| `ShareAccessLogger` | hub-api service | Log access with IP hashing, compute stats, auto-purge |
| `DiscoveryService` | central-api service | Geoproximity search with Haversine, circuit/region filter |
| `TerritorySyncService` | hub-api service | Build structured territory payload, push to central-api |
| `SharingDepthFilter` | central-api util | Filter territory JSON by depth (boundary/addresses/full) |
| Updated `seed-roles.ts` | hub-api seed | All new permissions per AppRole |
| Updated `permissions.ts` | hub-api lib | All new permission constants |

---

## Cross-Spec Alignment

### Spec 2 (Address & OSM) Updates Needed

- Replace any `requireRole("elder")` references with specific permission strings
- Address endpoints use `app:addresses.view`, `app:addresses.edit`, `app:addresses.import`
- OSM endpoints use `app:osm.refresh`, `app:osm.edit`
- Gap detection uses `app:gapDetection.view`, `app:gapDetection.run`
- Heatmap access gated by `app:addresses.view`

### Spec 3 (Territory Operations) — Already Aligned

- Assignment endpoints already reference correct permission strings
- Campaign endpoints already reference correct permission strings
- Assign endpoint correctly uses `requireAnyPermission("app:assignments.manage", "app:campaigns.assist")`
- Dynamic conductor/assistant scoping documented in both specs

### Spec 1 (Drawing UX) — No Changes Needed

- Already references `app:territories.edit` for vertex handles
- Already references `app:territories.split` for scissors affordance
- `hasPermission()` check pattern carries over as-is

---

## Route Migration Strategy

1. **Phase 1:** Add `requirePermission()` and `requireAnyPermission()` middleware to hub-api
2. **Phase 2:** Update `permissions.ts` with all new permission constants
3. **Phase 3:** Update `seed-roles.ts` with new permissions per AppRole
4. **Phase 4:** Migrate routes file by file — each route file is one PR:
   - `territories.ts` → `publishers.ts` → `meetings.ts` → `settings.ts` → `permissions.ts` (roles) → `speakers.ts` → `sharing.ts` → `chat.ts`
5. **Phase 5:** Remove `requireRole()` function and all imports — single cleanup PR
6. **Phase 6:** Add new territory sharing routes (share links, sync, discovery)

**No downtime.** During migration, both `requireRole()` and `requirePermission()` coexist. Permission resolution falls back to Keycloak base roles if no AppRole assigned, so existing users keep their current access level.

---

## Success Criteria

1. All hub-api routes use `requirePermission()` — zero `requireRole()` calls remain
2. Publisher can view territories but cannot edit — permission boundary enforced
3. Service Overseer can manage territories, addresses, campaigns — but not admin settings
4. Conductor can assign territories only within their campaign scope — scope enforcement works
5. Public share links work with all 3 scopes (boundary/addresses/full)
6. PIN protection blocks access after 5 failed attempts and auto-revokes
7. Central discovery returns geoproximity-sorted results for discoverable tenants
8. Non-discoverable tenants are excluded from search but accessible via subdomain lookup
9. Cross-tenant territory sync respects `shareExcluded` flag and depth settings
10. Auto-sync fires in background after boundary save when partnerships exist
11. Share access logs are viewable by overseer, show stats, and auto-purge after 90 days
12. Existing sharing flow (speakers) continues to work unchanged after migration
