# `src/services/community`

Community-admin service helpers and tests for verification queue workflows.

## Scope

- Supports community-admin flows consumed by `src/app/api/community/**`.
- Includes queue listing, claim/assignment, and verification decisions.

## Current Implementation Status

- This folder currently contains tests only (`__tests__/`).
- Runtime community logic is currently implemented in route handlers under `src/app/api/community/**`.

## Contract (Target Extraction)

When extracted into this layer, functions should include:

- `listQueue(params, actor)`
- `claimQueueEntry(entryId, actor)`
- `getQueueEntry(entryId, actor)`
- `submitVerificationDecision(entryId, input, actor)`
- `getCoverageDashboard(actor)`

Mutating functions must:

- Require authenticated actor context with `community_admin` permissions.
- Record audit events transactionally with status transitions.
- Return typed result unions for predictable API mapping.

## Security & Safety Rules

- Never trust client-supplied reviewer identity; derive actor from session context.
- Avoid PII in logs/telemetry.
- Keep queue status transitions constrained and explicit.

## Tests

Run only this area:

- `npx vitest run src/services/community`
