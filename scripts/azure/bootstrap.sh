#!/usr/bin/env bash
set -euo pipefail

# ORAN Azure bootstrap (App Service + PostgreSQL Flexible Server + Key Vault)
#
# This script provisions resource groups + core resources for dev/staging/prod.
# It intentionally avoids printing secrets.
# Environment variables: none required; uses active Azure CLI authentication context.
# Required RBAC roles: Contributor on target subscription/resource groups,
# and User Access Administrator or Owner if role assignments are needed for Key Vault.
#
# Prereqs:
# - Azure CLI installed and logged in: az login
# - Correct subscription selected: az account set --subscription <id>
#
# Usage (example):
#   ./scripts/azure/bootstrap.sh \
#     --prefix oran \
#     --location westus2 \
#     --environments dev,staging,prod
#
# Optional custom domain setup (example):
#   ./scripts/azure/bootstrap.sh ... \
#     --prod-hostname app.example.com
# Optional Azure Maps setup (example):
#   ./scripts/azure/bootstrap.sh ... \
#     --azure-maps-sas-token '<scoped-sas-token>'

usage() {
  cat <<'EOF'
Usage:
  bootstrap.sh --prefix <name> --location <azure-region> --environments <csv>

Required:
  --prefix         Resource name prefix (e.g., oran)
  --location       Azure region (e.g., westus2)
  --environments   Comma-separated list: dev,staging,prod

Optional:
  --appservice-sku App Service plan SKU (default: B1). Useful when certain tiers have 0 quota.
  --pg-location    PostgreSQL region override (default: same as --location)
  --pg-admin-user  PostgreSQL admin username (default: oranadmin)
  --prod-hostname  Custom hostname for prod webapp (e.g., app.example.com)
  --azure-maps-sas-token  Scoped Azure Maps SAS token to store in Key Vault and wire into the web app
  --skip-web       Skip App Service plan + Web App provisioning
  --skip-db        Skip PostgreSQL provisioning (and related Key Vault secrets)

Notes:
- This script creates Azure resources but does NOT configure GitHub OIDC.
  Use: scripts/azure/github-oidc.sh
- PostgreSQL network hardening (VNet/private access) is intentionally out-of-scope here.
  Treat internet-exposed DB settings as a production hardening item.
EOF
}

PREFIX=""
LOCATION=""
ENVS_CSV=""
APPSERVICE_SKU="B1"
PG_LOCATION=""
PG_ADMIN_USER="oranadmin"
PROD_HOSTNAME=""
AZURE_MAPS_SAS_TOKEN=""
SKIP_WEB="false"
SKIP_DB="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix)
      PREFIX="$2"; shift 2 ;;
    --location)
      LOCATION="$2"; shift 2 ;;
    --environments)
      ENVS_CSV="$2"; shift 2 ;;
    --appservice-sku)
      APPSERVICE_SKU="$2"; shift 2 ;;
    --pg-location)
      PG_LOCATION="$2"; shift 2 ;;
    --pg-admin-user)
      PG_ADMIN_USER="$2"; shift 2 ;;
    --prod-hostname)
      PROD_HOSTNAME="$2"; shift 2 ;;
    --azure-maps-sas-token)
      AZURE_MAPS_SAS_TOKEN="$2"; shift 2 ;;
    --skip-web)
      SKIP_WEB="true"; shift 1 ;;
    --skip-db)
      SKIP_DB="true"; shift 1 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$PG_LOCATION" ]]; then
  PG_LOCATION="$LOCATION"
fi

if [[ -z "$PREFIX" || -z "$LOCATION" || -z "$ENVS_CSV" ]]; then
  usage
  exit 1
fi

if [[ "$SKIP_WEB" != "true" && -z "$AZURE_MAPS_SAS_TOKEN" ]]; then
  echo "Missing required arg for web provisioning: --azure-maps-sas-token" >&2
  exit 1
fi

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing command: $1" >&2; exit 1; }
}

require_cmd az
require_cmd python3

# Generate a strong password without leaking it to stdout.
# NOTE: This still exists in your shell process env briefly; for maximum hygiene,
# consider running in a fresh terminal and clearing history.
gen_password() {
  python3 - <<'PY'
import secrets
import string
alphabet = string.ascii_letters + string.digits + "-_"
print(''.join(secrets.choice(alphabet) for _ in range(48)))
PY
}

ensure_logged_in() {
  if ! az account show >/dev/null 2>&1; then
    echo "Not logged into Azure CLI. Run: az login" >&2
    exit 1
  fi
}

ensure_logged_in

ensure_provider_registered() {
  local provider="$1"

  local state
  state="$(az provider show -n "$provider" --query registrationState -o tsv 2>/dev/null || echo "NotRegistered")"
  if [[ "$state" == "Registered" ]]; then
    return 0
  fi

  echo "==> Registering Azure provider: ${provider} (state=${state})"
  az provider register -n "$provider" >/dev/null || true

  for _ in {1..120}; do
    state="$(az provider show -n "$provider" --query registrationState -o tsv 2>/dev/null || echo "NotRegistered")"
    if [[ "$state" == "Registered" ]]; then
      return 0
    fi
    sleep 5
  done

  echo "Provider did not become Registered in time: ${provider} (state=${state})" >&2
  return 1
}

if [[ "$SKIP_WEB" != "true" ]]; then
  ensure_provider_registered "Microsoft.Web"
  ensure_provider_registered "Microsoft.Maps"
fi
ensure_provider_registered "Microsoft.Resources"
ensure_provider_registered "Microsoft.KeyVault"
if [[ "$SKIP_DB" != "true" ]]; then
  ensure_provider_registered "Microsoft.DBforPostgreSQL"
fi

ensure_current_user_can_manage_kv_secrets_rbac() {
  local vault_id="$1"
  local vault_name="$2"

  # Best-effort: when Key Vault uses RBAC, the creator may not automatically have
  # data-plane permissions to set/list secrets. The bootstrap needs to set secrets.
  local user_object_id
  if ! user_object_id="$(az ad signed-in-user show --query id -o tsv 2>/dev/null)"; then
    cat <<EOF >&2
Key Vault is RBAC-enabled, and this script needs permission to set secrets, but Azure CLI
could not resolve the signed-in user object id.

Fix: grant yourself a Key Vault secrets role on the vault scope, then rerun.
Example:
  az role assignment create --assignee-object-id <your-object-id> \
    --assignee-principal-type User --role "Key Vault Secrets Officer" --scope "${vault_id}"
EOF
    return 1
  fi

  # If the assignment already exists, Azure returns an error; ignore it.
  az role assignment create \
    --assignee-object-id "$user_object_id" \
    --assignee-principal-type User \
    --role "Key Vault Secrets Officer" \
    --scope "$vault_id" >/dev/null 2>&1 || true

  # RBAC can take time to propagate.
  for _ in {1..30}; do
    if az keyvault secret list --vault-name "$vault_name" --query "[].name" -o tsv >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done

  echo "Timed out waiting for Key Vault RBAC permissions to propagate." >&2
  return 1
}

create_env() {
  local env="$1"

  local rg="${PREFIX}-${env}-rg"
  local plan="${PREFIX}-${env}-plan"
  local webapp="${PREFIX}-${env}-web"
  local kv="${PREFIX}-${env}-kv"
  local mapsAccount="${PREFIX}-${env}-maps"
  local pgServer="${PREFIX}-${env}-pg"
  local dbName="oran_db"

  echo "==> [${env}] Creating resource group: ${rg}"
  az group create --name "$rg" --location "$LOCATION" >/dev/null

  local webappPrincipalId=""
  if [[ "$SKIP_WEB" != "true" ]]; then
    if az appservice plan show --name "$plan" --resource-group "$rg" >/dev/null 2>&1; then
      echo "==> [${env}] App Service plan exists; skipping create: ${plan}"
    else
      echo "==> [${env}] Creating App Service plan: ${plan}"
      if ! az appservice plan create \
        --name "$plan" \
        --resource-group "$rg" \
        --location "$LOCATION" \
        --is-linux \
        --sku "$APPSERVICE_SKU" >/dev/null; then
        cat <<'EOF' >&2
App Service plan creation failed.

Common cause: subscription quota for Basic/Standard App Service plan workers is 0.
Fix options:
- Request an App Service quota increase in Azure Portal (Subscriptions -> Usage + quotas / Quotas).
- Choose a different region.
- Re-run with --skip-web to provision DB/KeyVault while waiting.
EOF
        exit 1
      fi
    fi

    if az webapp show --name "$webapp" --resource-group "$rg" >/dev/null 2>&1; then
      echo "==> [${env}] Web App exists; skipping create: ${webapp}"
    else
      echo "==> [${env}] Creating Web App: ${webapp}"
      # Runtime strings can vary by CLI version. If this fails, run:
      #   az webapp list-runtimes --os linux
      az webapp create \
        --name "$webapp" \
        --resource-group "$rg" \
        --plan "$plan" \
        --runtime "NODE|20-lts" >/dev/null
    fi

    az webapp update --name "$webapp" --resource-group "$rg" --https-only true >/dev/null

    echo "==> [${env}] Enabling system-assigned managed identity for Web App"
    webappPrincipalId="$(az webapp identity assign --name "$webapp" --resource-group "$rg" --query principalId -o tsv)"
  fi

  echo "==> [${env}] Creating Key Vault: ${kv}"
  # Key Vault name constraints:
  # - 3-24 chars
  # - letters, digits, and hyphens
  # - globally unique
  if az keyvault show --name "$kv" --resource-group "$rg" >/dev/null 2>&1; then
    echo "==> [${env}] Key Vault already exists; skipping create"
  else
    az keyvault create \
      --name "$kv" \
      --resource-group "$rg" \
      --location "$LOCATION" >/dev/null
  fi

  # Key Vault can be configured either with access policies OR RBAC authorization.
  # If RBAC is enabled, access policies cannot be set.
  local kvRbacEnabled
  kvRbacEnabled="$(az keyvault show --name "$kv" --resource-group "$rg" --query properties.enableRbacAuthorization -o tsv)"
  local kvId
  kvId="$(az keyvault show --name "$kv" --resource-group "$rg" --query id -o tsv)"

  if [[ "$kvRbacEnabled" == "true" ]]; then
    echo "==> [${env}] Ensuring current user can manage Key Vault secrets (RBAC mode)"
    ensure_current_user_can_manage_kv_secrets_rbac "$kvId" "$kv"
  fi

  if [[ "$SKIP_WEB" != "true" ]]; then
    echo "==> [${env}] Granting Web App identity permission to read secrets"

    if [[ "$kvRbacEnabled" == "true" ]]; then
      az role assignment create \
        --assignee-object-id "$webappPrincipalId" \
        --assignee-principal-type ServicePrincipal \
        --role "Key Vault Secrets User" \
        --scope "$kvId" >/dev/null
    else
      az keyvault set-policy \
        --name "$kv" \
        --object-id "$webappPrincipalId" \
        --secret-permissions get list >/dev/null
    fi
  fi
  local databaseUrlSecretUri=""
  local azureMapsKeySecretUri=""
  local azureMapsSasSecretUri=""
  if [[ "$SKIP_DB" != "true" ]]; then
    if az postgres flexible-server show --resource-group "$rg" --name "$pgServer" >/dev/null 2>&1; then
      echo "==> [${env}] PostgreSQL server exists; skipping create: ${pgServer}"
      echo "==> [${env}] NOTE: Skipping Key Vault DB secret creation to avoid overwriting unknown credentials"
    else
      echo "==> [${env}] Creating PostgreSQL Flexible Server: ${pgServer}"
      local pgAdminPassword
      pgAdminPassword="$(gen_password)"

      # This is a minimal, best-effort create. For production, prefer private networking.
      az postgres flexible-server create \
        --name "$pgServer" \
        --resource-group "$rg" \
        --location "$PG_LOCATION" \
        --tier Burstable \
        --sku-name Standard_B1ms \
        --storage-size 32 \
        --version 16 \
        --admin-user "$PG_ADMIN_USER" \
        --admin-password "$pgAdminPassword" \
        --yes >/dev/null

      echo "==> [${env}] Creating database: ${dbName}"
      az postgres flexible-server db create \
        --resource-group "$rg" \
        --server-name "$pgServer" \
        --database-name "$dbName" >/dev/null

      echo "==> [${env}] Storing DB credentials in Key Vault"
      local tmp
      tmp="$(mktemp)"
      chmod 600 "$tmp"

      printf %s "$PG_ADMIN_USER" >"$tmp"
      az keyvault secret set --vault-name "$kv" --name "pg-admin-user" --file "$tmp" >/dev/null

      printf %s "$pgAdminPassword" >"$tmp"
      az keyvault secret set --vault-name "$kv" --name "pg-admin-password" --file "$tmp" >/dev/null

      # NOTE: Azure Postgres connection strings may require SSL in non-local environments.
      # Keep sslmode=require for staging/prod. For local dev, use sslmode=disable.
      local dbHost="${pgServer}.postgres.database.azure.com"
      local dbUser="${PG_ADMIN_USER}@${pgServer}"
      local databaseUrl="postgresql://${dbUser}:${pgAdminPassword}@${dbHost}:5432/${dbName}?sslmode=require"

      printf %s "$databaseUrl" >"$tmp"
      az keyvault secret set --vault-name "$kv" --name "database-url" --file "$tmp" >/dev/null

      rm -f "$tmp"

      databaseUrlSecretUri="$(az keyvault secret show --vault-name "$kv" --name "database-url" --query id -o tsv)"
    fi
  fi

  if [[ "$SKIP_WEB" != "true" ]]; then
    if az maps account show --name "$mapsAccount" --resource-group "$rg" >/dev/null 2>&1; then
      echo "==> [${env}] Azure Maps account exists; skipping create: ${mapsAccount}"
    else
      echo "==> [${env}] Creating Azure Maps account: ${mapsAccount}"
      az maps account create \
        --account-name "$mapsAccount" \
        --resource-group "$rg" \
        --location "$LOCATION" \
        --kind Gen2 \
        --sku G2 \
        --accept-tos \
        --disable-local-auth false >/dev/null
    fi

    echo "==> [${env}] Storing Azure Maps secrets in Key Vault"
    local tmp
    tmp="$(mktemp)"
    chmod 600 "$tmp"

    local mapsKey
    mapsKey="$(az maps account keys list --name "$mapsAccount" --resource-group "$rg" --query primaryKey -o tsv)"

    printf %s "$mapsKey" >"$tmp"
    az keyvault secret set --vault-name "$kv" --name "azure-maps-key" --file "$tmp" >/dev/null

    printf %s "$AZURE_MAPS_SAS_TOKEN" >"$tmp"
    az keyvault secret set --vault-name "$kv" --name "azure-maps-sas-token" --file "$tmp" >/dev/null

    rm -f "$tmp"

    azureMapsKeySecretUri="$(az keyvault secret show --vault-name "$kv" --name "azure-maps-key" --query id -o tsv)"
    azureMapsSasSecretUri="$(az keyvault secret show --vault-name "$kv" --name "azure-maps-sas-token" --query id -o tsv)"
  fi

  if [[ "$SKIP_WEB" != "true" ]]; then
    echo "==> [${env}] Configuring Web App settings"
    # Use Key Vault reference so secrets do not appear in App Service settings.
    # NOTE: This requires the Web App managed identity policy above.
    local settings=(
      "NODE_ENV=production"
      "NEXT_TELEMETRY_DISABLED=1"
      "SCM_DO_BUILD_DURING_DEPLOYMENT=true"
    )

    if [[ -n "$databaseUrlSecretUri" ]]; then
      settings+=("DATABASE_URL=@Microsoft.KeyVault(SecretUri=${databaseUrlSecretUri})")
    fi
    if [[ -n "$azureMapsKeySecretUri" ]]; then
      settings+=("AZURE_MAPS_KEY=@Microsoft.KeyVault(SecretUri=${azureMapsKeySecretUri})")
    fi
    if [[ -n "$azureMapsSasSecretUri" ]]; then
      settings+=("AZURE_MAPS_SAS_TOKEN=@Microsoft.KeyVault(SecretUri=${azureMapsSasSecretUri})")
    fi

    az webapp config appsettings set \
      --name "$webapp" \
      --resource-group "$rg" \
      --settings "${settings[@]}" >/dev/null
  fi

  echo "==> [${env}] Done"
  if [[ "$SKIP_WEB" != "true" ]]; then
    echo "    Web App URL: https://${webapp}.azurewebsites.net"
    echo "    Azure Maps:  ${mapsAccount}"
  fi
  echo "    Key Vault:   ${kv}"
  if [[ "$SKIP_DB" != "true" ]]; then
    echo "    Postgres:    ${pgServer}"
  fi
}

IFS=',' read -r -a envs <<<"$ENVS_CSV"

for env in "${envs[@]}"; do
  case "$env" in
    dev|staging|prod) create_env "$env" ;;
    *)
      echo "Invalid env: $env (expected dev,staging,prod)" >&2
      exit 1
      ;;
  esac
done

if [[ -n "$PROD_HOSTNAME" ]]; then
  rg="${PREFIX}-prod-rg"
  webapp="${PREFIX}-prod-web"
  echo "==> [prod] Adding custom hostname: ${PROD_HOSTNAME}"
  az webapp config hostname add --resource-group "$rg" --webapp-name "$webapp" --hostname "$PROD_HOSTNAME" >/dev/null

  cat <<EOF
==> [prod] DNS step required
Create a CNAME record:
  ${PROD_HOSTNAME}  ->  ${webapp}.azurewebsites.net

After DNS propagates, create and bind a managed certificate:
  az webapp config ssl create --resource-group "$rg" --name "$webapp" --hostname "$PROD_HOSTNAME"
  # Then bind the returned thumbprint:
  az webapp config ssl bind --resource-group "$rg" --name "$webapp" --certificate-thumbprint <thumbprint> --ssl-type SNI
EOF
fi
