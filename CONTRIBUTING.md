# Contributing to ORAN

ORAN is safety-critical. Contributions must preserve the non-negotiables in docs/VISION.md.

## Required before opening a PR

- Read docs/SSOT.md and docs/OPERATING_MODEL.md.
- If you change a safety-critical behavior, update the SSOT doc for that area (or add an ADR).

## PR requirements

- Keep PRs small and focused.
- Validate inputs with Zod in API routes.
- Add targeted tests for the exact module you changed.
- Update docs that act as SSOT for the area.

## Testing discipline (minimize wasted runtime)

Run focused tests first:

- `npm run test:chat`
- `npm run test:search`
- `npm run test:scoring`

Run full suite (`npm run test:coverage`) when touching shared contracts or multiple modules.

## Security

- Never add PII to logs/telemetry.
- Never add external live data sources to seeker-facing responses without staging/verification.

## Documentation policy

- Docs must be truthful.
- Planned items must be labeled **Planned**.
- If you touch an area, update its README and add an entry to docs/ENGINEERING_LOG.md for contract-level changes.
