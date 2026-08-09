# ORAN Operational Runbooks

This directory is the operational control plane for production support,
incident response, resource integrity, and recovery.

The active platform is Vercel + Supabase + Clerk + Sentry + Resend. Azure and
Foundry are retired and prohibited; they have no operational rollback route. See
[`STACK_MIGRATION.md`](../platform/STACK_MIGRATION.md).

## Lifecycle Contract

- `active`: primary instructions for the target production stack.
- `historical`: immutable incident or migration evidence that is not executable guidance.

Every active `RUNBOOK_*.md` in the governed folders declares its lifecycle,
owner, reviewers, last review, and next review.

## Folder Structure

- `core/`: incident command, rollback, release controls, handoff, readiness.
- `services/`: active target-stack services.
- `security/`: security, privacy, and credential incident procedures.
- `data/`: resource integrity and freshness operations.
- `dr/`: disaster recovery and restore procedures.
- `monitoring/`: active observability guidance.
- `audits/`: historical runbook audit reports.
- `templates/`: runbook and communication templates.

## Severity Model

- `SEV-1`: Platform-wide outage, severe safety/privacy risk, or confirmed breach.
- `SEV-2`: Major user-facing degradation or resource-integrity failure.
- `SEV-3`: Partial degradation with a safe workaround.
- `SEV-4`: Low-impact issue or early warning.

## Active Target-Stack Catalog

### Core

| Runbook | Scope |
| --- | --- |
| [Incident triage](core/RUNBOOK_INCIDENT_TRIAGE.md) | First response, severity, command, escalation |
| [Deployment rollback](core/RUNBOOK_DEPLOYMENT_ROLLBACK.md) | Vercel rollback with Supabase compatibility checks |
| [Change freeze/go-no-go](core/RUNBOOK_CHANGE_FREEZE_GO_NO_GO.md) | Release freeze and promotion decision |
| [On-call handoff](core/RUNBOOK_ON_CALL_HANDOFF.md) | Risk and incident ownership transfer |
| [Incident postmortem](core/RUNBOOK_INCIDENT_POSTMORTEM.md) | Evidence-backed follow-up and corrective actions |
| [Runbook governance](core/RUNBOOK_STALE_RUNBOOK_GOVERNANCE.md) | Lifecycle, cadence, and CI enforcement |
| [Operations readiness](core/OPERATIONS_READINESS.md) | Coverage, drills, and known risks |

### Product, Data, And Platform Services

| Runbook | Scope |
| --- | --- |
| [Resource freshness review](data/RUNBOOK_RESOURCE_FRESHNESS_REVIEW.md) | Expiry, staleness, reverification, holds, and review |
| [211 API ingestion](services/RUNBOOK_211_API_INGESTION.md) | Governed source bootstrap, polling, and publication rollout |
| [Admin routing](services/RUNBOOK_ADMIN_ROUTING.md) | Reviewer assignment, capacity, coverage, and SLA issues |
| [Resource data quality](services/RUNBOOK_DATA_QUALITY_INCIDENT.md) | Provenance, quarantine, dedupe, and publication incidents |
| [Database incident](services/RUNBOOK_DATABASE_INCIDENT.md) | Supabase/PostgreSQL/pool/migration incidents |
| [Authentication outage](services/RUNBOOK_AUTH_OUTAGE.md) | Clerk identity and database-owned authorization |
| [Account and form resilience](services/RUNBOOK_ACCOUNT_AND_FORM_RESILIENCE.md) | Account, onboarding, profile, and managed forms |
| [Durable account erasure](services/RUNBOOK_ACCOUNT_ERASURE.md) | Release gate, bounded deletion worker, retries, blocked requests, and rollback |
| [Membership and reviewer governance](services/RUNBOOK_MEMBERSHIP_SCOPE_AND_REVIEWER_GOVERNANCE.md) | Membership, scope grants, freezes, reviewer dormancy |
| [Web degradation](services/RUNBOOK_WEB_APP_DEGRADATION.md) | Vercel application and critical journeys |
| [Rate limit and chat usage](services/RUNBOOK_RATE_LIMIT_INCIDENT.md) | Atomic daily quota, minute rate, and in-flight controls |
| [CI/CD failure](services/RUNBOOK_CI_CD_PIPELINE_FAILURE.md) | GitHub, Vercel, Sentry source maps, Supabase migrations |
| [Dependency outage](services/RUNBOOK_DEPENDENCY_OUTAGE.md) | Provider failures and safe degraded modes |
| [Security incident](security/RUNBOOK_SECURITY_INCIDENT.md) | Security/privacy containment and recovery |
| [Scheduled worker secret rotation](security/RUNBOOK_INTERNAL_API_KEY_ROTATION.md) | Vercel Cron and provider-neutral internal-tool credentials |
| [Observability outage](monitoring/RUNBOOK_OBSERVABILITY_OUTAGE.md) | Sentry/Vercel blind spots and fallback checks |
| [Disaster recovery](dr/RUNBOOK_DR_BACKUP_RESTORE.md) | Backup/restore readiness and recovery validation |

## Active Alert Routing

| Trigger | Primary | Secondary |
| --- | --- | --- |
| Web/API latency or 5xx | `RUNBOOK_WEB_APP_DEGRADATION` | `RUNBOOK_DEPLOYMENT_ROLLBACK` |
| Supabase/pool/migration failure | `RUNBOOK_DATABASE_INCIDENT` | `RUNBOOK_INCIDENT_TRIAGE` |
| Clerk/auth/RBAC failure | `RUNBOOK_AUTH_OUTAGE` | `RUNBOOK_INCIDENT_TRIAGE` |
| Quota/rate/finalization failure | `RUNBOOK_RATE_LIMIT_INCIDENT` | `RUNBOOK_DATABASE_INCIDENT` |
| Expired/stale resource findings | `RUNBOOK_RESOURCE_FRESHNESS_REVIEW` | `RUNBOOK_DATA_QUALITY_INCIDENT` |
| Supporting-reference or provenance leak | `RUNBOOK_DATA_QUALITY_INCIDENT` | `RUNBOOK_SECURITY_INCIDENT` |
| 211 feed/replay/publication issue | `RUNBOOK_211_API_INGESTION` | `RUNBOOK_DATA_QUALITY_INCIDENT` |
| Reviewer capacity/SLA issue | `RUNBOOK_ADMIN_ROUTING` | `RUNBOOK_INCIDENT_TRIAGE` |
| External provider outage | `RUNBOOK_DEPENDENCY_OUTAGE` | `RUNBOOK_INCIDENT_TRIAGE` |
| Sentry/telemetry blind spot | `RUNBOOK_OBSERVABILITY_OUTAGE` | `RUNBOOK_INCIDENT_TRIAGE` |
| Runtime configuration failure | `RUNBOOK_DEPENDENCY_OUTAGE` | `RUNBOOK_AUTH_OUTAGE` |
| Cron/internal credential exposure | `RUNBOOK_INTERNAL_API_KEY_ROTATION` | `RUNBOOK_SECURITY_INCIDENT` |
| Any security/privacy signal | `RUNBOOK_SECURITY_INCIDENT` | `RUNBOOK_INCIDENT_TRIAGE` |

## First Response

1. Open `core/RUNBOOK_INCIDENT_TRIAGE.md` and assign severity.
2. Name Incident Commander, Operations Driver, and Communications Lead.
3. Capture the Vercel release, `/api/health`, affected journey, Supabase/Clerk
   status, and privacy-filtered Sentry evidence.
4. Route through the active table above; retired provider platforms are not recovery options.
5. Stabilize the safest degraded service, validate exit criteria, and capture
   post-incident actions.

## Target-Stack Quick Reference

| Resource | Reference |
| --- | --- |
| Stable Vercel candidate | `https://oran-sandy.vercel.app` |
| Readiness | `GET /api/health` |
| Hosting/jobs | Dedicated Vercel project `oran` and `vercel.json` |
| Database | Dedicated Supabase project and pooled `DATABASE_URL` |
| Identity | Dedicated ORAN Clerk production instance |
| Errors/releases | Dedicated Sentry project `oran` |
| Secrets | Dedicated Doppler project/config plus Vercel environment |
| Email | Dedicated Resend domain and sending-only credential |

Never print environment values while diagnosing. Use `.env.example` and
`.github/runtime/webapp-production-settings.txt` as name-only contracts.

## Critical Environment Names

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL`, `DATABASE_POOL_MAX`, `ORAN_DATABASE_ROLE`, `ORAN_SUPABASE_PROJECT_REF` | Dedicated pooled ORAN backend login plus fixed role/project identity assertions |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk identity |
| `CRON_SECRET` | Vercel Cron authentication |
| `NEXT_PUBLIC_SENTRY_DSN` | Privacy-filtered error reporting |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | Release/source-map upload |
| `RESEND_API_KEY`, `RESEND_FROM` | Transactional email |
| `INTERNAL_API_KEY` | Optional, separate approved internal-tooling credential |

## Templates

- [Runbook template](templates/RUNBOOK_TEMPLATE.md)
- [Incident communications template](templates/INCIDENT_COMMS_TEMPLATE.md)
