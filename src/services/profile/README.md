# `src/services/profile`

Profile-domain service helpers and tests for authenticated profile management.

## Scope

- Supports seeker profile read/update/delete flows consumed by `src/app/api/profile/**`.
- Handles `approximateCity` and `preferredLocale` style profile preferences.

## Current Implementation Status

- This folder currently contains tests only (`__tests__/`).
- Runtime profile logic is currently implemented in `src/app/api/profile/route.ts`.

## Contract (Target Extraction)

When moved into this folder, service functions should include:

- `getProfile(actor)`
- `upsertProfile(input, actor)`
- `deleteProfile(actor)`

## Security & Privacy Rules

- Profile access is always actor-scoped; no cross-user access.
- Never log raw profile values or identifying metadata.
- Default to approximate location patterns; avoid precise geolocation behavior.

## Tests

Run only this area:

- `npx vitest run src/services/profile`
