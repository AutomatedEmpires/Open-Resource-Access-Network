# ORAN Operational Runbooks

Procedures for operating and troubleshooting the ORAN platform in production.

## Runbooks

| Runbook | When to Use |
|---------|-------------|
| [RUNBOOK_INGESTION.md](RUNBOOK_INGESTION.md) | Ingestion pipeline issues — stuck queues, extraction failures, no candidates processing |
| [RUNBOOK_ADMIN_ROUTING.md](RUNBOOK_ADMIN_ROUTING.md) | Admin routing failures — unrouted candidates, SLA breaches, capacity issues, coverage gaps |
| [RUNBOOK_LLM_OUTAGE.md](RUNBOOK_LLM_OUTAGE.md) | Azure OpenAI unavailable or degraded — rate limiting, model deployment issues |
| [MONITORING_QUERIES.md](MONITORING_QUERIES.md) | KQL queries for Application Insights dashboards and investigation |
| [LOAD_SCALE_TESTING.md](LOAD_SCALE_TESTING.md) | Throughput targets, queue concurrency tuning, DB pool sizing, load test script |

## Quick Reference

### Key URLs

| Resource | URL |
|----------|-----|
| Web App | `https://<prefix>-prod-web.azurewebsites.net` |
| Function App | `https://<prefix>-prod-func.azurewebsites.net` |
| Application Insights | Azure Portal → Application Insights → `<prefix>-prod-insights` |
| Key Vault | Azure Portal → Key Vaults → `<prefix>-prod-kv` |

### Common CLI Commands

```bash
# Check web app status
az webapp show --resource-group <rg> --name <webapp> --query state

# Check function app status
az functionapp show --resource-group <rg> --name <func-app> --query state

# View function app logs (live)
az webapp log tail --resource-group <rg> --name <func-app>

# Check queue depths
az storage queue list --account-name <storage> --query "[].{name:name,count:approximateMessageCount}" -o table

# Restart web app
az webapp restart --resource-group <rg> --name <webapp>

# Restart function app
az functionapp restart --resource-group <rg> --name <func-app>
```

### Environment Variables

See `.env.example` for the full list. Critical runtime variables:

| Variable | Service | Source |
|----------|---------|--------|
| `DATABASE_URL` | Web App + Functions | Key Vault reference |
| `INTERNAL_API_KEY` | Functions → Web App | Key Vault reference |
| `ORAN_APP_URL` | Functions | App setting |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Both | App setting |
| `AZURE_AD_CLIENT_ID` | Web App | App setting |
| `AZURE_AD_CLIENT_SECRET` | Web App | Key Vault reference |
| `NEXTAUTH_SECRET` | Web App | Key Vault reference |
