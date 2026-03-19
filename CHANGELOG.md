# Changelog
Format: [CalVer](https://calver.org/) — `YYYY.MM.DD.TS`

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
