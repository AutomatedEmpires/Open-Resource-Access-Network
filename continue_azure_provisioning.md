# Continue Azure Provisioning (Handoff)

This document is a comprehensive handoff for continuing Azure provisioning and deployment for ORAN.

It is written for a *new agent* picking up work in VS Code/Codespaces.

**Security / privacy rule for this handoff**
- Do **not** print secret values (DB password, `DATABASE_URL`, Clerk keys, etc.).
- Only print *resource names*, *IDs*, and *configuration keys*. This repo is safety/privacy sensitive.

---

## 0) TL;DR (Current status)

**Production Azure subscription is now Pay‑As‑You‑Go under `jackson@automatedempires.com`.**

Production infrastructure in `westus2` is **successfully provisioned** and appears complete:
- Resource Group exists
- App Service plan + Web App exist, Web App is Running
- Key Vault exists and is RBAC-enabled
- PostgreSQL Flexible Server exists and is `Ready`
- Key Vault contains expected secret names
- Web App has `DATABASE_URL` configured as a Key Vault reference
- Postgres DB `oran_db` exists

Remaining work is primarily **deployment automation + governance**:
- Configure GitHub Actions OIDC (or alternative) for deployments
- Set budgets/alerts and “minimum spend” defaults
- Decide and implement RBAC for additional accounts (startup/student)
- (Optionally) provision staging/dev subscriptions or RGs

---

## 1) Repository context

Repo: `AutomatedEmpires/Open-Resource-Access-Network`
- Branch used during this work: `codespace`

Key runbooks/scripts:
- Azure deploy runbook: [docs/DEPLOYMENT_AZURE.md](docs/DEPLOYMENT_AZURE.md)
- Provisioning script: [scripts/azure/bootstrap.sh](scripts/azure/bootstrap.sh)
- GitHub OIDC helper: [scripts/azure/github-oidc.sh](scripts/azure/github-oidc.sh)

Important SSOT/constraints:
- ORAN safety constraints in `.github/copilot-instructions.md` (retrieval-first, crisis gate, privacy-first).

---

## 2) Azure identity terms (for the human)

**Entra ID** (formerly “Azure Active Directory”) is Microsoft’s identity directory for a tenant. It holds:
- Users (e.g., `jackson@automatedempires.com`)
- Guest users (e.g., external accounts invited into the tenant)
- App registrations / service principals
- Roles and permissions

In practice:
- **Subscription** = billing + quota + where resources live.
- **Tenant (Entra ID)** = the identity boundary that controls who can do what.

---

## 3) What problems we hit earlier (and why it felt like spinning)

This history matters because it explains why we stabilized on Pay‑As‑You‑Go for prod.

### 3.1 Resource providers not registered
New subscriptions often start with providers unregistered. Creates can fail or behave inconsistently until:
- `Microsoft.Web`
- `Microsoft.KeyVault`
- `Microsoft.DBforPostgreSQL`
are registered.

We added logic to `bootstrap.sh` to auto-register and wait.

### 3.2 App Service quota = 0 in Startup subscription
In the **startup** subscription, Azure returned quota errors like:
- “Current Limit (Basic VMs): 0”
- “Current Limit (Standard VMs): 0”
which prevented App Service plan creation.

This is an offer/quota constraint, independent of credits.

### 3.3 Postgres “location restricted” in Startup subscription
In the startup subscription, Postgres creation returned:
- “The location is restricted from performing this operation.”

This is also offer/policy/region restriction.

### 3.4 Key Vault RBAC default prevented secret operations
Key Vault was created in RBAC mode (`enableRbacAuthorization=true`) and the signed-in user initially could not list/set secrets.

We updated `bootstrap.sh` to best-effort self-grant `Key Vault Secrets Officer` for the signed-in user on the vault scope (so the bootstrap can set secrets).

---

## 4) Current Azure context (verified)

### 4.1 Active subscription
As of the last verification, Azure CLI was authenticated as:
- User: `jackson@automatedempires.com`
- Subscription ID: `e3d708a7-6264-451c-bd7e-670fecfbf4fa`
- Tenant ID: `823dc1e7-3a05-4466-8968-2962d122d5dd`
- Subscription name: `Azure subscription 1` (name can be changed later)

Verification command:
```bash
az account show --query '{id:id,name:name,tenantId:tenantId,user:user.name}' -o jsonc
```

### 4.2 Production resources (prefix `oranhf57ir`)
Region: `westus2`

Resource Group:
- `oranhf57ir-prod-rg`

Resources present in the RG:
- App Service plan: `oranhf57ir-prod-plan`
- Web App: `oranhf57ir-prod-web`
- Key Vault: `oranhf57ir-prod-kv` (RBAC enabled)
- Postgres flexible server: `oranhf57ir-prod-pg`

Web App endpoint:
- `https://oranhf57ir-prod-web.azurewebsites.net`

Postgres state:
- `Ready` (SKU: `Standard_B1ms`, region: West US 2)

Key Vault secrets (names only):
- `database-url`
- `pg-admin-password`
- `pg-admin-user`

Web App appsettings keys include:
- `DATABASE_URL`
- `NODE_ENV`
- `NEXT_TELEMETRY_DISABLED`
- `SCM_DO_BUILD_DURING_DEPLOYMENT`

Postgres DBs include:
- `oran_db`

Verification commands (safe: no secret values):
```bash
rg=oranhf57ir-prod-rg
kv=oranhf57ir-prod-kv
web=oranhf57ir-prod-web
pg=oranhf57ir-prod-pg

az group show -n "$rg" -o table
az resource list -g "$rg" --query "[].{name:name,type:type,location:location}" -o table
az webapp list -g "$rg" --query "[].{name:name,state:state,defaultHostName:defaultHostName}" -o table
az keyvault list -g "$rg" --query "[].{name:name,enableRbacAuthorization:properties.enableRbacAuthorization}" -o table
az postgres flexible-server list -g "$rg" --query "[].{name:name,state:state,location:location,sku:sku.name}" -o table

az keyvault secret list --vault-name "$kv" --query "[].name" -o tsv | sort
az webapp config appsettings list -g "$rg" -n "$web" --query "[].name" -o tsv | sort
az postgres flexible-server db list -g "$rg" -s "$pg" --query "[].name" -o tsv | sort
```

---

## 5) Code changes made locally (important)

### 5.1 `bootstrap.sh` enhancements (uncommitted)
[scripts/azure/bootstrap.sh](scripts/azure/bootstrap.sh) has been modified locally. Key additions:
- `--skip-web` and `--skip-db`
- Provider auto-registration + waiting (`Microsoft.Web`, `Microsoft.KeyVault`, `Microsoft.DBforPostgreSQL`)
- Key Vault RBAC helper to ensure the signed-in user can set secrets (`Key Vault Secrets Officer`) when vault is RBAC-enabled
- Idempotency for App Service plan and Web App (skip create if already exists)
- Safety behavior: if Postgres already exists, it **does not overwrite** Key Vault DB secrets (to avoid credential mismatches)

This is meant to reduce “spin” and make repeated runs safe.

Check working tree:
```bash
git status --porcelain
```

If you plan to keep these script changes, create a PR or commit them after validating in a clean environment.

### 5.2 Engineering log
[docs/ENGINEERING_LOG.md](docs/ENGINEERING_LOG.md) is modified locally (append-only log). Confirm it doesn’t contain PII before committing.

---

## 6) What is incomplete / next tasks (ordered)

### 6.1 Deployment automation (GitHub Actions OIDC)
Goal: deploy from GitHub Actions to `oranhf57ir-prod-web` without storing long-lived Azure credentials.

Approach:
1) Run the helper script:
   ```bash
  bash scripts/azure/github-oidc.sh \
    --app-name oranhf57ir-gha-deploy \
    --resource-group oranhf57ir-prod-rg \
    --webapp-name oranhf57ir-prod-web \
    --github-owner AutomatedEmpires \
    --github-repo Open-Resource-Access-Network \
    --github-environment production
   ```
  (If the script supports different flags in your current branch, open it and follow usage.)

  Notes:
  - The workflow uses `environment: production` (see `.github/workflows/deploy-azure-appservice.yml`), so the federated credential subject should be environment-based.

2) In GitHub repo settings, set secrets/vars expected by workflow:
   - `AZURE_CLIENT_ID`
   - `AZURE_TENANT_ID`
   - `AZURE_SUBSCRIPTION_ID`
   - `AZURE_RESOURCE_GROUP`
   - `AZURE_WEBAPP_NAME`
   - Repo variable: `AZURE_DEPLOY_ENABLED=true`

  Codespaces note:
  - The Codespaces-provided `GITHUB_TOKEN` may not have permission to manage Actions secrets/vars (you may see `HTTP 403: Resource not accessible by integration`).
  - If so, authenticate `gh` as a GitHub user (device/web flow) and then set secrets/vars via `gh`, or set them manually in the GitHub UI.

3) Trigger the workflow:
   - Workflow file: `.github/workflows/deploy-azure-appservice.yml`

Verification:
- After deploy, confirm site responds:
  `https://oranhf57ir-prod-web.azurewebsites.net`

### 6.2 Budgets + cost controls (minimize spend)
User intent: keep prod spend minimal while using startup/student credits for build/test.

Recommended baseline actions in the **Pay‑As‑You‑Go prod subscription**:
- Cost Management -> Budgets:
  - Create a monthly budget with alerts at 50% / 80% / 100%
- Consider stopping non-essential resources when not needed:
  - Postgres Flexible Server can often be stopped (if supported) to reduce compute spend.
  - App Service: choose the smallest SKU that still works for production requirements.

### 6.3 Access model (do NOT add everyone as subscription Owner by default)
User asked whether to add startup/student accounts as “owners”. Recommended:

- Keep `jackson@automatedempires.com` as the primary **Owner**.
- Invite `automatedempires@outlook.com` and `jackson.cole@snhu.edu` as **guest users** in the `jackson@automatedempires.com` tenant.
- Grant *least privilege*:
  - For day-to-day ops: `Contributor` on the prod resource group (`oranhf57ir-prod-rg`)
  - For Key Vault secret management (if needed): `Key Vault Secrets Officer` on the vault scope
  - Avoid `Owner` at subscription scope unless absolutely required.

Commands (example) to grant RG Contributor:
```bash
SUB_ID=e3d708a7-6264-451c-bd7e-670fecfbf4fa
RG=oranhf57ir-prod-rg
SCOPE="/subscriptions/${SUB_ID}/resourceGroups/${RG}"

# Use the guest user objectId once invited.
az role assignment create \
  --assignee-object-id <GUEST_OBJECT_ID> \
  --assignee-principal-type User \
  --role Contributor \
  --scope "$SCOPE"
```

### 6.4 Staging/dev strategy (use credits)
Non-prod can live in:
- startup subscription (`automatedempires@outlook.com`)
- student subscription (`jackson.cole@snhu.edu`)

But only if those subscriptions allow required resources in the chosen region.

Recommended pattern:
- Use the same `bootstrap.sh` in those subscriptions with separate prefixes:
  - `oran<suffix>-dev-*`
  - `oran<suffix>-staging-*`

If those subscriptions have quota/policy restrictions, use:
- different region, or
- `--skip-web` / `--skip-db` to provision only what’s allowed.

---

## 7) Known-good provisioning command (prod)

In the Pay‑As‑You‑Go subscription, provisioning that led to the above state is effectively:
```bash
# Make sure Azure CLI is on the prod subscription
az account set --subscription e3d708a7-6264-451c-bd7e-670fecfbf4fa

# Provision prod
bash scripts/azure/bootstrap.sh \
  --prefix oranhf57ir \
  --location westus2 \
  --environments prod
```

Notes:
- `bootstrap.sh` is intentionally designed not to print secret values.
- The script uses Key Vault references so secrets don’t live directly in App Service settings.

---

## 8) Safety / correctness verification checklist

After provisioning/deploying:
- Confirm Web App is `Running` and HTTPS-only.
- Confirm Key Vault is RBAC-enabled and:
  - has the 3 expected secrets (names only)
  - Web App managed identity has permission to read secrets (Key Vault Secrets User)
- Confirm Postgres is `Ready` and `oran_db` exists.
- Confirm Web App appsettings include `DATABASE_URL` key.

---

## 9) If anything breaks (fast diagnostics)

### 9.1 “ForbiddenByRbac” on Key Vault
Cause: RBAC mode requires role assignments for data-plane actions.
Fix:
- Assign `Key Vault Secrets Officer` (to set/list secrets) for the operator.
- Assign `Key Vault Secrets User` for the Web App managed identity.

### 9.2 Postgres create fails with “location restricted”
Cause: offer/policy restriction.
Fix:
- Use Pay‑As‑You‑Go for prod, or
- choose a region permitted by that subscription, or
- use a different Azure DB product (bigger change).

### 9.3 App Service plan create fails with quota 0
Cause: subscription quota for that plan worker tier is 0.
Fix:
- request quota increase (Portal -> Quotas / Usage + quotas), or
- use a subscription that already has quota, or
- temporarily run `--skip-web`.

---

## 10) Suggested next agent actions (do these in order)

1) Verify Azure CLI context is still prod subscription `e3d708a7-...`.
2) Confirm health endpoints (at least homepage) on `https://oranhf57ir-prod-web.azurewebsites.net`.
3) Set up GitHub OIDC and deploy workflow secrets/vars.
4) Add budgets/alerts.
5) Implement access model: invite startup/student identities as guests and grant RG-scoped `Contributor`.
6) Optionally provision staging/dev subscriptions with credits, but expect policy/quota variance.

---

## Appendix: Exact resource names (copy/paste)

```text
Subscription (prod / PayGo): e3d708a7-6264-451c-bd7e-670fecfbf4fa
Tenant: 823dc1e7-3a05-4466-8968-2962d122d5dd
Prefix: oranhf57ir
Region: westus2

RG:    oranhf57ir-prod-rg
Plan:  oranhf57ir-prod-plan
Web:   oranhf57ir-prod-web
KV:    oranhf57ir-prod-kv
PG:    oranhf57ir-prod-pg
DB:    oran_db
URL:   https://oranhf57ir-prod-web.azurewebsites.net
```
