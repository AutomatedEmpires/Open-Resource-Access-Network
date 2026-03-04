# SIGMA Status

Last updated: 2026-03-03 (UTC)

## Scope (SIGMA ownership)

- API routes: `src/app/api/**/route.ts`
- Auth/session/guards: `src/services/auth/**`
- Security: `src/services/security/**`
- Flags: `src/services/flags/**`
- Telemetry wrappers: `src/services/telemetry/**`

## Recently completed

- Crisis-first hard gate for chat is enforced end-to-end: crisis routing runs before quota and before rate limiting.
- Standardized rate limiting contract: shared limiter returns `retryAfterSeconds`, and `429` responses include `Retry-After`.
- Chat no longer trusts client-supplied `userId`; server-derived session identity is used for rate limit keys and telemetry context.

## Verification

- `npx tsc --noEmit`
- `npm run test`

## Notes

- ESLint currently reports warnings (no errors) in ingestion-related tests; these are tracked separately from SIGMA work.
