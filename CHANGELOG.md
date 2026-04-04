# Changelog
Format: [CalVer](https://calver.org/) — `YYYY.MM.DD.TS`

## v2026.04.04.24

### Fix: H3 Hex Grid Resolution & Concurrency
- fix: reduce H3 resolution from 8 to 7 — 265 hexes → ~38 hexes for congregation polygon
- fix: batch 3 concurrent Overpass queries per round with 1.5s inter-batch delay
- fix: resolves "Failed to fetch" timeout on gap detection run (~265s → ~20s)

## v2026.04.04.23

### H3 Hexagonal Grid for Overpass Spatial Tiling
- feat: H3 hex grid engine (`hub-api/src/lib/hex-grid.ts`) — polygonToHexes, hexToBBox, hexToGeoJSON, subdivideHexes, pointToHex, hashBoundary (#296)
- feat: `queryBuildingsInPolygon()` in osm-overpass.ts — hex-based Overpass tiling replaces bbox queries
- feat: `HexGridCache` Prisma model for caching hex computations per boundary+resolution
- feat: gap detection route now uses H3 hex tiling instead of bounding box queries
- feat: 14 unit tests for hex-grid engine
- fix: Overpass 504 timeouts on large congregation boundaries (~20km × 20km)

## v2026.04.03.11

### Gap Detection Filter & Auto-Fix Bugs
- feat: add building type filter chips to gap detection sidebar (toggle shed, barn, commercial, etc.)
- fix: handle MultiPolygon geometry in territory edit mode (Edit button stops working after first save)
- fix: bulk fix uses `runAutoFixPipeline`, matching single-fix behavior (was failing with inline PostGIS)
- fix: Branch-KML-Import file picker accept attribute (macOS text/plain MIME type)

## v2026.04.03.9

### Territory Management Features
- feat: **Delete Boundary** — kebab menu on TerritoryDetail to delete a territory polygon without removing the territory itself (`DELETE /territories/:id/boundaries`)
- feat: **Branch KML Import** — new import card to update existing territory boundaries by matching territory numbers from branch-tool KML files (`POST /territories/import/kml/branch`)
- feat: **Bulk Fix Violations** — fix mode on map view to select and auto-fix multiple violated territories at once (`POST /territories/fix/bulk`)
- refactor: extract KML parser into shared `kml-parser.ts` utility
- feat: i18n keys for all three features (EN + DE)
- chore: bump version to 2026.04.03.9

## v2026.04.03.8

### Territory Polygon Export
- feat: add KML 2.2, GeoJSON (RFC 7946), GPX 1.1 client-side export for territory polygons
- feat: add server-side PDF map export via Puppeteer + pdfkit (satellite + street styles)
- feat: ExportDropdown component on TerritoryDetail page (single territory export)
- feat: checkbox selection + export toolbar on TerritoryList page (bulk + export all)
- feat: `TERRITORIES_EXPORT` permission for RBAC-controlled export access
- feat: i18n messages for export UI (EN + DE)
- feat: POST /territories/export/pdf endpoint with ZIP streaming
- chore: add Chromium to Dockerfile for headless PDF rendering
- chore: add puppeteer-core, pdfkit, archiver dependencies
- chore: bump version to 2026.04.03.8

## v2026.04.03.7

### Gap Detection — Ignore Visibility Fix + Map Style Zoom Preservation
- fix: ignored buildings now properly disappear from map — backend `/runs` endpoint filters out ignored osmIds from resultGeoJson before returning
- fix: `gapCount` on runs updated to reflect filtered results
- fix: map zoom and center preserved when switching between Street/Satellite/OSM styles
- chore: bump version to 2026.04.03.7

## v2026.04.03.6

### Gap Detection — Shift+Drag and Ignore Fixes
- fix: disable MapLibre BoxZoom so shift+drag rectangle selection no longer triggers map zoom-out
- fix: ignored buildings now properly disappear from map after bulk ignore (force refresh gap markers)
- fix: per-batch error handling — failed batches are logged but remaining batches continue
- chore: align package.json version with CalVer release tags (prevents version drift)

## v2026.04.03.5

### Territory Detail — Clip Segment Tool
- feat: add Clip button to territory detail page (alongside Edit) for segment-based boundary alignment
- feat: click two vertices to define a segment, then clip to nearby roads, neighbors, or congregation boundary
- feat: preview clipped polygon before saving — user must approve with Save/Cancel
- feat: "Straighten" option replaces segment with direct line between endpoints
- feat: snap context cached after first fetch to avoid repeated Overpass API calls
- feat: resilient to Overpass API failures (429/504) — continues with neighbor/boundary targets only
- fix: vertex markers use outer/inner div pattern to prevent MapLibre transform conflicts
- fix: vertex click uses ref to avoid stale closure in useCallback
- fix: Edit button works correctly after canceling clip mode

## v2026.04.03.4

### Gap Detection — Fix console layer errors
- fix: use `map.getLayer()`/`map.getSource()` existence check instead of try-catch for layer cleanup
- Eliminates "Cannot remove non-existing layer" console errors on gap detection page

## v2026.04.03.3

### Territory Editor — Clip Segment Tool (#288)
- feat: new "Clip" tool in territory editor toolbar for segment-based boundary alignment
- feat: select two vertices to define a boundary segment, then clip to nearest road, neighbor, or boundary
- feat: "Straighten" option replaces segment with direct line between endpoints
- feat: full undo/redo integration for clip operations
- feat: floating panel shows available clip targets ranked by proximity
- deps: add @turf/nearest-point-on-line, @turf/line-slice, @turf/helpers, @turf/length

## v2026.04.03.2

### Gap Detection Bugfixes (#286)
- fix: bulk ignore returns 400 when selecting >200 buildings — now chunks into batches of 200
- fix: filter out features with missing osmId before sending ignore request
- fix: remove orphaned `gap-markers-border` layer cleanup that caused console errors

## v2026.04.03.1

### Gap Detection — Shift+Drag Bulk Ignore (#284)
- feat: shift+drag rectangle selection on gap detection map to bulk-ignore buildings
- Hold Shift + drag to draw selection rectangle, buildings inside are highlighted yellow
- Auto-switch to satellite view for visual verification
- Confirmation bar with reason picker and Ignore/Cancel buttons
- Uses existing batch ignore API (up to 200 buildings per call)
- chore: publisher form refactor, sync fixes, device routes, i18n updates

## v2026.04.02.3

### Admin Password Reset (#282)
- feat: `POST /api/publishers/:id/reset-password` — email-first with temp password fallback
- feat: in-memory rate limiter (3 requests/hour/publisher)
- feat: Reset Password button on publisher detail page (elder-only)
- feat: one-time-display dialog for temporary password with copy-to-clipboard
- feat: i18n strings for reset password UI (en-US, de-DE)

## v2026.04.01.16

### Map fixes + upgrade instructions (#275)
- fix: Gap Detection page not displaying territory polygons or congregation boundary
  - Fetch territories with `type=all` to include congregation_boundary records
  - Fix race condition: `layersAdded.current` prevented layer re-add when territories arrived after map load
- fix: ViolationBadges — use dynamic maplibre-gl import for Marker (same fix as TerritoryDetail)
- feat: add upgrade instructions to Settings page with copy-to-clipboard commands

## v2026.04.01.14

### Inline Polygon Editing Fix (#273)
- fix: wire up inline polygon editing on TerritoryDetail — edit button was noop
- feat: draggable MapLibre vertex markers on polygon in edit mode
- feat: Save/Cancel buttons with live polygon preview during drag
- feat: auto-fix pipeline (congregation clip, neighbor clip) on save

## v2026.04.01.13

### Territory Editor Enhancement (#271)
- feat: smart creation flow — draw polygon → auto reverse-geocode city → suggest territory number by group prefix
- feat: `POST /territories/suggest` endpoint with Nominatim city detection and number suggestion
- feat: `CreateTerritoryModal` with pre-filled city/number and group hint (e.g., "5xx — Antdorf")
- feat: batch Snap All — snap all vertices to nearest targets with preview → Accept / Revert
- feat: `snapAll()` function in SnapEngine with `SnapReport` per vertex
- feat: expose `targets` and `tolerance` from `useSnapEngine` hook for batch operations
- fix: edit button always visible (disabled when no permission) instead of hidden
- fix: ViolationBadges loading/error/empty state indicators instead of silent failure

## v2026.04.01.12

### Bug Fixes (#269)
- fix: create PostGIS extension on startup (was missing, caused 500 on violations/spatial queries)
- fix: rewrite CreationFlow to draw on maplibre map (was blank white div with fake coordinates)
- fix: ViolationBadges reactivity — gate map prop on isLoaded state
- fix: show map container during creation mode (was h-0 when no boundary)
- fix: graceful fallback when PostGIS unavailable (skip spatial validation, return empty violations)

## v2026.04.01.11

### Territory Polygon Fixes (#267)
- feat: PostGIS auto-fix pipeline — validate → congregation clip → neighbor clip → overlap detect
- feat: preview-before-save modal showing original vs clipped boundaries
- feat: non-destructive boundary versioning with restore capability
- feat: violation warning badges on territory map (red = exceeds boundary, amber = overlap)
- fix: Edit polygon — add Edit button in TerritoryDetail (permission-gated)
- fix: New Territory creation — modal with number + name (replaces broken `?draw=true`)
- feat: Territory Servant seed role + flag mapping
- feat: auto-mapped vs manual role display in publisher Roles tab
- feat: v1 boundary version bootstrap for existing territories on startup

## v2026.04.01.10

### Address API response mapper + superpowers docs (#265)
- feat: add `toApiAddress()` response mapper normalizing Prisma fields for frontend
- feat: add `languageSpoken` compat alias to AddressUpdateBody
- docs: add superpowers plan and spec for Field Work Mode

## v2026.04.01.9

### Field Work Mode (#264)
- feat: GPS-sorted proximity list with Haversine distance, 5s re-sort, freeze toggle
- feat: one-tap QuickActionBar for visit logging (6 outcomes)
- feat: full-screen mobile FieldWorkMode with bottom sheet UX (collapsed/peek/expanded)
- feat: Apple Maps-style blue dot with heading cone + accuracy circle (MyLocationMarker)
- feat: overseer FieldWorkDashboard — real-time map of publishers sharing location
- feat: GPS tracker hook with compass heading (iOS + Android), accuracy, speed
- feat: heading/accuracy fields on LocationShare, joinCode on CampaignFieldGroup
- feat: active-locations endpoint, join-by-code, generate-code, auto-timeout cleanup
- feat: FIELD_WORK_GPS + FIELD_WORK_OVERSEER permissions, Service Overseer seed role
- fix: MapLibre marker memory leak in dashboard (proper Marker.remove())
- fix: async race condition guard in MyLocationMarker initMarker

## v2026.03.31.18

### Territory Module (#262)
- feat: 22 new permission constants, dynamic campaign-based permissions in PolicyEngine
- feat: 15 new Prisma models (Address, AddressVisit, LocalOsmFeature, CampaignFieldGroup, LocationShare, TerritoryShare, ShareAccessLog, etc.)
- feat: PostGIS migration for spatial queries, Redis service for BullMQ
- feat: SnapEngine with priority-based snapping, undo/redo, vertex/midpoint handles
- feat: Territory editor with creation flow (click-to-place + freehand lasso) and split flow (scissors)
- feat: Address CRUD with DNC auto-revert, visit logging, bulk operations
- feat: BullMQ OSM refresh worker, gap detection with ignore list, 6-mode heatmaps
- feat: KML/CSV import for territories and addresses
- feat: Campaign lifecycle (draft/active/closed/archived), adaptive due dates, field groups
- feat: Location sharing with consent dialog, duration picker, auto-expiry
- feat: Kanban board with drag-and-drop assignment, publisher sidebar
- feat: Campaign management UI (list, wizard, detail), meeting point manager
- feat: Campaign reports with per-territory/publisher/meeting-point breakdowns, CSV export
- feat: SHA-256 share links with PIN protection, central discovery with Haversine
- feat: Depth-filtered territory sync, sharing frontend (create/revoke/redeem)
- feat: Tenant discovery fields and SharedTerritory.syncedAt in central-api
- fix: Share PIN via POST body (not query string), pepper env vars enforced in production
- fix: PostGIS image (postgis/postgis:16-3.4-alpine), Redis healthcheck, composite indexes
- 69 vitest tests, TypeScript clean across all packages

## v2026.03.31.12

### Fix invite KC user missing name fields (#258)
- fix: pass firstName/lastName from publisher record to `createInvitedKeycloakUser`
- fix: also set name on existing user in 409 path
- Without this, Keycloak shows "Update Account Information" with empty name fields

## v2026.03.31.11

### Invite onboarding — show temp password + credential setup flow (#258)
- feat: `createInvitedKeycloakUser` returns temp password alongside userId
- feat: redeem endpoint returns `tempPassword` to frontend
- feat: CompletionStep shows temp password (toggle visibility, copy) and login button
- feat: after login, Keycloak enforces: password change → TOTP → passkey registration
- i18n: credential setup instructions in DE/EN

## v2026.03.31.10

### Fix publisher delete Bad Request (#258)
- fix: DELETE request sent `Content-Type: application/json` with no body — Fastify rejects empty JSON
- fix: strip Content-Type header from publisher delete fetch (same pattern as role delete)

## v2026.03.31.9

### Fix invite 409 — enforce required actions on existing KC user (#258)
- fix: when reusing existing Keycloak user (409), set requiredActions (UPDATE_PASSWORD, CONFIGURE_TOTP, webauthn-register-passwordless) and reset temp password
- Without this, re-invited users skip password change, TOTP, and passkey setup

## v2026.03.31.8

### Fix invite redeem 409 — Keycloak user already exists (#258)
- fix: `createInvitedKeycloakUser` threw 500 on Keycloak 409 (user exists from previous invite)
- fix: handle 409 by looking up existing user by email instead of failing

## v2026.03.31.7

### Fix service groups encrypted names + overseer/assistant (#258)
- fix: service groups showed encrypted ciphertext instead of publisher names — Prisma extension doesn't decrypt nested includes
- fix: export `decryptPublisherFields()` and call manually for nested Publisher records in service group endpoints
- feat: replace string-based overseer/assistant with Publisher FK relations (`overseerId`, `assistantId`)
- feat: overseer/assistant dropdowns per service group card in frontend
- i18n: add Gruppenaufseher / Gruppengehilfe translations

## v2026.03.31.6

### Fix invite wizard privacy step "Ungültiger Schritt" (#256)
- fix: `accept-privacy` endpoint required `onboardingStep === "security"` but invite wizard skips security step
- fix: now accepts `"user_info"` or `"security"` — Keycloak handles security via requiredActions

## v2026.03.31.5

### Fix Matrix RBAC — ministerial_servant never matched (#254)
- fix: `shouldJoinRoom()` compared `"ministerialServant"` (camelCase) but Prisma enum is `"ministerial_servant"` (snake_case)
- fix: applied in both `matrix-rooms.ts` and `matrix-provisioning.ts`

## v2026.03.31.4

### Publisher edit UI — resend invite, delete user, polish (#252)
- fix: resend invite returns 400 — Fastify rejects empty JSON body when Content-Type is set
- fix: all status actions (approve/reject/deactivate/reactivate) send empty body `{}`
- feat: admin can delete a publisher with full cascade cleanup (DB + Keycloak user)
- feat: danger zone section with delete confirmation on publisher edit page
- fix: add `onDelete: Cascade` to TerritoryAssignment, Notification, CampaignInvite
- fix: add `onDelete: SetNull` to MeetingAssignment (assignee/assistant), Speaker
- polish: status bar wraps on small screens, resend button visual feedback, error on own line

## v2026.03.31.3

### Fix invited user onboarding — password policy compliance (#250)
- fix: `createInvitedKeycloakUser()` temp password doesn't meet KC policy — `randomUUID()` has no uppercase/special chars
- fix: add CONFIGURE_TOTP + webauthn-register-passwordless to requiredActions for invited users

## v2026.03.31.2

### Fix German translation for midweek overseer (#248)
- fix: rename "LAD-Aufseher" to "Leben und Dienst Aufseher" in de-DE.json

## v2026.03.26.9

### Mandatory Keycloak auth — remove custom WebAuthn/TOTP (#241)
- feat: remove `@simplewebauthn/server`, `otpauth`, `qrcode` from hub-api (ADR-0086)
- feat: remove `@simplewebauthn/browser` from hub-app
- feat: remove `@simplewebauthn/server`, `argon2`, `otpauth`, `qrcode` from central-api; add `openid-client`
- feat: delete SecurityGate, SecurityWizard, SecurityStep (hub-app)
- feat: delete custom security routes — passkey, TOTP, password policy (hub-api)
- feat: delete custom auth files — passkey.ts, totp.ts, setup.ts, mfa-setup.ts (central-api)
- feat: rewrite `requireSecurityComplete()` to check Keycloak `requiredActions` via Admin API (fail-closed)
- feat: rewire profile security endpoints to Keycloak Admin API (hub-api)
- feat: rewrite central-api login/auth for Keycloak OIDC (openid-client)
- feat: remove WebAuthnCredential, SecuritySetup Prisma models (hub-api)
- feat: remove TenantPasskey, clean TenantAuth, add keycloakUserId (central-api)
- feat: clean up 35+ unused i18n security keys (hub-app)

## v2026.03.26.8

### Fix Matrix client auth — use Synapse admin login (#238)
- fix: frontend was using Keycloak OIDC token as Matrix access token — Synapse rejects it
- feat: add `getMatrixUserToken()` using Synapse Admin API `POST /users/{userId}/login`
- fix: `POST /chat/ensure` now returns `matrixAccessToken` + `matrixUserId`
- fix: ChatWidget awaits `/chat/ensure` response and uses real Matrix token for SDK init

## v2026.03.26.6

### Chat auth fix, DM picker, Matrix provisioning (#235)
- fix: add `/chat`, `/jitsi`, `/away-periods` to auth `API_PREFIXES` — fixes 401 on chat routes
- feat: add `NewDMPicker` component for creating direct messages between publishers
- feat: add `matrix-provisioning.ts` for space/user provisioning on first boot
- feat: add chat routes (`/chat/dm`, `/chat/members`, `/chat/spaces/provision`, `/chat/ensure`)
- feat: resizable chat widget with Matrix OIDC init and unread counts
- feat: `ConversationList` with SpaceTree, tab filtering (Alle/Spaces/DMs/Ungelesen)
- feat: add `InviteCode` model to Prisma schema for invite tracking
- chore: publisher form resend invite improvements

## v2026.03.26.5

### Dashboard vault unseal guide + matrix-admin vault integration (#233)
- chore: add collapsible Maintenance section to portal dashboard with Vault unseal instructions after server reboot
- fix: `matrix-admin.ts` loads Synapse secrets from Vault via `vault-client` (ADR-0083) instead of `process.env`
- fix: change installer command from `sh` to `bash` in dashboard and email templates
- Related: itunified-io/cf-hubport-cloud#123 (installer cleanup removal)

## v2026.03.26.2

### Fix: Sharing resolve rejects APPROVED tenants + dynamic version display (#227)
- fix: sharing resolve/request endpoints now accept both `APPROVED` and `ACTIVE` tenant statuses (was `ACTIVE` only — UAT tenants are `APPROVED`)
- feat: dynamic version display via `runtime-config.js` — sidebar reads version from `window.__HUBPORT_CONFIG__` at container startup instead of hardcoded constant
- chore: `docker-entrypoint.sh` injects `version` from `package.json` into runtime config
- chore: add `getAppVersion()` to `hub-app/src/lib/config.ts`

## v2026.03.26.1

### Fix: Sharing routes return 401 — missing from API_PREFIXES + API token provisioning (#227)
- fix: add `/sharing` to `API_PREFIXES` in hub-api auth middleware (JWT was never verified for sharing routes)
- feat: `POST /admin/internal/provision-api-token` endpoint (central-api) for programmatic M2M token creation

## v2026.03.25.2

### Fix: docker-compose template missing HUBPORT_TENANT_ID and HUBPORT_API_TOKEN (#225)
- fix: rename `TENANT_ID` → `HUBPORT_TENANT_ID` in docker-compose.yml (name mismatch with hub-api code)
- fix: add `HUBPORT_API_TOKEN` to docker-compose.yml (needed for sharing + token rotation)
- fix: update `.env.example` with correct variable names

## v2026.03.25.1

### Fix: Sharing partner connection returns Unauthorized (#223)
- fix: add `apiTokenAuth` guards to all central-api `/sharing/*` routes
- fix: hub-api sharing routes now include Authorization header when calling central-api
- feat: `POST /sharing/request` + `GET /sharing/resolve/:subdomain` (central-api)
- fix: `/sharing` route PermissionGuard uses `app:sharing.view` (was `app:settings.view`)

## v2026.03.24.25

### Feat: Publisher Availability + Speaker Catalog Foundation (#222)
- feat: AwayPeriod model — publishers mark date ranges as unavailable (encrypted reason)
- feat: away-periods CRUD routes (GET/POST/DELETE) with RBAC permissions
- feat: shared `getPublisherAvailability()` utility — reused by midweek, weekend, public talk planners
- feat: AvailabilitySection component in Profile page (add/delete away periods)
- feat: SpeakerTalk join model — maps speakers to their public talk repertoire
- feat: SpeakerSource enum (local/hubport/manual) replacing boolean `isLocal`
- feat: Speaker privacy fields (sharePhone, shareEmail, shareAvailability)
- feat: Speaker monthlyInviteCap (default 4, set in profile)
- feat: Speaker publisherId FK for local speaker → publisher link
- feat: Enhanced speakers route with talk numbers, source filter
- feat: POST /speakers/import-csv for bulk CSV import of manual guest speakers

## v2026.03.23.5

### Installer E2E Fixes — Invite, RBAC, Encryption, JWT
- fix: bootstrap assigns Admin AppRole (WILDCARD) to hub owner (#188, #190)
- fix: invite redeem passes decrypted email to Keycloak (#191, #192)
- fix: add findUniqueOrThrow/findFirstOrThrow to encryption READ_ACTIONS (#191)
- fix: await async generateOnboardingToken — fastify/jwt sign returns Promise (#191)
- fix: use standalone fast-jwt signer for onboarding tokens (JWKS can't sign) (#191)

## v2026.03.23.4

### Fix: Password verification bypasses 2FA required actions (#188)
- fix: verifyPassword() temporarily clears Keycloak requiredActions before password grant
- Restores requiredActions in finally block (always, even on error)
- Fixes SecurityGate deadlock: password change blocked by CONFIGURE_TOTP

## v2026.03.23.1

### Publisher Bootstrap Endpoint (#116)
- feat: POST /internal/bootstrap — one-shot admin publisher creation
- Guarded by X-Bootstrap-Secret + zero-publisher count
- Added /internal to security + privacy exempt routes

## v2026.03.22.8

### Node.js 22 Upgrade + Build Fixes
- chore: upgrade Dockerfiles from Node.js 20 → 22 (builder + runtime)
- chore: central-api distroless runtime → nodejs22-debian12
- fix: vault-client.ts `VAULT_SECRET_PATH` → `VAULT_PATHS.encryptionKey` (TS build error)
- chore: add `.dockerignore` to exclude node_modules, .git, dist from build context
- chore: multi-arch Docker build support (linux/amd64 + linux/arm64) via buildx TARGETARCH

## v2026.03.22.7

### CodeQL + Dependabot Remediation
- fix: biased cryptographic random → rejection sampling in admin-user.ts (#178)
- fix: validate + encode Keycloak admin path segments via safePath() (#180)
- feat: @fastify/rate-limit in hub-api + central-api — global 100/min + per-route 5-10/min on auth endpoints (#182)
- dismiss: 2 js/insufficient-password-hash alerts (matrix HMAC-SHA1 protocol, SHA-256 token hash)
- chore: lockfile refresh for effect, serialize-javascript, esbuild Dependabot alerts

## v2026.03.22.6

### SEC-004-2: hub-api directAccessGrants disabled in setup-wizard
- fix: keycloak-setup.ts hub-api directAccessGrantsEnabled=false (#176)

## v2026.03.22.5

### SEC-004 Residual — MAIL_RELAY_SECRET Vault Migration
- fix: users.ts invite flows read MAIL_RELAY_SECRET from Vault via getMailRelaySecret() (#174)

## v2026.03.22.4

### SEC-004 Phase 3 Residual — Verify Client + TOTP Encryption
- fix: dedicated hub-verify Keycloak client for password verification (F3) (#172)
- fix: verifyPassword() migrated from hub-app to hub-verify (ADR-0081) (#172)
- fix: directAccessGrantsEnabled=false on hub-app public client (#172)
- fix: getAdminToken() reads client secret from Vault via getKeycloakClientSecret() (#172)
- feat: SecuritySetup.totpSecret encrypted via prisma-encryption.ts (F4, ADR-0082) (#172)

## v2026.03.22.3

### SEC-004 Phase 3 — Tenant Security Hardening
- fix: SecurityGate fail-closed + server-side `requireSecurityComplete()` middleware (#120)
- fix: remove JWT_SECRET and ENCRYPTION_KEY dev fallbacks — fail hard (#121, #149)
- fix: read Matrix admin credentials from env vars, not hardcoded (#153)
- fix: defer tunnelToken/mailRelaySecret until device approved (#152, #154)
- feat: extend hub-api field encryption to address, dateOfBirth, notes (#155, #157)
- feat: central-api field encryption for email, names, tunnelToken, totpSecret (#156)
- feat: vault-client extended for all operational secrets with env fallback (#150)
- fix: token rotation reads/writes via Vault instead of file (#157)
- feat: Jitsi JWT auth + HMAC-SHA256 room names (#151)

## v2026.03.22.2

### Invite Flow Fixes (#116, #118, #119)
- fix: invite email links to `/invite?code=XXX` with CTA button (#118)
- fix: defer Keycloak user creation from `/users/invite` to `/onboarding/redeem` (#119)
- fix: skip temp password verification during onboarding in `/security/password` (#119)
- fix: make email required in invite body schema (#119)

## v2026.03.22.1

### Publisher Invite Signup Wizard (#116)
- Rewrite `/onboarding/redeem` with Keycloak user creation + onboarding token
- Add `createInvitedKeycloakUser()` function (separate from admin flow)
- Add onboarding token middleware with dual-auth for `/security/*`
- Add rate limiting for code redemption (5/IP+code/15min)
- Add `OnboardingStep` enum + step tracking on Publisher model
- Add `/onboarding/status`, `/onboarding/user-info`, `/onboarding/complete-security`
- Rewrite `/onboarding/accept-privacy` with token auth (no IDOR)
- Add invite wizard UI: InviteWizard, CodeValidation, UserInfoStep, SecurityStep, PrivacyStep, CompletionStep
- Add `/invite` public route (outside OIDC auth gate)
- Add DE/EN i18n messages (38 keys)
- Resume support for interrupted onboarding
- Keycloak user rollback on DB failure
- Audit logging on all state-changing endpoints

## v2026.03.21.12

### Status Management + Service Groups + Invite Flow (#91, #95)
- PublisherForm: status management bar (approve/reject/deactivate/reactivate)
- PublisherForm: info card (email, status, gender, privacy at a glance)
- PublisherForm: create mode uses invite flow (`POST /users/invite`), shows invite code + email send
- PublisherForm: All Roles section — full role assignment list with add/remove
- Service Groups page (`/publishers/service-groups`): card grid, member management, seed defaults
- "Dienstgruppen" button in PublisherList header
- 8 new serviceGroups i18n keys (EN + DE)

## v2026.03.21.11

### Matrix Chat — Element Embed + Synapse Admin Library (#91, #94)
- Chat page: Element Web iframe embed with full-height layout
- Chat nav item in sidebar (MessageCircle icon, visible to all authenticated)
- matrix-admin.ts: Synapse Admin API client for auto-provisioning users/rooms
- Default rooms: #general, #elders, #service, #technik, #ordnungsdienst, #reinigung
- i18n: nav.chat, chat.notConfigured, chat.openExternal (EN + DE)
- Bump APP_VERSION to v2026.03.21.11

## v2026.03.21.10

### Service Groups + Cleaning & Garden Duty Module (#91, #93)
- Prisma models: ServiceGroup, CleaningDuty, CleaningSchedule, GardenDuty, GardenDutyMember
- Publisher.serviceGroupId FK — publishers belong to service groups (default 5)
- Cleaning duties (Grundreinigung, Sichtreinigung, Monatsreinigung) assigned to service groups on rotation
- Garden duties (Rasen mähen, Winterdienst) assigned to individual publishers
- Auto-generate rotation schedules: weekly/biweekly/monthly round-robin across service groups
- CleaningDashboard UI: duty cards, schedule table with status management, garden member lists
- Service group CRUD with member assignment API
- Seed defaults endpoint for first setup
- Auth middleware: /service-groups, /cleaning added to API_PREFIXES
- 16 new i18n keys (EN + DE)

## v2026.03.21.9

### Unified Publisher Page + Cleaning/Garden AppRoles (#91, #92)
- Rewrite PublisherList: full data table with status pills, congregation role badges, app role pills, search filter
- Remove Benutzer + Rollen nav items from sidebar
- Add Reinigung & Garten nav item
- 4 new cleaning/garden AppRoles: Grundreinigung, Sichtreinigung, Rasen, Winterdienst
- Include appRoles in GET /publishers list response
- Add POST /users/invite-email relay endpoint (sends via central API)
- Route cleanup: /users → /publishers redirect, /settings/roles for role management
- Add cleaning.view permission to base publisher role
- i18n: 20+ new keys (EN + DE) for publishers, settings, cleaning

## v2026.03.21.8

### Mandatory Passkey + TOTP, Password Manager Support, Profile Menu (#88)
- Security wizard now requires ALL THREE steps: Password → Passkey → TOTP (was passkey OR TOTP)
- `setupComplete` requires `passwordChanged && passkeyRegistered && totpConfigured`
- Password inputs have `autocomplete="new-password"` — browsers offer auto-generated passwords
- Added "Security & Account" link in user dropdown → navigates to /profile SecuritySection
- Passkey step no longer skippable — both passkey and TOTP are mandatory
- i18n: `nav.profile.security`, `security.wizard.passkey.required` (EN + DE)

## v2026.03.21.7

### Fix SecurityGate Not Triggering on First Login (#86)
- Added `/security` to `API_PREFIXES` in auth middleware
- `/security/status` was returning 500 because JWT verification was skipped
- SecurityGate now correctly blocks navigation until password changed + 2FA configured

## v2026.03.21.6

### Distinguish TOTP Labels Between Portal and Tenant Hub (#83)
- Portal TOTP issuer: `hubport.cloud Portal` (was `hubport.cloud`)
- Tenant Hub TOTP issuer: `{tenant-name} Hub` (was `Hubport`)
- `HUBPORT_TENANT_NAME` env var passed to hub container via docker-compose
- Users can now distinguish portal and tenant TOTP entries in their authenticator app

## v2026.03.21.4

### Danger Zone Card in Tenant Portal (#81)
- Red-bordered "Danger Zone" card at bottom of portal dashboard
- Shows reset commands: `docker compose down -v` + `rm -rf` with tenant slug
- Collapsed by default, click to expand with warning text
- Copy buttons on each command
- Step-by-step: stop containers → remove directory → reinstall

## v2026.03.21.3

### Owner First/Last Name in Tenant Registration (#79)
- Added `ownerFirstName` and `ownerLastName` optional fields to Tenant model
- POST `/tenants/request` accepts `firstName` and `lastName`
- `/setup/exchange` response includes `firstName` and `lastName`
- Installer uses these for Keycloak admin user (first + last name)

## v2026.03.21.2

### Exchange Response Includes Tenant Email
- Added `email` field to `/setup/exchange` response
- Installer uses tenant owner's registration email for Keycloak admin user creation

## v2026.03.21.1

### Passkey-First Authentication (#74)
- **SecurityGate**: Full-screen wizard blocks all app navigation until password changed + second factor (passkey or TOTP) configured
- **SecurityWizard**: 3-step setup — password change → passkey registration → TOTP authenticator app
- **Profile SecuritySection**: Self-service credential management — change password, add/remove passkeys, set up/remove TOTP, view/revoke active sessions
- **Security API routes**: `/security/*` endpoints for password, TOTP, WebAuthn passkeys, and session management
- **Prisma models**: `WebAuthnCredential` (credentialId, publicKey, counter, transports) and `SecuritySetup` (passwordChanged, totpSecret)
- **Password policy**: 12+ chars, upper/lower/digit/special, not username, common password blocklist
- **Keycloak realm policy**: Password policy enforced server-side, brute force protection (5 failures → 60s lockout, 15min max)
- **Real-person onboarding**: Setup wizard creates real user (not generic "admin") with random temp password + Publisher record
- **hub-api client**: New `hub-api` confidential OIDC client for password verification via direct grant
- **i18n**: 50+ new keys in both `en-US.json` and `de-DE.json` for wizard + profile security sections
- **Dependencies**: `@simplewebauthn/server`, `@simplewebauthn/browser`, `otpauth`, `qrcode`, `cbor-x`

## v2026.03.20.6

### Runtime Config Fix (#74)
- **Bug fix**: All API calls used build-time `VITE_API_URL` (empty in Docker), causing `/permissions/me` and all fetch calls to hit the static server (port 3000) instead of hub-api (port 3001)
- **Shared config helper**: `getApiUrl()` in `hub-app/src/lib/config.ts` reads `window.__HUBPORT_CONFIG__.apiUrl` (runtime) with fallback to `VITE_API_URL` (dev mode)
- **8 files updated**: PermissionProvider, PublisherForm, UserDetail, UserList, RoleList, RoleDetail, AuditLog, Profile
- **Result**: Sidebar now shows all nav items for admin user in tenant Docker mode

### Publisher Form Polish (#72, #73)
- **Full rewrite** of `PublisherForm.tsx`: Personal Info, Contact, Congregation, Duties, Program, Notes sections
- **New congregation flags**: `anointed`, `special_needs`
- **6 new duty AppRoles**: Mikrofon, Zoom Ordner, Video PC, Audio Anlage, Sound, Vortragsplaner
- **3 new permissions**: `privilege:zoomModerator`, `privilege:publicTalkLocal`, `privilege:serviceMeetingConductor`
- **Program assignments**: midweek (LM Overseer, Program) and weekend (WT Conductor, Program, Vortragsplaner) toggle switches
- **Duties section**: toggle switches for 9 duty AppRoles grouped by Technical, Service, Planning
- **API extended**: `dateOfBirth`, `displayName`, `address`, `notes` fields on Publisher; `appRoles` included in GET response
- **i18n**: 43 new keys in both `en-US.json` and `de-DE.json`
- **GHCR workflow**: Fixed CalVer tag pattern (`type=match` instead of `type=semver`)

## v2026.03.20.2

### User Management, RBAC & Publisher Onboarding (#234)
- **PolicyEngine**: permission-based RBAC replacing flat role hierarchy — buildContext, can(), maskFields(), audit()
- **12 preseeded AppRoles**: Coordinator, Secretary, Service Overseer, LM Overseer, WT Conductor, Technik, Ordnungsdienst, Program, Technik Responsible, Circuit Overseer, Service Overseer Assistant, Cleaning Responsible
- **3 CongregationRoles**: publisher, ministerial_servant, elder with independent inheritance
- **CongregationFlags**: additive flags (pioneer types, elder/MS sub-roles) with auto-assign to AppRoles
- **Privacy gate**: mandatory privacy acceptance before API access, 3 category dropdowns (contact/address/notes visibility)
- **Field masking**: deny rules + publisher privacy settings control field visibility
- **Keycloak admin client**: user CRUD, role assignment, disable/enable/delete
- **User management UI**: UserList, UserDetail, RoleList, RoleDetail pages with status pills and role badges
- **Self-service**: profile page with privacy settings, account deactivation, GDPR delete
- **Onboarding**: invite code redemption, privacy acceptance endpoints
- **Audit logging**: all mutations recorded with actor + before/after state
- **Security scanning**: Dependabot (npm, Docker, GitHub Actions), CodeQL (JS/TS), Snyk (hub-app, hub-api, central-api)
- **Repo visibility**: changed to public (enables free security scanning)

## v2026.03.20.1

### Setup Wizard Enhancement (#23)
- **Setup code**: XXXX-XXXX code generation (31-char non-ambiguous alphabet, 30 min TTL, single-use)
- **Setup code exchange**: POST /setup/exchange with rate limiting (5/IP/min, 20/code total)
- **Bootstrap token exchange**: POST /tenants/:id/token-exchange (ADR-0072)
- **Passkey-first login**: WebAuthn discoverable credentials as primary auth, email/password as fallback
- **TOTP label**: Shows tenant name instead of email
- **Onboarding email**: Simplified — no docker-compose YAML, no raw tokens, setup-code-based flow
- **Wizard consolidation**: 9 steps → 6 (env-check, db-init, vault-init, keycloak, admin-user, cf-tunnel)
- **db-init**: P3005 auto-baseline fallback for non-empty databases
- **vault-init**: Bootstrap token exchange + tunnel token stored in Vault
- **cf-tunnel**: Public URL verification
- **Test API**: UAT-only endpoints with auto-rotating key (30 min TTL, 5 min overlap)
- **Email ring buffer**: In-memory buffer for test observability (10 entries)
- **Setup code UI**: Dashboard card with code generation, countdown timer, curl command

## v2026.03.19.1

### Admin Portal Read-Only + License Change (#10)
- **Admin portal**: Removed approve/reject/decommission buttons and POST handlers
- **Admin portal**: Added read-only status indicators (tunnel ID, DNS badge, provisioned/activation dates)
- **Admin portal**: Added info banner — provisioning managed via `hubport-admin` MCP skill (ADR-0065)
- **Internal endpoint**: Added `POST /internal/send-email` for MCP skill email sending
- **Removed**: `central-api/src/lib/provision.ts` — direct Cloudflare API calls removed
- **License**: Changed from GPL-3.0 to MIT + Commons Clause (ADR-0060)

## v2026.03.18.3

### Full App Implementation (#6)
- **hub-app**: React 19 + Vite + Tailwind v4 PWA
  - OIDC auth (react-oidc-context, Keycloak), RBAC role guards (admin/elder/publisher/viewer)
  - i18n (react-intl, en-US + de-DE), locale detection + switcher
  - Design system: dark theme (#050507), amber brand (#d97706), Inter font, Lucide icons
  - PWA: vite-plugin-pwa, service worker, installable manifest, offline-first
  - Pages: Dashboard, Publishers (list/form), Territories (list/map), Meetings (list/form), Settings, Sharing
  - Role-filtered navigation sidebar
  - Build: 398KB JS (117KB gzip), 13KB CSS, service worker generated
- **hub-api**: Fastify v5 + Prisma v6
  - RBAC middleware: requireRole/requireAnyRole preHandler guards
  - JWT auth: dev mode (no token needed), TST (JWT_SECRET), UAT/PRD (Keycloak JWKS)
  - Routes: publishers CRUD (elder+), territories CRUD + assign/return (elder+), meetings CRUD (elder+ write, all read)
  - Prisma schema: Publisher, Territory, TerritoryAssignment, Meeting
  - Health endpoints: /health, /health/db
- Updated Dockerfile (proper multi-stage build)
- Updated root package.json workspaces (hub-app, hub-api, setup-wizard, central-api)
- Fixed setup-wizard keycloak-setup duplicate key bug

## v2026.03.18.2

### Docker Stack + Setup Wizard (#4)
- Docker Compose: 6 services (hubport, postgres, vault, keycloak, cloudflared, warp optional)
- Docker Compose dev override with hot-reload volumes
- Setup wizard: 7-step web UI (port 8080) with credential approval gates
  - Step 1: Tenant registration (one-time call-home, graceful offline)
  - Step 2: Database init (Prisma migrate deploy)
  - Step 3: Vault init (unseal keys, KV engine)
  - Step 4: Keycloak realm + OIDC client + RBAC roles
  - Step 5: CF Tunnel connectivity check
  - Step 6: WARP client (optional, skip by default)
  - Step 7: Admin user creation with admin role
- GHCR publishing workflow (.github/workflows/publish.yml)
- Multi-stage Dockerfile (hub-app + hub-api + setup-wizard)
- docker-entrypoint.sh: auto-migrate + start all services
- Vault config (file storage, no TLS for local)
- .env.example with all required variables

## v2026.03.18.1

### Initial Setup (#1, #2, #3)
- Project scaffolding: package.json, CLAUDE.md, README.md, LICENSE (GPL)
- Central API: Fastify v5 with TypeBox validation
- Tenant endpoints: request, pending, approve, reject, activate
- Sharing endpoints: approve partner, territories, talks
- Prisma schema for tenant registry + sharing
- Dockerfile (multi-stage, distroless runtime)

## v2026.03.31.1

- **Fix provision-auth Keycloak user name mapping** (#246)
  - Use `ownerFirstName`/`ownerLastName` instead of congregation name
  - Add `tempPassword` support: generate, return in response, include in email
  - Add `KEYCLOAK_INTERNAL_URL` for cluster-internal admin API calls
  - Add `setTemporaryPassword` function + required actions (TOTP, passkey)
