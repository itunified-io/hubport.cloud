# Field Work Mode: GPS Location, Quick-Action Visit Logging & Location Sharing

**Date:** 2026-04-01
**Status:** Approved
**Scope:** hubport.cloud territory module — mobile field work UX + GPS integration

## Problem

Publishers working door-to-door need a fast, mobile-first workflow to:
1. See their GPS location on the territory map with walking direction (heading)
2. Tap a building and record a visit outcome in one tap (not at home, contacted, DNC)
3. View the address list sorted by proximity to their current position
4. Optionally share their location with their field work group or territory overseer

The current TerritoryDetail page is desktop-oriented with a table layout that requires multiple clicks to log a visit. There is no GPS integration, no quick actions, and no mobile-optimized field work mode.

## Existing Infrastructure

The codebase already has field group and location sharing infrastructure:

- **`CampaignFieldGroup`** (Prisma model) — groups within meeting points with status lifecycle (`open` → `in_field` → `closed`), member lists, territory assignments
- **`LocationShare`** (Prisma model) — per-publisher location sharing with duration-based expiry, lat/lng tracking, `isActive` flag
- **`field-groups.ts`** routes — CRUD, start/close groups, start/stop/update location sharing
- **`ServiceGroup`** (Prisma model) — permanent congregation service groups (Gruppe 1-5), unrelated to field work sessions
- Permissions: `CAMPAIGNS_CONDUCT` (leader), `CAMPAIGNS_ASSIST` (member), `CAMPAIGNS_LOCATION_SHARE` (all publishers)

**This spec extends the existing `CampaignFieldGroup` + `LocationShare` system** with GPS/heading client-side features and mobile UX. It does NOT create parallel models or routes.

## Design Decisions

- **Hybrid layout (Approach C):** Shared components rendered in device-appropriate layouts — full-screen map with bottom sheet on mobile, enhanced TerritoryDetail sidebar on desktop
- **One-tap outcomes:** No confirmation dialog — tap = logged. Brief toast confirmation auto-dismisses
- **Apple Maps-style blue dot:** White-bordered blue dot, translucent heading cone, pulsing accuracy circle
- **Extend existing LocationShare:** Add `heading` and `accuracy` fields to existing `LocationShare` model. Continue using DB-backed location (not in-memory) for consistency with existing system
- **HTTP polling (existing pattern):** Existing `location-share/update` endpoint already uses POST polling. Add heading + accuracy fields to existing update body
- **Reuse existing permissions:** `CAMPAIGNS_CONDUCT` for group leadership, `CAMPAIGNS_ASSIST` for participation, `CAMPAIGNS_LOCATION_SHARE` for sharing toggle. Only add `FIELD_WORK_GPS` (new) and `FIELD_WORK_OVERSEER` (new)

## Component Architecture

### Shared Components (Frontend)

| Component | Type | Purpose |
|-----------|------|---------|
| `useGpsTracker` | Hook | Watches position + heading via Geolocation API + DeviceOrientationEvent. Returns `{lat, lng, heading, accuracy, speed, active, error, toggle()}` |
| `MyLocationMarker` | MapLibre overlay | Blue dot + heading cone + accuracy circle. Uses MapLibre `Marker` with custom HTML element (not GeoJSON source — avoids full layer re-render on every GPS tick) |
| `QuickActionBar` | UI component | One-tap outcome buttons: Contacted (green), Not Home (amber), DNC (red), Letter (blue), Moved (gray), Phone (blue) |
| `ProximityList` | UI component | Address list sorted by Haversine distance from GPS position. Inline quick-action mini-buttons per row. Re-sorts every 5s |
| `BottomSheet` | UI component | Mobile bottom sheet with 3 states (collapsed/peek/expanded), drag gestures |

### Outcome-to-VisitOutcome Mapping

| UI Label | Icon | Color | `VisitOutcome` value |
|----------|------|-------|---------------------|
| Contacted | ✓ | green | `"contacted"` |
| Not Home | 🏠 | amber | `"not_at_home"` |
| DNC | 🚫 | red | `"do_not_call"` |
| Letter | ✉️ | blue | `"letter_sent"` |
| Moved | → | gray | `"moved"` |
| Phone | 📞 | blue | `"phone_attempted"` |

### Layout Detection

- Screen width `< 768px` → mobile layout (auto)
- Desktop: manual toggle button in map toolbar (i18n key: `territory.fieldWork.start`)
- Both layouts use identical shared components, different presentation

## Feature A: Quick-Action Visit Logging

### Map Interaction (Both Layouts)

1. Tap/click building polygon on map → building highlights with amber border
2. Bottom sheet (mobile) or popup (desktop) shows: street + house number, building type, last visit info
3. `QuickActionBar` displays 6 one-tap outcome buttons
4. Tap outcome → `POST /territories/:id/addresses/:addrId/visits` fires immediately (requires existing `ADDRESSES_VISIT` permission, already granted to all publishers)
5. Building color updates instantly: green = contacted, amber = not home, red = DNC
6. Toast confirmation: "Sindelsdorfer Str. 6a — Not Home" (auto-dismiss 2s)

### ProximityList (Address List)

- Each row: status icon | street + house number | distance ("12m") | 3 quick-action mini-buttons (Contacted, Not Home, DNC)
- Already-visited: green left border, strike-through text, "Done" label, quick-actions hidden
- DNC: dimmed 50% opacity, red left border, no quick-actions
- Expand row (chevron or tap address text) → full VisitLogger with all 6 outcomes + notes + date

### GPS Proximity Sort

- Haversine distance computed client-side from `useGpsTracker` position
- Re-sorts every 5 seconds (not every GPS tick — prevents jarring reorder)
- "Freeze sort" toggle: publisher can pin the current sort order to prevent disorienting reorder while mid-interaction. Re-sorts resume when unfrozen or when publisher scrolls to top.
- Distance label per row: "12m", "45m", "130m"
- Header indicator: i18n `territory.fieldWork.sortByDistance` with option to switch to street sort

## Feature B: GPS Location on Map

### useGpsTracker Hook

```typescript
interface GpsState {
  lat: number | null;
  lng: number | null;
  heading: number | null;    // degrees, 0 = north
  accuracy: number | null;   // meters
  speed: number | null;      // m/s
  active: boolean;
  error: string | null;
  toggle: () => void;
}
```

- `navigator.geolocation.watchPosition` with `enableHighAccuracy: true`
- Heading from `DeviceOrientationEvent` (mobile compass). Fallback: compute heading from position delta when speed > 1 m/s (desktop/no compass)
- Update rate: position every 3s, heading every 500ms (throttled)
- Cleans up watcher on unmount

### MyLocationMarker (MapLibre)

- Custom HTML `Marker` (not GeoJSON source)
- Blue dot: 14px diameter, white 2px border, `box-shadow` glow
- Heading cone: CSS `clip-path` triangle, rotated to heading degrees, semi-transparent blue (`rgba(59,130,246,0.12)`)
- Accuracy circle: radius scaled to map zoom level, fades with opacity transition, pulsing animation
- Recenter button: floating bottom-right, crosshair icon, re-centers map on user position

### Browser Permission Flow

1. First tap "locate me" button → browser Geolocation permission prompt
2. Denied → inline message (i18n `territory.fieldWork.locationDenied`) with settings link
3. Granted → activate tracking, show blue dot

## Location Sharing (Extends Existing System)

### Schema Changes to Existing `LocationShare` Model

```prisma
model LocationShare {
  // Existing fields (unchanged):
  id             String   @id @default(uuid())
  fieldGroupId   String
  publisherId    String
  duration       String
  expiresAt      DateTime
  isActive       Boolean  @default(true)
  lastLatitude   Float?
  lastLongitude  Float?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  // New fields:
  heading        Float?   /// Compass heading in degrees (0-360)
  accuracy       Float?   /// GPS accuracy in meters
}
```

### API Changes (Extend Existing Endpoints)

**Modified:** `POST /field-groups/:id/location-share/update`
- Add `heading` (optional Float) and `accuracy` (optional Float) to `LocationShareUpdateBody` schema
- Existing permission: `CAMPAIGNS_ASSIST` or `CAMPAIGNS_CONDUCT` — unchanged

**New:** `GET /field-groups/active-locations` (overseer endpoint)
- Returns all active `LocationShare` records with publisher info across all active field groups
- Permission: `FIELD_WORK_OVERSEER`
- Tenant-scoped (automatic via RBAC context)

**No new route files needed** — extend existing `field-groups.ts`

### Privacy Model

- Sharing is opt-in: publisher starts sharing via existing `location-share/start` endpoint with chosen duration
- Publisher stops sharing via existing `location-share/stop` endpoint
- When sharing is off: publisher still sees others in group who share, but own dot invisible
- Location data cleared when group closes (existing behavior in `close` handler)
- Expired shares auto-deactivate (existing `expiresAt` check)

### Join Code Enhancement (New)

Add a 6-character alphanumeric join code to `CampaignFieldGroup` for easy mobile joining:

```prisma
model CampaignFieldGroup {
  // Existing fields...
  joinCode  String?  /// 6-char alphanumeric, unique while status != "closed"
}
```

**New endpoints (add to `field-groups.ts`):**
- `POST /field-groups/:id/generate-code` — generates join code (leader only, `CAMPAIGNS_CONDUCT`)
- `POST /field-groups/join` — body: `{ code: string }` → joins group (`CAMPAIGNS_ASSIST`)

### Auto-Timeout Cleanup

- Field groups with `status = "in_field"` and `startedAt` older than 4 hours are auto-closed
- Cleanup via Fastify `setInterval` (every 5 minutes) registered on server start
- Deactivates all associated `LocationShare` records (same as manual close)

## Mobile Layout: Field Work Mode

### Entry Point

- Territory detail on mobile (`< 768px`) → shows field work start button at top
- Desktop: same button in map toolbar as toggle
- Activates full-screen map with GPS

### Bottom Sheet (3 States)

**Collapsed (default):**
- Thin bar (60px): GPS status dot + nearest address name + distance + drag handle
- Map fills entire screen above

**Peek (building tapped):**
- Slides up ~180px: address info + QuickActionBar (6 outcome buttons)
- Map adjusts padding-bottom so selected building stays visible
- Swipe down to collapse, swipe up to expand

**Expanded (swipe up or tap list icon):**
- Covers bottom 60% of screen: full ProximityList with GPS-sorted addresses
- Map visible above (40%), blue dot still tracking
- Search bar at top of list
- Swipe down to peek or collapse

### Navigation

- Back button (top-left) → exits field work mode, returns to TerritoryDetail
- Field group badge (top-right, if in group) → opens group member panel overlay

### Offline Support

- Quick actions queue locally in IndexedDB if network unavailable
- Sync when back online — duplicate detection by `(addressId, visitedAt)` within 5-minute window; skip if duplicate exists
- Visual indicator: orange dot on GPS status bar = "offline, queuing visits"

## Desktop Layout Enhancements

### TerritoryDetail Changes

- Map shows `MyLocationMarker` with heading when GPS active
- Click building on map → popup with address info + `QuickActionBar`
- Address table gains "Proximity" sort option alongside existing columns
- When proximity sort active: distance column appears, re-sorts every 5s

### Overseer Dashboard (New Page: `/territories/field-work`)

- Full-screen map showing all territories
- Color-coded dots for all publishers currently sharing location (via `GET /field-groups/active-locations`)
- Sidebar: active field groups with member counts
- Click group → see members, territories, sharing status
- Click publisher dot → territory info, last visit logged
- Permission-gated: `FIELD_WORK_OVERSEER`

## Permissions

### New Permission Definitions (add to `permissions.ts`)

Only 2 new permissions needed — rest reuses existing:

| Permission | Constant | String key | Purpose |
|-----------|----------|------------|---------|
| `FIELD_WORK_GPS` | `PERMISSIONS.FIELD_WORK_GPS` | `"app:field_work.gps"` | Use GPS on territory map |
| `FIELD_WORK_OVERSEER` | `PERMISSIONS.FIELD_WORK_OVERSEER` | `"app:field_work.overseer"` | See all sharing publishers on dashboard |

### Reused Existing Permissions

| Action | Permission | Already granted to |
|--------|-----------|-------------------|
| Create/close field groups | `CAMPAIGNS_CONDUCT` | Service Overseer, elder roles |
| Join groups, share location | `CAMPAIGNS_ASSIST` | All publishers (BASE_ROLE) |
| Toggle location sharing | `CAMPAIGNS_LOCATION_SHARE` | All publishers (BASE_ROLE) |
| Log visits (quick actions) | `ADDRESSES_VISIT` | All publishers (BASE_ROLE) |

### Changes to Apply

**`permissions.ts` — BASE_ROLE_PERMISSIONS.publisher:**
```typescript
PERMISSIONS.FIELD_WORK_GPS,  // new
```

**`seed-roles.ts` — Service Overseer:**
```typescript
PERMISSIONS.FIELD_WORK_OVERSEER,  // new
```

**`permissions.ts` — PAGE_PERMISSIONS:**
```typescript
"/territories/field-work": [PERMISSIONS.FIELD_WORK_OVERSEER],
```

Coordinator + Admin already have WILDCARD — no changes needed.

## Key Files

### Frontend (hub-app)

| File | Action |
|------|--------|
| `src/hooks/useGpsTracker.ts` | Create — GPS + heading hook |
| `src/hooks/useLocationSharing.ts` | Create — wraps existing field-group location-share API with GPS tracker integration |
| `src/components/map/MyLocationMarker.tsx` | Create — blue dot + heading + accuracy |
| `src/components/territory/QuickActionBar.tsx` | Create — one-tap outcome buttons |
| `src/components/territory/ProximityList.tsx` | Create — GPS-sorted address list with inline quick-actions |
| `src/components/territory/BottomSheet.tsx` | Create — mobile bottom sheet (3 states) with drag gestures |
| `src/pages/territories/FieldWorkMode.tsx` | Create — mobile full-screen map mode |
| `src/pages/territories/FieldWorkDashboard.tsx` | Create — overseer dashboard |
| `src/pages/territories/TerritoryDetail.tsx` | Modify — add GPS + quick-action integration |
| `src/lib/territory-api.ts` | Modify — add field work API functions |

### Backend (hub-api)

| File | Action |
|------|--------|
| `src/routes/field-groups.ts` | Modify — add heading/accuracy to location update, add active-locations endpoint, add join code endpoints |
| `src/lib/permissions.ts` | Modify — add 2 new permissions, update BASE_ROLE_PERMISSIONS, update PAGE_PERMISSIONS |
| `src/lib/seed-roles.ts` | Modify — add FIELD_WORK_OVERSEER to Service Overseer |
| `prisma/schema.prisma` | Modify — add heading + accuracy to LocationShare, add joinCode to CampaignFieldGroup |
