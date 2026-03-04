# Azure Scripts

Operational scripts for Azure provisioning and GitHub OIDC setup.

## Scripts

- `bootstrap.sh`
  - Purpose: Provision core ORAN Azure resources (resource groups, App Service plan/web app, Key Vault, PostgreSQL Flexible Server) across one or more environments.
  - Required environment variables: none (uses current Azure CLI auth context).
  - Required RBAC roles: `Contributor` on target scope; `User Access Administrator` or `Owner` when role assignment operations are required.

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
  --environments dev,staging,prod

./scripts/azure/github-oidc.sh \
  --app-name oran-gha-deploy \
  --resource-group oran-prod-rg \
  --webapp-name oran-prod-web \
  --github-owner <owner> \
  --github-repo Open-Resource-Access-Network \
  --github-environment production
```

## Idempotency Notes

- `bootstrap.sh` checks for existing resource group/plan/web app/Key Vault/PostgreSQL resources and reuses them when present.
- `github-oidc.sh` reuses existing app registrations, service principals, and federated credentials when already configured.
