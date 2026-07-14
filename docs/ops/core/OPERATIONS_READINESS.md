# ORAN Operations Readiness

## Purpose

This document records operational coverage for the active Vercel, Supabase,
Clerk, Sentry, Resend, and provider-neutral map stack. Runbook existence is not
the same as current validation; `scripts/check-runbook-freshness.mjs` is the
authority for review status.

## Active Coverage

| Capability | Primary runbook | Posture |
| --- | --- | --- |
| Incident command | `RUNBOOK_INCIDENT_TRIAGE` | Active target stack |
| Vercel rollback/release gate | `RUNBOOK_DEPLOYMENT_ROLLBACK`, `RUNBOOK_CHANGE_FREEZE_GO_NO_GO` | Active target stack |
| Web application health | `RUNBOOK_WEB_APP_DEGRADATION` | Active target stack |
| Supabase/PostgreSQL | `RUNBOOK_DATABASE_INCIDENT` | Active target stack |
| Clerk identity/ORAN authorization | `RUNBOOK_AUTH_OUTAGE` | Active target stack |
| Chat quota/rate controls | `RUNBOOK_RATE_LIMIT_INCIDENT` | Active target stack |
| Resource freshness | `RUNBOOK_RESOURCE_FRESHNESS_REVIEW` | Active target stack |
| Resource provenance/data quality | `RUNBOOK_DATA_QUALITY_INCIDENT` | Active target stack |
| 211/feed operations | `RUNBOOK_211_API_INGESTION` | Active, review status enforced by CI |
| Reviewer routing/capacity | `RUNBOOK_ADMIN_ROUTING` | Active, review status enforced by CI |
| Membership/reviewer governance | `RUNBOOK_MEMBERSHIP_SCOPE_AND_REVIEWER_GOVERNANCE` | Active, review status enforced by CI |
| Dependency degradation | `RUNBOOK_DEPENDENCY_OUTAGE` | Active target stack |
| Security/privacy response | `RUNBOOK_SECURITY_INCIDENT` | Active target stack |
| Runtime secret/configuration | `RUNBOOK_INTERNAL_API_KEY_ROTATION`, `RUNBOOK_KEY_VAULT_ACCESS_FAILURE` | Active target stack; one historical filename |
| Sentry/Vercel observability | `RUNBOOK_OBSERVABILITY_OUTAGE` | Active target stack |
| Disaster recovery | `RUNBOOK_DR_BACKUP_RESTORE` | Active, review and measured drill still required |
| Handoff/postmortem/governance | Core runbooks | Active target stack |

## Rollback-Only Coverage

| Legacy capability | Runbook | Retirement posture |
| --- | --- | --- |
| Azure Function host/timers | `RUNBOOK_FUNCTION_APP_FAILURE` | Review-gated until decommission |
| Azure Functions/Storage Queue ingestion | `RUNBOOK_INGESTION` | Review-gated until decommission |
| Azure OpenAI ingestion extraction | `RUNBOOK_LLM_OUTAGE` | Review-gated until decommission |
| Azure Storage Queue throughput | `RUNBOOK_QUEUE_BACKLOG` | Review-gated until decommission |

These documents are not active incident routes. Their overdue status must not be
hidden; either validate the rollback path or decommission/archive it.

## Monitoring And Alerting

- Sentry and Vercel provide target-stack error, release, and runtime evidence.
- `/api/health` independently checks environment readiness and database reachability.
- Five authenticated, staggered Vercel Cron routes run feed polling, SLA,
  coverage, confidence-regression, and resource-freshness checks.
- `MONITORING_QUERIES.md` and `LOAD_SCALE_TESTING.md` remain Azure rollback
  references and are not target-stack monitoring instructions.
- Alert-to-runbook routing is maintained in `docs/ops/README.md`.

## Drill Program

- Monthly tabletop: one safety, auth, data-integrity, or provider incident.
- Quarterly game day: rollback or restore executed end to end.
- Capture time to detect, mitigate, and recover plus every runbook gap.
- A desk review may advance content review dates, but it must not claim a restore,
  rollback, or provider drill that was not executed.

## Review Governance

- SEV-1/SEV-2 runbooks: quarterly.
- SEV-3/SEV-4 runbooks: semi-annually.
- Immediate review after material changes to APIs, services, migrations,
  functions, infrastructure, workflows, or `vercel.json`.
- Active and rollback-only documents both fail CI when overdue.
- Lifecycle/date changes require substantive content and validation evidence.

## Current Risks

- Disaster recovery lacks a measured Supabase restore RTO/RPO.
- Several active ingestion/governance documents still require target-stack review.
- The Azure rollback window has no completed decommission evidence.
- Provider-neutral monitoring/load guidance has not yet replaced the Azure KQL
  and queue tuning references.

## Next Actions

1. Resolve every remaining overdue item reported by the checker through review
   or evidenced retirement.
2. Run and record the first Supabase restore drill and Vercel rollback game day.
3. Close the Azure rollback window after production cutover and backup validation.
4. Replace the legacy monitoring/load documents with Sentry/Vercel/Supabase guidance.

## Governance Links

- `docs/ops/README.md`
- `docs/ops/core/RUNBOOK_STALE_RUNBOOK_GOVERNANCE.md`
- `docs/platform/STACK_MIGRATION.md`
- `docs/SECURITY_PRIVACY.md`
- `scripts/check-runbook-freshness.mjs`
