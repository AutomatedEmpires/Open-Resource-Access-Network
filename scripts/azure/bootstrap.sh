#!/usr/bin/env bash
set -euo pipefail

# ORAN Azure bootstrap (App Service + PostgreSQL Flexible Server + Key Vault)
#
# This script provisions resource groups + core resources for dev/staging/prod.
# It intentionally avoids printing secrets.
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

usage() {
  cat <<'EOF'
Usage:
  bootstrap.sh --prefix <name> --location <azure-region> --environments <csv>

Required:
  --prefix         Resource name prefix (e.g., oran)
  --location       Azure region (e.g., westus2)
  --environments   Comma-separated list: dev,staging,prod

Optional:
  --pg-admin-user  PostgreSQL admin username (default: oranadmin)
  --prod-hostname  Custom hostname for prod webapp (e.g., app.example.com)

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
PG_ADMIN_USER="oranadmin"
PROD_HOSTNAME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix)
      PREFIX="$2"; shift 2 ;;
    --location)
      LOCATION="$2"; shift 2 ;;
    --environments)
      ENVS_CSV="$2"; shift 2 ;;
    --pg-admin-user)
      PG_ADMIN_USER="$2"; shift 2 ;;
    --prod-hostname)
      PROD_HOSTNAME="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$PREFIX" || -z "$LOCATION" || -z "$ENVS_CSV" ]]; then
  usage
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

create_env() {
  local env="$1"

  local rg="${PREFIX}-${env}-rg"
  local plan="${PREFIX}-${env}-plan"
  local webapp="${PREFIX}-${env}-web"
  local kv="${PREFIX}-${env}-kv"
  local pgServer="${PREFIX}-${env}-pg"
  local dbName="oran_db"

  echo "==> [${env}] Creating resource group: ${rg}"
  az group create --name "$rg" --location "$LOCATION" >/dev/null

  echo "==> [${env}] Creating App Service plan: ${plan}"
  az appservice plan create \
    --name "$plan" \
    --resource-group "$rg" \
    --location "$LOCATION" \
    --is-linux \
    --sku B1 >/dev/null

  echo "==> [${env}] Creating Web App: ${webapp}"
  # Runtime strings can vary by CLI version. If this fails, run:
  #   az webapp list-runtimes --os linux
  az webapp create \
    --name "$webapp" \
    --resource-group "$rg" \
    --plan "$plan" \
    --runtime "NODE|20-lts" >/dev/null

  az webapp update --name "$webapp" --resource-group "$rg" --https-only true >/dev/null

  echo "==> [${env}] Enabling system-assigned managed identity for Web App"
  local webappPrincipalId
  webappPrincipalId="$(az webapp identity assign --name "$webapp" --resource-group "$rg" --query principalId -o tsv)"

  echo "==> [${env}] Creating Key Vault: ${kv}"
  # Key Vault name constraints:
  # - 3-24 chars
  # - letters, digits, and hyphens
  # - globally unique
  az keyvault create \
    --name "$kv" \
    --resource-group "$rg" \
    --location "$LOCATION" >/dev/null

  echo "==> [${env}] Granting Web App identity permission to read secrets"
  # Uses Key Vault access policies (not RBAC). If your org enforces RBAC-only vaults,
  # you'll need to assign the appropriate RBAC role instead.
  az keyvault set-policy \
    --name "$kv" \
    --object-id "$webappPrincipalId" \
    --secret-permissions get list >/dev/null

  echo "==> [${env}] Creating PostgreSQL Flexible Server: ${pgServer}"
  local pgAdminPassword
  pgAdminPassword="$(gen_password)"

  # This is a minimal, best-effort create. For production, prefer private networking.
  az postgres flexible-server create \
    --name "$pgServer" \
    --resource-group "$rg" \
    --location "$LOCATION" \
    --tier Burstable \
    --sku-name Standard_B1ms \
    --storage-size 32 \
    --version 16 \
    --admin-user "$PG_ADMIN_USER" \
    --admin-password "$pgAdminPassword" \
    --database-name "$dbName" \
    --yes >/dev/null

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

  local databaseUrlSecretUri
  databaseUrlSecretUri="$(az keyvault secret show --vault-name "$kv" --name "database-url" --query id -o tsv)"

  echo "==> [${env}] Configuring Web App settings"
  # Use Key Vault reference so secrets do not appear in App Service settings.
  # NOTE: This requires the Web App managed identity policy above.
  az webapp config appsettings set \
    --name "$webapp" \
    --resource-group "$rg" \
    --settings \
      "NODE_ENV=production" \
      "NEXT_TELEMETRY_DISABLED=1" \
      "SCM_DO_BUILD_DURING_DEPLOYMENT=true" \
      "DATABASE_URL=@Microsoft.KeyVault(SecretUri=${databaseUrlSecretUri})" >/dev/null

  echo "==> [${env}] Done"
  echo "    Web App URL: https://${webapp}.azurewebsites.net"
  echo "    Key Vault:   ${kv}"
  echo "    Postgres:    ${pgServer}"
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
