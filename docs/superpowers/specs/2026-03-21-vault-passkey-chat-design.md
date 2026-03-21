# Design Spec: Vault Production Mode + Keycloak Passkey Login + LinkedIn-Style Chat

**Date:** 2026-03-21
**Issues:** hubport.cloud #96, #97, #98
**Status:** Draft

---

## Context

Three operational gaps discovered during hubport.cloud UAT deployment:

1. **Vault runs in dev mode** — static root token, volatile storage, no policies. All environments (dev/UAT/prod) must mirror production.
2. **Keycloak login only offers username+password** — passkeys and TOTP are stored in hub-api DB, not Keycloak. Users complete SecurityWizard but subsequent logins don't enforce 2FA.
3. **Chat embeds Element Web via iframe** — functional but looks like a separate app. Needs native LinkedIn-style widget, pre-seeded Spaces, RBAC per channel, cross-tenant federation, Jitsi calls, and profile pictures.

---

## #97 — Vault Production Mode

### Architecture
- **Server mode** with file-based persistent storage (`/vault/data` volume)
- **File-based unseal key** in `.vault-keys` (chmod 600)
- **AppRole auth** for hub-api (not root token)
- **Transit-only policy** — AppRole can only `transit/encrypt/*` and `transit/decrypt/*`

### Installer Changes (`cf-hubport-cloud/src/installer.ts`)

**Vault container config:**
```yaml
vault:
  image: hashicorp/vault:1.15
  cap_add: [IPC_LOCK]
  command: vault server -config=/vault/config/vault.hcl
  volumes:
    - vault-data:/vault/data
    - ./vault-config.hcl:/vault/config/vault.hcl:ro
```

**Generated `vault-config.hcl`:**
```hcl
storage "file" { path = "/vault/data" }
listener "tcp" { address = "0.0.0.0:8200"; tls_disable = 1 }
api_addr = "http://vault:8200"
disable_mlock = true
ui = false
```

**Init sequence (installer bash):**
1. `vault operator init -key-shares=1 -key-threshold=1 -format=json` → save to `.vault-keys`
2. `vault operator unseal $UNSEAL_KEY`
3. `vault secrets enable transit`
4. `vault write -f transit/keys/hubport`
5. Create policy: `transit/encrypt/hubport` + `transit/decrypt/hubport`
6. `vault auth enable approle`
7. Create role `hub-api` with policy
8. Extract `role_id` + generate `secret_id`
9. Write `VAULT_ROLE_ID` + `VAULT_SECRET_ID` to `.env`

**Auto-unseal on restart:** Init container or entrypoint script reads `.vault-keys` and unseals.

### Hub-API Changes (`hub-api/src/lib/vault-client.ts`)
- Replace `VAULT_TOKEN` env var with `VAULT_ROLE_ID` + `VAULT_SECRET_ID`
- Add AppRole login: `POST /v1/auth/approle/login` → get client_token
- Cache token, auto-renew before TTL expiry (1h TTL, 4h max)
- Fallback: if `VAULT_TOKEN` is set (legacy), use it directly (backwards compat)

### .env Changes
```diff
- VAULT_TOKEN=<root-token>
+ VAULT_ROLE_ID=<role-id>
+ VAULT_SECRET_ID=<secret-id>
```

---

## #96 — Keycloak Passkey Login

### Architecture Decision: Keycloak-Only Storage
- **Both passkeys AND TOTP stored in Keycloak** (not hub-api DB)
- Hub-api `WebAuthnCredential` table → removed
- Hub-api `SecuritySetup.totpSecret` → removed (Keycloak stores TOTP)
- Hub-api `SecuritySetup` table → status tracker only (`passwordChanged` flag)

### Keycloak Browser Flow Configuration

**Installer adds via `kcadm.sh`:**

1. Configure WebAuthn Passwordless policy:
   - RP Entity Name: `hubport`
   - RP ID: `$SUBDOMAIN.hubport.cloud`
   - Algorithms: ES256
   - Authenticator: platform
   - Resident Key: required
   - User Verification: required

2. Copy browser flow → `browser-webauthn`:
   - Username form: REQUIRED
   - Password form: ALTERNATIVE
   - WebAuthn Passwordless: ALTERNATIVE
   - Conditional OTP: CONDITIONAL (prompts if user has OTP credential)

3. Set as realm browser flow: `browserFlow=browser-webauthn`

### Login Flow

**First login (no 2FA):**
```
Username + Password → SecurityGate → SecurityWizard (register passkey + TOTP in Keycloak)
```

**Subsequent logins (2FA configured):**
```
Option A: Passkey (fingerprint/Face ID) → logged in
Option B: Username + Password → OTP prompt → logged in
```
Password-only login is **blocked** once 2FA credentials exist in Keycloak.

### SecurityWizard Changes (`hub-api/src/routes/security.ts`)

**Passkey registration:**
- Currently: stores in `WebAuthnCredential` table
- New: calls Keycloak Admin API to register WebAuthn credential
- Keycloak API: `POST /admin/realms/hubport/users/{userId}/credentials`

**TOTP setup:**
- Currently: stores `totpSecret` in `SecuritySetup` table, verifies locally
- New: calls Keycloak Admin API to configure OTP
- Keycloak handles TOTP verification at login time

**Status check (`GET /security/status`):**
- Query Keycloak Admin API for user credentials (WebAuthn count, OTP configured)
- Still check `passwordChanged` from local `SecuritySetup` table

### Database Migration
- Drop `WebAuthnCredential` table
- Remove `totpSecret`, `totpEnabledAt` from `SecuritySetup`
- Keep `passwordChanged`, `passwordChangedAt`

---

## #98 — LinkedIn-Style Chat Widget

### Architecture
- **Bottom-right popup widget** (not full page, not iframe)
- **`matrix-js-sdk`** for Synapse communication (replaces Element Web)
- **Full-screen overlay on mobile** (< 768px breakpoint)
- **No Element Web container** — custom React chat UI only
- **Jitsi Meet** for voice/video calls (1:1 + group)
- **Profile pictures** synced to Matrix user avatar

### Widget States
1. **Collapsed**: Floating amber chat bubble (bottom-right), unread badge count
2. **Expanded**: Conversation list (380px wide popup)
3. **Thread open**: Split view — list left, messages right (or replace list on mobile)
4. **Full-screen** (mobile): Overlay covering entire viewport

### UI Design
- **Glassmorphism**: Dark glass background, subtle border glow, `backdrop-filter: blur(20px)`
- **Amber accent**: Gradients, badges, active indicators (#d97706 → #b45309)
- **Pill tabs**: Alle | Spaces | DMs | Ungelesen
- **Tree view Spaces**: Collapsible sections with nested channels
- **RBAC badges**: Role requirement tag per channel (no read-only — if visible, writable)

### Pre-Seeded Spaces

| Space | Icon | Channels | Access | Admin |
|-------|------|----------|--------|-------|
| Versammlung | 🏛️ | #allgemein, 🔒#älteste, #predigtdienst | All publishers (älteste = elder only) | Coordinator |
| Dienste | ⚙️ | #technik, #ordnungsdienst, #reinigung, #garten | Per AppRole | Technik Resp. / Coordinator |
| Dienstgruppen | 📋 | Auto-created per service group | Group members | Service Group Overseer |

### Cross-Tenant Spaces
- **Federation whitelist**: `*.hubport.cloud` only (no external domains)
- **Permission**: `chat:crossTenant` required to create/join
- **Badge**: 🌐 CROSS-TENANT label on federated spaces
- **Who**: Coordinator, Secretary, Service Overseer by default
- **Invite**: Space admin invites publishers from other tenants by Matrix ID

### Service Spaces (Time-Bound)
- **Creator**: `privilege:serviceMeetingConductor` role (`chat:createServiceSpace` permission)
- **Purpose**: Temporary space for a specific service activity
- **Content**: Meeting point, time, territory, car groups, notes
- **Invite**: Conductor picks publishers (from service group or all active)
- **Lifecycle**: Active → event date passes → auto-delete after 7 days
- **No archive**: Fully deleted to save storage (no audit trail for temporary events)

### DM Permissions
- **Default**: All active publishers can DM any active publisher (same tenant)
- **Elder toggle**: Settings page toggle to restrict DMs (elder can disable/enable for entire tenant)
- **Cross-tenant DMs**: Require `chat:crossTenant` role
- **No external DMs**: Federation whitelist blocks non-hubport domains

### Voice/Video Calls
- **Jitsi Meet** self-hosted in tenant Docker stack
- **1:1 calls**: Native WebRTC via Jitsi widget in DM thread
- **Group calls**: Jitsi conference room created per space
- **Elder toggle**: Settings page toggle to enable/disable video calls for entire tenant (default: enabled)
- **Installer**: Adds `jitsi` container to docker-compose

### Chat RBAC Permissions

| Permission | Scope | Default Roles |
|------------|-------|---------------|
| `chat.view` | Read messages in joined spaces | All publishers |
| `chat.send` | Send messages where write granted | All publishers |
| `chat.createSpace` | Create new spaces | Coordinator, Secretary |
| `chat.createServiceSpace` | Create time-bound service spaces | Service Meeting Conductor |
| `chat.createCampaign` | Create campaign spaces (preaching + territory) | Elder, Service Overseer |
| `chat.crossTenant` | Create/join cross-tenant spaces | Coordinator, Secretary, Service Overseer |
| `chat.invite` | Invite members to spaces (admin) | Space admin (overseer) |
| `chat.manageDMs` | Toggle DM permissions for tenant | Elder |

### Channel Access Rule
**If you can see a channel, you can write in it.** No read-only access concept. Visibility = full participation.

### Channel Badges
- **Role tag** (muted): Which AppRole grants access (e.g., `Technik`, `Elder`, `Reinigung`)
- **Aufseher** (amber): Space admin (manage members, settings)
- **CROSS-TENANT** (yellow border): Federated across hubs

### Campaign Spaces

**Special Preaching Campaigns:**
- Created by Elder or Service Overseer (`chat:createCampaign`)
- **Invite-based** (not auto-join): All active publishers receive invitation notification
- Each publisher responds: **Teilnehmen** (accept) / **Nicht verfügbar** (unavailable)
- Only accepted publishers are added to the campaign space
- Creator sees participation overview (accepted / declined / pending)
- Contains: campaign goals, schedule, territory assignments, progress updates
- Auto-delete 7 days after campaign end date

**Campaign Templates:**
- Gedächtnismahleinladung (annual memorial invitation)
- Einladung Kongress (regional/circuit convention invitation)
- Predigtdienstaktion `<Datum>` (special preaching action with date)
- Benutzerdefiniert (custom title + date range)

**Territory Campaigns:**
- Auto-created when territory assigned to a group/publisher
- Linked to Territory model (`territoryId`)
- Contains: territory map reference, block assignments, notes, do-not-call updates
- Closed when territory returned
- Auto-delete 7 days after return date

### Profile Pictures
- Add `avatarUrl: String?` to Publisher Prisma model
- Upload in PublisherForm (profile section)
- Store as base64 data URL or R2 object URL
- Sync to Matrix user avatar via Synapse Admin API on change
- Used in: chat avatars, publisher list, profile dropdown

### New Dependencies
- `matrix-js-sdk` — Matrix client SDK
- `@jitsi/react-sdk` or Jitsi iframe API — voice/video calls
- Image upload/resize library (e.g., `browser-image-compression`)

### Docker Stack Changes (installer)
- **Remove**: `element` container (Element Web no longer needed)
- **Add**: `jitsi` container (Jitsi Meet for calls)
- **Keep**: `synapse` container (Matrix homeserver, unchanged)

### Files to Create/Modify

**New files (hub-app):**
- `src/components/chat/ChatWidget.tsx` — main widget container + state management
- `src/components/chat/ConversationList.tsx` — left panel with search, tabs, space tree
- `src/components/chat/MessageThread.tsx` — right panel with messages + input
- `src/components/chat/SpaceTree.tsx` — collapsible space/channel tree
- `src/components/chat/MessageInput.tsx` — input bar with attachments + send
- `src/components/chat/CallControls.tsx` — Jitsi call UI
- `src/lib/matrix-client.ts` — matrix-js-sdk wrapper (init, sync, send, etc.)

**New files (hub-api):**
- `src/lib/matrix-admin.ts` — Synapse Admin API client (create user, room, space)
- `src/lib/matrix-rooms.ts` — pre-seeded space/room definitions + auto-provisioning
- `src/routes/chat.ts` — chat settings API (DM toggle, etc.)

**Modified files:**
- `hub-app/src/components/Header.tsx` — chat bubble icon (already done)
- `hub-app/src/components/Layout.tsx` — render ChatWidget
- `hub-app/src/components/Sidebar.tsx` — Chat removed (already done)
- `hub-api/src/lib/permissions.ts` — new chat permissions (partially done)
- `hub-api/src/lib/seed-roles.ts` — chat permissions on roles (partially done)
- `hub-api/prisma/schema.prisma` — avatarUrl field, remove WebAuthnCredential
- `hub-api/src/routes/security.ts` — Keycloak-only passkey/TOTP
- `hub-api/src/lib/vault-client.ts` — AppRole auth

---

## Implementation Order

| Phase | Issue | Scope | Effort |
|-------|-------|-------|--------|
| 1 | #97 | Vault production mode (installer + vault-client) | Small |
| 2 | #96 | Keycloak passkey login (installer + security routes + migration) | Medium |
| 3 | #98a | Chat widget UI (matrix-js-sdk + React components) | Large |
| 4 | #98b | Pre-seeded Spaces + RBAC + campaigns (matrix-admin + auto-provisioning) | Medium |
| 5 | #98c | Cross-tenant federation + service spaces + campaigns | Medium |
| 6 | #98d | Jitsi calls + profile pictures | Small |
| 7 | LP | Landing page chat showcase (cf-hubport-cloud) | Small |

---

## Landing Page Update (cf-hubport-cloud)

Update the CF Worker landing page to showcase the chat feature:

### Home Page — New Trust Card
- Icon: 💬 MessageCircle
- Title: "E2E-verschlüsselter Chat"
- Text: Built-in congregation messaging with Spaces, DMs, voice/video calls. Self-hosted, GDPR-compliant.

### Features Page — Chat Section
- **Screenshot mockup** of the chat widget (generated HTML, no real user data)
  - Use placeholder names: "Max Mustermann", "Anna Schmidt"
  - Generic messages: "Wann ist Diensttreff?", "Samstag 10 Uhr"
  - Show Spaces tree with pre-seeded channels
- Feature bullets: E2E encryption, Spaces for duty teams, DMs, voice/video calls, cross-tenant federation, campaign chats, auto-provisioning
- Comparison line: "Deine Nachrichten bleiben auf DEINEM Server — nicht bei WhatsApp oder Telegram"

### FAQ Entry
- Q: "Enthält hubport.cloud internen Chat?"
- A: Yes, Matrix-based E2E encrypted chat with Spaces, DMs, calls. Single sign-on. Self-hosted.

---

## ADRs to Update/Create
- **New ADR**: Chat architecture — matrix-js-sdk custom widget vs Element iframe
- **New ADR**: Cross-tenant federation whitelist policy
- **Supersede ADR-0077**: Passkey storage → Keycloak-only (was hub-api DB)
- **Update CLAUDE.md**: Chat RBAC permissions, Vault AppRole, Keycloak WebAuthn flow

## Verification
- Vault: `vault status` shows server mode, AppRole login works, encrypt/decrypt succeeds
- Passkey: Keycloak login shows "Sign in with Passkey", passkey login works, OTP enforced on password login
- Chat: Widget opens, Spaces visible, messages send/receive in real-time, DMs work
- Calls: 1:1 Jitsi call connects, group call in space works
- Cross-tenant: CROSS-TENANT space visible, messages federate between tenants
- Mobile: Full-screen overlay on phone-width viewport
