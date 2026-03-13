# Azure Scripts

Operational scripts for Azure provisioning and GitHub OIDC setup.

## Scripts

- `bootstrap.sh`
  - Purpose: Provision core ORAN Azure resources (resource groups, App Service plan/web app, Azure Maps account, Key Vault, PostgreSQL Flexible Server) across one or more environments.
  - Required environment variables: none (uses current Azure CLI auth context).
  - Required RBAC roles: `Contributor` on target scope; `User Access Administrator` or `Owner` when role assignment operations are required.
  - Required secure input when provisioning the web app: `--azure-maps-sas-token` so the script can store the browser SAS token in Key Vault and wire `AZURE_MAPS_SAS_TOKEN` into App Service.

- `rotate-maps-sas.sh`
  - Purpose: Mint a fresh scoped Azure Maps SAS token, sync the `azure-maps-sas-token` Key Vault secret, update the live `AZURE_MAPS_SAS_TOKEN` App Service setting, and verify the `/api/maps/token` broker.
  - Required environment variables: none (uses current Azure CLI auth context).
  - Required RBAC roles: permissions to call `Microsoft.Maps/accounts/listSas`, set Key Vault secrets when `--keyvault-name` is used, and update App Service settings.

- `github-oidc.sh`
  - Purpose: Configure Microsoft Entra app registration/service principal and GitHub Actions federated credential for OIDC-based deployment.
  - Required environment variables: none (uses current Azure CLI auth context).
  - Required RBAC roles: app registration management permissions (for example `Application Administrator`) plus `User Access Administrator` or `Owner` on deployment scope for role assignment.

## Usage

```bash
chmod +x scripts/azure/*.sh

./scripts/azure/bootstrap.sh \
  --prefix oran \
  --location westus2 \
  --environments dev,staging,prod \
  --azure-maps-sas-token '<scoped-sas-token>'

./scripts/azure/github-oidc.sh \
  --app-name oran-gha-deploy \
  --resource-group oran-prod-rg \
  --webapp-name oran-prod-web \
  --github-owner <owner> \
  --github-repo Open-Resource-Access-Network \
  --github-environment production

./scripts/azure/rotate-maps-sas.sh \
  --resource-group oran-prod-rg \
  --webapp-name oran-prod-web \
  --keyvault-name oran-prod-kv
```

## Idempotency Notes

- `bootstrap.sh` checks for existing resource group/plan/web app/Key Vault/PostgreSQL/Azure Maps resources and reuses them when present.
- `github-oidc.sh` reuses existing app registrations, service principals, and federated credentials when already configured.
- `rotate-maps-sas.sh` is safe to re-run; it always issues a new SAS token and overwrites the current Key Vault secret/app setting with the newest value.
