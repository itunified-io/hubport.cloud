# hubport.cloud

[![License: MIT + Commons Clause](https://img.shields.io/badge/License-MIT%20%2B%20Commons%20Clause-blue.svg)](LICENSE)
[![CodeQL](https://github.com/itunified-io/hubport.cloud/actions/workflows/codeql.yml/badge.svg)](https://github.com/itunified-io/hubport.cloud/actions/workflows/codeql.yml)
[![Security Scan](https://github.com/itunified-io/hubport.cloud/actions/workflows/security.yml/badge.svg)](https://github.com/itunified-io/hubport.cloud/actions/workflows/security.yml)
[![Known Vulnerabilities](https://snyk.io/test/github/itunified-io/hubport.cloud/badge.svg)](https://snyk.io/test/github/itunified-io/hubport.cloud)

Self-hosted congregation management platform — always free, source-available under MIT + Commons Clause.

## Architecture

| Component | Description | Deploy Target |
|-----------|-------------|---------------|
| **Central API** (`central-api/`) | Tenant registry, provisioning, portal auth | K8s (distroless) |
| **Hub App** (`hub-app/`) | React 19 SPA — publishers, territories, meetings | Docker (self-hosted) |
| **Hub API** (`hub-api/`) | Fastify v5 — RBAC, PolicyEngine, audit logging | Docker (self-hosted) |
| **Setup Wizard** (`setup-wizard/`) | First-run configuration (6-step web UI) | Docker (self-hosted) |
| **Landing Page** | [cf-hubport-cloud](https://github.com/itunified-io/cf-hubport-cloud) | CF Worker |

## Features

- **Permission-based RBAC** — PolicyEngine with 12 preseeded roles, field masking, deny rules
- **Privacy controls** — mandatory GDPR acceptance, per-field visibility settings
- **Audit logging** — all mutations recorded with actor + before/after state
- **i18n** — English (en-US) and German (de-DE)
- **PWA** — installable, offline-first, service worker
- **Self-hosted** — Docker Compose with Keycloak, Vault, PostgreSQL

## Development

```bash
npm install
npm run dev       # start central-api dev server
npm test          # run tests
npm run build     # build for production
```

## Security

This project uses automated security scanning:

- **[Dependabot](https://github.com/itunified-io/hubport.cloud/security/dependabot)** — dependency vulnerability alerts + auto-PRs
- **[CodeQL](https://github.com/itunified-io/hubport.cloud/actions/workflows/codeql.yml)** — static analysis for JavaScript/TypeScript
- **[Snyk](https://snyk.io/test/github/itunified-io/hubport.cloud)** — vulnerability scanning across all components

Report security issues via [GitHub Security Advisories](https://github.com/itunified-io/hubport.cloud/security/advisories/new).

## License

MIT + Commons Clause — free for non-commercial use. See [LICENSE](LICENSE) for details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md)

## Sponsors

This project is always free. Support via [GitHub Sponsors](https://github.com/sponsors/itunified-io).
