# Runbook: On-Call Handoff

## Metadata

- Owner role: Platform On-Call Lead
- Reviewers: Release Manager, Security Lead
- Last reviewed (UTC): 2026-03-06
- Next review due (UTC): 2026-06-06
- Severity scope: SEV-1 to SEV-4

## Purpose And Scope

This runbook standardizes shift handoffs to prevent context loss, missed risks, and unresolved incident drift.

## Safety Constraints (Must Always Hold)

- Explicitly call out unresolved safety/privacy risks.
- Preserve full incident timeline and mitigation context.
- No handoff without rollback state and current guardrail status.

## Handoff Triggers

- Scheduled on-call rotation.
- Incident command role change.
- Major unresolved alert at end of shift.

## Required Handoff Packet

1. Incident summary (active + recently mitigated).
2. Current severity levels and blast radius.
3. Open alerts and known false positives.
4. Recent deploy/migration status.
5. Outstanding action items and owners.
6. Rollback readiness and known-good version reference.
7. Safety status:
   - Crisis routing intact
   - Retrieval-first intact
   - Auth boundaries intact

## Handoff Template

- Current UTC time:
- Outgoing on-call:
- Incoming on-call:
- Active incidents:
- Top 3 risks:
- Open risks (must not be blank):
- Last deploy status:
- Immediate next checks (first 30 minutes):
- Escalations pending:
- Links:
  - Incident channel/thread
  - Dashboards
  - Relevant runbooks

## Validation

Incoming on-call must confirm:
1. Access to required systems.
2. Understanding of active priorities.
3. Acknowledgment of open risks.
4. Ownership of next checkpoint update time.

## References

- `docs/ops/core/RUNBOOK_INCIDENT_TRIAGE.md`
- `docs/ops/README.md`
- `docs/ops/core/OPERATIONS_READINESS.md`
