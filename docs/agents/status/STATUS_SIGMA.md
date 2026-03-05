# SIGMA Status

Last updated: 2026-03-05 (UTC)

## Scope (SIGMA ownership)

- API routes: `src/app/api/**/route.ts`
- Auth/session/guards: `src/services/auth/**`
- Security: `src/services/security/**`
- Flags: `src/services/flags/**`
- Telemetry wrappers: `src/services/telemetry/**`
- Error boundaries: `src/app/global-error.tsx`, `src/app/error.tsx`, `src/app/not-found.tsx`, per-route-group `error.tsx`
- Scope management API: `src/app/api/admin/scopes/**`, `src/app/api/user/scopes/**`
- Notification API: `src/app/api/user/notifications/**`
- Appeal review API: `src/app/api/admin/appeals/**`
- Submission APIs: `src/app/api/submissions/**`

## Recently completed

- **Wave 2 (2026-03-05):**
  - Appeal submission API (`POST/GET /api/submissions/appeal`): authenticated users can appeal denied submissions they own; ownership + denied status validation, duplicate prevention, priority=1, reviewer notification with idempotency.
  - Community report API (`POST/GET /api/submissions/report`): anonymous or authenticated listing reports; 10 reason categories, 24h duplicate prevention, fraud reports elevated to priority=2.
  - Admin appeals review API (`GET/POST /api/admin/appeals`): community_admin+ review queue with status filter + pagination; transactional decide with row locking; approved appeals re-open original submission to `needs_review`.
  - Admin appeals review page (`/appeals`): status filter tabs, paginated table with priority badges, expandable decision panel.
  - Scope Center page (`/scopes`): 3-tab admin dashboard (Scopes list+create, Pending Grants two-person queue, Audit Log).
  - Seeker report page (`/report`): form with 10 reason options, details textarea, optional contact email.
  - Seeker appeal page (`/appeal`): appeal form + "My Appeals" listing with status badges.
  - Notification preferences section added to profile page: 9 event types × 2 channels checkbox grid.
  - Admin layout updated with Appeals + Scopes nav entries.
  - 51 new tests (17 admin appeals, 17 submission appeals, 17 submission reports). Total: 1572 tests passing.

- **Wave 1 (2026-03-05):**
  - HSTS header added (`max-age=63072000; includeSubDomains; preload`) in `next.config.mjs`.
  - Error boundary hierarchy: root `global-error.tsx` (inline styles, no Tailwind dependency), app-level `error.tsx`, custom `not-found.tsx`, and per-route-group boundaries for `(seeker)`, `(host)`, `(community-admin)`, `(oran-admin)` with context-appropriate fallback navigation.
  - Scope management API routes: `GET/POST /api/admin/scopes`, `GET/POST /api/admin/scopes/grants`, `PUT/DELETE /api/admin/scopes/grants/[id]`, `GET /api/user/scopes`. Two-person approval enforced on grant decisions.
  - Notification API routes: `GET /api/user/notifications`, `PUT /api/user/notifications/[id]/read`, `PUT /api/user/notifications/read-all`, `GET/PUT /api/user/notifications/preferences`.
  - Fixed notification `broadcast()` idempotency key — replaced non-deterministic `Date.now()` with resource-type+resource-id for proper deduplication.
  - 47 new tests (22 scope admin, 5 user scope, 20 notification). Total: 1450 tests passing.

- **Prior:**
  - Crisis-first hard gate for chat enforced end-to-end.
  - Standardized rate limiting contract: shared limiter returns `retryAfterSeconds`, and `429` responses include `Retry-After`.
  - Chat no longer trusts client-supplied `userId`; server-derived session identity is used for rate limit keys and telemetry context.

## Verification

- `npx tsc --noEmit` — 0 errors
- `npm run test` — 1572/1572 passing

## Notes

- ESLint currently reports warnings (no errors) in ingestion-related tests; these are tracked separately from SIGMA work.
