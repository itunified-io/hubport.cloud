# Field Service Module (Predigtdienst) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. Chunks 3-7 can run in parallel after Chunks 1-2 complete.

**Goal:** Implement the complete Predigtdienst (Field Service) module for hubport.cloud — permanent meeting points, service group meeting planning with publisher self-signup, conductor group management with live tracking, and sidebar restructuring.

**Architecture:** Fastify 5 hub-api backend with Prisma 6, React 19 hub-app frontend with MapLibre GL JS. All routes use `requirePermission()` RBAC. Location sharing is opt-in per publisher.

**Tech Stack:** TypeScript, Fastify 5, Prisma 6, React 19, MapLibre GL JS, Tailwind CSS 4, react-intl (i18n DE/EN), lucide-react icons

**Repo:** `~/github/itunified-io/hubport.cloud` (monorepo: hub-api, hub-app)

**Spec Document:**
- Spec: `docs/superpowers/specs/2026-04-01-field-service-module-design.md`

---

## Dependency Graph

```
Chunk 1: RBAC + Schema ──────────┐
Chunk 2: Sidebar + Routes ───────┤
                                 ├─→ Chunk 3: Meeting Point Backend + Frontend
                                 ├─→ Chunk 4: Service Meeting Backend
                                 │        └──→ Chunk 5: Service Meeting Frontend (Calendar + List)
                                 ├─→ Chunk 6: Field Group + Location Backend
                                 │        └──→ Chunk 7: Conductor View + Live Map Frontend
                                 └─→ Chunk 8: Campaign Integration + Privacy Settings
```

Chunks 1 and 2 MUST complete before any other chunk starts. After that, Chunks 3, 4, 6, 8 can run in parallel. Chunk 5 depends on 4; Chunk 7 depends on 6.

---

## File Structure

### Hub-API New Files
```
hub-api/src/routes/
├── field-service-meeting-points.ts   # Meeting point CRUD
├── service-group-meetings.ts         # Service meetings + signup + field groups + location
```

### Hub-API Modified Files
```
hub-api/src/
├── index.ts                          # Register new route plugins
├── lib/
│   ├── permissions.ts                # Add 7 new permission constants
│   └── seed-roles.ts                # Add permissions to AppRoles
└── prisma/schema.prisma             # 5 new models + Publisher privacy field
```

### Hub-App New Files
```
hub-app/src/
├── pages/field-service/
│   ├── MeetingPointList.tsx          # Card grid of meeting points
│   ├── MeetingPointForm.tsx          # Create/edit meeting point with map
│   ├── MeetingPointDetail.tsx        # Meeting point detail + upcoming meetings
│   ├── ServiceGroupPlanning.tsx      # Calendar + list toggle view
│   ├── ServiceMeetingDetail.tsx      # Conductor view with group manager + live map
│   └── components/
│       ├── WeekCalendar.tsx          # 7-day grid with meeting chips
│       ├── MeetingListView.tsx       # Chronological list with signup buttons
│       └── FieldGroupManager.tsx     # Drag publishers into groups, assign territories
├── lib/
│   └── field-service-api.ts          # Typed API client for all field service endpoints
```

### Hub-App Modified Files
```
hub-app/src/
├── components/Sidebar.tsx            # New Predigtdienst menu, move Aktionen
├── App.tsx                           # New routes under /field-service/*
├── i18n/de-DE.json                   # German translations
├── i18n/en-US.json                   # English translations
└── pages/settings/ (or profile)      # Privacy toggle for location sharing
```

---

## Chunk 1: RBAC + Database Schema

### 1.1 Prisma Schema
- [ ] Add `FieldServiceMeetingPoint` model (see spec: name, address, lat/lng, dayOfWeek, time, conductorId, assistantIds, territoryIds, maxParticipants, isActive)
- [ ] Add `ServiceGroupMeeting` model (meetingPointId, serviceGroupId?, date, time, conductorId, status, startedAt, completedAt)
- [ ] Add `ServiceMeetingSignup` model (meetingId, publisherId, signedUpAt, cancelledAt) with @@unique([meetingId, publisherId])
- [ ] Add `ServiceMeetingFieldGroup` model (meetingId, name, leaderId, memberIds, territoryIds, status, startedAt, completedAt)
- [ ] Add `ServiceLocationShare` model (fieldGroupId, publisherId, lat/lng, accuracy, isActive, startedAt, lastUpdatedAt, stoppedAt)
- [ ] Add `allowLocationSharing Boolean @default(false)` to Publisher model
- [ ] Add relations: FieldServiceMeetingPoint → ServiceGroupMeeting[], ServiceGroupMeeting → signups[] + fieldGroups[], fieldGroup → locationShares[]
- [ ] Run `npx prisma db push` to apply

### 1.2 Permissions
- [ ] Add to `permissions.ts`: `FIELD_SERVICE_VIEW`, `MEETING_POINTS_VIEW`, `MEETING_POINTS_MANAGE`, `SERVICE_MEETINGS_VIEW`, `SERVICE_MEETINGS_MANAGE`, `SERVICE_MEETINGS_SIGNUP`, `SERVICE_MEETINGS_CONDUCT`
- [ ] Update `seed-roles.ts`:
  - Admin/Elder: all 7 permissions
  - Ministerial Servant: all except `MEETING_POINTS_MANAGE`
  - Publisher: `FIELD_SERVICE_VIEW`, `MEETING_POINTS_VIEW`, `SERVICE_MEETINGS_VIEW`, `SERVICE_MEETINGS_SIGNUP`

---

## Chunk 2: Sidebar + Routes

### 2.1 Sidebar Restructuring
- [ ] In `Sidebar.tsx`: Add new top-level "Predigtdienst" nav item with icon `BookOpen` (or `BookOpenText`)
- [ ] Children: Aktionen (`/field-service/campaigns`), Treffpunkte (`/field-service/meeting-points`), Predigtdienstgruppen (`/field-service/groups`)
- [ ] Remove Aktionen child from Gebiete menu
- [ ] Gate parent menu on `app:field_service.view`
- [ ] Import new lucide icons as needed

### 2.2 Route Configuration
- [ ] In `App.tsx`: Add `/field-service` parent route
- [ ] Move campaign routes: `/territories/campaigns/*` → `/field-service/campaigns/*`
- [ ] Add redirect from old campaign paths to new paths (backwards compat)
- [ ] Add new routes: `/field-service/meeting-points`, `/field-service/meeting-points/new`, `/field-service/meeting-points/:id`
- [ ] Add new routes: `/field-service/groups`, `/field-service/groups/:meetingId`

### 2.3 I18n
- [ ] Add German translations: `nav.fieldService`, `nav.fieldService.campaigns`, `nav.fieldService.meetingPoints`, `nav.fieldService.serviceGroups`
- [ ] Add English translations for same keys
- [ ] Add page-level translations for meeting point form labels, service meeting UI, status labels

---

## Chunk 3: Meeting Point Backend + Frontend

### 3.1 API Routes (`field-service-meeting-points.ts`)
- [ ] `GET /field-service/meeting-points` — list all active meeting points for tenant (include conductor name via Publisher join)
- [ ] `POST /field-service/meeting-points` — create with validation (name required, dayOfWeek 0-6, time format HH:MM)
- [ ] `GET /field-service/meeting-points/:id` — detail with upcoming ServiceGroupMeetings
- [ ] `PUT /field-service/meeting-points/:id` — update fields
- [ ] `DELETE /field-service/meeting-points/:id` — soft delete (set isActive=false) or hard delete if no meetings exist
- [ ] Register in `index.ts`

### 3.2 API Client (`field-service-api.ts`)
- [ ] Create typed API client following `territory-api.ts` pattern (apiFetch helper, TerritoryApiError reuse or new FieldServiceApiError)
- [ ] Types: `FieldServiceMeetingPoint`, `ServiceGroupMeeting`, `ServiceMeetingSignup`, `ServiceMeetingFieldGroup`, `ServiceLocationShare`
- [ ] Functions: `listMeetingPoints`, `createMeetingPoint`, `getMeetingPoint`, `updateMeetingPoint`, `deleteMeetingPoint`

### 3.3 Frontend Pages
- [ ] `MeetingPointList.tsx` — Card grid layout. Each card: name, day/time badge, conductor avatar+name, territory count, participants badge. "+ Neuer Treffpunkt" button (gated on `meeting_points.manage`). Click card → navigate to detail.
- [ ] `MeetingPointForm.tsx` — Form with: name input, address input, map picker (reuse `useMapLibre`), day-of-week toggle buttons (Mo-So), time picker, conductor dropdown (fetch publishers), assistant multi-select, territory multi-select, max participants number input. Save → POST/PUT → navigate back.
- [ ] `MeetingPointDetail.tsx` — Header with name, address, map. Upcoming meetings list. Edit/Delete buttons (gated). Territory boundary visualization on map.

---

## Chunk 4: Service Meeting Backend

### 4.1 API Routes (`service-group-meetings.ts`)
- [ ] `GET /field-service/meetings` — list upcoming meetings with signups count, conductor name. Support `?week=2026-W14` filter (ISO week). Include meetingPoint name.
- [ ] `POST /field-service/meetings` — create meeting at a meeting point (copy defaults: conductor, time). Validate meetingPointId exists.
- [ ] `PUT /field-service/meetings/:id` — update (only if status=planned)
- [ ] `DELETE /field-service/meetings/:id` — cancel (set status=cancelled, only if status=planned)
- [ ] `POST /field-service/meetings/:id/signup` — publisher self-signup. Check maxParticipants if set. Create ServiceMeetingSignup row.
- [ ] `DELETE /field-service/meetings/:id/signup` — set cancelledAt on signup row
- [ ] `POST /field-service/meetings/:id/start` — conductor starts meeting (set status=active, startedAt)
- [ ] `POST /field-service/meetings/:id/complete` — conductor completes (set status=completed, completedAt, auto-complete all field groups)
- [ ] Register in `index.ts`

### 4.2 API Client additions
- [ ] Add to `field-service-api.ts`: `listServiceMeetings`, `createServiceMeeting`, `updateServiceMeeting`, `cancelServiceMeeting`, `signupForMeeting`, `cancelSignup`, `startMeeting`, `completeMeeting`

---

## Chunk 5: Service Meeting Frontend (Calendar + List)

### 5.1 Week Calendar Component
- [ ] `WeekCalendar.tsx` — 7-column grid (Mo-So). Day headers with date. Meeting chips inside day cells: green for regular, orange for campaign. Chip shows time + meeting point name. Click chip → navigate to detail.
- [ ] Week navigation: left/right arrows + "Heute" button. Display week range (e.g., "31.03 — 06.04.2026").

### 5.2 Meeting List View Component
- [ ] `MeetingListView.tsx` — Grouped by date. Each meeting card: time, meeting point name, conductor, territory badges, signup count. "Anmelden"/"Abmelden" toggle button. Avatar row of signed-up publishers.

### 5.3 Service Group Planning Page
- [ ] `ServiceGroupPlanning.tsx` — Container with view toggle (calendar/list icons). Calendar as default view. Shared week state. "+ Neuer Termin" button for managers (opens dialog: select meeting point → date → time → conductor → save).

---

## Chunk 6: Field Group + Location Backend

### 6.1 Field Group Endpoints (in `service-group-meetings.ts`)
- [ ] `POST /field-service/meetings/:id/groups` — create field group (name, leaderId, memberIds from signed-up publishers, territoryIds)
- [ ] `PUT /field-service/groups/:groupId` — update members, territories, leader
- [ ] `POST /field-service/groups/:groupId/start` — set status=in_field, startedAt
- [ ] `POST /field-service/groups/:groupId/complete` — set status=completed, completedAt, deactivate all location shares

### 6.2 Location Sharing Endpoints
- [ ] `POST /field-service/groups/:groupId/location/start` — check publisher.allowLocationSharing (403 if false). Create ServiceLocationShare row.
- [ ] `POST /field-service/groups/:groupId/location/update` — update lat/lng/accuracy/lastUpdatedAt. Only if isActive=true.
- [ ] `POST /field-service/groups/:groupId/location/stop` — set isActive=false, stoppedAt
- [ ] `GET /field-service/groups/:groupId/locations` — get all active location shares for group (conductor view)

### 6.3 API Client additions
- [ ] Add to `field-service-api.ts`: `createFieldGroup`, `updateFieldGroup`, `startFieldGroup`, `completeFieldGroup`, `startLocationShare`, `updateLocation`, `stopLocationShare`, `getGroupLocations`

---

## Chunk 7: Conductor View + Live Map Frontend

### 7.1 Service Meeting Detail Page
- [ ] `ServiceMeetingDetail.tsx` — Header: meeting point name, date/time, status badge. Tabs or sections:
  - **Anmeldungen**: Signed-up publishers list with avatars. Show `allowLocationSharing` status icon per publisher.
  - **Gruppen**: Field group cards. Each card shows leader, members, territories, status. "Neue Gruppe" button.
  - **Karte**: Live location map (MapLibre) showing territory boundaries + publisher markers.
- [ ] "Meeting starten" button (status=planned → active)
- [ ] "Meeting abschließen" button (status=active → completed)

### 7.2 Field Group Manager Component
- [ ] `FieldGroupManager.tsx` — Create groups from signed-up publishers. Assign members (multi-select from signup list). Assign territories (multi-select from meeting point's default territories). Set group leader. "Gruppe starten" / "Zurück" buttons per group.

### 7.3 Live Location Map
- [ ] Reuse `useMapLibre` hook
- [ ] Territory boundaries as polygon layers
- [ ] Publisher locations as circle markers (color-coded per group)
- [ ] Auto-refresh locations every 30 seconds (poll `GET /field-service/groups/:groupId/locations`)
- [ ] Publishers without opt-in shown as grayed-out in sidebar (no marker on map), labeled "Standort nicht freigegeben"

---

## Chunk 8: Campaign Integration + Privacy Settings

### 8.1 Campaign Integration
- [ ] Add optional `meetingPointId` to `CampaignMeetingPoint` model (Prisma schema update)
- [ ] When creating a campaign meeting point, allow selecting an existing FieldServiceMeetingPoint to inherit defaults
- [ ] In ServiceGroupPlanning calendar: show campaign meetings with orange styling alongside regular green meetings
- [ ] Query both ServiceGroupMeeting and CampaignMeetingPoint for calendar data (union in API or separate queries merged in frontend)

### 8.2 Privacy Settings
- [ ] Add "Datenschutz" / "Privacy" section to publisher profile/settings page
- [ ] Toggle: "Standortfreigabe im Predigtdienst erlauben" / "Allow location sharing in field service"
- [ ] Explanation text below toggle
- [ ] API endpoint: `PUT /publishers/:id/privacy` or extend existing publisher update
- [ ] Default OFF for all existing publishers

---

## Verification Checklist

- [ ] Sidebar shows Predigtdienst with 3 children, Gebiete no longer has Aktionen
- [ ] Old `/territories/campaigns/*` routes redirect to `/field-service/campaigns/*`
- [ ] Meeting point CRUD works (create with map, edit, delete)
- [ ] Service meeting appears in calendar and list views
- [ ] Publisher can signup/cancel from both views
- [ ] Conductor can create groups, assign members + territories
- [ ] Conductor can start/complete meeting
- [ ] Location sharing works only for opted-in publishers (403 for others)
- [ ] Privacy toggle works in settings
- [ ] Campaign meetings show in calendar with different color
- [ ] RBAC: Publisher cannot create meeting points or meetings
- [ ] RBAC: MS can create meetings but not meeting points
- [ ] `npm run build` passes in hub-api and hub-app
- [ ] `npx prisma db push` applies without data loss
- [ ] All new UI has DE + EN translations
