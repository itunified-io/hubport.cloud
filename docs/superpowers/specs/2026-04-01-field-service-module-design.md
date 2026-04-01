# Field Service Module (Predigtdienst) — Design Spec

**Date:** 2026-04-01
**Status:** Draft
**Target repo:** hubport.cloud (field service module)
**Source reference:** Brainstorming session 2026-04-01, existing campaign/meeting-point/field-group system

## Problem

The current sidebar nests Campaigns (Aktionen) under Gebiete (Territories), mixing territory management with field service operations. There is no way to manage permanent recurring meeting points (e.g., "Saturday 10:00 at Kingdom Hall"), no service group meeting planning, and no publisher self-signup for field service sessions. Campaign meeting points are ephemeral — they exist only within a campaign lifecycle and disappear when the campaign closes.

Key pain points:
- **No permanent meeting points** — conductors recreate the same meeting points for every campaign
- **No recurring schedule** — weekly field service meetings have no digital representation
- **No publisher self-service** — publishers cannot see upcoming meetings or sign up
- **No service group planning** — conductors cannot organize publishers into field groups before arriving at the meeting point
- **Campaigns buried in Territories** — logically separate concerns mixed in one menu
- **No privacy-respecting location sharing** — no opt-in mechanism for live tracking

## Design Principle

> **Field service is a first-class module.** Meeting points are permanent entities. Publishers self-organize. Conductors orchestrate. Campaigns overlay the regular schedule temporarily. Privacy is opt-in.

## Target Users

1. **Elders / Service Overseers** — manage meeting points, appoint conductors
2. **Ministerial Servants / Conductors** — plan service meetings, organize groups, assign territories
3. **Publishers** — view schedule, sign up for meetings, optionally share location

---

## Sidebar Restructuring

### Current Structure
```
Gebiete
  ├── Board
  ├── Aktionen        ← campaigns buried here
  ├── Lückenerkennung
  └── Import
```

### New Structure
```
Gebiete
  ├── Board
  ├── Lückenerkennung
  └── Import

Predigtdienst              ← NEW top-level menu
  ├── Aktionen             ← moved from Gebiete
  ├── Treffpunkte          ← NEW: permanent meeting points
  └── Predigtdienstgruppen ← NEW: service group planning
```

**Rationale:** Gebiete focuses on territory data management. Predigtdienst focuses on field service operations. Campaigns are a field service activity, not a territory management task.

---

## Data Model

### Entity: FieldServiceMeetingPoint (NEW)

A permanent, recurring meeting location for field service.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| tenantId | String | Tenant isolation |
| name | String | Display name (e.g., "Königreichssaal Samstag") |
| address | String? | Street address |
| latitude | Float? | Map coordinates |
| longitude | Float? | Map coordinates |
| dayOfWeek | Int | 0=Sun, 1=Mon, ..., 6=Sat |
| time | String | "10:00" format |
| conductorId | String? | Default conductor (Publisher ID) |
| assistantIds | String[] | Default assistants |
| territoryIds | String[] | Default territories to work |
| maxParticipants | Int? | Optional capacity limit |
| isActive | Boolean | Soft deactivation |
| notes | String? | Internal notes |

**Key distinction from CampaignMeetingPoint:** This entity is permanent and recurring. CampaignMeetingPoint is ephemeral, tied to a campaign lifecycle. Campaigns can optionally reference a FieldServiceMeetingPoint to inherit its defaults.

### Entity: ServiceGroupMeeting (NEW)

A concrete, scheduled instance of field service at a meeting point.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| tenantId | String | Tenant isolation |
| meetingPointId | String | FK → FieldServiceMeetingPoint |
| serviceGroupId | String? | Optional FK → ServiceGroup |
| date | DateTime | Concrete date of meeting |
| time | String | Override time (or inherit from point) |
| conductorId | String | Conductor for this specific meeting |
| status | Enum | planned → active → completed / cancelled |
| notes | String? | Meeting-specific notes |
| startedAt | DateTime? | When conductor started the meeting |
| completedAt | DateTime? | When meeting was completed |

**Status transitions:**
- `planned` → `active` (conductor starts meeting)
- `active` → `completed` (conductor completes)
- `planned` → `cancelled` (conductor or elder cancels)

### Entity: ServiceMeetingSignup (NEW)

Publisher self-enrollment for a specific meeting.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| tenantId | String | Tenant isolation |
| meetingId | String | FK → ServiceGroupMeeting |
| publisherId | String | FK → Publisher |
| signedUpAt | DateTime | When publisher signed up |
| cancelledAt | DateTime? | Null = still signed up |

**Unique constraint:** (meetingId, publisherId) — one signup per publisher per meeting.

### Entity: ServiceMeetingFieldGroup (NEW)

A sub-group within a service meeting. Conductor organizes publishers into groups, assigns territories.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| tenantId | String | Tenant isolation |
| meetingId | String | FK → ServiceGroupMeeting |
| name | String? | "Gruppe 1", "Gruppe 2" |
| leaderId | String | Group leader (Publisher ID) |
| memberIds | String[] | Publishers in this group |
| territoryIds | String[] | Territories assigned to this group |
| status | Enum | planned → in_field → completed |
| startedAt | DateTime? | When group went to field |
| completedAt | DateTime? | When group returned |

### Entity: ServiceLocationShare (NEW)

Real-time location sharing during field service. **Opt-in only.**

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| tenantId | String | Tenant isolation |
| fieldGroupId | String | FK → ServiceMeetingFieldGroup |
| publisherId | String | Publisher sharing location |
| latitude | Float | Current lat |
| longitude | Float | Current lng |
| accuracy | Float? | GPS accuracy in meters |
| isActive | Boolean | Currently sharing |
| startedAt | DateTime | When sharing started |
| lastUpdatedAt | DateTime | Last coordinate update |
| stoppedAt | DateTime? | When sharing stopped |

### Privacy: Location Sharing Opt-In

Add to Publisher model or a dedicated PrivacySettings model:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| allowLocationSharing | Boolean | false | Must be explicitly enabled by publisher |

**Rules:**
- Location sharing is **opt-in** — default is OFF
- Publisher enables it via their privacy settings (profile page)
- Conductor sees which publishers have sharing enabled (icon/badge in group manager)
- API returns 403 if publisher attempts to share without opt-in
- Privacy settings page gets toggle: "Standortfreigabe im Predigtdienst erlauben" / "Allow location sharing in field service"

---

## Relationship Diagram

```
FieldServiceMeetingPoint (permanent, recurring)
  ├──→ ServiceGroupMeeting (concrete date instance)
  │      ├──→ ServiceMeetingSignup[] (publisher enrollments)
  │      └──→ ServiceMeetingFieldGroup[] (sub-groups)
  │             └──→ ServiceLocationShare[] (opt-in tracking)
  │
  └──→ CampaignMeetingPoint (optional link — campaign inherits defaults)
         └──→ Campaign
```

---

## RBAC Permissions

### New Permissions

| Permission | Description |
|------------|-------------|
| `app:field_service.view` | See Predigtdienst menu and pages |
| `app:meeting_points.view` | View meeting points list and details |
| `app:meeting_points.manage` | Create, edit, delete meeting points |
| `app:service_meetings.view` | View service meeting schedule |
| `app:service_meetings.manage` | Create, edit, cancel service meetings |
| `app:service_meetings.signup` | Self-signup / cancel for meetings |
| `app:service_meetings.conduct` | Start/complete meetings, manage field groups, assign territories |

### Role Matrix

| Permission | Admin | Elder | Ministerial Servant | Publisher |
|---|---|---|---|---|
| `field_service.view` | ✓ | ✓ | ✓ | ✓ |
| `meeting_points.view` | ✓ | ✓ | ✓ | ✓ |
| `meeting_points.manage` | ✓ | ✓ | — | — |
| `service_meetings.view` | ✓ | ✓ | ✓ | ✓ |
| `service_meetings.manage` | ✓ | ✓ | ✓ | — |
| `service_meetings.signup` | ✓ | ✓ | ✓ | ✓ |
| `service_meetings.conduct` | ✓ | ✓ | ✓ | — |

Existing campaign permissions (`app:campaigns.*`) remain unchanged.

---

## API Endpoints

### Meeting Points

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/field-service/meeting-points` | `meeting_points.view` | List all active meeting points |
| POST | `/field-service/meeting-points` | `meeting_points.manage` | Create meeting point |
| GET | `/field-service/meeting-points/:id` | `meeting_points.view` | Get meeting point detail |
| PUT | `/field-service/meeting-points/:id` | `meeting_points.manage` | Update meeting point |
| DELETE | `/field-service/meeting-points/:id` | `meeting_points.manage` | Delete meeting point |

### Service Meetings

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/field-service/meetings?week=2026-W14` | `service_meetings.view` | List meetings (filterable by ISO week) |
| POST | `/field-service/meetings` | `service_meetings.manage` | Create meeting at a meeting point |
| PUT | `/field-service/meetings/:id` | `service_meetings.manage` | Update meeting |
| DELETE | `/field-service/meetings/:id` | `service_meetings.manage` | Cancel meeting |
| POST | `/field-service/meetings/:id/signup` | `service_meetings.signup` | Publisher self-signup |
| DELETE | `/field-service/meetings/:id/signup` | `service_meetings.signup` | Cancel signup |
| POST | `/field-service/meetings/:id/start` | `service_meetings.conduct` | Conductor starts meeting |
| POST | `/field-service/meetings/:id/complete` | `service_meetings.conduct` | Conductor completes meeting |

### Field Groups (within a meeting)

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| POST | `/field-service/meetings/:id/groups` | `service_meetings.conduct` | Create field group |
| PUT | `/field-service/groups/:groupId` | `service_meetings.conduct` | Update group (members, territories) |
| POST | `/field-service/groups/:groupId/start` | `service_meetings.conduct` | Group goes to field |
| POST | `/field-service/groups/:groupId/complete` | `service_meetings.conduct` | Group returns |
| POST | `/field-service/groups/:groupId/location/start` | `service_meetings.signup` | Start location sharing (opt-in check) |
| POST | `/field-service/groups/:groupId/location/update` | `service_meetings.signup` | Update coordinates (30s polling) |
| POST | `/field-service/groups/:groupId/location/stop` | `service_meetings.signup` | Stop sharing |

---

## Frontend Components

### Meeting Point Management

**MeetingPointList** — Card grid of all meeting points. Each card shows: name, day/time badge, conductor name, territory count, participant count. "+ Neuer Treffpunkt" FAB for managers.

**MeetingPointForm** — Full-page form:
- Name input
- Address with map picker (reuse `useMapLibre` hook)
- Day of week selector (7 toggle buttons)
- Time picker
- Conductor dropdown (from publishers list)
- Assistant multi-select
- Territory multi-select
- Max participants (optional)

**MeetingPointDetail** — Map showing location + linked territory boundaries. Upcoming meetings list. Edit/delete for managers.

### Service Group Planning

**ServiceGroupPlanning** — Main view with toggle between:
- **Calendar view** (WeekCalendar component): 7-column grid, meeting chips color-coded (green = regular, orange = campaign). Click chip → navigate to detail.
- **List view** (MeetingListView component): Chronological list grouped by date. Shows conductor, territory count, signup count, "Anmelden"/"Abmelden" button.

Week navigation: prev/next arrows + "Heute" button.

**ServiceMeetingDetail (Conductor View):**
- Meeting info header (point, time, territories)
- Signed-up publishers list with avatars
- **Field Group Manager**: Drag-and-drop publishers into groups. Each group gets: name, leader assignment, territory assignment.
- "Meeting starten" / "Meeting abschließen" buttons
- **Live Location Map**: MapLibre map showing territory boundaries + real-time markers for publishers who opted-in to location sharing. Publishers without opt-in show as "Standort nicht freigegeben".

### Privacy Settings Addition

Add to existing profile/settings page:
- New section: "Datenschutz" / "Privacy"
- Toggle: "Standortfreigabe im Predigtdienst erlauben" with explanation text
- Default: OFF

---

## Integration with Campaigns

When a campaign is active:
- Campaign meeting points appear in the ServiceGroupPlanning calendar with distinct styling (orange)
- If a campaign references a FieldServiceMeetingPoint, the campaign inherits the point's defaults (conductor, territories)
- CampaignMeetingPoint gets optional `meetingPointId` FK to link to permanent meeting points
- Existing campaign lifecycle (draft → active → closed) is unchanged

---

## Success Criteria

1. Predigtdienst is a top-level sidebar menu with Aktionen, Treffpunkte, Predigtdienstgruppen
2. Meeting points persist across campaigns and are reusable
3. Publishers can self-signup for upcoming service meetings
4. Conductors can organize publishers into groups and assign territories
5. Live location tracking works only for publishers who opted-in
6. RBAC correctly restricts manage/conduct actions to elders + ministerial servants
7. Campaign meetings integrate into the same calendar view
8. All i18n: German (primary) and English
