# ORAN Platform (Azure-First)

ORAN is **Azure-first** for hosting, production database, and secrets management.

This document is the SSOT for platform direction. If you introduce a non-Azure provider for **core hosting**, **database**, or **secrets**, update this doc and `docs/platform/INTEGRATIONS.md`.

## Targets

- **Web app hosting**: Azure App Service (Linux, Node.js 20 LTS)
- **Database**: Azure Database for PostgreSQL Flexible Server + PostGIS
- **Secrets**: Azure Key Vault (GitHub Actions uses OIDC; app reads secrets via App Service configuration)
- **Observability**: Azure Application Insights + Log Analytics Workspace
- **Geocoding**: Azure Maps (G2 Gen2 SKU)
- **Translation**: Azure AI Translator (F0 free tier)
- **Email**: Azure Communication Services (transactional email for notifications)
- **Cache**: Azure Cache for Redis (search result caching, rate limiting)
- **Timer Functions**: Azure Functions (SLA breach checker, ingestion pipeline)
- **Storage (future)**: Azure Blob Storage

## Non-negotiables (platform implications)

- No PII in telemetry (Sentry/App Insights).
- No direct external search results served to seekers (all external sources must go through staging + verification).
- Prefer Azure-native primitives before adopting third-party infrastructure.

## Production resource inventory

| Resource | Type | SKU |
|---|---|---|
| `oranhf57ir-prod-plan` | App Service Plan | B1 Basic |
| `oranhf57ir-prod-web` | Web App (Linux Node 20) | — |
| `oranhf57ir-prod-kv` | Key Vault | Standard |
| `oranhf57ir-prod-pg` | PostgreSQL Flexible Server | — |
| `oranhf57ir-prod-logs` | Log Analytics Workspace | — |
| `oranhf57ir-prod-insights` | Application Insights | — |
| `oranhf57ir-prod-maps` | Azure Maps | G2 Gen2 |
| `oranhf57ir-prod-translator` | AI Translator | F0 Free |
| `oranhf57ir-prod-comm` | Communication Services | — |
| `oranhf57ir-prod-redis` | Azure Cache for Redis | C0 Basic |
| `oranhf57ir-prod-func` | Function App (Node.js 20) | Consumption |

## Environments

- `dev`: local Next.js + local Postgres/PostGIS via Docker Compose
- `staging`: Azure App Service + Azure Postgres (sanitized or synthetic data)
- `prod`: Azure App Service + Azure Postgres + Key Vault

## Identity and access

- GitHub Actions should deploy via **OIDC federated credentials** (no long-lived Azure secrets).
- Production changes should go through protected GitHub Environments.
