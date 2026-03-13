# Runbook: Data Quality Incident

## Metadata

- Owner role: Data Platform Lead
- Reviewers: Ingestion Operations Lead, Security Lead
- Last reviewed (UTC): 2026-03-06
- Next review due (UTC): 2026-06-06
- Severity scope: SEV-2 to SEV-3

## Purpose And Scope

Respond to data quality incidents in staged or published records, including malformed imports, verification drift, and trust-signal regressions.

## Safety Constraints

- Do not publish unverified data to seeker-facing surfaces.
- Preserve retrieval-first and no-hallucination guarantees.
- Use controlled corrective actions with audit trail.

## Triggers

- Unexpected spikes in rejected/failed candidates.
- Verification anomalies reported by admins.
- Confidence regression scan creates unusually high volume.

## Diagnosis

1. Identify source and stage where quality issue appears.
2. Check ingestion logs and candidate/verification records.
3. Determine whether issue is source data, parsing, or scoring drift.

## Mitigation

1. Pause affected ingestion source(s) if needed.
2. Correct source mapping/parsing rules.
3. Re-run verification workflow for affected candidates.
4. Escalate severe trust issues to security/incident triage.

## Validation

- New candidate quality returns to expected baseline.
- Review queue backlog normalizes.
- No unsafe records are published.

## References

- `docs/ops/services/RUNBOOK_INGESTION.md`
- `docs/ops/services/RUNBOOK_ADMIN_ROUTING.md`
- `docs/ops/services/RUNBOOK_DEPENDENCY_OUTAGE.md`
