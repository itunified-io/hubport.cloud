# PWA Offline Mode, Data Encryption & Device Management

**Date:** 2026-04-01
**Status:** Approved
**Scope:** hub-app (PWA client) + hub-api (backend sync/device endpoints)

## Overview

Enhance the hubport.cloud PWA with secure offline capabilities: encrypted local data storage via Dexie.js + AES-256-GCM, delta-based sync engine with conflict resolution, device registration with admin controls, controlled PWA update flow, and Web Push notifications. Full iOS Safari support (16.4+).

## Requirements

- Full offline mirror of all user-visible data (territories, addresses, visits, assignments, meetings, publishers)
- Hybrid sync: auto on app open + manual "Sync now" button
- Auto-push offline changes on reconnect with conflict resolution UI
- AES-256-GCM encryption of all PII in IndexedDB, key derived from stable OIDC `sub` claim
- Persistent storage request + graceful re-sync fallback for iOS eviction
- Online-first bootstrap (login once, then offline works)
- Device registration: max 3 per user, self-service + admin visibility/revoke
- Controlled PWA updates with Dexie migration safety
- Web Push notifications (iOS 16.4+ installed PWA, Android, Desktop)

## Technology Choice

**Dexie.js + Encryption Middleware** — battle-tested IndexedDB wrapper (~40KB gzipped) with schema versioning, migrations, transparent encryption middleware, and rich query API. iOS Safari well-tested by community. Sync engine custom-built on top.

Alternatives considered:
- Raw IndexedDB + Custom: full control but 3-4 weeks effort, must handle all iOS quirks manually
- RxDB + CRDTs: feature-complete but heavy (150KB+), requires custom replication endpoint, premium license for some features, overkill for our data volume

## Section 1: Offline Data Layer

### Dexie Database Schema

Database name: `hubportOffline-{tenantId}` (tenant-scoped to prevent data leakage between tenants)

**Tables and Prisma model mapping:**

| Dexie Table | Prisma Model | Primary Key | Indexes | Encrypted Fields |
|-------------|-------------|------------|---------|-----------------|
| territories | Territory | id | number, type | name, description, boundaries (GeoJSON) |
| addresses | Address | id | territoryId | streetAddress, city, postalCode, notes |
| visits | AddressVisit | id | addressId | notes |
| assignments | TerritoryAssignment | id | territoryId | — |
| meetingPoints | FieldServiceMeetingPoint | id | — | name, address |
| campaignMeetingPoints | CampaignMeetingPoint | id | campaignId | name, address |
| meetings | ServiceGroupMeeting | id | meetingPointId, date | notes |
| publishers | Publisher | id | — | firstName, lastName (encrypted) |
| territoryShares | TerritoryShare | id | territoryId | — |
| pendingChanges | (client-only) | id (auto) | table, status | payload |
| syncMeta | (client-only) | key | — | — |

All syncable tables include: `version` (Int), `updatedAt` (DateTime), `syncedAt` (DateTime).

### Encryption Strategy

**Algorithm:** AES-256-GCM via Web Crypto API (SubtleCrypto)

**Key derivation:**
1. OIDC `sub` claim (stable user ID, does not rotate) + `deviceId` → HMAC-SHA256 → seed
2. seed → PBKDF2 (100K iterations, random salt) → AES-256 key
3. Salt stored in `syncMeta` (not encrypted), generated once per device on first registration
4. Key held in **memory only** — never persisted to storage
5. The `/devices/encryption-key` endpoint returns the per-device salt (stored server-side). On app open, client fetches salt, then derives key locally using `sub + deviceId + salt`. No encryption key is ever transmitted over the wire.

**What gets encrypted:**
- PII fields: names, addresses, notes, phone numbers
- GeoJSON boundaries (location data)
- Pending change payloads
- NOT encrypted: IDs, timestamps, status enums (needed for Dexie indexing)

**Per-field encryption:**
- Each encrypted field gets a unique IV (12 bytes, `crypto.getRandomValues()`)
- Dexie middleware intercepts `put`/`get` — transparent to application code
- Web Crypto SubtleCrypto available on iOS Safari 15+

### Storage Budget

- Typical congregation (50 territories, 3000 addresses, 10K visits): ~5 MB raw
- With encryption overhead (12-byte IV + 16-byte auth tag per field + Base64 ~33%): ~8 MB estimated (overhead varies by field size — short name fields have higher relative overhead than large notes fields)
- iOS Safari quota: 50-500 MB (~50% free disk), `navigator.storage.persist()` extends

### Storage Eviction Protection

1. Request `navigator.storage.persist()` on first sync — on iOS this resolves silently based on engagement heuristics (no user-facing prompt, unlike Chrome). Persistence is more likely granted for installed PWAs (Add to Home Screen).
2. On every app open: check if Dexie tables exist and have data
3. If data was evicted: trigger transparent re-sync from server
4. Show brief "Refreshing offline data..." indicator during re-sync

## Section 2: Sync Engine

### Protocol: Delta-Based Pull/Push

**Pull (Server → Client):**
```
GET /sync/pull?since=<ISO-timestamp>&cursor=<opaque-cursor>
```
- Server queries all syncable tables for `updatedAt > since`
- Returns delta payload grouped by table:
```json
{
  "serverTime": "2026-04-01T12:30:00Z",
  "cursor": "eyJ0IjoiYWRkcmVzc2VzIiwib2Zmc2V0Ijo1MDB9",
  "tables": {
    "territories": { "upserts": [...], "deletes": ["id1"] },
    "addresses": { "upserts": [...], "deletes": [] }
  },
  "hasMore": false
}
```
- Pagination: if delta > 500 records, `hasMore: true` + opaque `cursor` — client passes cursor on next request
- Initial sync (no `since`): full dump of all user-visible data

**Push (Client → Server):**
```
POST /sync/push
```
- Client sends all entries from `pendingChanges` table
- Payload: `{ deviceId, changes: [{ table, recordId, operation, version, payload }] }`
- Operations: `create`, `update`, `delete`

**Push Response (per-change status):**
```json
{
  "results": [
    { "recordId": "addr-123", "status": "accepted", "serverVersion": 4 },
    { "recordId": "addr-456", "status": "conflict", "serverVersion": 5, "serverData": {...}, "clientVersion": 3 },
    { "recordId": "addr-789", "status": "rejected", "reason": "validation error" }
  ]
}
```

### Pending Changes Lifecycle

The `pendingChanges.status` field tracks each mutation through its lifecycle:

| Status | Meaning | Next Action |
|--------|---------|-------------|
| `pending` | Queued, not yet pushed | Include in next push |
| `pushing` | Currently being sent to server | Wait for response |
| `accepted` | Server accepted | Delete from pendingChanges |
| `conflict` | Version mismatch | Show conflict UI, user resolves |
| `failed` | Network error during push | Retry on next sync cycle |
| `rejected` | Server validation error | Show error to user, discard or let user fix |

On network failure mid-push: all `pushing` entries revert to `pending` for retry. On `rejected`: show inline error notification, keep in pendingChanges until user dismisses (acknowledges the error) — then discard.

### Sync Triggers (iOS-Safe)

| Trigger | Event | Behavior |
|---------|-------|----------|
| App open / resume | `visibilitychange` → `"visible"` | Auto-pull if lastSync > 5 min ago, auto-push pending |
| Manual sync | User taps "Sync Now" button | Full pull + push cycle with progress indicator |
| Reconnect | `navigator.onLine` → `true` | Verify connectivity first (see below), then push + pull |
| **NOT used** | Background Sync API, Periodic Background Sync | Not available on iOS Safari |

All sync is foreground-only.

**iOS `navigator.onLine` mitigation:** On iOS, `navigator.onLine` can return `true` when connected to WiFi without internet, and the `online` event can be delayed 10-30 seconds. Before attempting sync on reconnect, the sync engine performs a lightweight `HEAD /sync/status` request with a 5-second timeout. If it fails, sync is deferred and retried on next `visibilitychange` or manual trigger.

### Conflict Resolution

**Server-side:** Version column on all syncable tables. Every mutation increments `version` via Prisma middleware. Push endpoint uses optimistic concurrency: `WHERE version = clientVersion` — 0 rows updated = conflict.

**Client-side conflict UI:** When push returns `status: "conflict"`:
1. Show conflict dialog: "Address #42 was updated by another user"
2. Side-by-side comparison of local vs server values
3. Three actions:
   - **Keep Mine** — client re-sends with `force: true` flag. Server bypasses version check and overwrites with client data, incrementing version. This is intentional data override, not a race-prone retry.
   - **Use Theirs** — discard local change, update Dexie with server data, delete from pendingChanges.
   - **Review Both** — field-by-field merge UI, user picks values per field, result pushed as new version.

### Backend Schema Changes

All syncable models gain:
```prisma
version    Int       @default(0)
updatedAt  DateTime  @updatedAt
deletedAt  DateTime? // soft-delete for sync propagation
```

Soft-delete (`deletedAt`) instead of hard delete — sync needs to propagate removals to all devices.

**Migration strategy:** Adding `version Int @default(0)` and `deletedAt DateTime?` is non-destructive — both have defaults/are nullable. `Prisma db push` handles this safely. The version auto-increment middleware (`hub-api/src/middleware/version-middleware.ts`) must be registered in `app.ts` before any sync endpoint testing. Existing records start at version 0; first sync from any client will pull them with version 0.

## Section 3: Device Management

### Device Model

```prisma
model Device {
  id            String    @id @default(uuid())
  tenantId      String
  userId        String    // Keycloak sub
  deviceUuid    String    // client-generated UUID (localStorage)
  userAgent     String    // navigator.userAgent
  platform      String    // parsed from userAgentData or user-agent string
  screenSize    String    // e.g. "390x844"
  displayName   String    // auto-generated: "iPhone · Safari"
  encSalt       String    // per-device PBKDF2 salt for encryption key derivation
  status        String    @default("active")  // active | revoked
  revokedAt     DateTime?
  revokedBy     String?   // admin userId who revoked
  revokeReason  String?   // optional message shown to user
  lastSyncAt    DateTime?
  lastIp        String?
  registeredAt  DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  pushSubscription PushSubscription?

  @@unique([userId, deviceUuid])
  @@index([tenantId, userId])
}
```

### Registration Flow

1. User logs in via Keycloak OIDC → token received
2. Check `localStorage` for existing `hubport-device-id`
3. If exists: `GET /devices/me?deviceUuid=<uuid>` to verify status (active/revoked)
4. If not exists: generate UUID, collect metadata, `POST /devices/register`
5. Server checks: user has < 3 active devices? Yes → generate salt, 201 Created (returns salt). No → 409 Conflict with list of existing devices
6. On 409: show dialog "You have 3 registered devices. Remove one to use this device." User picks one → `DELETE /devices/:id` (server verifies `device.userId === req.user.sub`) → retry register
7. After registration: client derives encryption key locally (`sub + deviceId + salt` → HMAC → PBKDF2) → initial sync

### Device Identification

- **UUID** generated via `crypto.randomUUID()`, stored in `localStorage` as `hubport-device-id`
- **Platform** collected via `navigator.userAgentData?.platform` with fallback to user-agent string parsing (since `navigator.platform` is deprecated and returns generic values on modern browsers)
- **Screen size:** `${screen.width}x${screen.height}`
- **Display name** auto-generated server-side by parsing user-agent: e.g., "iPhone · Safari", "macOS · Chrome", "Android · Chrome"
- Clearing browser data = new device registration (UUID lost)

### Admin View

Settings → Geräte / Devices (requires `app:admin.devices` permission):
- Grouped by user
- Shows: device icon (📱/💻), display name, screen size, last sync time, status badge
- Revoke button with confirmation dialog + optional reason field
- Revoked devices shown dimmed with revocation date and reason

### User View

Profile → Meine Geräte / My Devices:
- Shows own devices, current device highlighted ("← this device")
- Device count: "2 of 3 devices registered"
- Can remove own other devices (not current device)

### Revocation Flow

1. Admin clicks "Revoke" → confirmation dialog with optional reason → `DELETE /admin/devices/:id`
2. Server: status → "revoked", `encSalt` cleared (key can no longer be derived), `revokedAt` + `revokeReason` stored
3. Revoked device on next app open: `GET /devices/me` returns `{ status: "revoked", reason: "Lost device" }`
4. App shows message: "Your device [iPad · Safari] was removed by admin. Reason: Lost device"
5. Wipe all Dexie data, clear `localStorage` device ID, force re-login
6. User can re-register if under device limit

### API Endpoints

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| POST | `/devices/register` | User | Register new device (checks limit, rate-limited: 10/hour) |
| GET | `/devices/me` | User | Check this device status (requires `deviceUuid` query param) |
| GET | `/devices` | User | List own devices |
| DELETE | `/devices/:id` | User | Remove own device (server verifies `device.userId === req.user.sub`) |
| GET | `/admin/devices` | Admin | List all devices (all users) |
| DELETE | `/admin/devices/:id` | Admin | Revoke any device (with reason) |
| GET | `/devices/encryption-salt` | User | Get per-device salt for key derivation |

**Security notes:**
- `POST /devices/register` is rate-limited to 10 requests per hour per user to prevent registration/deletion spam
- `DELETE /devices/:id` (user endpoint) verifies `device.userId === req.user.sub` — users cannot delete other users' devices
- `GET /devices/encryption-salt` requires valid device UUID matching the authenticated user

## Section 4: PWA Update Flow

### Current State

- `registerType: "autoUpdate"` + `skipWaiting: true` (inside `workbox` block) + `clientsClaim: true` — SW auto-activates without user consent
- Risky with offline data: new SW could activate during sync or break Dexie schema

### New Approach

- `registerType: "prompt"` at VitePWA plugin level
- Remove `skipWaiting: true` and `clientsClaim: true` from `workbox` block — SW stays in "waiting" until app explicitly calls `skipWaiting()`
- `useRegisterSW()` hook provides `needRefresh` boolean + `updateServiceWorker()` function
- Build injects `__APP_VERSION__` from `package.json` via Vite `define`
- Exclude sync/device endpoints from Workbox `api-cache` rule (see Modified Files)

### Version Enforcement

**Sync status endpoint** returns:
```json
GET /sync/status → { "minClientVersion": "2026.4.0-1.23", "lastSync": "...", ... }
```

- Client version ≥ `minClientVersion` → **optional update** (dismissible toast)
- Client version < `minClientVersion` → **required update** (non-dismissible bar, mutations blocked)

### Update Banner Modes

**Optional (non-breaking):**
- Dismissible toast: "New version available" + [Update] + [✕]
- App continues working normally

**Required (breaking schema change):**
- Non-dismissible bar: "Update required" + pending changes count + [Update Now]
- App content dimmed, new mutations blocked
- If offline: "Update required — connect to internet" + disabled button, app usable in read-only mode

### Update Sequence

1. Check `navigator.onLine` + `HEAD /sync/status` — if offline, show "connect first" and abort
2. Push all `pendingChanges` to server (`POST /sync/push`)
3. Resolve any conflicts (conflict UI if needed)
4. If Dexie schema version changed: `db.delete()` + recreate with new schema
5. Send `skipWaiting()` to waiting service worker
6. `window.location.reload()` — new SW takes over
7. App boots with new code → triggers fresh full sync from server

## Section 5: Push Notifications

### Architecture

- **Server:** `web-push` npm library with VAPID keys (public served to client, private in Vault)
- **Transport:** Standard Web Push Protocol → browser push service (FCM for Chrome/Android, APNs for Safari/iOS, Mozilla for Firefox)
- **Client:** Service worker `push` event handler shows native notification even when app is closed

### Push Subscription Model

```prisma
model PushSubscription {
  id          String   @id @default(uuid())
  tenantId    String
  deviceId    String   @unique
  endpoint    String
  p256dh      String   // encrypted at rest (ADR-0082)
  auth        String   // encrypted at rest (ADR-0082)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  device      Device   @relation(fields: [deviceId], references: [id], onDelete: Cascade)
  @@index([tenantId])
}
```

- 1:1 with Device, cascade delete on device revocation
- `p256dh` and `auth` encrypted per ADR-0082 field encryption

### Subscription Flow

1. After initial sync completes (device registered, app functional)
2. Show in-app banner (not browser popup): "Enable notifications to stay updated?"
3. User taps "Enable" → `Notification.requestPermission()` (user gesture required for iOS)
4. If granted: `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidPublicKey })`
5. Send subscription to `POST /devices/push-subscription`
6. If declined: respect choice, ask again after 7 days

### Notification Types

| Type | Priority | Trigger | Deep Link | Can Disable |
|------|----------|---------|-----------|-------------|
| Territory assignment | High | Territory assigned/returned | `/territories/:id` | Yes |
| Meeting update | Normal | Meeting created/changed/cancelled | `/field-service` | Yes |
| Sync conflict | Normal | Push returns conflict status | `/sync/conflicts` | Yes |
| Device revoked | Critical | Admin revokes device | `/profile/devices` | No (always on) |

Note: Deep link paths must be validated against the actual router configuration during implementation.

### iOS-Specific Requirements

- Must be installed PWA (Add to Home Screen) — push doesn't work in browser tab
- iOS 16.4+ required — detect via user-agent, hide notification option on older versions
- Permission must be triggered by user gesture (tap/click) — our in-app banner satisfies this
- No silent push — every push must show a visible notification
- No "data-only" push — can't use push to trigger background sync

### User Settings

Settings → Benachrichtigungen / Notifications:
- Master toggle: Push Notifications on/off
- Per-type toggles: territory assignments, meeting updates, sync conflicts
- Device revocations: always on (not toggleable)

## New Files

| File | Purpose |
|------|---------|
| `hub-app/src/lib/offline-db.ts` | Dexie database definition, schema, encryption middleware |
| `hub-app/src/lib/sync-engine.ts` | Pull/push sync logic, conflict detection, queue management |
| `hub-app/src/lib/device-manager.ts` | Device registration, status checks, metadata collection |
| `hub-app/src/lib/crypto.ts` | Key derivation, AES-256-GCM encrypt/decrypt via Web Crypto |
| `hub-app/src/hooks/useSyncStatus.ts` | React hook: sync state, pending count, last sync time |
| `hub-app/src/hooks/useOfflineData.ts` | React hook: read from Dexie when offline, API when online |
| `hub-app/src/hooks/usePushNotifications.ts` | React hook: subscription management, permission state |
| `hub-app/src/components/SyncStatusBar.tsx` | Header sync indicator + "Sync Now" button |
| `hub-app/src/components/UpdateBanner.tsx` | PWA update notification banner (optional/required modes) |
| `hub-app/src/components/ConflictDialog.tsx` | Side-by-side conflict resolution UI |
| `hub-app/src/components/DeviceLimitDialog.tsx` | "Remove a device" dialog when at limit |
| `hub-app/src/pages/profile/MyDevices.tsx` | User's device list page |
| `hub-app/src/pages/settings/DeviceAdmin.tsx` | Admin device management page |
| `hub-app/src/pages/settings/NotificationSettings.tsx` | Per-type notification toggles |
| `hub-app/src/pages/sync/ConflictsPage.tsx` | List of unresolved sync conflicts |
| `hub-api/src/routes/sync.ts` | Sync endpoints: pull, push, status |
| `hub-api/src/routes/devices.ts` | Device endpoints: register, list, revoke, encryption-salt |
| `hub-api/src/routes/push.ts` | Push subscription endpoint + send notification helper |
| `hub-api/src/lib/push-service.ts` | web-push wrapper, VAPID config, notification dispatch |
| `hub-api/src/middleware/version-middleware.ts` | Prisma middleware: auto-increment version on mutations |

## Modified Files

| File | Changes |
|------|---------|
| `hub-app/vite.config.ts` | `registerType: "prompt"`, remove `skipWaiting`/`clientsClaim` from workbox, add `__APP_VERSION__` define, exclude `/api/sync/*` and `/api/devices/*` from `api-cache` runtimeCaching rule |
| `hub-app/src/App.tsx` | Add `SyncStatusBar`, `UpdateBanner`, offline detection context |
| `hub-app/package.json` | Add `dexie` dependency |
| `hub-api/prisma/schema.prisma` | Add `Device`, `PushSubscription` models; add `version`, `deletedAt` to syncable models |
| `hub-api/src/app.ts` | Register sync, devices, push route modules; register version-middleware |

## Dependencies

| Package | Version | Size (gzipped) | Purpose |
|---------|---------|----------------|---------|
| `dexie` | ^4.x | ~40KB | IndexedDB wrapper with schema migrations |
| `web-push` | ^3.x | ~15KB (server) | VAPID-based Web Push sending |

## Security Considerations

- Encryption key derived from stable `sub` claim (not rotating access token) — key remains consistent across token refreshes
- Encryption salt stored per-device server-side; cleared on revocation making key re-derivation impossible
- Keys never persisted to disk — memory only, re-derived on each app open from `sub + deviceId + salt`
- PBKDF2 with 100K iterations makes brute-force key derivation impractical
- Soft-delete ensures sync propagates data removal to all devices
- Push subscription secrets (`p256dh`, `auth`) encrypted at rest per ADR-0082
- VAPID private key stored in Vault per ADR-0083
- Admin revoke wipes all local data on next app open — no residual plaintext
- Device limit (3) bounds the attack surface of lost/stolen devices
- `POST /devices/register` rate-limited to 10/hour per user
- `DELETE /devices/:id` verifies ownership (`device.userId === req.user.sub`)
- Dexie database tenant-scoped (`hubportOffline-{tenantId}`) to prevent cross-tenant data leakage
- "Keep Mine" conflict resolution uses server-side `force: true` flag — intentional override, not race-prone retry

## iOS Compatibility Matrix

| Feature | iOS Version | Notes |
|---------|-------------|-------|
| IndexedDB | 10+ | ✅ Fully supported |
| Web Crypto (SubtleCrypto) | 15+ | ✅ AES-256-GCM, PBKDF2, HMAC |
| Service Worker | 11.3+ | ✅ Caching, offline support |
| `navigator.storage.persist()` | 15.2+ | ✅ Silent heuristic (no prompt on iOS) |
| Web Push (notifications) | 16.4+ | ⚠️ Installed PWA only |
| `visibilitychange` event | 10+ | ✅ Reliable sync trigger |
| `navigator.onLine` | 10+ | ⚠️ Unreliable — mitigated with HEAD request probe |
| `crypto.randomUUID()` | 15.4+ | ✅ Device ID generation |
| `navigator.userAgentData` | ❌ | Not on iOS — fallback to UA string parsing |

**Minimum supported:** iOS 15+ (full offline + encryption). Push notifications require iOS 16.4+.
