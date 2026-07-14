# Runbook: Stale Runbook Governance

## Metadata

- Owner role: Release Manager
- Reviewers: Platform On-Call Lead, Security Lead
- Operational status: active
- Last reviewed (UTC): 2026-07-13
- Next review due (UTC): 2026-10-13
- Severity scope: Governance

## Purpose And Scope

Ensure runbooks remain current, accurate, and executable by enforcing review cadence and staleness checks.

## Governance Rules

- SEV-1/SEV-2 runbooks: review quarterly.
- SEV-3/SEV-4 runbooks: review semi-annually.
- Every operational runbook declares `active` or `rollback-only` status.
- Rollback-only runbooks remain review-gated until they are archived and must
  name an active replacement and retirement trigger.
- A review date records a substantive content/code validation, not a metadata edit.
- Trigger immediate review after major changes in:
  - `src/app/api/**`
  - `src/services/**`
  - `db/migrations/**`
  - `functions/**`
  - `infra/**`
  - `.github/workflows/**`
  - `vercel.json`

## Staleness Process

1. Identify runbooks with `Next review due` in the past.
2. Assign owner and review deadline.
3. Block release if critical runbooks are stale beyond grace period.
4. Review content against current code and operating provider before advancing
   dates; record remaining gaps rather than inventing successful drills.
5. Archive a retired runbook only after catalog links, alert routing, credentials,
   and replacement coverage are reconciled.

## Automation Status

Implemented in CI via `.github/workflows/runbook-freshness.yml` and `scripts/check-runbook-freshness.mjs`.

Operator expectation:

- keep the workflow green on PRs and scheduled checks
- treat missing/invalid owner, reviewer, lifecycle, last-review, or next-review
  metadata as a governance defect
- keep both active and rollback-only documents in the weekly full scan
- update this runbook whenever review cadence rules change

The checker must work on Windows and Linux. Focused tests cover native repository
path resolution, strict dates, lifecycle requirements, and overdue rollback-only
documents.

## References

- `docs/ops/templates/RUNBOOK_TEMPLATE.md`
- `docs/ops/core/OPERATIONS_READINESS.md`
- `scripts/check-runbook-freshness.mjs`
- `src/__tests__/scripts/check-runbook-freshness.test.ts`
