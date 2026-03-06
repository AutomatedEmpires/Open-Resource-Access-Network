# Runbook Template

## Metadata

- Runbook ID: `RUNBOOK_<NAME>`
- Owner role: `<team/role>`
- Reviewers: `<roles>`
- Last reviewed (UTC): `<YYYY-MM-DD>`
- Next review due (UTC): `<YYYY-MM-DD>`
- Severity scope: `SEV-1 | SEV-2 | SEV-3 | SEV-4`

## Purpose And Scope

Describe what this runbook covers, when it applies, and what it explicitly does not cover.

## Safety Constraints (Must Always Hold)

- Retrieval-first behavior must remain intact.
- Crisis hard gate (911/988/211) must not be bypassed.
- No hallucinated service facts in user-visible outputs.
- Privacy-first controls must remain in place; do not expose or log PII.

## Triggers And Severity Mapping

- Trigger conditions:
  - `<alert condition 1>`
  - `<alert condition 2>`
- Severity guidance:
  - `SEV-1`: widespread outage or safety-risking failure.
  - `SEV-2`: major degradation with active user impact.
  - `SEV-3`: partial degradation, workaround exists.
  - `SEV-4`: minor issue, no immediate user impact.

## Detection Signals

- Alerts: `<alert names>`
- Dashboards: `<links or locations>`
- Logs/KQL queries: `<query references>`

## Preconditions And Access

- Azure subscription/resource group access.
- Web app / function app operator permissions.
- Database access level required for diagnostics and mitigation.
- Access to incident communications channel.

## Incident Command

1. Assign Incident Commander (IC).
2. Assign Operations Driver.
3. Assign Communications Lead.
4. Create incident timeline and capture key events in UTC.

## Diagnosis Steps

1. Confirm impact scope (services, users, regions).
2. Validate whether this is a platform issue, dependency outage, or deployment regression.
3. Run baseline health checks.
4. Collect error signatures and correlate with recent changes.

## Mitigation Steps

1. Execute least-risk mitigation first.
2. If mitigation fails, escalate to rollback path.
3. If incident intersects security/privacy concerns, switch to security incident runbook.

## Rollback Criteria And Procedure

- Roll back when:
  - Error rates exceed threshold for more than `<duration>`.
  - Safety-critical behavior cannot be guaranteed.
- Rollback actions:
  - `<step-by-step rollback>`

## Validation And Exit Criteria

- All critical health signals return to baseline.
- No active safety constraint violations.
- Queue depth/latency/error metrics within acceptable thresholds.
- Stakeholders informed that incident is mitigated.

## Communications Checklist

- Internal incident update posted every `<interval>`.
- External communication approved and sent if required.
- Final resolution summary shared with impacted teams.

## Post-Incident Actions

1. Write post-incident summary within 24 hours.
2. Open follow-up issues for permanent fixes.
3. Update this runbook based on lessons learned.
4. Add an entry to `docs/ENGINEERING_LOG.md` for contract/operational changes.

## References

- `docs/SSOT.md`
- `docs/governance/OPERATING_MODEL.md`
- `docs/SECURITY_PRIVACY.md`
- `docs/ops/monitoring/MONITORING_QUERIES.md`
