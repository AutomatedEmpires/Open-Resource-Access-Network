# ORAN Operational Runbooks

This directory is the operational control plane for production support, incident response, and recovery.

## Folder Structure

- `core/`: incident command, rollback, release controls, handoff, readiness.
- `services/`: service-specific operational runbooks.
- `security/`: security and privacy incident procedures.
- `dr/`: disaster recovery and restore procedures.
- `monitoring/`: KQL and load/scale operating references.
- `audits/`: runbook audit reports.
- `templates/`: reusable runbook and communication templates.

## Severity Model

- `SEV-1`: Platform-wide outage, severe safety/privacy risk, or confirmed active security incident.
- `SEV-2`: Major user-facing degradation with significant workflow disruption.
- `SEV-3`: Partial degradation with workarounds.
- `SEV-4`: Low-impact issue or warning condition.

## Runbook Catalog

### Core Incident Management

| Runbook | Scope |
| --- | --- |
| [RUNBOOK_INCIDENT_TRIAGE.md](core/RUNBOOK_INCIDENT_TRIAGE.md) | Incident command, first response, severity classification, escalation |
| [RUNBOOK_DEPLOYMENT_ROLLBACK.md](core/RUNBOOK_DEPLOYMENT_ROLLBACK.md) | Rollback procedure for failed or risky production deployments |
| [RUNBOOK_CHANGE_FREEZE_GO_NO_GO.md](core/RUNBOOK_CHANGE_FREEZE_GO_NO_GO.md) | Change freeze criteria and release go/no-go decision workflow |
| [RUNBOOK_ON_CALL_HANDOFF.md](core/RUNBOOK_ON_CALL_HANDOFF.md) | On-call shift handoff protocol and risk transfer checklist |
| [RUNBOOK_INCIDENT_POSTMORTEM.md](core/RUNBOOK_INCIDENT_POSTMORTEM.md) | Standardized post-incident review and corrective action workflow |
| [RUNBOOK_STALE_RUNBOOK_GOVERNANCE.md](core/RUNBOOK_STALE_RUNBOOK_GOVERNANCE.md) | Runbook review cadence and staleness enforcement process |
| [OPERATIONS_READINESS.md](core/OPERATIONS_READINESS.md) | Readiness matrix, review cadence, and drill program |

### Service Operations

| Runbook | Scope |
| --- | --- |
| [RUNBOOK_INGESTION.md](services/RUNBOOK_INGESTION.md) | Ingestion pipeline issues, queue failures, poison queue recovery |
| [RUNBOOK_211_API_INGESTION.md](services/RUNBOOK_211_API_INGESTION.md) | Phased rollout, bootstrap, publish policy, and sync strategy for 211 API ingestion |
| [RUNBOOK_ADMIN_ROUTING.md](services/RUNBOOK_ADMIN_ROUTING.md) | Admin assignment failures, SLA breaches, capacity and coverage gaps |
| [RUNBOOK_LLM_OUTAGE.md](services/RUNBOOK_LLM_OUTAGE.md) | Azure OpenAI degradation affecting ingestion extraction |
| [RUNBOOK_DATABASE_INCIDENT.md](services/RUNBOOK_DATABASE_INCIDENT.md) | DB connectivity, saturation, lock contention, migration incidents |
| [RUNBOOK_AUTH_OUTAGE.md](services/RUNBOOK_AUTH_OUTAGE.md) | Entra/NextAuth failures, role enforcement degradation, auth recovery |
| [RUNBOOK_QUEUE_BACKLOG.md](services/RUNBOOK_QUEUE_BACKLOG.md) | Queue growth, poison queue handling, throughput restoration |
| [RUNBOOK_WEB_APP_DEGRADATION.md](services/RUNBOOK_WEB_APP_DEGRADATION.md) | Web/API latency or error degradation response |
| [RUNBOOK_FUNCTION_APP_FAILURE.md](services/RUNBOOK_FUNCTION_APP_FAILURE.md) | Function host/runtime failure diagnosis and recovery |
| [RUNBOOK_RATE_LIMIT_INCIDENT.md](services/RUNBOOK_RATE_LIMIT_INCIDENT.md) | 429 over-throttling/under-throttling incident response |
| [RUNBOOK_DATA_QUALITY_INCIDENT.md](services/RUNBOOK_DATA_QUALITY_INCIDENT.md) | Ingestion and verification data quality incident response |
| [RUNBOOK_CI_CD_PIPELINE_FAILURE.md](services/RUNBOOK_CI_CD_PIPELINE_FAILURE.md) | Pipeline and deployment workflow failure response |
| [RUNBOOK_SECURITY_INCIDENT.md](security/RUNBOOK_SECURITY_INCIDENT.md) | Security/privacy incident containment and recovery |
| [RUNBOOK_INTERNAL_API_KEY_ROTATION.md](security/RUNBOOK_INTERNAL_API_KEY_ROTATION.md) | Secure rotation procedure for internal API shared secret |
| [RUNBOOK_KEY_VAULT_ACCESS_FAILURE.md](security/RUNBOOK_KEY_VAULT_ACCESS_FAILURE.md) | Key Vault/managed identity secret-resolution failure response |
| [RUNBOOK_DEPENDENCY_OUTAGE.md](services/RUNBOOK_DEPENDENCY_OUTAGE.md) | Outages in external dependencies and degraded-mode routing |
| [RUNBOOK_DR_BACKUP_RESTORE.md](dr/RUNBOOK_DR_BACKUP_RESTORE.md) | Disaster recovery readiness and restore validation workflow |

### Monitoring And Testing

| Document | Scope |
| --- | --- |
| [MONITORING_QUERIES.md](monitoring/MONITORING_QUERIES.md) | KQL query baselines for detection and triage |
| [LOAD_SCALE_TESTING.md](monitoring/LOAD_SCALE_TESTING.md) | Throughput targets, queue concurrency tuning, DB pool sizing |
| [RUNBOOK_OBSERVABILITY_OUTAGE.md](monitoring/RUNBOOK_OBSERVABILITY_OUTAGE.md) | Telemetry pipeline outage response and blind-spot controls |
| [RUNBOOK_AUDIT_2026-03-06.md](audits/RUNBOOK_AUDIT_2026-03-06.md) | Code-verified audit log of runbook coverage and corrections |

### Templates

| Template | Purpose |
| --- | --- |
| [templates/RUNBOOK_TEMPLATE.md](templates/RUNBOOK_TEMPLATE.md) | Standard structure for all new runbooks |
| [templates/INCIDENT_COMMS_TEMPLATE.md](templates/INCIDENT_COMMS_TEMPLATE.md) | Standard format for internal and external incident updates |

## Alert To Runbook Routing

| Trigger/Signal | Primary Runbook | Secondary Runbook |
| --- | --- | --- |
| API 5xx spike or latency regression | `docs/ops/core/RUNBOOK_INCIDENT_TRIAGE.md` | `docs/ops/core/RUNBOOK_DEPLOYMENT_ROLLBACK.md` |
| Queue depth/backlog growth | `docs/ops/services/RUNBOOK_INGESTION.md` | `docs/ops/core/RUNBOOK_INCIDENT_TRIAGE.md` |
| Unrouted candidates / SLA breaches | `docs/ops/services/RUNBOOK_ADMIN_ROUTING.md` | `docs/ops/core/RUNBOOK_INCIDENT_TRIAGE.md` |
| OpenAI extraction failures/429 | `docs/ops/services/RUNBOOK_LLM_OUTAGE.md` | `docs/ops/services/RUNBOOK_INGESTION.md` |
| DB timeout/connection errors | `docs/ops/services/RUNBOOK_DATABASE_INCIDENT.md` | `docs/ops/core/RUNBOOK_INCIDENT_TRIAGE.md` |
| Post-deploy regression | `docs/ops/core/RUNBOOK_DEPLOYMENT_ROLLBACK.md` | `docs/ops/services/RUNBOOK_DATABASE_INCIDENT.md` |
| Auth failure spikes (401/403/503) | `docs/ops/services/RUNBOOK_AUTH_OUTAGE.md` | `docs/ops/core/RUNBOOK_INCIDENT_TRIAGE.md` |
| Security/privacy signal | `docs/ops/security/RUNBOOK_SECURITY_INCIDENT.md` | `docs/ops/core/RUNBOOK_INCIDENT_TRIAGE.md` |
| Queue backlog/poison growth | `docs/ops/services/RUNBOOK_QUEUE_BACKLOG.md` | `docs/ops/services/RUNBOOK_INGESTION.md` |
| Web/API degradation | `docs/ops/services/RUNBOOK_WEB_APP_DEGRADATION.md` | `docs/ops/core/RUNBOOK_DEPLOYMENT_ROLLBACK.md` |
| Function host/runtime failure | `docs/ops/services/RUNBOOK_FUNCTION_APP_FAILURE.md` | `docs/ops/services/RUNBOOK_QUEUE_BACKLOG.md` |
| Key Vault secret resolution failure | `docs/ops/security/RUNBOOK_KEY_VAULT_ACCESS_FAILURE.md` | `docs/ops/services/RUNBOOK_AUTH_OUTAGE.md` |
| Internal API key compromise | `docs/ops/security/RUNBOOK_INTERNAL_API_KEY_ROTATION.md` | `docs/ops/security/RUNBOOK_SECURITY_INCIDENT.md` |
| Observability blind spot | `docs/ops/monitoring/RUNBOOK_OBSERVABILITY_OUTAGE.md` | `docs/ops/core/RUNBOOK_INCIDENT_TRIAGE.md` |

## First-Response Flow

1. Open `docs/ops/core/RUNBOOK_INCIDENT_TRIAGE.md` and classify severity.
2. Assign Incident Commander, Operations Driver, and Communications Lead.
3. Route to service-specific runbook based on dominant failure signal.
4. Stabilize service using least-risk mitigation path.
5. Validate against exit criteria and capture post-incident actions.

## Quick Reference

### Key URLs

| Resource | URL |
| --- | --- |
| Web App | `https://<prefix>-prod-web.azurewebsites.net` |
| Function App | `https://<prefix>-prod-func.azurewebsites.net` |
| Application Insights | Azure Portal -> Application Insights -> `<prefix>-prod-insights` |
| Key Vault | Azure Portal -> Key Vaults -> `<prefix>-prod-kv` |

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

### Critical Environment Variables

See `.env.example` for full definitions.

| Variable | Service | Source |
| --- | --- | --- |
| `DATABASE_URL` | Web App + Functions | Key Vault reference |
| `INTERNAL_API_KEY` | Functions -> Web App | Key Vault reference |
| `ORAN_APP_URL` | Functions | App setting |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Both | App setting |
| `AZURE_AD_CLIENT_ID` | Web App | App setting |
| `AZURE_AD_CLIENT_SECRET` | Web App | Key Vault reference |
| `NEXTAUTH_SECRET` | Web App | Key Vault reference |
