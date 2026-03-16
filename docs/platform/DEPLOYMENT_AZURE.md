# Deploy ORAN to Azure (App Service)

This is the recommended deployment path for ORAN.

## Overview

- Hosting: Azure App Service (Linux) running Node.js
- Build: Oryx build during deploy (or prebuild + zip deploy)
- Deploy automation: GitHub Actions via OIDC

## Quickstart (scripts)

This repo includes two helpers:

- `scripts/azure/bootstrap.sh` — provisions App Service + Postgres Flexible Server + Key Vault for `dev`, `staging`, and/or `prod`.
- `scripts/azure/github-oidc.sh` — sets up GitHub Actions OIDC (no long-lived Azure secrets).

Make them executable:

```bash
chmod +x scripts/azure/*.sh
```

Example (your chosen defaults):

```bash
./scripts/azure/bootstrap.sh \
  --prefix oran \
  --location westus2 \
  --environments dev,staging,prod \
  --azure-maps-sas-token '<scoped-sas-token>' \
  --prod-hostname app.example.com
```

## 1) Create Azure resources

Minimum resources:

- Resource group
- App Service plan (Linux)
- Web App (Linux / Node 20)

Optional but recommended:

- Azure Database for PostgreSQL Flexible Server (enable PostGIS)
- Azure Key Vault (store secrets)
- Azure Maps account plus a scoped SAS token for the interactive seeker map

`infra/main.bicep` now provisions the Azure Maps account and injects both `AZURE_MAPS_KEY` and `AZURE_MAPS_SAS_TOKEN` into the web app through Key Vault references. `scripts/azure/bootstrap.sh` now provisions the same Azure Maps account and Key Vault secret wiring, but it still requires the caller to provide `--azure-maps-sas-token` as a secure input for first deployment.

Post-deployment rotation is now automated through `.github/workflows/rotate-azure-maps-sas.yml`, which calls `scripts/azure/rotate-maps-sas.sh` on a schedule or manual dispatch. The rotation script generates a fresh SAS token from the Azure Maps account, syncs the Key Vault secret, updates the live App Service setting, and verifies `/api/maps/token`.

## 2) Configure app settings (Web App)

Set these as App Service Application Settings (or via Key Vault references):

- `DATABASE_URL`
- Microsoft Entra ID vars:
  - `AZURE_AD_CLIENT_ID`
  - `AZURE_AD_CLIENT_SECRET` (store in Key Vault)
  - `AZURE_AD_TENANT_ID`
  - `NEXTAUTH_URL`
  - `NEXTAUTH_SECRET` (store in Key Vault)
- Azure Maps:
  - `AZURE_MAPS_KEY` for server-side geocoding
  - `AZURE_MAPS_SAS_TOKEN` for browser map token brokering via `/api/maps/token`
  - When deploying with `infra/main.bicep`, pass `azureMapsSasToken` as a secure deployment parameter so the template can store it in Key Vault and wire the app setting automatically.
- Optional auth-provider gates:
  - `ORAN_ENABLE_APPLE_AUTH=1` only when Apple OAuth is intentionally enabled in production
  - `APPLE_CLIENT_ID` and `APPLE_CLIENT_SECRET` only when Apple OAuth is intentionally enabled in production
  - `ORAN_ENABLE_GOOGLE_AUTH=1` only when Google OAuth is intentionally enabled in production
  - `ORAN_ENABLE_CREDENTIALS_AUTH=1` only when email/password auth is intentionally enabled in production
  - Credentials auth now accepts email, username, or phone as the sign-in identifier; this is password-based and not SMS/OTP auth.
  - Password-based credentials can coexist with Microsoft Entra for the same account when a `password_hash` is present on the existing `user_profiles` row.
- Optional Sentry:
  - `NEXT_PUBLIC_SENTRY_DSN`
- Recommended:
  - `NODE_ENV=production`
  - `NEXT_TELEMETRY_DISABLED=1`
  - `SCM_DO_BUILD_DURING_DEPLOYMENT=true`

Deployment gate note:

- Run `node scripts/validate-runtime-env.mjs --target webapp --node-env production` against the final app-settings set before rollout. In production this warns when Azure Maps, Translator, Redis, or Application Insights configuration is incomplete.
- CI now codifies the expected production webapp settings in `.github/runtime/webapp-production-settings.txt` and fails the `Runtime Readiness Contract` job if `REDIS_URL`, `AZURE_MAPS_KEY`, or `AZURE_MAPS_SAS_TOKEN` fall out of the enforced production contract.
- The App Service deploy workflow also promotes those three settings from warnings to hard failures when validating the live Azure Web App app-settings set before rollout.
- The Bicep template still accepts `azureMapsSasToken` as the initial deployment secret, but ongoing SAS lifecycle is now handled by the rotation workflow/script rather than a manual App Service update.

Apple setup note:

- This repository uses NextAuth/Auth.js directly, not Clerk-managed social auth. Clerk can abstract the Apple provider setup because Clerk stores and manages the Apple credentials on your behalf. ORAN cannot do that in its current architecture.
- To enable Apple in production you must create the Apple provider credentials yourself:
  - create or reuse an Apple Developer account
  - create a Service ID for the web app and enable Sign in with Apple
  - add the callback URL `https://openresourceaccessnetwork.com/api/auth/callback/apple` and any secondary host you intend to use, such as `https://oranhf57ir-prod-web.azurewebsites.net/api/auth/callback/apple`
  - generate the Apple client secret JWT and store the resulting values as `APPLE_CLIENT_ID` and `APPLE_CLIENT_SECRET`
  - Auth.js notes that Apple requires a live HTTPS URL and a client secret JWT; their current guidance also points to `npx auth add apple` as a helper for generating the client secret material
- Do not set `ORAN_ENABLE_APPLE_AUTH=1` until the Apple client ID and secret are both present in production.

Note: the bootstrap script sets `DATABASE_URL` as a **Key Vault reference** using a system-assigned managed identity, so the raw connection string does not need to live in App Service settings.

## 3) Configure GitHub Actions deployment (OIDC)

This repo includes a deploy workflow: `.github/workflows/deploy-azure-appservice.yml`.

The workflow now performs two pre/postflight checks automatically:

- validates the Azure App Service app-settings contract before rollout
- verifies `/api/health` plus core security headers after rollout

You must create an Azure AD app registration / service principal, then add a **federated credential** for GitHub Actions.

If you want a scripted setup, use:

```bash
./scripts/azure/github-oidc.sh \
  --app-name oran-gha-deploy \
  --resource-group oran-prod-rg \
  --webapp-name oran-prod-web \
  --github-owner <your-github-owner> \
  --github-repo Open-Resource-Access-Network \
  --github-environment production
```

GitHub secrets required:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_RESOURCE_GROUP`
- `AZURE_WEBAPP_NAME`

GitHub variable gate (recommended):

- `AZURE_DEPLOY_ENABLED=true`

Until this variable is set, the deploy workflow will skip automatically.

Note: the included deploy workflow targets the `production` GitHub Environment by default.

Codespaces note:

- If you try to set secrets/vars via `gh` inside a Codespace and see `HTTP 403: Resource not accessible by integration`, you are likely using the Codespaces-provided `GITHUB_TOKEN`.
- Fix by authenticating `gh` as a GitHub user (device/web flow) or setting secrets/vars in the GitHub UI.

## 4) Run the deployment

- Push to `main`, or run the workflow manually (Actions → Deploy).

For Functions, `.github/workflows/deploy-azure-functions.yml` now validates required Function App settings before deployment and still lists deployed functions after publish.

## Notes

- ORAN is safety-critical. Do not enable any external-data integrations that bypass staging/verification.
- Avoid sending PII to telemetry tools.
