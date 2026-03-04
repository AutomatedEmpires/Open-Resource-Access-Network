# `src/services/admin`

Admin-domain service helpers and tests for ORAN admin workflows.

## Scope

- Supports ORAN-admin operations consumed by `src/app/api/admin/**`.
- Covers approvals, audit views, feature/rules controls, and coverage zone administration.

## Current Implementation Status

- This folder currently contains tests only (`__tests__/`).
- Runtime admin logic is implemented inside API route handlers under `src/app/api/admin/**`.

## Contract (Target Extraction)

When logic is moved here, exported functions should be pure service functions with explicit auth context and transactional boundaries:

- `listApprovals(params, actor)`
- `decideApproval(input, actor)`
- `listAuditEvents(params, actor)`
- `listZones(params, actor)`
- `createZone(input, actor)`
- `updateZone(id, input, actor)`
- `deleteZone(id, actor)`

Each mutating function must:

- Accept `actorId` and role context.
- Execute state change + audit-log write atomically.
- Return typed success/error objects (no untyped exceptions across boundary).

## Security & Safety Rules

- No PII in logs/telemetry.
- Enforce role requirements (`oran_admin`) before mutating operations.
- Preserve retrieval-first and crisis invariants (no synthetic service facts).

## Tests

Run only this area:

- `npx vitest run src/services/admin`
