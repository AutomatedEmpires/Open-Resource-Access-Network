# ORAN Infrastructure (Bicep)

Infrastructure-as-Code for the core ORAN Azure platform, including the Azure Maps account used by the seeker map experience.

## Resources Provisioned

| Resource | Purpose |
|----------|---------|
| App Service Plan + Web App | Next.js application |
| Function App (Consumption) | Ingestion pipeline timers + queue processors |
| Storage Account + Queues | Function runtime + ingestion queue triggers |
| Key Vault | Secrets management (DB URL, API keys, auth secrets) |
| PostgreSQL Flexible Server | Primary database with PostGIS |
| Application Insights + Log Analytics | Telemetry and monitoring |
| Azure Maps Account | Server geocoding + browser map auth secret source |
| Azure Communication Services | Transactional email |
| Azure Cache for Redis | Search result caching |

Not currently provisioned by this template:

- Azure Maps SAS token generation and rotation automation inside Bicep itself. The template provisions the Maps account, stores its primary key in Key Vault, and accepts the browser SAS token as a secure deployment parameter so the web app can consume both values through Key Vault references. Ongoing rotation is handled by the repo-level script/workflow pair: `scripts/azure/rotate-maps-sas.sh` and `.github/workflows/rotate-azure-maps-sas.yml`.

## Deployment

### Prerequisites

- Azure CLI installed and logged in (`az login`)
- Target resource group created (`az group create --name oran-prod-rg --location westus2`)
- Required secrets ready (generate with `openssl rand -base64 32`)
- A scoped Azure Maps SAS token ready to pass as `azureMapsSasToken` during deployment

### Deploy

```bash
az deployment group create \
  --resource-group oran-prod-rg \
  --template-file infra/main.bicep \
  --parameters @infra/main.prod.bicepparam \
  --parameters \
    pgAdminPassword="$(openssl rand -base64 32)" \
    nextAuthSecret="$(openssl rand -base64 32)" \
                internalApiKey="$(openssl rand -base64 32)" \
                azureMapsSasToken="<scoped-sas-token>"
```

### What-if (preview changes)

```bash
az deployment group what-if \
  --resource-group oran-prod-rg \
  --template-file infra/main.bicep \
  --parameters @infra/main.prod.bicepparam
```

## Architecture

```
                    ┌──────────────────┐
                    │   App Service    │
                    │   (Next.js)      │
                    └──────┬───────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
      ┌───────▼──┐  ┌──────▼─────┐ ┌───▼────────┐
      │ Key Vault│  │ PostgreSQL │ │   Redis     │
      │ (secrets)│  │ + PostGIS  │ │  (cache)    │
      └──────────┘  └────────────┘ └────────────┘
              │
      ┌───────▼──────────┐
      │  Function App    │
      │  (Consumption)   │
      └───────┬──────────┘
              │
      ┌───────▼──────────┐
      │ Storage Account  │
      │ (queues + blobs) │
      └──────────────────┘
              │
      ┌───────▼──────────────────┐
      │  Application Insights    │
      │  + Log Analytics         │
      └─────────────────────────┘
```

## Security Notes

- All secrets stored in Key Vault, referenced via managed identity
- Web App and Function App use system-assigned managed identities
- HTTPS-only enforced on both apps
- FTPS disabled
- TLS 1.2 minimum
- Redis SSL-only (port 6380)
- PostgreSQL firewall allows Azure services only (production hardening: use private endpoints)
- The current Bicep template does not mint or rotate Azure Maps SAS tokens automatically inside the deployment itself; use the repo rotation automation after bootstrap/deploy to keep the live browser token current.
