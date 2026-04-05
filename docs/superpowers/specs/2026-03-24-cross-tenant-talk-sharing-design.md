# Cross-Tenant Public Talk Sharing — Design Spec

## Goal

Enable congregations on hubport.cloud to share public talk speakers across tenants with Vault-issued tokens, speaker-controlled privacy, availability management, and support for manual (non-hubport) guest speakers.

## Architecture Overview

```
┌─────────────┐     Vault-signed JWT     ┌─────────────┐
│  Tenant A    │◄────────────────────────►│  Tenant B    │
│  hub-api     │   (7-day TTL, rotated)   │  hub-api     │
│              │                          │              │
│  Speakers    │   GET /sharing/speakers  │  Coordinator │
│  Availability│   POST /sharing/invite   │  Catalog UI  │
│  Privacy     │   POST /sharing/confirm  │  Invitations │
└──────┬───────┘                          └──────┬───────┘
       │                                         │
       └──────────┐              ┌───────────────┘
                  ▼              ▼
           ┌──────────────────────────┐
           │      Central API         │
           │  SharingApproval         │
           │  Token issuance (Vault)  │
           │  Partner discovery       │
           └──────────────────────────┘
```

**Auth model:** Vault-issued sharing JWTs per approved tenant pair. 7-day TTL, auto-rotated. Revoked when partnership is toggled off.

**Data flow:** Tenant-to-tenant via CF Tunnel (Bearer token in header). Central-API brokers trust and token lifecycle only.

## Components

### 1. Publisher Availability (Shared Foundation)

A two-tier availability system reused across all planners.

#### Tier 1: Away Periods (All Publishers)

Every publisher can set date ranges when they're unavailable.

**Model: `AwayPeriod`** (hub-api)
```
id          String    @id @default(uuid())
publisherId String
startDate   DateTime
endDate     DateTime
reason      String?   // vacation, travel, illness, personal (optional, encrypted)
createdAt   DateTime  @default(now())

@@unique([publisherId, startDate, endDate])
```

- Default = available (absence-based, not presence-based)
- Publishers manage their own away periods in Profile → Availability
- Coordinators can view (not edit) any publisher's away periods
- Consumed by: midweek planner (student/assistant assignment), weekend planner (duties), cleaning schedule

#### Tier 2: Speaker Availability (Public Talk Givers)

Speakers who give public talks get additional controls, stored directly on the `Speaker` model (no separate model — see Data Model Summary §8).

- `monthlyInviteCap` on Speaker: max talks per month (default 4)
- Speaker sets cap in Profile → Public Talks: "Max 2 talks per month"
- System calculates: `available = NOT in away period AND monthly cap not reached`
- Coordinator sees in catalog: "M. Kramer · 2/3 talks this month (1 slot open)"
- Cap is advisory — coordinator can override with warning
- Away periods reuse the same `AwayPeriod` model via the Speaker's linked `publisherId`

**Speaker-Publisher link**: Local speakers have `publisherId` (FK to Publisher). Away periods are loaded via `Publisher.awayPeriods`. Manual/hubport speakers have `publisherId = null` and manage availability differently (manual = no availability, hubport = fetched from partner API).

#### Availability Calculation (shared function)

```typescript
function getAvailability(publisherId: string, dateRange: DateRange): AvailableDate[] {
  const awayPeriods = await getAwayPeriods(publisherId, dateRange);
  const meetings = await getScheduledMeetings(publisherId, dateRange);

  // For speakers: also check monthly cap
  const speaker = await getSpeaker(publisherId);
  if (speaker) {
    const monthlyCount = await getMonthlyTalkCount(speaker.id, dateRange);
    // Factor cap into availability
  }

  return computeOpenDates(dateRange, awayPeriods, meetings, speaker?.monthlyInviteCap);
}
```

#### UI: Profile → Availability Tab

- Calendar view showing away periods (red blocks) and scheduled assignments (blue dots)
- "+ Add Away Period" button: start date, end date, reason (optional)
- For speakers: monthly invite cap slider (1-8, default 4)
- Privacy toggle: "Share my availability with partner congregations" (on/off)

### 2. Speaker Privacy Controls

Each speaker controls what personal data is visible to partner congregations.

**Model: `SpeakerPrivacy`** (hub-api, on Speaker)
```
sharePhone        Boolean  @default(false)
shareEmail        Boolean  @default(false)
shareAvailability Boolean  @default(true)
```

- **Name** — always shared (required for scheduling)
- **Talk numbers** — always shared (required for catalog)
- **Phone** — toggle (default: hidden)
- **Email** — toggle (default: hidden)
- **Availability** — toggle (default: shared)
- If contact is hidden, partners see "🔒 Contact via coordinator"
- Managed in Profile → Public Talks → Privacy section

### 3. Sharing Partnerships

Bidirectional trust between two hubport.cloud tenants.

#### Partnership Lifecycle

1. **Request**: Either coordinator sends a partnership request via central-api
2. **Approve**: Other coordinator approves → central-api creates `SharingApproval`
3. **Token Issue**: Central-api generates Vault-signed JWT pair (one per direction)
4. **Active**: Both tenants can browse speakers, send invitations
5. **Revoke**: Either side toggles off → token stops rotating → existing scheduled talks kept, no new invitations

#### Central-API Endpoints (existing + new)

| Endpoint | Method | Description | Status |
|----------|--------|-------------|--------|
| `/sharing/approve` | POST | Request/approve partnership | Exists |
| `/sharing/approve/:rid/:aid` | DELETE | Revoke partnership | Exists |
| `/sharing/approved/:tenantId` | GET | List approved partners | Exists |
| `/sharing/tokens/:tenantId` | GET | **NEW** — Get sharing JWT for a partner | New |
| `/sharing/tokens/:tenantId/rotate` | POST | **NEW** — Force token rotation | New |
| `/sharing/discover` | GET | **NEW** — Search hubport.cloud tenants | New |

#### Vault Token Lifecycle

1. **Issuance**: On partnership approval, central-api creates HMAC-signed JWT using a per-tenant signing secret stored in Vault at `kv/hubport-cloud/{env}/sharing/{tenantA-id}/{tenantB-id}`
2. **Claims**: `{ iss: "hubport-central", sub: tenantA-id, aud: tenantB-id, scopes: ["speakers:read", "invitations:write"], exp: +7d }`
3. **Distribution**: Hub-api fetches sharing tokens from central-api (NOT directly from Vault). Central-api endpoint `GET /sharing/tokens/:tenantId` returns active JWTs for all approved partners. Hub-api calls this on startup + hourly refresh using its runtime token (ADR-0072).
4. **Rotation**: Every 7 days, central-api generates new JWT, stores signing secret in Vault, returns new token to hub-api on next refresh. Old token remains valid for 24h grace period.
5. **Revocation**: Toggle off → central-api deletes signing secret from Vault + sets `SharingApproval.revokedAt`. Additionally, central-api maintains a `revokedPartners` list returned on token refresh, so hub-api can immediately reject requests from revoked partners even if their JWT hasn't expired.

**Self-hosted tenant access**: Hub-api does NOT need direct Vault access for sharing tokens. It uses its existing runtime token (from ADR-0072 bootstrap) to call central-api, which brokers all Vault interactions. This avoids the need for Vault AppRole credentials on every self-hosted tenant.

**Verification on receiving side**: Receiving hub-api validates incoming sharing JWTs by checking the signature against a verification key fetched from `GET /sharing/verification-keys` on central-api (cached locally, refreshed daily). This is similar to JWKS — central-api publishes the public/symmetric keys for each tenant pair.

#### Tenant Discovery

`GET /sharing/discover` on central-api requires a valid tenant runtime token. Returns only tenants that have opted into discoverability (new `discoverable: Boolean` field on Tenant model). Search by congregation name, city. Never reveals tenant IDs or internal details — returns: display name, city, congregation number (optional).

### 4. Speaker Catalog (Hub-API)

Unified view of all speakers: local, hubport-connected, and manually-added.

#### Hub-API Sharing Endpoints (NEW)

Exposed to partner tenants, gated by sharing JWT:

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/sharing/speakers` | GET | Sharing JWT | List speakers (respects privacy settings) |
| `/sharing/speakers/:id/availability` | GET | Sharing JWT | Get open dates for a speaker |
| `/sharing/invite` | POST | Sharing JWT | Send talk invitation to a speaker |
| `/sharing/invite/:id/confirm` | POST | Sharing JWT | Confirm invitation (speaker or coordinator) |
| `/sharing/invite/:id/decline` | POST | Sharing JWT | Decline invitation |

#### Speaker Source Types

| Source | Badge | How Added | Availability | Invitation |
|--------|-------|-----------|-------------|------------|
| 🏠 Local | Amber | Publisher record + speaker flag | Auto (away periods + cap) | Direct schedule |
| 🔗 hubport partner | Green | Fetched via sharing JWT | Auto (from partner API) | Digital invitation flow |
| 📋 Manual | Purple | Coordinator adds individually or CSV import | Manual ("manual scheduling") | Phone/email (out-of-band) |

#### Manual Speaker Management

For congregations not on hubport.cloud:

- **Individual add**: Name, congregation (free text), phone, email, role, talk numbers
- **CSV import**: `firstName, lastName, congregation, phone, email, talkNumbers`
- **No digital invitation** — coordinator manages manually
- **Stored locally** as `Speaker` records with `source: "manual"` and `isLocal: false`

### 5. Invitation Workflow

The receiving congregation (B) invites a speaker from the sending congregation (A).

#### Relationship to PublicTalkSchedule

`SharingInvitation` tracks the cross-tenant negotiation. `PublicTalkSchedule` tracks the local meeting schedule. They are linked:

1. When Cong B sends an invitation → creates `SharingInvitation` (direction: outgoing, state: invited) + `PublicTalkSchedule` (mode: incoming_guest, invitationState: invited)
2. When invitation is confirmed → `SharingInvitation.state = confirmed` + `PublicTalkSchedule.invitationState = confirmed`
3. On Cong A's side: creates `PublicTalkSchedule` (mode: outgoing_guest) only after speaker confirms
4. `SharingInvitation.localScheduleId` links to the local `PublicTalkSchedule` record

For manual speakers (not on hubport.cloud): no `SharingInvitation` — coordinator creates `PublicTalkSchedule` directly with mode `incoming_guest` and manages invitation state manually.

#### Flow

```
Cong B coordinator                    Cong A hub-api                    Speaker (Cong A)
       │                                    │                                │
       ├─── POST /sharing/invite ──────────►│                                │
       │    {speakerId, talkId, date}       │                                │
       │                                    ├─── Notification ──────────────►│
       │                                    │    "Weilheim wants you for     │
       │                                    │     Nr. 67 on Apr 20"          │
       │                                    │                                │
       │                                    │◄── Speaker confirms ───────────┤
       │                                    │    POST /invitations/:id/confirm│
       │◄── Callback: confirmed ────────────┤                                │
       │    Both schedules updated          │                                │
```

#### Invitation States

```
draft → invited → speaker_pending → confirmed
                                  → declined
       → cancelled (from any state)
```

- **speaker_pending**: New state — speaker has been notified, awaiting their personal confirmation
- **Coordinator override**: NOT a state — it's an action. Coordinator can force-confirm from `speaker_pending` state. The `overriddenBy` field records who overrode. Speaker sees "overridden by coordinator" in their view.
- Speaker sees pending invitations in their Profile → Assignments tab
- Coordinator sees all invitations in Sharing → Invitations tab

**Compatibility with existing `InvitationState` enum**: The existing enum (`draft`, `invited`, `confirmed`, `declined`, `cancelled`) is extended with `speaker_pending`. Existing `PublicTalkSchedule` records using the old enum values remain valid — `speaker_pending` only applies to cross-tenant `SharingInvitation` records.

#### Callback Mechanism

When a speaker confirms/declines on Tenant A, the callback to Tenant B uses the sharing JWT:

```
Tenant A hub-api → POST https://api-{tenant-b}.hubport.cloud/sharing/callback
  Headers: { Authorization: Bearer <sharing-jwt-A-to-B> }
  Body: { invitationId, newState: "confirmed"|"declined", speakerName, talkNumber, date }
```

Tenant B's hub-api validates the JWT, updates the local `SharingInvitation`, and notifies the coordinator.

**Offline handling**: If Tenant B is unreachable, Tenant A queues the callback in a `PendingCallback` table (invitationId, payload, retryCount, nextRetryAt). Retries with exponential backoff: 5m, 30m, 2h, 12h, 24h (max 5 retries over 3 days). After max retries, mark as `callback_failed` and notify Tenant A's coordinator.

#### Notification

- In-app notification badge on speaker's profile
- Optional: Matrix chat message to speaker (if chat is configured)
- Coordinator gets notification when speaker confirms/declines

### 6. RBAC

| Action | talk_coordinator | service_overseer | admin | elder | publisher |
|--------|:---:|:---:|:---:|:---:|:---:|
| View sharing partners | ✓ | ✓ | ✓ | ✓ | — |
| Request/approve partnership | ✓ | ✓ | ✓ | — | — |
| Revoke partnership (toggle) | ✓ | ✓ | ✓ | — | — |
| Browse partner speakers | ✓ | ✓ | ✓ | ✓ | — |
| Invite guest speaker | ✓ | ✓ | ✓ | — | — |
| Confirm/decline own invitation | — | — | — | — | ✓ (self only) |
| Override speaker decision | ✓ | ✓ | ✓ | — | — |
| Add/import manual speakers | ✓ | ✓ | ✓ | — | — |
| View shared schedule (read-only) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Manage own availability | — | — | — | — | ✓ (self only) |
| Manage own privacy settings | — | — | — | — | ✓ (self only) |
| Set monthly invite cap | — | — | — | — | ✓ (self, speakers only) |

**New Keycloak role**: `talk_coordinator` — assigned by admin to the publisher responsible for public talk scheduling.

### 7. UI Pages

#### Sharing Partners Page (3 tabs)

**Tab 1: Partners**
- Grid of partner cards (Active, Pending, Incoming, Revoked)
- Active cards: toggle on/off, token status, speaker count, revoke button
- Incoming cards: approve/decline buttons
- "+ Add Partner" button opens congregation search modal

**Tab 2: Speaker Catalog**
- Unified table: all speakers from all sources (local + hubport + manual)
- Columns: Speaker, Source (badge), Talks (number chips), Contact (or 🔒), Availability (date chips), Action (Invite/Schedule)
- Filters: by source, by talk number
- Search: speaker name, congregation, talk number
- "+ Add Speaker" dropdown: Individual / CSV Import
- Legend bar: 🔗 hubport partner, 📋 manual, 🏠 local, 🔒 privacy hidden

**Tab 3: Invitations**
- Incoming section: our speakers requested by others
- Outgoing section: speakers we invited from partners
- Each invitation shows: progress dots (Received → Awaiting speaker → Confirmed), speaker name, talk, date, actions
- Coordinator override button for incoming invitations

#### Profile → Availability (new section)

- Calendar showing away periods + scheduled assignments
- "+ Add Away Period" with date range picker + optional reason
- For speakers: monthly invite cap slider
- Privacy toggles (phone, email, availability sharing)

### 8. Data Model Summary

#### New Models (hub-api)

```prisma
model AwayPeriod {
  id          String    @id @default(uuid())
  publisherId String
  publisher   Publisher @relation(fields: [publisherId], references: [id])
  startDate   DateTime
  endDate     DateTime
  reason      String?   // encrypted
  createdAt   DateTime  @default(now())

  @@unique([publisherId, startDate, endDate])
}

model SpeakerTalk {
  id          String     @id @default(uuid())
  speakerId   String
  speaker     Speaker    @relation(fields: [speakerId], references: [id], onDelete: Cascade)
  publicTalkId String
  publicTalk  PublicTalk @relation(fields: [publicTalkId], references: [id])

  @@unique([speakerId, publicTalkId])
}

model PendingCallback {
  id            String   @id @default(uuid())
  invitationId  String
  targetTenantUrl String
  payload       Json
  retryCount    Int      @default(0)
  nextRetryAt   DateTime
  failedAt      DateTime?
  createdAt     DateTime @default(now())
}

model SharingInvitation {
  id                String           @id @default(uuid())
  localScheduleId   String?          // our PublicTalkSchedule entry
  remoteTenantId    String           // partner tenant ID
  remoteSpeakerId   String?          // speaker ID on partner's side
  speakerId         String?          // local Speaker record (if incoming)
  speaker           Speaker?         @relation(fields: [speakerId], references: [id])
  publicTalkId      String?
  publicTalk        PublicTalk?      @relation(fields: [publicTalkId], references: [id])
  meetingDate       DateTime
  direction         InvitationDirection  // incoming | outgoing
  state             InvitationState
  note              String?          // encrypted
  invitedAt         DateTime?
  speakerRespondedAt DateTime?
  confirmedAt       DateTime?
  declinedAt        DateTime?
  cancelledAt       DateTime?
  overriddenBy      String?          // coordinator who overrode
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt
}

enum InvitationDirection {
  incoming   // partner requested our speaker
  outgoing   // we requested partner's speaker
}

enum InvitationState {
  draft
  invited
  speaker_pending
  confirmed
  declined
  cancelled
}
```

#### Modified Models (hub-api)

```prisma
model Speaker {
  // existing fields (id, firstName, lastName, phone, email, isLocal, status, createdAt, updatedAt)...

  // NEW fields
  publisherId       String?        // FK to Publisher — set for local speakers, null for manual/hubport
  publisher         Publisher?     @relation(fields: [publisherId], references: [id])
  source            SpeakerSource  @default(local)
  congregationName  String?        // encrypted — free text for manual/hubport speakers
  monthlyInviteCap  Int            @default(4)
  sharePhone        Boolean        @default(false)
  shareEmail        Boolean        @default(false)
  shareAvailability Boolean        @default(true)
  talks             SpeakerTalk[]  // which public talks this speaker can give
  invitations       SharingInvitation[]
}

// Away periods are on Publisher, not Speaker. For local speakers:
//   speaker.publisher.awayPeriods (via publisherId FK)
// For manual/hubport speakers: no availability tracking (manual scheduling)

model PublicTalk {
  // existing fields (id, talkNumber, title, outline, discontinued)...
  speakers          SpeakerTalk[]       // NEW: back-relation
  invitations       SharingInvitation[] // NEW: back-relation
}

enum SpeakerSource {
  local      // own congregation publisher
  hubport    // from hubport.cloud partner (federated)
  manual     // manually added (not on hubport.cloud)
}
```

**Migration from `isLocal: Boolean`**: `isLocal = true` → `source = local`, `isLocal = false` → `source = manual`. Drop `isLocal` after migration. The `hubport` source is only set by the federation sync process.
```

#### Central-API Additions

```prisma
model SharingApproval {
  // existing fields...
  revokedAt    DateTime?   // NEW — when partnership was toggled off
  tokenVersion Int @default(0) // NEW — incremented on rotation
}

model SharingToken {
  id            String   @id @default(uuid())
  approvalId    String
  approval      SharingApproval @relation(fields: [approvalId], references: [id])
  issuedAt      DateTime
  expiresAt     DateTime
  vaultPath     String   // kv path where JWT is stored
  rotationCount Int      @default(0)

  @@unique([approvalId])
}
```

### 9. Error Handling

| Scenario | Behavior |
|----------|----------|
| Partner revokes during pending invitation | Invitation auto-cancelled, both notified |
| Speaker declines after coordinator override | Override wins — speaker sees "overridden by coordinator" |
| Token expires mid-request | 401 → hub-api refreshes token from Vault → retry once |
| Partner hub-api unreachable | Queue invitation locally, retry with exponential backoff (max 3 days) |
| Monthly cap exceeded | Warn coordinator, allow override with confirmation |
| CSV import has invalid rows | Import valid rows, return error report for invalid ones |
| Concurrent invitations exceed cap | Optimistic check: count confirmed + pending invitations in month. If cap reached after invite was sent, notify coordinator of over-schedule. No DB-level locking — advisory cap, not hard constraint. |
| Migration from isLocal to SpeakerSource | `isLocal=true` → `source=local`, `isLocal=false` → `source=manual`. Drop `isLocal` column after migration. |

### 10. Security Considerations

- All PII fields (speaker phone, email, reason) encrypted at rest (AES-256-GCM per ADR-0082)
- Sharing JWTs signed by Vault transit engine — hub-api validates signature, not just expiry
- Sharing endpoints validate JWT `aud` claim matches receiving tenant ID
- Rate limit on sharing endpoints: 100 req/min per tenant pair
- Audit log: all invitation actions, partnership changes, privacy setting changes
- Manual speakers: contact info encrypted, not exposed to sharing API

### 11. Implementation Order

1. **Phase 1: Availability Foundation** — AwayPeriod model, Profile UI, midweek planner integration
2. **Phase 2: Speaker Catalog** — SpeakerTalk join model, manual speaker add/import, source badges, catalog table UI, isLocal→SpeakerSource migration
3. **Phase 3: Partnership Trust** — central-api discovery, approval flow, Vault token lifecycle
4. **Phase 4: Federation API** — hub-api sharing endpoints, JWT validation middleware
5. **Phase 5: Invitation Workflow** — digital invitation flow, speaker confirmation, callbacks
6. **Phase 6: Privacy & Polish** — speaker privacy controls, monthly cap, notifications

### 12. Mockups

- Architecture diagram: `.superpowers/brainstorm/87011-1774375217/architecture-overview.html`
- UI mockup (Partners + Catalog + Invitations): `.superpowers/brainstorm/87011-1774375217/sharing-ui-mockup-v3.html`
