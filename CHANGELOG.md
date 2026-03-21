# Changelog
Format: [CalVer](https://calver.org/) — `YYYY.MM.DD.TS`

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
