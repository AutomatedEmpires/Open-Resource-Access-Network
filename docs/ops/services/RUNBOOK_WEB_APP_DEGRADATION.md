# Runbook: Web App Degradation

## Metadata

- Owner role: Platform On-Call Lead
- Reviewers: Release Manager, Identity And Access Lead
- Last reviewed (UTC): 2026-03-06
- Next review due (UTC): 2026-06-06
- Severity scope: SEV-1 to SEV-3

## Purpose And Scope

Respond to elevated latency, 5xx spikes, or partial user journey failures in the ORAN web app and API surface.

## Triggers

- `/api/search` or core API p95/p99 latency spike.
- Sustained 5xx growth in Application Insights.
- Authentication redirects failing for protected routes.

## Triage Steps

1. Open `docs/ops/core/RUNBOOK_INCIDENT_TRIAGE.md` and assign severity.
2. Validate current deployment and recent config changes.
3. Check request/error trends using `docs/ops/monitoring/MONITORING_QUERIES.md`.
4. Confirm auth behavior if 401/403/503 spikes appear.

## Mitigation

1. Scale down risk by pausing non-critical jobs if needed.
2. Restart web app if app process appears degraded.
3. Roll back to known-good version when regression is deployment-linked.
4. Route auth-specific failures to `docs/ops/services/RUNBOOK_AUTH_OUTAGE.md`.

## Validation

- Error rates trend down to baseline.
- Core user journeys pass (search, service details, admin entrypoints).
- No new high-severity alerts for one stabilization window.

## References

- `docs/ops/core/RUNBOOK_DEPLOYMENT_ROLLBACK.md`
- `docs/ops/services/RUNBOOK_AUTH_OUTAGE.md`
- `docs/ops/monitoring/MONITORING_QUERIES.md`
