# Runbook: Stale Runbook Governance

## Metadata

- Owner role: Release Manager
- Reviewers: Platform On-Call Lead, Security Lead
- Last reviewed (UTC): 2026-03-06
- Next review due (UTC): 2026-06-06
- Severity scope: Governance

## Purpose And Scope

Ensure runbooks remain current, accurate, and executable by enforcing review cadence and staleness checks.

## Governance Rules

- SEV-1/SEV-2 runbooks: review quarterly.
- SEV-3/SEV-4 runbooks: review semi-annually.
- Trigger immediate review after major changes in:
  - `src/app/api/**`
  - `src/services/**`
  - `functions/**`
  - `infra/**`
  - `.github/workflows/**`

## Staleness Process

1. Identify runbooks with `Next review due` in the past.
2. Assign owner and review deadline.
3. Block release if critical runbooks are stale beyond grace period.

## Automation Status

Implemented in CI via `.github/workflows/runbook-freshness.yml` and `scripts/check-runbook-freshness.mjs`.

Operator expectation:

- keep the workflow green on PRs and scheduled checks
- treat missing `Next review due (UTC)` metadata as a governance defect
- update this runbook whenever review cadence rules change

## References

- `docs/ops/templates/RUNBOOK_TEMPLATE.md`
- `docs/ops/core/OPERATIONS_READINESS.md`
