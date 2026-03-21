# hubport.cloud — CLAUDE.md

## Project Overview
Self-hosted congregation management platform. Public repo (MIT + Commons Clause, ADR-0060).

This repo contains:
- `central-api/` — Fastify API for tenant registry, provisioning, portal auth (deployed to K8s)
- `hub-app/` — React SPA for congregation management (self-hosted Docker stack)
- `hub-api/` — Fastify API for congregation data, RBAC, publishers (self-hosted Docker stack)
- `setup-wizard/` — First-run configuration wizard (self-hosted Docker stack)
- Root `Dockerfile` — Multi-platform tenant stack image (hub-app + hub-api + setup-wizard)
- `central-api/Dockerfile` — Distroless central-api image (K8s only)

## Git Workflow
- `main` branch = production, protected
- Feature branches: `feature/<issue-nr>-<description>`
- Every change needs a GitHub issue
- Commit messages reference issues: `feat: add tenant endpoint (#5)`
- CalVer versioning: YYYY.MM.DD.TS
- PR workflow: feature branch → PR → merge into main

## Architecture

### RBAC System
- **PolicyEngine** (`hub-api/src/lib/policy-engine.ts`): buildContext → can → maskFields → audit
- **Permission keys**: `app:<module>.<action>`, `deny:<field>`, `privilege:<name>`, `manage:<area>`
- **12 preseeded AppRoles** (Coordinator, Secretary, Service Overseer, etc.)
- **3 CongregationRoles** (publisher, ministerial_servant, elder) + additive flags
- Keycloak realm roles → base permissions: admin=`*`, elder=full, publisher=minimal, viewer=read-only

### Auth
- **JWKS verification** (`hub-api/src/lib/auth.ts`): Uses `get-jwks` to verify Keycloak RS256 tokens
- `KEYCLOAK_JWKS_URL` must be the internal Docker URL (e.g., `http://keycloak:8080/realms/hubport/protocol/openid-connect/certs`)
- Auth hook only enforces JWT on API route prefixes — static SPA files are public
- SPA uses `react-oidc-context` for Keycloak OIDC in the browser

### Security — Passkey-First Authentication (ADR-0077, Plan 013)
- **Mandatory** for all users: passkey-first + TOTP fallback (see [ADR-0077](https://github.com/itunified-io/infrastructure/blob/main/docs/adr/0077-passkey-first-authentication.md), [Plan 013](https://github.com/itunified-io/infrastructure/blob/main/docs/plans/013-passkey-first-auth-workflow.md))
- **SecurityGate** (`hub-app/src/auth/SecurityGate.tsx`): Full-screen wizard blocks app until password changed + passkey or TOTP configured
- **Password policy**: 12+ chars, upper/lower/digit/special, no reuse (5), brute force lockout (5 attempts)
- **Hub-API proxy routes** (`/security/*`): Password, TOTP, sessions via Keycloak Admin API
- **WebAuthn passkeys**: Browser `navigator.credentials.create()` with challenge/response through hub-api
- **Profile security tab**: Self-service password change, passkey/TOTP management, session list + revoke
- **Setup wizard**: Validates password policy, sets `temporary: true`, adds `requiredActions` for WebAuthn + TOTP

### Runtime Config
- `VITE_*` env vars are baked at build time — undefined in generic Docker image
- `docker-entrypoint.sh` generates `/app/hub-app/dist/config.js` with `window.__HUBPORT_CONFIG__`
- SPA reads from `@/lib/config.ts` with fallback to `import.meta.env`
- PWA service worker must NOT cache `config.js` (navigateFallbackDenylist in vite.config.ts)

### Docker
- Tenant stack: `docker buildx build --platform linux/amd64,linux/arm64` (ADR-0070)
- Central API: `docker buildx build --platform linux/amd64` (K8s cluster is amd64)
- `hub-app/dist` must be `--chown=1001:1001` for config.js write access

## Conventions
- Language: English (code, docs, commits)
- License: MIT + Commons Clause (ADR-0060)
- Contributions welcome — see CONTRIBUTING.md
- Deploy central-api to K8s via `kubectl apply` (manifests in infrastructure repo)
- Deploy tenant stack to GHCR: `docker buildx build --push`
