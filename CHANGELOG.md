# Changelog
Format: [CalVer](https://calver.org/) — `YYYY.MM.DD.TS`

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
