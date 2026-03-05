# ORAN Integration Catalog (Student Dev Pack + Existing)

This document maps available integrations/credits to ORAN needs and clarifies what is acceptable for **production** vs **dev/staging only**.

## Principles

- **Retrieval-first**: external sources must not bypass staging + verification.
- **Privacy-first**: avoid PII collection and PII in telemetry.
- **Azure-first**: prefer Azure-native services for hosting/DB/secrets.
- **Student/edu-only services**: treat as **dev/staging only** unless the license explicitly permits production use.

## Core production stack (recommended)

- Hosting: Azure App Service (see `docs/platform/DEPLOYMENT_AZURE.md`)
- DB: Azure Database for PostgreSQL Flexible Server + PostGIS
- Secrets: Azure Key Vault
- Error tracking: Sentry (already integrated; keep PII out)
- CI/CD: GitHub Actions + Dependabot + CodeQL

## “Use now” integrations (high value)

### Secrets management

- **Azure Key Vault** (prod SSOT)
- **Doppler** (Dev Pack): great for local/dev secret sync; avoid making it the only source of truth for production secrets if you want full Azure control.
- **1Password**: good for team secret sharing; still keep prod runtime secrets in Key Vault/App Service settings.

### Observability

- **Azure Application Insights**: **primary production backend** — connected via `APPLICATIONINSIGHTS_CONNECTION_STRING`. Auto-instruments HTTP + PostgreSQL. Typed wrappers in `src/services/telemetry/appInsights.ts`.
- **Sentry**: already present and privacy-restricted. Serves as secondary/fallback.
- **Datadog** (student/startup): optional; if used, enforce no-PII and consider it secondary.
- **New Relic**: optional; same privacy constraints.

### CI, code quality, and security

- **CodeQL**: enabled via `.github/workflows/codeql.yml`.
- **Dependabot**: enabled via `.github/dependabot.yml`.
- **Codecov**: already in CI; keep as best-effort unless you want enforced thresholds.
- **DeepScan / CodeScene**: optional; useful for refactors and risk detection.
- **ImgBot**: optional; safe if you want automated image optimization.

### Feature flags

ORAN already has an in-house flag interface.

- **ConfigCat / DevCycle**: consider only if you need remote rules, targeting, and audit trails. If adopted, treat it as a backing store behind the existing `FlagService` abstraction.

### Testing

- **BrowserStack / LambdaTest**: useful for cross-browser checks (especially for accessibility and low-bandwidth behavior).
- **TestMail.app**: useful for testing outbound email flows (if/when email notifications are implemented).

### Analytics (privacy-sensitive)

- **SimpleAnalytics**: a strong privacy-forward default for basic page analytics. Ensure consent handling matches `docs/SECURITY_PRIVACY.md`.
- **Amplitude**: powerful but higher privacy risk; only add with explicit consent + data minimization.

## Geospatial / mapping

- **Azure Maps** (Azure-native): **implemented** — G2 Gen2 SKU provisioned, geocoding service in `src/services/geocoding/azureMaps.ts`. Key stored in Key Vault.
- **Leaflet + OpenStreetMap**: still viable for client-side tile rendering (no Azure Maps tiles SDK used yet).
- **CARTO** (Dev Pack): strong for analysis/admin workflows; treat as an internal tool unless you are comfortable operationally.
- **ArcGIS (edu)**: treat as dev-only unless you have a production license.

## External data sources (must respect import-first)

- **Firecrawl / Zyte**: if used, only to assist **internal ingestion** (scrape → stage → review → verify → publish). Never serve scraped results directly to seekers.
- **Census / BLS / HUD / data.gov**: fine for enrichment and planning, but keep “user-facing service facts” sourced from verified records.

## Edu-only caution list

If an integration is tied to `.edu` access, assume **NOT production-safe** unless the vendor’s license explicitly permits production use:

- ArcGIS Enterprise (student)
- Some “startup/student” programs that require personal/student accounts

When in doubt:

- Use it for **development, analysis, prototyping**, or internal dashboards.
- For production, replace with Azure-native or a properly licensed vendor account.

## Reference

- Keep any raw inventories that include codes/credits in a private location (not committed to the repo).
