# Runbook: Incident Triage And Command

## Metadata

- Owner role: Platform On-Call Lead
- Reviewers: Security Lead, Data Lead, Product Operations Lead
- Last reviewed (UTC): 2026-03-06
- Next review due (UTC): 2026-06-06
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

- GitHub Actions failures on main deployment workflows.
- Application Insights alerts and KQL in `docs/ops/monitoring/MONITORING_QUERIES.md`.
- Queue depth increases in ingestion/admin pipelines.
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
   - Web app health
   - Function app health
   - Queue depth
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
   - Database
   - Azure OpenAI (ingestion only)
   - Entra auth
   - Storage queues
4. Classify incident path and switch to specialized runbook:
   - Ingestion issues: `docs/ops/services/RUNBOOK_INGESTION.md`
   - Admin assignment issues: `docs/ops/services/RUNBOOK_ADMIN_ROUTING.md`
   - LLM dependency issues: `docs/ops/services/RUNBOOK_LLM_OUTAGE.md`
   - DB issues: `docs/ops/services/RUNBOOK_DATABASE_INCIDENT.md`
   - Deployment regressions: `docs/ops/core/RUNBOOK_DEPLOYMENT_ROLLBACK.md`

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
- Queue backlog and SLA breach risk stabilized.
- Incident channel updated with resolution summary.

## Post-Incident Requirements

1. Complete post-incident report within 24 hours.
2. Create corrective actions with owners and due dates.
3. Update affected runbooks and monitoring alerts.
4. Add a concise entry to `docs/ENGINEERING_LOG.md` if contracts or operations changed.

## References

- `docs/ops/monitoring/MONITORING_QUERIES.md`
- `docs/ops/services/RUNBOOK_INGESTION.md`
- `docs/ops/services/RUNBOOK_ADMIN_ROUTING.md`
- `docs/ops/services/RUNBOOK_LLM_OUTAGE.md`
- `docs/SSOT.md`
