#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  rotate-maps-sas.sh --resource-group <rg> --webapp-name <name> [options]

Required:
  --resource-group        Azure resource group containing the web app and maps account
  --webapp-name           Azure Web App name

Optional:
  --maps-account-name     Azure Maps account name (default: derive from web app name if it ends with -web)
  --keyvault-name         Key Vault name to sync the rotated token into
  --expiry-hours          SAS lifetime in hours, must be < 24 (default: 12)
  --max-rate-per-second   Maps SAS max rate per second (default: 500)
  --verify-url            URL to verify after rotation (default: https://<webapp>.azurewebsites.net/api/maps/token)
  --subscription          Azure subscription id/name override
  --skip-keyvault-sync    Do not write the rotated SAS token back to Key Vault

Notes:
  - This script updates the live App Service setting AZURE_MAPS_SAS_TOKEN directly,
    because the production runtime currently consumes the direct setting reliably.
  - If --keyvault-name is provided and --skip-keyvault-sync is not set, the script also
    updates the azure-maps-sas-token secret for operational parity.
EOF
}

RESOURCE_GROUP=""
WEBAPP_NAME=""
MAPS_ACCOUNT_NAME=""
KEYVAULT_NAME=""
EXPIRY_HOURS="12"
MAX_RATE_PER_SECOND="500"
VERIFY_URL=""
SUBSCRIPTION=""
SKIP_KEYVAULT_SYNC="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --resource-group)
      RESOURCE_GROUP="$2"; shift 2 ;;
    --webapp-name)
      WEBAPP_NAME="$2"; shift 2 ;;
    --maps-account-name)
      MAPS_ACCOUNT_NAME="$2"; shift 2 ;;
    --keyvault-name)
      KEYVAULT_NAME="$2"; shift 2 ;;
    --expiry-hours)
      EXPIRY_HOURS="$2"; shift 2 ;;
    --max-rate-per-second)
      MAX_RATE_PER_SECOND="$2"; shift 2 ;;
    --verify-url)
      VERIFY_URL="$2"; shift 2 ;;
    --subscription)
      SUBSCRIPTION="$2"; shift 2 ;;
    --skip-keyvault-sync)
      SKIP_KEYVAULT_SYNC="true"; shift 1 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 1 ;;
  esac
done

if [[ -z "$RESOURCE_GROUP" || -z "$WEBAPP_NAME" ]]; then
  usage
  exit 1
fi

command -v az >/dev/null 2>&1 || { echo "Missing command: az" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "Missing command: curl" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Missing command: node" >&2; exit 1; }

if [[ -n "$SUBSCRIPTION" ]]; then
  az account set --subscription "$SUBSCRIPTION"
fi

if [[ -z "$MAPS_ACCOUNT_NAME" ]]; then
  if [[ "$WEBAPP_NAME" == *-web ]]; then
    MAPS_ACCOUNT_NAME="${WEBAPP_NAME%-web}-maps"
  else
    echo "--maps-account-name is required when the web app name does not end with -web" >&2
    exit 1
  fi
fi

if [[ -z "$VERIFY_URL" ]]; then
  VERIFY_URL="https://${WEBAPP_NAME}.azurewebsites.net/api/maps/token"
fi

if ! [[ "$EXPIRY_HOURS" =~ ^[0-9]+$ ]] || (( EXPIRY_HOURS < 1 || EXPIRY_HOURS > 23 )); then
  echo "--expiry-hours must be an integer between 1 and 23" >&2
  exit 1
fi

if ! [[ "$MAX_RATE_PER_SECOND" =~ ^[0-9]+$ ]] || (( MAX_RATE_PER_SECOND < 1 )); then
  echo "--max-rate-per-second must be a positive integer" >&2
  exit 1
fi

WEBAPP_PRINCIPAL_ID="$(az webapp identity show --resource-group "$RESOURCE_GROUP" --name "$WEBAPP_NAME" --query principalId -o tsv)"
if [[ -z "$WEBAPP_PRINCIPAL_ID" ]]; then
  echo "Could not resolve web app managed identity principalId" >&2
  exit 1
fi

MAPS_RESOURCE_ID="$(az resource show --resource-group "$RESOURCE_GROUP" --resource-type Microsoft.Maps/accounts --name "$MAPS_ACCOUNT_NAME" --query id -o tsv)"
if [[ -z "$MAPS_RESOURCE_ID" ]]; then
  echo "Could not resolve Azure Maps account resource id" >&2
  exit 1
fi

START_UTC="$(date -u -d '-5 minutes' +"%Y-%m-%dT%H:%M:%SZ")"
EXPIRY_UTC="$(date -u -d "+${EXPIRY_HOURS} hours" +"%Y-%m-%dT%H:%M:%SZ")"
REQUEST_BODY=$(cat <<EOF
{
  "start": "${START_UTC}",
  "expiry": "${EXPIRY_UTC}",
  "principalId": "${WEBAPP_PRINCIPAL_ID}",
  "regions": ["global"],
  "signingKey": "primaryKey",
  "maxRatePerSecond": ${MAX_RATE_PER_SECOND}
}
EOF
)

TOKEN="$(az rest \
  --method post \
  --url "https://management.azure.com${MAPS_RESOURCE_ID}/listSas?api-version=2023-06-01" \
  --body "$REQUEST_BODY" \
  --query accountSasToken \
  -o tsv)"

if [[ -z "$TOKEN" ]]; then
  echo "Azure Maps SAS rotation returned an empty token" >&2
  exit 1
fi

if [[ "$SKIP_KEYVAULT_SYNC" != "true" && -n "$KEYVAULT_NAME" ]]; then
  az keyvault secret set \
    --vault-name "$KEYVAULT_NAME" \
    --name azure-maps-sas-token \
    --value "$TOKEN" \
    --output none
fi

az webapp config appsettings set \
  --resource-group "$RESOURCE_GROUP" \
  --name "$WEBAPP_NAME" \
  --settings "AZURE_MAPS_SAS_TOKEN=$TOKEN" \
  --output none

echo "Rotated Azure Maps SAS token (length=${#TOKEN}, expires=${EXPIRY_UTC})."
echo "Waiting for App Service restart and warm-up..."
sleep 60

RESPONSE_FILE="$(mktemp)"
HTTP_STATUS="$(curl -sS --max-time 90 -o "$RESPONSE_FILE" -w '%{http_code}' "$VERIFY_URL")"
echo "Maps broker verify status=${HTTP_STATUS}"

if [[ "$HTTP_STATUS" != "200" ]]; then
  cat "$RESPONSE_FILE"
  echo "Azure Maps broker verification failed" >&2
  exit 1
fi

node -e "const fs=require('fs'); const body=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(body.authType!=='sas' || !body.sasToken){console.error('Broker response missing sas payload'); process.exit(1)} console.log('MAPS_TOKEN_BROKER=ok')" "$RESPONSE_FILE"
