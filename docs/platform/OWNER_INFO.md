# ORAN Owner & Integration Inventory (No Secrets)

This file is a **high-level inventory** of ORAN’s Microsoft/Azure ecosystem: what’s provisioned, where configuration lives, and how to locate it.

## Safety + privacy rules (non-negotiable)

- **Do not commit secrets** (API keys, connection strings, passwords, tokens).
- **Do not commit personal email addresses** or other PII.
- Runtime secrets must live in **Azure Key Vault** and be referenced via **App Service settings**.
- For sensitive operational details (emails used for alerts, sign-in accounts, key values), use the local-only file: `docs/OWNER_INFO.local.md`.

## Azure tenancy + subscription

- Tenant: `automatedempires.com` (Entra ID)
- Subscription name: `Azure subscription 1`
- Subscription ID: `e3d708a7-6264-451c-bd7e-670fecfbf4fa`

Helpful commands:

- `az account show --output jsonc`
- `az account list --output table`

## Resource groups (prod)

- Production resource group: `oranhf57ir-prod-rg`

## Provisioned Azure services (prod)

These resources are expected to exist in `oranhf57ir-prod-rg`:

- App Service Plan: `oranhf57ir-prod-plan`
- Web App: `oranhf57ir-prod-web`
- Key Vault: `oranhf57ir-prod-kv`
- PostgreSQL Flexible Server: `oranhf57ir-prod-pg`
- Log Analytics Workspace: `oranhf57ir-prod-logs`
- Application Insights: `oranhf57ir-prod-insights`
- Azure Maps: `oranhf57ir-prod-maps` (G2 Gen2)
- Azure AI Translator: `oranhf57ir-prod-translator` (F0)

## Why these integrations exist

- Azure App Service: simple, Azure-native hosting for Next.js with predictable ops.
- Azure Database for PostgreSQL + PostGIS: authoritative data store for verified resources + geospatial queries.
- Azure Key Vault: single source of truth for runtime secrets (no secrets in repo).
- Log Analytics + Application Insights: production observability inside Microsoft; supports alerting and auditing without adding PII.
- Azure Maps: Azure-native geocoding to support map/directory UX without relying on third-party mapping providers.
- Azure AI Translator: Azure-native translation for service-record text (names/descriptions) with a free tier for early-stage usage.

ORAN safety contract reminder:

- Anything shown to seekers must come from **stored records only**.
- AI services may help with **ingestion/extraction/summarization**, but never directly inject new “facts” into seeker responses.

## Secrets: Key Vault (prod)

Key Vault: `oranhf57ir-prod-kv`

Expected secret *names* (values MUST NOT be committed):

- `database-url`
- `pg-admin-password`
- `pg-admin-user`
- `azure-maps-key`
- `azure-translator-key`

Helpful commands (names only):

- `az keyvault secret list --vault-name oranhf57ir-prod-kv --query "[].name" -o tsv`

## App Service configuration (prod)

Web App: `oranhf57ir-prod-web`

Expected App Settings (some are Key Vault references):

- `DATABASE_URL` = `@Microsoft.KeyVault(SecretUri=...)`
- `APPLICATIONINSIGHTS_CONNECTION_STRING` = (non-secret string; still treat as sensitive)
- `AZURE_MAPS_KEY` = `@Microsoft.KeyVault(SecretUri=...)`
- `AZURE_TRANSLATOR_KEY` = `@Microsoft.KeyVault(SecretUri=...)`
- `AZURE_TRANSLATOR_ENDPOINT` = `https://api.cognitive.microsofttranslator.com/`
- `AZURE_TRANSLATOR_REGION` = `westus2`
- `SCM_DO_BUILD_DURING_DEPLOYMENT` = `false`
- `WEBSITE_RUN_FROM_PACKAGE` = `1`

Helpful commands:

- `az webapp config appsettings list -g oranhf57ir-prod-rg -n oranhf57ir-prod-web -o table`

## Budgets (Cost Management)

Budgets are alerting controls (they do not hard-stop spend).

- Resource-group scoped monthly budget: `oran-monthly-budget` (amount: $60)
- Subscription scoped monthly budget: `oran-subscription-budget` (amount: $200)

Notification thresholds (both budgets): 50% / 80% / 100%

To view notifications (do not copy/paste emails into this file):

- `az consumption budget show --budget-name oran-monthly-budget --resource-group oranhf57ir-prod-rg --output jsonc`
- `az rest --method get --url "https://management.azure.com/subscriptions/e3d708a7-6264-451c-bd7e-670fecfbf4fa/providers/Microsoft.Consumption/budgets/oran-subscription-budget?api-version=2019-10-01" --output jsonc`

## Access control (RBAC)

Preferred pattern:

- Create Entra security groups (e.g. `ORAN-Owners`, `ORAN-Contributors`, `ORAN-Readers`).
- Assign Azure roles to groups at subscription/RG scopes.
- Add/remove humans from groups (audit-friendly).

Current (prod RG) roles:

- Resource group scope `oranhf57ir-prod-rg`: two invited guest users have `Owner`.

Ownership mapping policy (repo-safe):

- Do not list personal emails here.
- Record roles and scopes here (e.g., “2 Owners at prod RG scope”).
- Keep the specific human identities in `docs/OWNER_INFO.local.md`.

Recommended next hardening step:

- Move from per-user RBAC to Entra security groups (`ORAN-Owners`, `ORAN-Contributors`, `ORAN-Readers`).

To inspect RBAC:

- `az role assignment list --scope /subscriptions/e3d708a7-6264-451c-bd7e-670fecfbf4fa/resourceGroups/oranhf57ir-prod-rg --include-inherited -o table`

## Repo integration pointers

- Deployment workflow: `.github/workflows/deploy-azure-appservice.yml`
- Azure platform SSOT: `docs/platform/PLATFORM_AZURE.md`
- Integration SSOT: `docs/platform/INTEGRATIONS.md`
- Telemetry wrapper (App Insights): `src/services/telemetry/appInsights.ts`
- Next.js App Insights init hook: `src/instrumentation.ts`
- Azure Maps service: `src/services/geocoding/azureMaps.ts`
- Azure Translator service: `src/services/i18n/translator.ts`

## Agent ecosystem: scrape → extract → verify (ORAN-safe)

Scraping is acceptable **only** as an ingestion input that still goes through staging + verification.

Clean pipeline shape:

1) **Locate candidates** (non-user-facing)

- Inputs: curated lists, partner feeds, permitted scrapes, submissions.
- Output: candidate URLs/documents stored as evidence.

1) **Extract structured fields** (unverified)

- Parse source HTML/PDF into a normalized candidate record.
- Must include traceability: source URL, fetch timestamp, content hash.

1) **Verify repeatedly** (publish gate)

- Automated checks (domain consistency, contact info stability, cross-source agreement).
- Human review required for publish (community-admin / ORAN-admin).

1) **Confidence scoring** (internal)

- Score determines review priority and reverify cadence.
- Score does not override the publish gate.

1) **Reverification scheduler**

- Periodically re-check published records; flag drift, downgrade confidence, and/or move back to review.

Azure-native building blocks (recommended):

- Orchestration: Azure Functions (Durable) or Container Apps Jobs
- Queues: Azure Service Bus
- Evidence storage: Azure Blob Storage
- Telemetry: Application Insights

Implementation note:

- Keep seeker retrieval/ranking LLM-free. If an LLM is used, it must only summarize already-retrieved stored records.

## Student Azure → production Azure promotion workflow

Goal: build/test the ingestion agent in a low-cost “student” environment, then reproduce it in the main runtime account once it’s stable.

Recommended approach: **Infrastructure as Code + environment separation**

- Maintain a single set of IaC templates (Bicep or Terraform) with parameterized names, SKU tiers, and resource group.
- Create two Azure environments:
  - `oran-dev` (student subscription): cheapest SKUs, reduced retention, smaller quotas.
  - `oran-prod` (main subscription): production SKUs, retention, locks, alerts.

CI/CD pattern:

- GitHub Environments:
  - `azure-student` → deploys only to student subscription RG
  - `azure-prod` → deploys only to prod subscription RG (requires approvals)
- Separate OIDC federated credentials per subscription/environment.
- Promote by re-deploying the same IaC + app build to prod (no manual portal clicking).

Data promotion policy (important):

- Do not “copy unverified candidates” into prod by default.
- Prefer: run the same ingestion pipeline in prod against approved sources, or export/import only after explicit review.

Checklist to switch from student → prod:

- IaC parameters updated (RG names, SKUs, alerting, retention)
- OIDC configured for prod deployment identity
- Key Vault secrets created in prod KV (by name) and referenced by App Service
- Verification + scoring thresholds confirmed in docs and tests

## Local-only owner notes

Create and maintain `docs/OWNER_INFO.local.md` for:

- Alert recipient emails
- Which human accounts are primary operators
- Any key rotation notes
- Break-glass procedures

That file is intentionally gitignored.
