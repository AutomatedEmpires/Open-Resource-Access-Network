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

If you used `scripts/azure/bootstrap.sh`, these resources are created automatically.

## 2) Configure app settings (Web App)

Set these as App Service Application Settings (or via Key Vault references):

- `DATABASE_URL`
- Microsoft Entra ID vars:
  - `AZURE_AD_CLIENT_ID`
  - `AZURE_AD_CLIENT_SECRET` (store in Key Vault)
  - `AZURE_AD_TENANT_ID`
  - `NEXTAUTH_URL`
  - `NEXTAUTH_SECRET` (store in Key Vault)
- Optional Sentry:
  - `NEXT_PUBLIC_SENTRY_DSN`
- Recommended:
  - `NODE_ENV=production`
  - `NEXT_TELEMETRY_DISABLED=1`
  - `SCM_DO_BUILD_DURING_DEPLOYMENT=true`

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
