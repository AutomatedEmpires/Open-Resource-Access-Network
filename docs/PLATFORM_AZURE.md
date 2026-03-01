# ORAN Platform (Azure-First)

ORAN is **Azure-first** for hosting, production database, and secrets management.

This document is the SSOT for platform direction. If you introduce a non-Azure provider for **core hosting**, **database**, or **secrets**, update this doc and `docs/INTEGRATIONS.md`.

## Targets

- **Web app hosting**: Azure App Service (Linux, Node.js 20)
- **Database**: Azure Database for PostgreSQL Flexible Server + PostGIS
- **Secrets**: Azure Key Vault (GitHub Actions uses OIDC; app reads secrets via App Service configuration)
- **Cache / rate limiting (future)**: Azure Cache for Redis
- **Storage (future)**: Azure Blob Storage

## Non-negotiables (platform implications)

- No PII in telemetry (Sentry/App Insights).
- No direct external search results served to seekers (all external sources must go through staging + verification).
- Prefer Azure-native primitives before adopting third-party infrastructure.

## Environments

- `dev`: local Next.js + local Postgres/PostGIS via Docker Compose
- `staging`: Azure App Service + Azure Postgres (sanitized or synthetic data)
- `prod`: Azure App Service + Azure Postgres + Key Vault

## Identity and access

- GitHub Actions should deploy via **OIDC federated credentials** (no long-lived Azure secrets).
- Production changes should go through protected GitHub Environments.
