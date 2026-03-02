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

To inspect RBAC:
- `az role assignment list --scope /subscriptions/e3d708a7-6264-451c-bd7e-670fecfbf4fa/resourceGroups/oranhf57ir-prod-rg --include-inherited -o table`

## Repo integration pointers

- Deployment workflow: `.github/workflows/deploy-azure-appservice.yml`
- Azure platform SSOT: `docs/PLATFORM_AZURE.md`
- Integration SSOT: `docs/INTEGRATIONS.md`
- Telemetry wrapper (App Insights): `src/services/telemetry/appInsights.ts`
- Next.js App Insights init hook: `src/instrumentation.ts`
- Azure Maps service: `src/services/geocoding/azureMaps.ts`
- Azure Translator service: `src/services/i18n/translator.ts`

## Local-only owner notes

Create and maintain `docs/OWNER_INFO.local.md` for:
- Alert recipient emails
- Which human accounts are primary operators
- Any key rotation notes
- Break-glass procedures

That file is intentionally gitignored.
