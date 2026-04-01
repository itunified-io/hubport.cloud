# PWA Offline Mode, Data Encryption & Device Management

**Date:** 2026-04-01
**Status:** Approved
**Scope:** hub-app (PWA client) + hub-api (backend sync/device endpoints)

## Overview

Enhance the hubport.cloud PWA with secure offline capabilities: encrypted local data storage via Dexie.js + AES-256-GCM, delta-based sync engine with conflict resolution, device registration with admin controls, controlled PWA update flow, and Web Push notifications. Full iOS Safari support (16.4+).

## Requirements

- Full offline mirror of all user-visible data (territories, addresses, visits, assignments, meetings)
- Hybrid sync: auto on app open + manual "Sync now" button
- Auto-push offline changes on reconnect with conflict resolution UI
- AES-256-GCM encryption of all PII in IndexedDB, key derived from OIDC token
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

Database name: `hubportOffline`

**Tables:**

| Table | Primary Key | Indexes | Encrypted Fields |
|-------|------------|---------|-----------------|
| territories | id | number, type | name, description, boundaries (GeoJSON) |
| addresses | addressId | territoryId | streetAddress, city, postalCode, notes |
| visits | visitId | addressId | notes |
| assignments | id | territoryId | — |
| meetingPoints | id | — | name, address |
| meetings | id | meetingPointId, date | notes |
| pendingChanges | id (auto) | table, status | payload |
| syncMeta | key | — | — |

All syncable tables include: `version` (Int), `updatedAt` (DateTime), `syncedAt` (DateTime).

### Encryption Strategy

**Algorithm:** AES-256-GCM via Web Crypto API (SubtleCrypto)

**Key derivation:**
1. OIDC `access_token` + `deviceId` → HMAC-SHA256 → seed
2. seed → PBKDF2 (100K iterations, random salt) → AES-256 key
3. Salt stored in `syncMeta` (not encrypted)
4. Key held in **memory only** — never persisted to storage

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

- Typical congregation (50 territories, 3000 addresses, 10K visits): ~5 MB
- With encryption overhead (IV + padding, ~60%): ~8 MB
- iOS Safari quota: 50-500 MB (~50% free disk), `navigator.storage.persist()` extends

### Storage Eviction Protection

1. Request `navigator.storage.persist()` on first sync — iOS shows permission prompt
2. On every app open: check if Dexie tables exist and have data
3. If data was evicted: trigger transparent re-sync from server
4. Show brief "Refreshing offline data..." indicator during re-sync

## Section 2: Sync Engine

### Protocol: Delta-Based Pull/Push

**Pull (Server → Client):**
```
GET /sync/pull?since=<ISO-timestamp>
```
- Server queries all syncable tables for `updatedAt > since`
- Returns delta payload grouped by table: `{ tables: { territories: { upserts: [...], deletes: ["id1"] }, ... }, hasMore: false }`
- Pagination: if delta > 500 records, `hasMore: true` — client calls again with cursor
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

### Sync Triggers (iOS-Safe)

| Trigger | Event | Behavior |
|---------|-------|----------|
| App open / resume | `visibilitychange` → `"visible"` | Auto-pull if lastSync > 5 min ago, auto-push pending |
| Manual sync | User taps "Sync Now" button | Full pull + push cycle with progress indicator |
| Reconnect | `navigator.onLine` → `true` | Push pending first, then pull updates |
| **NOT used** | Background Sync API, Periodic Background Sync | Not available on iOS Safari |

All sync is foreground-only.

### Conflict Resolution

**Server-side:** Version column on all syncable tables. Every mutation increments `version` via Prisma middleware. Push endpoint uses optimistic concurrency: `WHERE version = clientVersion` — 0 rows updated = conflict.

**Client-side conflict UI:** When push returns `status: "conflict"`:
1. Show conflict dialog: "Address #42 was updated by another user"
2. Side-by-side comparison of local vs server values
3. Three actions: **Keep Mine** (force-push with server version) | **Use Theirs** (discard local change) | **Review Both** (field-by-field merge)

### Backend Schema Changes

All syncable models gain:
```prisma
version    Int       @default(0)
updatedAt  DateTime  @updatedAt
deletedAt  DateTime? // soft-delete for sync propagation
```

Soft-delete (`deletedAt`) instead of hard delete — sync needs to propagate removals to all devices.

## Section 3: Device Management

### Device Model

```prisma
model Device {
  id            String    @id @default(uuid())
  tenantId      String
  userId        String    // Keycloak sub
  deviceUuid    String    // client-generated UUID (localStorage)
  userAgent     String    // navigator.userAgent
  platform      String    // navigator.platform (e.g. "iPhone", "Win32")
  screenSize    String    // e.g. "390x844"
  displayName   String    // auto-generated: "iPhone · Safari"
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
3. If exists: `GET /devices/me` to verify status (active/revoked)
4. If not exists: generate UUID, collect metadata (userAgent, platform, screenSize), `POST /devices/register`
5. Server checks: user has < 3 active devices? Yes → 201 Created. No → 409 Conflict with list of existing devices
6. On 409: show dialog "You have 3 registered devices. Remove one to use this device." User picks one → `DELETE /devices/:id` → retry register
7. After registration: `POST /devices/encryption-key` → derive key → initial sync

### Device Identification

- **UUID** generated via `crypto.randomUUID()`, stored in `localStorage` as `hubport-device-id`
- **Metadata** collected automatically: `navigator.userAgent`, `navigator.platform`, `${screen.width}x${screen.height}`
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
2. Server: status → "revoked", encryption key deleted, `revokedAt` + `revokeReason` stored
3. Revoked device on next app open: `GET /devices/me` returns `{ status: "revoked", reason: "Lost device" }`
4. App shows message: "Your device [iPad · Safari] was removed by admin. Reason: Lost device"
5. Wipe all Dexie data, clear `localStorage` device ID, force re-login
6. User can re-register if under device limit

### API Endpoints

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| POST | `/devices/register` | User | Register new device (checks limit) |
| GET | `/devices/me` | User | Check this device status |
| GET | `/devices` | User | List own devices |
| DELETE | `/devices/:id` | User | Remove own device |
| GET | `/admin/devices` | Admin | List all devices (all users) |
| DELETE | `/admin/devices/:id` | Admin | Revoke any device (with reason) |
| POST | `/devices/encryption-key` | User | Get encryption key for this device |

## Section 4: PWA Update Flow

### Current State

- `registerType: "autoUpdate"` + `skipWaiting: true` — SW auto-activates without user consent
- Risky with offline data: new SW could activate during sync or break Dexie schema

### New Approach

- `registerType: "prompt"` + `skipWaiting: false` — SW stays in "waiting" until app explicitly calls `skipWaiting()`
- `useRegisterSW()` hook provides `needRefresh` boolean + `updateServiceWorker()` function
- Build injects `__APP_VERSION__` from `package.json`

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

1. Check `navigator.onLine` — if offline, show "connect first" and abort
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
| Meeting update | Normal | Meeting created/changed/cancelled | `/field-service/meetings/:id` | Yes |
| Sync conflict | Normal | Push returns conflict status | `/sync/conflicts` | Yes |
| Device revoked | Critical | Admin revokes device | `/profile/devices` | No (always on) |

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
| `hub-api/src/routes/devices.ts` | Device endpoints: register, list, revoke, encryption-key |
| `hub-api/src/routes/push.ts` | Push subscription endpoint + send notification helper |
| `hub-api/src/lib/push-service.ts` | web-push wrapper, VAPID config, notification dispatch |
| `hub-api/src/middleware/version-middleware.ts` | Prisma middleware: auto-increment version on mutations |

## Modified Files

| File | Changes |
|------|---------|
| `hub-app/vite.config.ts` | `registerType: "prompt"`, `skipWaiting: false`, `__APP_VERSION__` define |
| `hub-app/src/App.tsx` | Add `SyncStatusBar`, `UpdateBanner`, offline detection context |
| `hub-app/package.json` | Add `dexie` dependency |
| `hub-api/prisma/schema.prisma` | Add `Device`, `PushSubscription` models; add `version`, `deletedAt` to syncable models |
| `hub-api/src/app.ts` | Register sync, devices, push route modules |

## Dependencies

| Package | Version | Size (gzipped) | Purpose |
|---------|---------|----------------|---------|
| `dexie` | ^4.x | ~40KB | IndexedDB wrapper with schema migrations |
| `web-push` | ^3.x | ~15KB (server) | VAPID-based Web Push sending |

## Security Considerations

- Encryption keys never persisted to disk — memory only, re-derived on each app open
- Device revocation immediately invalidates encryption key server-side
- PBKDF2 with 100K iterations makes brute-force key derivation impractical
- Soft-delete ensures sync propagates data removal to all devices
- Push subscription secrets (`p256dh`, `auth`) encrypted at rest per ADR-0082
- VAPID private key stored in Vault per ADR-0083
- Admin revoke wipes all local data on next app open — no residual plaintext
- Device limit (3) bounds the attack surface of lost/stolen devices

## iOS Compatibility Matrix

| Feature | iOS Version | Notes |
|---------|-------------|-------|
| IndexedDB | 10+ | ✅ Fully supported |
| Web Crypto (SubtleCrypto) | 15+ | ✅ AES-256-GCM, PBKDF2, HMAC |
| Service Worker | 11.3+ | ✅ Caching, offline support |
| `navigator.storage.persist()` | 15.2+ | ✅ Prevents eviction |
| Web Push (notifications) | 16.4+ | ⚠️ Installed PWA only |
| `visibilitychange` event | 10+ | ✅ Reliable sync trigger |
| `navigator.onLine` | 10+ | ⚠️ Can be delayed on iOS |
| `crypto.randomUUID()` | 15.4+ | ✅ Device ID generation |

**Minimum supported:** iOS 15+ (full offline + encryption). Push notifications require iOS 16.4+.
