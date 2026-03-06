# ORAN Operations Readiness

## Purpose

This document provides an auditable snapshot of operational readiness for production reliability and governance review.

## Runbook Coverage Matrix

| Capability | Runbook | Status |
| --- | --- | --- |
| Incident command and triage | `docs/ops/core/RUNBOOK_INCIDENT_TRIAGE.md` | Implemented |
| Ingestion pipeline operations | `docs/ops/services/RUNBOOK_INGESTION.md` | Implemented |
| Admin routing reliability | `docs/ops/services/RUNBOOK_ADMIN_ROUTING.md` | Implemented |
| LLM dependency outage | `docs/ops/services/RUNBOOK_LLM_OUTAGE.md` | Implemented |
| Database incident response | `docs/ops/services/RUNBOOK_DATABASE_INCIDENT.md` | Implemented |
| Deployment rollback | `docs/ops/core/RUNBOOK_DEPLOYMENT_ROLLBACK.md` | Implemented |
| Authentication outage response | `docs/ops/services/RUNBOOK_AUTH_OUTAGE.md` | Implemented |
| Queue backlog response | `docs/ops/services/RUNBOOK_QUEUE_BACKLOG.md` | Implemented |
| Security/privacy incident response | `docs/ops/security/RUNBOOK_SECURITY_INCIDENT.md` | Implemented |
| Dependency outage routing | `docs/ops/services/RUNBOOK_DEPENDENCY_OUTAGE.md` | Implemented |
| Disaster recovery and restore validation | `docs/ops/dr/RUNBOOK_DR_BACKUP_RESTORE.md` | Implemented |
| On-call handoff continuity | `docs/ops/core/RUNBOOK_ON_CALL_HANDOFF.md` | Implemented |
| Change freeze and go/no-go gate | `docs/ops/core/RUNBOOK_CHANGE_FREEZE_GO_NO_GO.md` | Implemented |
| Web app degradation response | `docs/ops/services/RUNBOOK_WEB_APP_DEGRADATION.md` | Implemented |
| Function app runtime failure response | `docs/ops/services/RUNBOOK_FUNCTION_APP_FAILURE.md` | Implemented |
| Rate-limit incident response | `docs/ops/services/RUNBOOK_RATE_LIMIT_INCIDENT.md` | Implemented |
| Data quality incident response | `docs/ops/services/RUNBOOK_DATA_QUALITY_INCIDENT.md` | Implemented |
| CI/CD pipeline failure response | `docs/ops/services/RUNBOOK_CI_CD_PIPELINE_FAILURE.md` | Implemented |
| Internal API key rotation | `docs/ops/security/RUNBOOK_INTERNAL_API_KEY_ROTATION.md` | Implemented |
| Key Vault access failure response | `docs/ops/security/RUNBOOK_KEY_VAULT_ACCESS_FAILURE.md` | Implemented |
| Observability outage response | `docs/ops/monitoring/RUNBOOK_OBSERVABILITY_OUTAGE.md` | Implemented |
| Incident postmortem process | `docs/ops/core/RUNBOOK_INCIDENT_POSTMORTEM.md` | Implemented |
| Runbook staleness governance | `docs/ops/core/RUNBOOK_STALE_RUNBOOK_GOVERNANCE.md` | Implemented |

## Monitoring And Alerting Coverage

- Core KQL queries are maintained in `docs/ops/monitoring/MONITORING_QUERIES.md`.
- Incident triage uses those queries as baseline diagnostics.
- Alert-to-runbook routing table is maintained in `docs/ops/README.md`.
- Latest runbook verification audit: `docs/ops/audits/RUNBOOK_AUDIT_2026-03-06.md`.

## Drill Program

- Monthly tabletop: one incident scenario with role assignment and timeline capture.
- Quarterly game day: one recovery or rollback scenario executed end-to-end.
- Track and review:
  - Time to detect
  - Time to mitigate
  - Time to recover
  - Runbook gaps discovered

## Review Cadence

- SEV-1/SEV-2 runbooks: reviewed quarterly.
- SEV-3/SEV-4 runbooks: reviewed semi-annually.
- Mandatory review on major changes in:
  - `src/app/api/**`
  - `src/services/**`
  - `db/migrations/**`
  - `infra/**`
  - `.github/workflows/**`

## Current Risks

- Some runbooks still rely on manual command execution and operator judgment.
- Recovery objective targets (RTO/RPO) are documented but not yet baselined with measured drill outcomes.

## Next Actions

1. Run first formal incident tabletop and record outcomes.
2. Measure and publish first RTO/RPO baseline from DR drill.
3. Add automated runbook staleness checks (review date enforcement) in CI.

## Governance Links

- `docs/SSOT.md`
- `docs/governance/OPERATING_MODEL.md`
- `docs/SECURITY_PRIVACY.md`
- `docs/ENGINEERING_LOG.md`
