#!/usr/bin/env bash
set -euo pipefail

# ORAN GitHub Actions -> Azure OIDC setup helper
#
# Creates:
# - Azure AD app registration + service principal
# - Role assignment for deploying to a specific resource group
# - Federated credential for GitHub Actions (repo + environment)
#
# Prereqs:
# - Azure CLI installed and logged in: az login
# - You have permission to create app registrations + role assignments
# - You know the GitHub org/user + repo name
#
# Usage (example):
#   ./scripts/azure/github-oidc.sh \
#     --app-name oran-gha-deploy \
#     --resource-group oran-prod-rg \
#     --github-owner AutomatedEmpires \
#     --github-repo Open-Resource-Access-Network \
#     --github-environment production
#
# Output:
# - Prints values to set as GitHub secrets:
#   AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, AZURE_WEBAPP_NAME

usage() {
  cat <<'EOF'
Usage:
  github-oidc.sh --app-name <name> --resource-group <rg> --github-owner <owner> --github-repo <repo> --github-environment <env>

Required:
  --app-name            Azure AD app registration name
  --resource-group      Resource group that contains the target Web App
  --github-owner        GitHub org/user
  --github-repo         GitHub repository name
  --github-environment  GitHub Actions environment name (e.g., production)

Optional:
  --webapp-name         Azure Web App name (for printing AZURE_WEBAPP_NAME)
  --role                Azure role for deployment (default: Contributor)
  --subject-format      Token subject format (default: environment)

Notes:
- Subject formats:
  - environment: repo:<owner>/<repo>:environment:<env>
  - branch: repo:<owner>/<repo>:ref:refs/heads/<branch>
EOF
}

APP_NAME=""
RESOURCE_GROUP=""
WEBAPP_NAME=""
GITHUB_OWNER=""
GITHUB_REPO=""
GITHUB_ENVIRONMENT=""
ROLE="Contributor"
SUBJECT_FORMAT="environment"

truncate() {
  local s="$1"
  local max="$2"
  if (( ${#s} <= max )); then
    printf '%s' "$s"
  else
    printf '%s' "${s:0:max}"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-name)
      APP_NAME="$2"; shift 2 ;;
    --resource-group)
      RESOURCE_GROUP="$2"; shift 2 ;;
    --webapp-name)
      WEBAPP_NAME="$2"; shift 2 ;;
    --github-owner)
      GITHUB_OWNER="$2"; shift 2 ;;
    --github-repo)
      GITHUB_REPO="$2"; shift 2 ;;
    --github-environment)
      GITHUB_ENVIRONMENT="$2"; shift 2 ;;
    --role)
      ROLE="$2"; shift 2 ;;
    --subject-format)
      SUBJECT_FORMAT="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$APP_NAME" || -z "$RESOURCE_GROUP" || -z "$GITHUB_OWNER" || -z "$GITHUB_REPO" || -z "$GITHUB_ENVIRONMENT" ]]; then
  usage
  exit 1
fi

command -v az >/dev/null 2>&1 || { echo "Missing command: az" >&2; exit 1; }

if ! az account show >/dev/null 2>&1; then
  echo "Not logged into Azure CLI. Run: az login" >&2
  exit 1
fi

SUBSCRIPTION_ID="$(az account show --query id -o tsv)"
TENANT_ID="$(az account show --query tenantId -o tsv)"

RG_ID="$(az group show --name "$RESOURCE_GROUP" --query id -o tsv)"

echo "==> Ensuring app registration exists: $APP_NAME"
APP_ID="$(az ad app list --display-name "$APP_NAME" --query '[0].appId' -o tsv 2>/dev/null || true)"
if [[ -z "$APP_ID" || "$APP_ID" == "None" ]]; then
  APP_ID="$(az ad app create --display-name "$APP_NAME" --query appId -o tsv)"
fi

echo "==> Ensuring service principal exists"
SP_ID="$(az ad sp show --id "$APP_ID" --query id -o tsv 2>/dev/null || true)"
if [[ -z "$SP_ID" || "$SP_ID" == "None" ]]; then
  SP_ID="$(az ad sp create --id "$APP_ID" --query id -o tsv)"
fi

echo "==> Assigning role '$ROLE' on resource group"
az role assignment create --assignee-object-id "$SP_ID" --assignee-principal-type ServicePrincipal --role "$ROLE" --scope "$RG_ID" >/dev/null

case "$SUBJECT_FORMAT" in
  environment)
    SUBJECT="repo:${GITHUB_OWNER}/${GITHUB_REPO}:environment:${GITHUB_ENVIRONMENT}"
    ;;
  branch)
    echo "For branch subject format, pass --subject-format branch and set GITHUB_ENVIRONMENT to the branch name." >&2
    SUBJECT="repo:${GITHUB_OWNER}/${GITHUB_REPO}:ref:refs/heads/${GITHUB_ENVIRONMENT}"
    ;;
  *)
    echo "Invalid --subject-format: $SUBJECT_FORMAT" >&2
    exit 1
    ;;
esac

CRED_NAME_RAW="github-${GITHUB_OWNER}-${GITHUB_REPO}-${GITHUB_ENVIRONMENT}"
# Federated credential name has a length limit; keep it deterministic.
CRED_NAME="$(truncate "$CRED_NAME_RAW" 120)"

echo "==> Creating federated credential: $CRED_NAME"
# Uses GitHub's OIDC issuer and audience for Azure.
EXISTING_CRED="$(az ad app federated-credential list --id "$APP_ID" --query "[?name=='${CRED_NAME}'].name | [0]" -o tsv 2>/dev/null || true)"
if [[ -n "$EXISTING_CRED" && "$EXISTING_CRED" != "None" ]]; then
  echo "==> Federated credential already exists; skipping create"
else
  tmp_json="$(mktemp)"
  trap 'rm -f "$tmp_json"' EXIT

  cat >"$tmp_json" <<JSON
{
  "name": "${CRED_NAME}",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "${SUBJECT}",
  "description": "GitHub Actions OIDC for ${GITHUB_OWNER}/${GITHUB_REPO} (${GITHUB_ENVIRONMENT})",
  "audiences": ["api://AzureADTokenExchange"]
}
JSON

  az ad app federated-credential create --id "$APP_ID" --parameters "$tmp_json" >/dev/null
fi

cat <<EOF

==> Set these GitHub repository secrets:
AZURE_CLIENT_ID=${APP_ID}
AZURE_TENANT_ID=${TENANT_ID}
AZURE_SUBSCRIPTION_ID=${SUBSCRIPTION_ID}
AZURE_RESOURCE_GROUP=${RESOURCE_GROUP}

AZURE_WEBAPP_NAME=${WEBAPP_NAME:-<your-webapp-name>}

==> Also set this GitHub repository variable:
AZURE_DEPLOY_ENABLED=true

Next:
- Ensure your Web App name matches the workflow secret AZURE_WEBAPP_NAME.
- Then run the workflow: Deploy (Azure App Service)
EOF
