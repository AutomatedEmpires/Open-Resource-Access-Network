# Scoring Service (src/services/scoring)

## Public score contract (SSOT)

- Exactly three public sub-scores (0–100):
  - Verification Confidence
  - Eligibility Match
  - Constraint Fit

Final score:

`final = 0.45 * verification + 0.40 * eligibility + 0.15 * constraint`

Primary entry points:

- src/services/scoring/scorer.ts

## Tests

- `src/services/scoring/__tests__/scoring.test.ts`

## Update-on-touch

If you change any weights, bands, or scoring signals:

- Update docs/SCORING_MODEL.md
- Update tests to assert invariants (weights and band boundaries)
