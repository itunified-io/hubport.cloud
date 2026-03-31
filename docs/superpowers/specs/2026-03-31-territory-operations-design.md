# Territory Operations — Design Spec

**Date:** 2026-03-31
**Status:** Draft
**Target repo:** hubport.cloud (territory module)
**Source reference:** Frozen `itunified-io/hub` codebase (complete refactor, not carry-over)
**Related specs:**
- `2026-03-31-territory-drawing-ux-design.md` (Spec 1 — boundary drawing UX)
- `2026-03-31-territory-address-osm-design.md` (Spec 2 — address & OSM management)

## Scope

This is **Spec 3 of 4** for the territory module:

| Spec | Scope | Status |
|------|-------|--------|
| 1. Drawing UX | Vertex manipulation, snap engine, split, lasso, auto-fix | Done |
| 2. Address & OSM | OSM fetching, gap detection, local OSM layer, addresses, visits, heatmap, import | Done |
| **3. Territory Operations** | **Assignment, campaigns, meeting points, field groups, live tracking, Kanban board** | **This document** |
| 4. Sharing & RBAC | Cross-tenant sharing, RBAC role planning | Planned |

**Note:** Visit tracking (logging visits, visit history, heatmap) is fully covered in Spec 2. This spec covers the operational workflows that use visit data (campaign progress, assignment lifecycle).

## ID Convention

All `memberId`, `conductorId`, `assistantId`, and similar person-reference fields in this spec store **Member model UUIDs** (the `id` field of the `Member` Prisma model), not Keycloak `sub` strings. The JWT `sub` claim is resolved to a Member UUID via `Member.keycloakId` lookup at the API layer. This is consistent with Spec 2's `AddressVisit.memberId` clarification (which also stores a Member UUID resolved from JWT).

The `assignedBy`, `returnedBy`, `closedBy`, and `createdBy` fields store **Keycloak `sub` strings** directly (audit trail — who performed the action, not who was assigned).

## Data Models

### TerritoryAssignment (refactored)

Complete redesign from frozen hub. Supports regular assignments, campaign assignments, and suspension during campaigns.

```prisma
model TerritoryAssignment {
  assignmentId  String    @id @default(uuid())
  tenantId      String
  territoryId   String
  memberId      String?   // Member model UUID, XOR with groupId
  groupId       String?   // MinistryGroup model UUID, XOR with memberId
  campaignId    String?   // non-null = campaign assignment
  assignedBy    String    // Keycloak sub (audit: who made the assignment)
  assignedDate  DateTime  @default(now())
  dueDate       DateTime? // auto-calculated, overrideable. Null for campaign assignments (campaign endDate governs).
  returnedDate  DateTime?
  returnedBy    String?   // Keycloak sub
  isActive      Boolean   @default(true)
  isSuspended   Boolean   @default(false) // true when campaign suspends regular assignment
  notes         String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  territory     Territory @relation(fields: [territoryId], references: [id])
  campaign      Campaign? @relation(fields: [campaignId], references: [campaignId])

  @@index([tenantId])
  @@index([tenantId, territoryId])
  @@index([tenantId, isActive])
  @@index([tenantId, campaignId])
  @@index([memberId])
  @@index([groupId])
}
```

**Constraints:**
- `memberId` XOR `groupId`: exactly one must be set. Server validates on create — returns 400 if both or neither provided.
- `campaignId` nullable: null = regular assignment, non-null = campaign assignment.
- Campaign assignments have `dueDate = null` — they end when the campaign closes.
- `isSuspended` only set on regular assignments when a campaign includes their territory.
- `memberId` and `groupId` are **deliberately unlinked** (no Prisma `@relation`). The Member and MinistryGroup models are defined in the core hubport.cloud schema (not territory-specific). Joins are done via application-level queries: `prisma.member.findUnique({ where: { id: assignment.memberId } })`.

### Campaign

```prisma
model Campaign {
  campaignId     String         @id @default(uuid())
  tenantId       String
  name           String         @db.VarChar(255) // e.g., "Memorial Invitation 2026"
  type           CampaignType
  customTypeName String?        @db.VarChar(255) // only for type=custom
  description    String?
  startDate      DateTime
  endDate        DateTime
  status         CampaignStatus @default(draft)
  territoryIds   Json           // string[] — deliberate denormalization (see note below)
  resultReport   Json?          // generated on close (see Campaign Result Report section)
  createdBy      String         // Keycloak sub
  closedAt       DateTime?
  closedBy       String?
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  assignments    TerritoryAssignment[]
  meetingPoints  CampaignMeetingPoint[]

  @@index([tenantId])
  @@index([tenantId, status])
}

enum CampaignType {
  memorial_invitation
  convention_invitation
  special_campaign
  letter_writing
  custom
}

enum CampaignStatus {
  draft
  active
  closed
  archived
}
```

**`territoryIds` as JSON array (deliberate trade-off):** This is a denormalized JSON array instead of a join table. The trade-off: no referential integrity (deleted/archived territory IDs can become stale). This is acceptable because: (a) territories are rarely deleted, (b) the activation step validates all IDs, and (c) the report snapshot preserves the data even if territories are later modified. A cleanup job can be added later if stale IDs become a problem.

**Validation:**
- `customTypeName` required when `type = custom`, ignored otherwise.
- `startDate` must be before `endDate`.
- `endDate` must be in the future on create.
- `territoryIds` validated on activation (not on draft create): all IDs must reference existing, non-archived territories. Returns 400 with list of invalid IDs.

**Overlapping campaigns:** A territory can only be in **one active campaign at a time**. On activation, server checks if any territory in `territoryIds` is already in another active campaign. If so, returns 409: `{ error: "territory_in_active_campaign", conflicts: [{ territoryId, campaignId, campaignName }] }`. Draft campaigns can have overlapping territories (resolved before activation).

### CampaignMeetingPoint

```prisma
model CampaignMeetingPoint {
  meetingPointId String   @id @default(uuid())
  tenantId       String
  campaignId     String
  name           String   @db.VarChar(255) // e.g., "Parking lot Hauptstraße"
  latitude       Float
  longitude      Float
  address        String?  @db.VarChar(500) // human-readable address
  dayOfWeek      String   // monday | tuesday | ... | sunday
  time           String   @db.VarChar(5) // "09:00" (HH:mm)
  conductorId    String   // Member model UUID
  assistantIds   Json     @default("[]") // string[] of Member model UUIDs
  territoryIds   Json     // string[] — subset of parent campaign's territoryIds
  notes          String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  campaign       Campaign @relation(fields: [campaignId], references: [campaignId])
  fieldGroups    CampaignFieldGroup[]

  @@index([tenantId])
  @@index([campaignId])
}
```

**Validation:**
- `conductorId` must reference an existing Member in the tenant.
- `assistantIds` members must exist in the tenant.
- `territoryIds` must be a subset of the parent campaign's `territoryIds`.
- `dayOfWeek` must be one of: `monday`–`sunday`.
- `time` must match `HH:mm` format (24h).

### CampaignFieldGroup

Lightweight, session-based grouping of publishers at a meeting point.

```prisma
model CampaignFieldGroup {
  fieldGroupId   String           @id @default(uuid())
  tenantId       String
  meetingPointId String
  name           String           @db.VarChar(100) // "Group 1" or custom
  memberIds      Json             @default("[]") // string[] of Member UUIDs
  territoryIds   Json             @default("[]") // string[] — assigned by conductor
  sessionDate    DateTime         @db.Date
  sessionTime    String           @db.VarChar(5) // "09:00"
  status         FieldGroupStatus @default(open)
  closedAt       DateTime?
  notes          String?
  createdAt      DateTime         @default(now())

  meetingPoint   CampaignMeetingPoint @relation(fields: [meetingPointId], references: [meetingPointId])
  locationShares LocationShare[]

  @@index([tenantId])
  @@index([meetingPointId, sessionDate])
}

enum FieldGroupStatus {
  open       // publishers can join, conductor assigning territories
  in_field   // group is out working, location sharing available
  closed     // session done, location shares deactivated
}
```

**Note:** No direct `campaignId` relation. To query all field groups for a campaign: join through meeting point (`WHERE meetingPointId IN (SELECT meetingPointId FROM CampaignMeetingPoint WHERE campaignId = $1)`). This is acceptable because field groups are always accessed via their meeting point context, and the campaign close job iterates meeting points anyway.

**Status transitions:**
- `open` → `in_field`: conductor taps "Start". Location sharing consent prompts appear.
- `in_field` → `closed`: conductor taps "Close". All location shares deactivated, coordinates nulled.
- `open` → `closed`: conductor cancels group before it goes out.
- No backward transitions (closed is final).

### LocationShare

Real-time location sharing within a field group. Opt-in, time-limited, privacy-first.

```prisma
model LocationShare {
  shareId        String              @id @default(uuid())
  tenantId       String
  fieldGroupId   String
  memberId       String              // Member model UUID
  isActive       Boolean             @default(true)
  consentedAt    DateTime
  duration       LocationDuration
  expiresAt      DateTime            // calculated: consentedAt + duration
  lastLatitude   Float?              // overwritten on each update, nulled on deactivate
  lastLongitude  Float?
  lastUpdatedAt  DateTime?
  createdAt      DateTime            @default(now())

  fieldGroup     CampaignFieldGroup  @relation(fields: [fieldGroupId], references: [fieldGroupId])

  @@index([fieldGroupId, isActive])
  @@index([memberId])
}

enum LocationDuration {
  one_hour    // 1h
  four_hours  // 4h
  eight_hours // 8h
}
```

**Deactivation triggers** (whichever comes first):
1. Chosen duration expires (`expiresAt < now()`)
2. Conductor closes the field group (status → `closed`)
3. Publisher manually stops sharing

**On deactivation:**
- `isActive = false`
- `lastLatitude = null`, `lastLongitude = null` (no location history retained)

**Privacy guarantees:**
- Only current position stored (overwritten every 30s). No trail/history.
- Coordinates nulled on deactivation — no forensic recovery.
- Visible only to: same field group members + meeting point conductor + assistants.
- `app:campaigns.location_share` permission required (granted to all publishers by default, revocable by Tenant Admin).

### Congregation Settings (new fields)

Added to existing `TenantSettings` model:

```prisma
// Added fields:
defaultCheckoutDays    Int @default(120) // default territory checkout period (days)
overdueReminderDays    Int @default(7)   // days before due date to send reminder
returnedVisibleDays    Int @default(30)  // days to show returned territories in Kanban "Returned" column
```

**Migration for existing tenants:** These are additive columns with `@default()` values. Prisma migration adds the columns with defaults — existing rows automatically get the default values. No data migration script needed. No downtime.

### Notification Types (new)

Added to existing `NotificationType` enum:

```prisma
// New values:
territory_overdue_reminder  // X days before due date (sent ONCE at threshold, not daily)
territory_assignment        // territory assigned to publisher
campaign_activated          // campaign status → active
campaign_closed             // campaign auto-close or manual close
campaign_assignment         // territory assigned during campaign
```

**Overdue reminder deduplication:** The `assignment-overdue-check` job tracks which assignments have already received a reminder by checking for an existing `territory_overdue_reminder` notification with the same `assignmentId` reference. Each assignment gets at most **one** reminder notification.

## Territory Assignment

### Adaptive Due Dates

On assignment creation, the server calculates a suggested due date:

1. **Get base period:** `TenantSettings.defaultCheckoutDays` (e.g., 120 days)
2. **Get territory address count:** count of active addresses in the territory
3. **Get congregation averages:**
   - `avgAddressCount`: average active addresses across all territories. **If zero (no territories with addresses), skip ratio calculation and use `defaultCheckoutDays` directly.**
   - `avgDaysToComplete`: average days-to-complete across all returned assignments in the congregation. **If zero (no completed assignments), use `historyRatio = 1.0`.**
4. **Calculate ratios:**
   ```
   addressRatio = avgAddressCount > 0 ? (territory.addressCount / avgAddressCount) : 1.0
   historyRatio = (territory has ≥3 past completed assignments AND avgDaysToComplete > 0)
     ? (territory.avgDaysToComplete / congregation.avgDaysToComplete)
     : 1.0
   suggestedDays = baseDays * addressRatio * historyRatio
   clamp(suggestedDays, 14, 365)
   ```
5. **Due date = assignedDate + suggestedDays**

The API returns the suggested due date in the response. The UI shows it pre-filled but editable.

### Assignment Status Transitions

**Regular assignments:**
```
Territory: available → assigned (on assign)
Territory: assigned → available (on return)
Assignment: isActive=true → isActive=false, returnedDate=now (on return)
```

**Campaign suspension:**
```
On campaign activate:
  - Regular assignments for included territories: isSuspended=true
  - Territory status: → available (ready for campaign assignment)

On campaign close:
  - Campaign assignments: isActive=false, returnedDate=now
  - Suspended regular assignments: isSuspended=false (resume)
  - Due date extension: suspendedAssignment.dueDate += (campaign.closedAt - campaign.startDate)
    This adds the campaign duration to the due date so publishers aren't immediately overdue.
  - Territory status: reflects resumed assignment (or available if none)
```

### Overdue Tracking

- Server-side scheduled job checks active, non-suspended assignments daily (06:00 UTC)
- If `dueDate - now() <= overdueReminderDays` AND no existing `territory_overdue_reminder` notification for this assignment → send notification to:
  - The assigned member (or group members)
  - The service overseer
- **One reminder per assignment** — not daily. The job checks for existing notification to prevent duplicates.
- If `dueDate < now()`, territory appears in Overdue column of Kanban board (no auto-return — overseer decides)

### API Endpoints

| Endpoint | Method | Permission | Purpose |
|----------|--------|------------|---------|
| `/territories/:id/assign` | POST | `app:assignments.manage` | Assign territory |
| `/territories/:id/return` | POST | `app:assignments.manage` | Return territory |
| `/territories/:id/history` | GET | `app:assignments.view` | Assignment history for territory |
| `/territories/assignments/active` | GET | `app:assignments.view` | All active assignments |
| `/territories/assignments/overdue` | GET | `app:assignments.view` | Overdue assignments |
| `/territories/:id/suggested-due` | GET | `app:assignments.manage` | Calculate suggested due date for territory |

**`POST /territories/:id/assign` request/response:**

Request:
```json
{
  "memberId": "uuid",       // XOR with groupId
  "groupId": "uuid",        // XOR with memberId
  "dueDate": "2026-07-15",  // optional, pre-filled with suggested date in UI
  "notes": "string"         // optional
}
```

Response (201):
```json
{
  "assignment": {
    "assignmentId": "uuid",
    "territoryId": "uuid",
    "memberId": "uuid",
    "groupId": null,
    "assignedBy": "keycloak-sub",
    "assignedDate": "2026-03-31T10:00:00Z",
    "dueDate": "2026-07-15T00:00:00Z",
    "isActive": true,
    "isSuspended": false,
    "campaignId": null,
    "notes": null
  },
  "suggestedDue": {
    "suggestedDays": 106,
    "suggestedDate": "2026-07-15",
    "factors": {
      "baseDays": 120,
      "addressRatio": 0.88,
      "historyRatio": 1.0
    }
  },
  "member": {
    "id": "uuid",
    "displayName": "John Doe"
  }
}
```

**`POST /territories/:id/return` request/response:**

Request:
```json
{
  "notes": "string"  // optional
}
```

Response (200):
```json
{
  "assignment": {
    "assignmentId": "uuid",
    "territoryId": "uuid",
    "returnedDate": "2026-03-31T15:00:00Z",
    "returnedBy": "keycloak-sub",
    "isActive": false
  },
  "territory": {
    "id": "uuid",
    "status": "available",
    "lastWorkedDate": "2026-03-31T15:00:00Z"
  }
}
```

**`GET /territories/:id/suggested-due` response:**
```json
{
  "territoryId": "uuid",
  "suggestedDays": 106,
  "suggestedDate": "2026-07-15",
  "factors": {
    "baseDays": 120,
    "addressRatio": 0.88,
    "historyRatio": 1.0,
    "addressCount": 35,
    "avgAddressCount": 40,
    "pastAssignments": 5
  }
}
```

**Error handling:**
- Assign to already-assigned territory: 409 `{ error: "already_assigned", assignmentId, assignedTo }`.
- Assign to archived territory: 400 `{ error: "territory_archived" }`.
- Assign during active campaign (territory in campaign): 400 `{ error: "territory_in_campaign", campaignId, campaignName }`. Use campaign assignment instead.
- Return with no active assignment: 404 `{ error: "no_active_assignment" }`.
- Invalid memberId/groupId: 400 `{ error: "member_not_found" }` or `{ error: "group_not_found" }`.

## Campaign Management

### Campaign Lifecycle

```
draft → active → closed → archived
```

1. **Draft:** Overseer creates campaign, selects territories, sets dates, configures meeting points and conductors. Not visible to publishers.
2. **Active:** Overseer activates campaign. Regular assignments on included territories are suspended. Campaign assignments can be made. Publishers see campaign in dashboard.
3. **Closed:** Auto-closes on `endDate` (checked by daily scheduled job) or manually closed by overseer. All campaign assignments auto-return. Suspended regular assignments resume with extended due dates. Result report generated and stored.
4. **Archived:** Overseer archives old campaigns. Hidden from default views, accessible in campaign history.

### Campaign Activation Effects

When overseer sets campaign `status = active`:

1. **Overlap check:** Verify no territory in `territoryIds` is in another active campaign. If conflict, return 409 (see Campaign model validation).
2. All active `TerritoryAssignment` records where `territoryId IN campaign.territoryIds` AND `campaignId IS NULL` (regular assignments) get `isSuspended = true`
3. Territory status for included territories set to `available`
4. Notification `campaign_activated` sent to all publishers with suspended assignments:
   - "Your territory T-5 is part of the Memorial Campaign (Mar 15 – Apr 15). Your regular assignment will resume after the campaign."

### Campaign Close Effects

When campaign closes (auto or manual):

1. All active campaign assignments (`campaignId = this campaign, isActive = true`) → `isActive = false`, `returnedDate = now()`
2. All `CampaignFieldGroup` for this campaign's meeting points with `status != closed` → `status = closed`, `closedAt = now()`
3. All active `LocationShare` for affected field groups → deactivated, coordinates nulled
4. Suspended regular assignments (`isSuspended = true`, matching territory IDs) → `isSuspended = false`
5. **Due date extension:** For each resumed assignment, `dueDate += (campaign.closedAt - campaign.startDate)`. This adds the full campaign duration to the due date so publishers aren't immediately overdue because their territory was locked in a campaign. If `dueDate` was null, it stays null.
6. Territory status updated: if resumed assignment exists → `assigned`, otherwise → `available`
7. Campaign `status = closed`, `closedAt = now()`, `closedBy = 'system'` (auto) or Keycloak sub (manual)
8. Result report generated and stored in `campaign.resultReport` (see Result Report section)
9. Notification `campaign_closed` sent to all campaign participants

### Campaign Auto-Close

A daily scheduled job (06:00 UTC) checks for active campaigns where `endDate < now()`. For each:
1. Run campaign close effects (above)
2. Log: "Campaign {name} auto-closed on end date"

### API Endpoints

| Endpoint | Method | Permission | Purpose |
|----------|--------|------------|---------|
| `/campaigns` | GET | `app:campaigns.view` | List campaigns. Query: `status` (comma-separated: `draft,active,closed,archived`, default: `active,draft`). |
| `/campaigns` | POST | `app:campaigns.manage` | Create campaign (draft) |
| `/campaigns/:id` | GET | `app:campaigns.view` | Get campaign details including meeting points |
| `/campaigns/:id` | PUT | `app:campaigns.manage` | Update campaign (draft only) |
| `/campaigns/:id/activate` | POST | `app:campaigns.manage` | Activate campaign |
| `/campaigns/:id/close` | POST | `app:campaigns.manage` | Manually close campaign |
| `/campaigns/:id/archive` | POST | `app:campaigns.manage` | Archive closed campaign |
| `/campaigns/:id/assign` | POST | `app:campaigns.manage` OR `app:campaigns.conduct` OR `app:campaigns.assist` (all scoped to meeting point territories) | Assign territory within campaign. Body: `{ territoryId, memberId?, groupId? }`. No dueDate — campaign endDate governs. |
| `/campaigns/:id/report` | GET | `app:campaigns.report` | Get campaign result report (closed/archived only) |
| `/campaigns/:id/report/export` | GET | `app:campaigns.report` | Export as CSV ZIP. `Content-Type: application/zip`, `Content-Disposition: attachment; filename="campaign-{name}-report.zip"`. Contains `territories.csv` + `publishers.csv`. |

**Error handling:**
- Activate campaign with past endDate: 400 `{ error: "end_date_past" }`.
- Activate campaign with no territories: 400 `{ error: "no_territories_selected" }`.
- Activate campaign with no meeting points: 400 `{ error: "no_meeting_points" }`.
- Activate with territory in another active campaign: 409 `{ error: "territory_in_active_campaign", conflicts: [...] }`.
- Update active campaign: 400 `{ error: "campaign_not_draft", status }`. Only draft campaigns are editable.
- Close already-closed campaign: 400 `{ error: "campaign_already_closed" }`.
- Assign territory not in campaign: 400 `{ error: "territory_not_in_campaign" }`.

## Field Service Meeting Points

### Conductor Workflow

1. Overseer creates meeting points during campaign draft phase
2. Assigns a conductor (Member UUID) to each meeting point
3. Conductor can appoint assistants
4. On campaign activation, meeting points become visible to publishers

### Conductor Permissions (Scoped)

Conductors gain `app:campaigns.conduct` scoped to their meeting point's territories:
- Assign/unassign territories within meeting point to publishers (via `POST /campaigns/:id/assign`)
- Create/manage field groups for their meeting point
- Update meeting point details (time, location, notes)
- Appoint assistants
- Mark territories as complete
- View location shares for their meeting point's groups

Assistants gain `app:campaigns.assist` scoped to their meeting point:
- Assign territories within meeting point to publishers (via `POST /campaigns/:id/assign`)
- Create/manage field groups
- Cannot change meeting point details or appoint other assistants

**Scope enforcement:** PolicyEngine checks meeting point membership:
```typescript
function hasCampaignPermission(userId: string, permission: string, territoryId: string): boolean {
  // Static roles bypass scoping
  if (hasStaticRole(userId, ['tenant_admin', 'service_overseer'])) return true;

  // Resolve Member UUID from Keycloak sub
  const member = await findMemberByKeycloakId(userId);
  if (!member) return false;

  const meetingPoints = await findActiveCampaignMeetingPoints({ tenantId });
  for (const mp of meetingPoints) {
    if (!mp.territoryIds.includes(territoryId)) continue;
    if (permission === 'campaigns.conduct' && mp.conductorId === member.id) return true;
    if (permission === 'campaigns.assist' && mp.assistantIds.includes(member.id)) return true;
  }
  return false;
}
```

Permissions are **automatically revoked** when:
- Campaign closes (no active meeting points)
- User removed from `conductorId` or `assistantIds`
- Meeting point deleted

### API Endpoints

| Endpoint | Method | Permission | Purpose |
|----------|--------|------------|---------|
| `/campaigns/:id/meeting-points` | GET | `app:campaigns.view` | List meeting points for campaign |
| `/campaigns/:id/meeting-points` | POST | `app:campaigns.manage` | Create meeting point (draft campaign only) |
| `/campaigns/:id/meeting-points/:mpId` | PUT | `app:campaigns.manage` OR `app:campaigns.conduct` (scoped) | Update meeting point |
| `/campaigns/:id/meeting-points/:mpId` | DELETE | `app:campaigns.manage` | Delete meeting point (draft only) |
| `/campaigns/:id/meeting-points/:mpId/assistants` | PUT | `app:campaigns.conduct` (scoped) | Set assistant list. Body: `{ assistantIds: string[] }` |

## Field Groups & Live Tracking

### Field Group Lifecycle

```
open → in_field → closed
open → closed (cancelled)
```

1. **Open:** Conductor creates group for a session date. Publishers see "Join" button.
2. **In Field:** Conductor taps "Start". Location sharing consent prompts appear. Group is working.
3. **Closed:** Conductor taps "Close". All location shares deactivated. Group becomes read-only.

### Auto-Join

Publishers attending a meeting point session can self-join an open group:
- Publisher sees list of open groups for today's session at their meeting point
- Taps "Join Group 2" → `memberIds` array updated to include their Member UUID
- Publisher can leave an open group (removes from `memberIds`)
- Cannot join/leave once group is `in_field` or `closed`

### Location Sharing

**Consent flow:**
1. When group transitions to `in_field`, each member gets a prompt:
   - "Share your location with Group 2? Your group members and conductor will see your position on the map."
   - Duration picker: **1 hour** | **4 hours** | **8 hours**
   - "Share" / "Not now" buttons
2. If "Share": creates `LocationShare` record with `expiresAt = now + duration`
3. If "Not now": no record created. Publisher can opt-in later from group view.

**Client location updates:**
- Client sends `PUT /location-shares/:id/position` every 30 seconds with `{ latitude, longitude }`
- Server overwrites `lastLatitude`, `lastLongitude`, `lastUpdatedAt`
- If `expiresAt < now()` or `isActive = false`, server returns 410 Gone and client stops sending

**Deactivation triggers** (whichever comes first):
1. Duration expires (`expiresAt < now()`)
2. Conductor closes the field group → all shares for that group deactivated
3. Publisher manually stops sharing → single share deactivated

**On deactivation:**
- `isActive = false`
- `lastLatitude = null`, `lastLongitude = null` (coordinates erased)
- No location history retained anywhere

**Map view:**
- Group members see small avatar pins on territory map for each sharing member
- Client polls `GET /field-groups/:fgId/locations` every 30 seconds (returns all active shares with positions)
- Conductor sees all groups' locations at their meeting point
- Pins disappear immediately when sharing stops

**Scalability note:** Polling is sufficient for expected group sizes (2-10 people per group, max ~50 people per meeting point). At these sizes, polling every 30s produces negligible load. WebSocket/SSE can be added in a future iteration if group sizes grow significantly.

### API Endpoints

| Endpoint | Method | Permission | Purpose |
|----------|--------|------------|---------|
| `/campaigns/:cId/meeting-points/:mpId/field-groups` | GET | `app:campaigns.view` | List field groups. Query: `sessionDate` |
| `/campaigns/:cId/meeting-points/:mpId/field-groups` | POST | `app:campaigns.conduct` OR `app:campaigns.assist` (scoped) | Create field group |
| `/field-groups/:fgId` | GET | `app:campaigns.view` | Get field group details + member list |
| `/field-groups/:fgId/join` | POST | `app:campaigns.view` | Publisher self-joins open group |
| `/field-groups/:fgId/leave` | POST | `app:campaigns.view` | Publisher leaves open group |
| `/field-groups/:fgId/start` | POST | `app:campaigns.conduct` OR `app:campaigns.assist` (scoped) | Transition to `in_field` |
| `/field-groups/:fgId/close` | POST | `app:campaigns.conduct` OR `app:campaigns.assist` (scoped) | Close group. Deactivates all location shares |
| `/field-groups/:fgId/territories` | PUT | `app:campaigns.conduct` OR `app:campaigns.assist` (scoped) | Update assigned territories. Body: `{ territoryIds }` |
| `/field-groups/:fgId/locations` | GET | `app:campaigns.view` (group members + conductor + assistants only) | Get active location shares with positions |
| `/location-shares` | POST | `app:campaigns.location_share` | Start sharing. Body: `{ fieldGroupId, duration }`. Returns shareId |
| `/location-shares/:id/position` | PUT | `app:campaigns.location_share` | Update position. Body: `{ latitude, longitude }`. Returns 410 if expired |
| `/location-shares/:id/stop` | POST | `app:campaigns.location_share` | Stop sharing. Deactivates, nulls coordinates |

**Error handling:**
- Join closed/in_field group: 400 `{ error: "group_not_open" }`
- Start already in_field group: 400 `{ error: "group_already_started" }`
- Close already closed group: 400 `{ error: "group_already_closed" }`
- Share location in non-in_field group: 400 `{ error: "group_not_in_field" }`
- Update position on expired share: 410 `{ error: "share_expired" }`

## Campaign Result Report

Generated on campaign close. Stored as JSON in `Campaign.resultReport`.

### Report Structure

```json
{
  "generatedAt": "2026-04-15T06:00:00Z",
  "summary": {
    "campaignName": "Memorial Invitation 2026",
    "type": "memorial_invitation",
    "startDate": "2026-03-15",
    "endDate": "2026-04-15",
    "durationDays": 31,
    "totalTerritories": 42,
    "completedTerritories": 35,
    "partialTerritories": 5,
    "untouchedTerritories": 2,
    "totalAddresses": 3890,
    "addressesReached": 3245,
    "coveragePercent": 83.4,
    "participatingPublishers": 28,
    "meetingPointCount": 3,
    "totalFieldSessions": 45
  },
  "territories": [
    {
      "territoryId": "uuid",
      "number": "T-1",
      "name": "North",
      "status": "complete",
      "addressCount": 85,
      "visitedCount": 85,
      "coveragePercent": 100,
      "assignedTo": "John Doe",
      "meetingPoint": "Parking Hauptstraße",
      "conductor": "Jane Smith",
      "daysToComplete": 12
    }
  ],
  "publishers": [
    {
      "memberId": "uuid",
      "name": "John Doe",
      "territoriesWorked": 3,
      "addressesVisited": 156,
      "avgAddressesPerDay": 8.2
    }
  ],
  "meetingPoints": [
    {
      "meetingPointId": "uuid",
      "name": "Parking Hauptstraße",
      "conductor": "Jane Smith",
      "territoriesAssigned": 14,
      "totalCoverage": 87.2,
      "publisherCount": 10,
      "fieldSessionCount": 15
    }
  ],
  "comparison": {
    "previousCampaigns": [
      {
        "campaignId": "uuid",
        "name": "Memorial Invitation 2025",
        "year": 2025,
        "durationDays": 30,
        "totalTerritories": 40,
        "totalAddresses": 3650,
        "coveragePercent": 78.1
      }
    ],
    "trends": {
      "coverageDelta": 5.3,
      "addressesDelta": 240,
      "territoriesDelta": 2,
      "direction": "improving"
    }
  }
}
```

**Territory completion logic:**
- `complete`: all active (non-archived, non-DNC) addresses have at least one `AddressVisit` with `visitDate` within the campaign date range (`startDate` to `closedAt`)
- `partial`: at least one address visited during campaign period but not all
- `untouched`: zero addresses visited during campaign period

**Comparison:**
- Queries previous closed/archived campaigns with matching `type`
- If no previous campaign of same type, `comparison` field is null
- `trends.direction`: `"improving"` if coverageDelta > 0, `"declining"` if < 0, `"stable"` if within ±1%

### Export

- **CSV export** via `GET /campaigns/:id/report/export?format=csv`
- Response: `Content-Type: application/zip`, `Content-Disposition: attachment; filename="campaign-{name}-report.zip"`
- ZIP contains two CSV files:
  - `territories.csv` — per-territory breakdown (all columns from territories array)
  - `publishers.csv` — per-publisher stats (all columns from publishers array)

**Note:** PDF export is deferred to a future iteration. The initial release supports CSV only.

## Kanban Assignment Board

### Columns

| Column | Filter | Card Color | Sort |
|--------|--------|------------|------|
| Available | `status = available`, no active non-suspended assignment | Gray | Territory number ASC |
| Assigned | Active assignment, `dueDate > now + overdueReminderDays` | Blue | Due date ASC |
| Due Soon | Active assignment, `now < dueDate <= now + overdueReminderDays` | Amber | Due date ASC |
| Overdue | Active assignment, `dueDate < now` | Red | Days overdue DESC |
| Returned | `returnedDate` within last `TenantSettings.returnedVisibleDays` days, `isActive = false` | Green | Return date DESC |

### Territory Cards

Each card shows:
- Territory number + name
- Assigned publisher (avatar + name) or "Unassigned"
- Due date (relative: "3 days left", "5 days overdue")
- Address count + last worked date
- Progress bar during campaigns (addresses visited / total)
- Campaign badge if part of active campaign

### Interactions

- **Drag Available → Assigned:** Opens assign dialog (pick publisher/group, review suggested due date, confirm)
- **Drag Assigned/Due Soon/Overdue → Available:** Triggers return (confirmation dialog with optional notes)
- **Click card:** Opens detail flyout (assignment history, address summary, quick actions)
- **Filter bar:** Filter by territory type, publisher, group, campaign
- **Campaign toggle:** Switch between regular assignment view and active campaign view

### Publisher Sidebar (collapsible right panel)

- List of active publishers with current territory count
- Drag publisher onto Available territory card to assign
- Publisher card shows:
  - Name + avatar
  - Current territories (count + list)
  - Capacity indicator: `currentTerritories / avgTerritoriesPerCheckoutPeriod` where the average is calculated from the publisher's last 6 completed assignments (or congregation average if < 3 completed). Green: < 80% of avg, Amber: 80-120%, Red: > 120%.

### API Endpoints

| Endpoint | Method | Permission | Purpose |
|----------|--------|------------|---------|
| `/territories/board` | GET | `app:assignments.view` | Kanban board data |
| `/territories/board/publishers` | GET | `app:assignments.view` | Publisher sidebar data |

**`GET /territories/board` response:**
```json
{
  "columns": {
    "available": [
      {
        "territoryId": "uuid",
        "number": "T-1",
        "name": "North",
        "addressCount": 35,
        "lastWorkedDate": "2026-01-15T10:00:00Z",
        "campaignId": null,
        "campaignName": null
      }
    ],
    "assigned": [
      {
        "territoryId": "uuid",
        "number": "T-3",
        "name": "East",
        "addressCount": 42,
        "assignment": {
          "assignmentId": "uuid",
          "memberName": "John Doe",
          "memberAvatar": "url",
          "assignedDate": "2026-03-01T10:00:00Z",
          "dueDate": "2026-07-01T00:00:00Z",
          "daysRemaining": 92
        }
      }
    ],
    "dueSoon": [...],
    "overdue": [...],
    "returned": [...]
  },
  "settings": {
    "overdueReminderDays": 7,
    "returnedVisibleDays": 30
  }
}
```

**`GET /territories/board/publishers` response:**
```json
{
  "publishers": [
    {
      "memberId": "uuid",
      "displayName": "John Doe",
      "avatar": "url",
      "currentTerritories": 2,
      "currentTerritoryNumbers": ["T-3", "T-7"],
      "capacity": {
        "avgTerritoriesPerPeriod": 2.5,
        "ratio": 0.8,
        "level": "green"
      }
    }
  ]
}
```

## Cross-Spec Alignment

### Spec 2 Updates Needed

The following items in Spec 2 should be aligned with this spec when both are implemented:

1. **Publisher Permission Scoping (Spec 2):** The scoping check should use `TerritoryAssignment.memberId` (Member UUID) and `isActive = true AND isSuspended = false` (not `returnedAt IS NULL`). This aligns with Spec 3's refactored model.

2. **Spec 2 scope table:** The "Territory Operations" row should read "Assignment, campaigns, meeting points, field groups, live tracking, Kanban board" (not "visit tracking workflows" — visit tracking is in Spec 2).

3. **`Territory.lastWorkedDate`:** This field (updated by Spec 2's visit logging) is read by Spec 3 for Kanban cards and campaign reports. No change needed — just documenting the dependency.

## RBAC Roles & Permissions

### New Permissions

| Permission | Purpose |
|------------|---------|
| `app:assignments.view` | View assignment board, assignment history, overdue list |
| `app:assignments.manage` | Assign/return territories, manage due dates |
| `app:campaigns.view` | View campaigns, meeting points, field groups |
| `app:campaigns.manage` | Create/edit/activate/close/archive campaigns |
| `app:campaigns.conduct` | Conductor: manage meeting point, create field groups, assign within scope |
| `app:campaigns.assist` | Assistant: assign within meeting point scope, manage field groups |
| `app:campaigns.report` | View/export campaign result reports |
| `app:campaigns.location_share` | Share real-time location during field service |

### Role → Permission Matrix

| Role | assignments .view | assignments .manage | campaigns .view | campaigns .manage | campaigns .conduct | campaigns .assist | campaigns .report | campaigns .location_share |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Tenant Admin | x | x | x | x | x | x | x | x |
| Service Overseer | x | x | x | x | x | x | x | x |
| SO Assistant | x | x | x | — | — | — | x | x |
| Group Overseer | x | — | x | — | x | x | x | x |
| Conductor (dynamic) | x | — | x | — | x | x | x | x |
| Assistant (dynamic) | x | — | x | — | — | x | — | x |
| Publisher | x | — | x | — | — | — | — | x |

### Dynamic Roles

Conductor and Assistant are **not permanent AppRoles**. They are derived from `CampaignMeetingPoint` records:

- **Conductor:** User's Member UUID is listed as `conductorId` on an active campaign's meeting point → gains `app:campaigns.conduct` scoped to that meeting point's `territoryIds`.
- **Assistant:** User's Member UUID is listed in `assistantIds` on an active campaign's meeting point → gains `app:campaigns.assist` scoped to that meeting point's `territoryIds`.

Permissions are **automatically revoked** when campaign closes, user is removed, or meeting point is deleted.

### Notifications

| Type | Trigger | Recipients |
|------|---------|------------|
| `territory_overdue_reminder` | Configurable days before due date (sent once per assignment) | Assigned publisher + service overseer |
| `territory_assignment` | Territory assigned to publisher | Assigned publisher |
| `campaign_activated` | Campaign status → active | All publishers with suspended assignments |
| `campaign_closed` | Campaign auto-close or manual close | All campaign participants |
| `campaign_assignment` | Territory assigned during campaign | Assigned publisher + meeting point conductor |

Notifications use the existing `TenantNotification` model. New notification types added to `NotificationType` enum.

## Infrastructure Dependencies

### Scheduled Jobs

Two new daily scheduled jobs (added to existing cron infrastructure):

| Job | Schedule | Purpose |
|-----|----------|---------|
| `campaign-auto-close` | Daily 06:00 UTC | Check active campaigns with `endDate < now()`, run close effects |
| `assignment-overdue-check` | Daily 06:00 UTC | Check active non-suspended assignments approaching due date, send one-time notifications |

Both jobs are lightweight queries — no external API calls, no heavy processing.

### Prisma Migration

This spec adds 5 new models and 3 new fields to `TenantSettings`. All are additive (new tables + new columns with defaults). Migration strategy:

1. New Prisma migration file: `YYYYMMDD_add_territory_operations`
2. Creates tables: `Campaign`, `CampaignMeetingPoint`, `CampaignFieldGroup`, `LocationShare`
3. Alters `TerritoryAssignment`: adds `campaignId`, `isSuspended`, `returnedBy` columns
4. Alters `TenantSettings`: adds `defaultCheckoutDays`, `overdueReminderDays`, `returnedVisibleDays`
5. Adds new enum values to `NotificationType`
6. **No downtime required** — all changes are additive
7. **Rollback:** Drop new tables + remove new columns. Feature can be gated behind a feature flag (`TenantSettings.campaignsEnabled`, default true) if gradual rollout is needed.

### Existing Dependencies

- **BullMQ + Redis** (from Spec 2): Not used by Spec 3 — campaigns and assignments are synchronous.
- **PostgreSQL + PostGIS** (from Specs 1+2): Standard queries, no new spatial operations.
- **Notification system:** Uses existing `TenantNotification` model and delivery pipeline.

## Components to Build

### API (hub-api)

| Component | Purpose |
|-----------|---------|
| `routes/assignments.ts` | Territory assignment CRUD, adaptive due dates, Kanban board data |
| `routes/campaigns.ts` | Campaign lifecycle, activation, close, result reports, export |
| `routes/meeting-points.ts` | Meeting point CRUD, conductor/assistant management |
| `routes/field-groups.ts` | Field group lifecycle, join/leave, location sharing |
| `jobs/campaign-auto-close.ts` | Daily job: auto-close expired campaigns |
| `jobs/assignment-overdue-check.ts` | Daily job: one-time overdue reminders |
| `lib/adaptive-due-date.ts` | Due date calculation (address ratio, history ratio, division-by-zero guards) |
| `lib/campaign-report.ts` | Result report generation (summary, breakdown, comparison) |
| `lib/campaign-permissions.ts` | Dynamic conductor/assistant scope checks |

### UI (hub-app)

| Component | Purpose |
|-----------|---------|
| `KanbanBoard` | Drag-and-drop territory assignment board with 5 columns |
| `KanbanCard` | Territory card with status, assignment info, progress |
| `PublisherSidebar` | Collapsible panel with publisher list + capacity indicators |
| `AssignDialog` | Assign territory: member/group picker, due date (with suggestion), notes |
| `CampaignList` | Campaign list with status filter tabs |
| `CampaignDetail` | Campaign detail: meeting points, territories, progress overview |
| `CampaignCreate` | Creation wizard: name/type → select territories → set dates |
| `MeetingPointEditor` | Meeting point form: location picker (map), time, conductor, assistants |
| `FieldGroupManager` | Conductor view: create groups, assign territories, start/close |
| `FieldGroupJoin` | Publisher view: see available groups, join/leave |
| `LocationShareConsent` | Opt-in dialog: duration picker (1h/4h/8h), privacy explanation |
| `LiveLocationMap` | Map overlay: avatar pins for sharing group members |
| `CampaignReport` | Report viewer: summary cards, territory table, publisher table, comparison chart |

## Success Criteria

1. Territories can be assigned to members OR groups with adaptive due date suggestions
2. Due date formula handles edge cases (new congregations, no history) with safe fallbacks
3. Overdue reminders sent once per assignment at configurable days before due
4. Campaigns can be created, activated (suspends regular assignments), and closed (resumes with extended due dates)
5. Overlapping campaigns blocked at activation (same territory cannot be in two active campaigns)
6. Predefined campaign types (memorial, convention, special, letter writing) + custom campaigns work
7. Meeting points have conductors and assistants with scoped permissions
8. Conductors can create field groups, publishers can self-join open groups
9. Location sharing is opt-in with 1h/4h/8h duration choice, deactivates on group close
10. No location history retained — only current position, nulled on deactivation
11. Campaign result report includes summary, per-territory, per-publisher, per-meeting-point, and campaign comparison
12. Kanban board shows 5 columns with drag-and-drop, configurable "Returned" visibility
13. Publisher sidebar shows capacity indicators based on historical data with safe fallbacks
14. All dynamic roles (conductor, assistant) are scoped and auto-revoked on campaign close
15. Campaign auto-close runs daily, extends suspended assignment due dates on resume
16. Migration is additive (no downtime), rollback possible by dropping new tables
