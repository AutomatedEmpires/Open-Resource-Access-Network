# Runbook: Incident Triage And Command

## Metadata

- Owner role: Platform On-Call Lead
- Reviewers: Security Lead, Data Lead, Product Operations Lead
- Operational status: active
- Last reviewed (UTC): 2026-07-13
- Next review due (UTC): 2026-10-13
- Severity scope: SEV-1 to SEV-4

## Purpose And Scope

This runbook defines the first-response operating model for production incidents: severity classification, command roles, escalation, and stabilization workflow.

## Safety Constraints (Must Always Hold)

- Crisis hard gate behavior remains active.
- Retrieval/ranking contracts remain deterministic and retrieval-first.
- No emergency mitigation may introduce fabricated service facts.
- No PII in logs, chats, or incident artifacts.

## Triggers And Severity Mapping

- Trigger examples:
  - Error rate spike, major latency regression, or auth outage.
  - Queue backlog that risks SLA breach.
  - Safety-critical control regression.
  - Security alert with potential user impact.

- Severity mapping:
  - `SEV-1`: platform-wide outage, severe safety risk, or confirmed security breach.
  - `SEV-2`: critical user journey materially degraded.
  - `SEV-3`: localized degradation with workaround.
  - `SEV-4`: low-impact issue or early warning signal.

## Detection Signals

- GitHub required-check or Vercel production deployment failures.
- Privacy-filtered Sentry alerts, Vercel runtime errors, and `/api/health` failures.
- Supabase connection/latency signals or freshness/review backlog growth.
- Direct user/admin reports through issue forms or internal channels.

## Incident Command Roles

1. Incident Commander (IC): owns incident strategy and severity.
2. Operations Driver: executes diagnostics and mitigations.
3. Communications Lead: sends updates and maintains timeline.
4. Scribe (optional): records event timeline in UTC.

## First 15 Minutes

### First 5 Minutes (Immediate)

1. Confirm incident exists and assign provisional severity.
2. Declare Incident Commander and open incident channel.
3. Freeze risky change activity for SEV-1/SEV-2.
4. Publish initial status with next update time.

### Minutes 5-15

1. Confirm incident and assign severity.
2. Appoint IC, Operations Driver, Communications Lead.
3. Freeze non-essential deployments if SEV-1/SEV-2.
4. Capture baseline status:
   - Vercel deployment and web app health
   - Supabase and Clerk status
   - Scheduled-job and review backlog state
   - Error rates and latency
5. Publish incident start update with known impact and next update time.

## Diagnosis Workflow

1. Determine blast radius:
   - Seeker-facing only
   - Admin-facing only
   - Ingestion only
   - Full platform
2. Check recent change windows:
   - Workflow runs
   - Infrastructure changes
   - Migration history
3. Validate dependencies:
   - Supabase PostgreSQL/pooler
   - Clerk identity and ORAN authorization mapping
   - Vercel hosting/functions/cron
   - Sentry and OpenStreetMap tiles
   - Resend or optional AI only when the affected journey uses them
4. Classify incident path and switch to specialized runbook:
   - Resource freshness issues: `docs/ops/data/RUNBOOK_RESOURCE_FRESHNESS_REVIEW.md`
   - 211/feed issues: `docs/ops/services/RUNBOOK_211_API_INGESTION.md`
   - Admin assignment issues: `docs/ops/services/RUNBOOK_ADMIN_ROUTING.md`
   - DB issues: `docs/ops/services/RUNBOOK_DATABASE_INCIDENT.md`
   - Auth issues: `docs/ops/services/RUNBOOK_AUTH_OUTAGE.md`
   - Usage-control issues: `docs/ops/services/RUNBOOK_RATE_LIMIT_INCIDENT.md`
   - Dependency issues: `docs/ops/services/RUNBOOK_DEPENDENCY_OUTAGE.md`
   - Deployment regressions: `docs/ops/core/RUNBOOK_DEPLOYMENT_ROLLBACK.md`

Retired provider platforms are not an incident-recovery or rollback option.

## Mitigation Priorities

1. Restore safe, degraded service before full feature restoration.
2. Preserve crisis routing and core search integrity first.
3. Pause optional/non-critical workflows before core workloads.
4. Avoid manual data edits unless necessary for containment.

## Escalation Policy

- Escalate to Security Lead immediately if:
  - Suspected data exposure.
  - Unauthorized access indications.
  - Integrity concerns in published service data.
- Escalate to executive stakeholders for SEV-1 within 30 minutes.

## Communications Cadence

- `SEV-1`: update every 15 minutes until mitigated.
- `SEV-2`: update every 30 minutes until mitigated.
- `SEV-3/SEV-4`: update every 60 minutes or on material change.
- Use `docs/ops/templates/INCIDENT_COMMS_TEMPLATE.md` for consistency.

## Exit Criteria

- Error rates/latency return to normal operating ranges.
- No active safety/privacy violations.
- Review/freshness backlog and SLA breach risk stabilized.
- Incident channel updated with resolution summary.

## Post-Incident Requirements

1. Complete post-incident report within 24 hours.
2. Create corrective actions with owners and due dates.
3. Update affected runbooks and monitoring alerts.
4. Add a concise entry to `docs/ENGINEERING_LOG.md` if contracts or operations changed.

## References

- `docs/ops/monitoring/RUNBOOK_OBSERVABILITY_OUTAGE.md`
- `docs/ops/data/RUNBOOK_RESOURCE_FRESHNESS_REVIEW.md`
- `docs/ops/services/RUNBOOK_ADMIN_ROUTING.md`
- `docs/ops/services/RUNBOOK_DEPENDENCY_OUTAGE.md`
- `docs/SSOT.md`
