# hubport.cloud — CLAUDE.md

## Project Overview
Self-hosted congregation management platform. This repo contains:
- `central-api/` — Minimal Fastify API for tenant registry, sharing, and provisioning (deployed to K8s)
- Future: `hub-app/`, `hub-api/`, `setup-wizard/` (self-hosted Docker stack)

## Git Workflow
- `main` branch = production, protected
- Feature branches: `feature/<issue-nr>-<description>`
- Every change needs a GitHub issue
- Commit messages reference issues: `feat: add tenant endpoint (#5)`
- CalVer versioning: YYYY.MM.DD.TS
- PR workflow: feature branch → PR → merge into main

## Conventions
- Language: English (code, docs, commits)
- License: MIT + Commons Clause (ADR-0060)
- Contributions welcome — see CONTRIBUTING.md
- Deploy central-api to K8s via `kubectl apply` (manifests in infrastructure repo)
