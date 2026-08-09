# ORAN Operations Readiness

## Purpose

This document records operational coverage for the active Vercel, Supabase,
Clerk, Sentry, Resend, and provider-neutral map stack. Runbook existence is not
the same as current validation; `scripts/check-runbook-freshness.mjs` is the
authority for review status.

As of 2026-07-14, the checker reports 27 governed runbooks, zero missing or
invalid metadata, and zero overdue reviews. That result means the documents were
governed and reviewed; it does not convert the unexecuted drills below into
operational evidence.

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
| 211/feed operations | `RUNBOOK_211_API_INGESTION` | Code-reviewed; production canary/rights acceptance still gates enablement |
| Reviewer routing/capacity | `RUNBOOK_ADMIN_ROUTING` | Code-reviewed; active initial-assignment orchestration/drill is a gap |
| Membership/reviewer governance | `RUNBOOK_MEMBERSHIP_SCOPE_AND_REVIEWER_GOVERNANCE` | Code-reviewed; focused tests and typecheck passed |
| Dependency degradation | `RUNBOOK_DEPENDENCY_OUTAGE` | Active target stack |
| Security/privacy response | `RUNBOOK_SECURITY_INCIDENT` | Active target stack |
| Runtime secret/configuration | `RUNBOOK_INTERNAL_API_KEY_ROTATION`, `RUNBOOK_DEPENDENCY_OUTAGE` | Active target stack |
| Sentry/Vercel observability | `RUNBOOK_OBSERVABILITY_OUTAGE` | Active target stack |
| Disaster recovery | `RUNBOOK_DR_BACKUP_RESTORE` | Content-reviewed; isolated restore and measured RTO/RPO are a launch blocker |
| Handoff/postmortem/governance | Core runbooks | Active target stack |

## Monitoring And Alerting

- Sentry and Vercel provide target-stack error, release, and runtime evidence.
- `/api/health` independently checks environment readiness and database reachability.
- Six authenticated, staggered Vercel Cron routes run feed polling, SLA,
  coverage, confidence-regression, resource-freshness, and account-erasure checks.
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
- Active documents fail CI when overdue.
- Lifecycle/date changes require substantive content and validation evidence.

## Current Risks

- Disaster recovery lacks a measured Supabase restore RTO/RPO.
- 211 polling lacks an accepted production canary, rights/data-owner scope
  evidence, and human content reconciliation; keep it disabled until accepted.
- The active feed path does not yet demonstrate initial reviewer-assignment
  orchestration end to end; unattended ingestion-to-review routing is not ready.

## Next Actions

1. Run and record the isolated Supabase restore; set approved RTO/RPO and obtain
   the Release Manager's DR go/no-go decision by the short review date.
2. Implement and drill active initial reviewer assignment before enabling
   unattended source-feed ingestion.
3. Run the bounded 211 canary and human reconciliation before production polling;
   require separate two-person evidence for any later auto-publish rollout.

## Governance Links

- `docs/ops/README.md`
- `docs/ops/core/RUNBOOK_STALE_RUNBOOK_GOVERNANCE.md`
- `docs/platform/STACK_MIGRATION.md`
- `docs/SECURITY_PRIVACY.md`
- `scripts/check-runbook-freshness.mjs`
