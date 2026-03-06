# ORAN Infrastructure (Bicep)

Infrastructure-as-Code for the complete ORAN Azure platform.

## Resources Provisioned

| Resource | Purpose |
|----------|---------|
| App Service Plan + Web App | Next.js application |
| Function App (Consumption) | Ingestion pipeline timers + queue processors |
| Storage Account + Queues | Function runtime + ingestion queue triggers |
| Key Vault | Secrets management (DB URL, API keys, auth secrets) |
| PostgreSQL Flexible Server | Primary database with PostGIS |
| Application Insights + Log Analytics | Telemetry and monitoring |
| Azure Communication Services | Transactional email |
| Azure Cache for Redis | Search result caching |

## Deployment

### Prerequisites

- Azure CLI installed and logged in (`az login`)
- Target resource group created (`az group create --name oran-prod-rg --location westus2`)
- Required secrets ready (generate with `openssl rand -base64 32`)

### Deploy

```bash
az deployment group create \
  --resource-group oran-prod-rg \
  --template-file infra/main.bicep \
  --parameters @infra/main.prod.bicepparam \
  --parameters \
    pgAdminPassword="$(openssl rand -base64 32)" \
    nextAuthSecret="$(openssl rand -base64 32)" \
    internalApiKey="$(openssl rand -base64 32)"
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
