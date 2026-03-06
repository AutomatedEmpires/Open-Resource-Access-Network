# Scoring Contract

## Scope

Defines deterministic scoring and confidence behavior used for ranking and moderation signals.

## Inputs

- Structured service record fields
- Evidence and verification metadata

## Required Guarantees

- Deterministic scoring (same inputs produce same outputs).
- Score logic is explainable and documented.
- Eligibility is never guaranteed in user-facing messaging.

## Failure Modes

- Missing required fields -> conservative score handling.
- Scoring regressions -> flagged via tests and monitoring.

## Validation

- Scoring unit tests for edge and regression cases.
- Periodic confidence regression scans.

## References

- `docs/SCORING_MODEL.md`
- `src/services/scoring/**`
- `docs/ops/services/RUNBOOK_DATA_QUALITY_INCIDENT.md`
