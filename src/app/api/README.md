# API Routes (src/app/api)

All API routes must:

- validate untrusted input using Zod
- avoid logging PII
- enforce safety gates before returning service recommendations
- guard on `isDatabaseConfigured()` and return **503** if `DATABASE_URL` is not set
- include `Retry-After` header on all 429 responses
- call `getAuthContext()` for protected routes (not rely on middleware alone)

## Public Distribution Tiers

ORAN exposes three distinct public resource-distribution surfaces:

- `/api/search` — seeker discovery and ranked search
- `/api/services` — batch lookup for already-known published service IDs
- `/api/hsds/**` — standards-oriented distribution and profile discovery

These are separate contracts. Do not collapse them into one generic public data API. See
`docs/contracts/RESOURCE_DISTRIBUTION_API.md`.

`/api/search` is always a published-only active-record query surface. Public callers must not be given a status override that can target inactive or defunct records.

## Endpoints

| Route | Method | Auth | Zod | Rate Limit | Notes |
|-------|--------|------|-----|------------|-------|
| `/api/auth/context` | GET | Clerk session required for user context | N/A | No | Returns ORAN-owned role and account state; never returns provider secrets |
| `/api/chat` | POST | Optional | Yes | Yes (20/min) | Crisis-first gate; rate limit inside orchestrator |
| `/api/search` | GET | No | Yes | Yes (60/min) | Public search |
| `/api/feedback` | POST | No | Yes | Yes (10/min) | Public feedback submission |
| `/api/services` | GET | No | Yes | Yes (60/min) | Batch service fetch by IDs |
| `/api/hsds/profile` | GET | No | N/A | No | HSDS profile/discovery metadata |
| `/api/hsds/services` | GET | No | Query parsing only | No | HSDS-compatible published services list |
| `/api/hsds/services/[id]` | GET | No | UUID validation | No | HSDS-compatible published service detail |
| `/api/hsds/organizations` | GET | No | Query parsing only | No | HSDS-compatible published organizations list |
| `/api/hsds/organizations/[id]` | GET | No | UUID validation | No | HSDS-compatible published organization detail |
| `/api/maps/token` | GET | No | N/A | Yes (60/5min) | Azure Maps key broker |
| `/api/internal/sla-check` | GET/POST | Internal (`CRON_SECRET`; rollback header supported) | N/A | No | Daily Vercel Cron SLA breach scanner |
| `/api/internal/confidence-regression-scan` | GET/POST | Internal (`CRON_SECRET`; rollback header supported) | N/A | No | Daily Vercel Cron confidence-regression scanner |
| `/api/internal/coverage-gaps` | GET/POST | Internal (`CRON_SECRET`; rollback header supported) | Yes | No | Daily Vercel Cron coverage-gap detection + admin alerting |
| `/api/internal/ingestion/feed-poll` | GET/POST | Internal (`CRON_SECRET`; rollback header supported) | Yes | No | Daily Vercel Cron source-feed poller for active HSDS / 211 feeds |
| `/api/internal/resource-freshness-scan` | GET/POST | Internal (`CRON_SECRET`; rollback header supported) | Yes | No | Daily Vercel Cron expiry, reverification, and community-review sweep |
| `/api/internal/account-erasure` | GET/POST | Internal (`CRON_SECRET`) | N/A | No | Daily; bounded durable account-erasure retries under a fixed wall-clock deadline |
| `/api/profile` | GET/PUT | Auth required | Yes | Yes | Seeker profile CRUD |
| `/api/saved` | GET/POST/DELETE | Auth required | Yes | Yes | Saved services CRUD |
| `/api/admin/audit` | GET | `oran_admin` | Yes | Yes (60/min) | Audit log read |
| `/api/admin/approvals` | GET/POST | `oran_admin` | Yes | Yes (30/min write) | Approval queue |
| `/api/admin/capacity` | GET | `community_admin` | N/A | Yes (60/min) | Admin capacity dashboard (scaling-aware) |
| `/api/admin/agents/control-plane` | GET | `oran_admin` | N/A | Yes (60/min) | Enterprise operator/control-plane snapshot |
| `/api/admin/rules` | GET/PUT | `oran_admin` | Yes | Yes (30/min write) | Feature flag management |
| `/api/admin/zones` | GET/POST | `oran_admin` | Yes | Yes (30/min write) | Coverage zone CRUD |
| `/api/admin/zones/[id]` | PUT/DELETE | `oran_admin` | Yes (UUID) | Yes (30/min) | Zone update/delete; UUID-validated |
| `/api/community/queue` | GET/POST | `community_admin` | Yes | Yes (60/30 min) | Community review queue over submissions |
| `/api/community/queue/[id]` | GET/PUT | `community_admin` | Yes (UUID) | Yes (60/30 min) | Review entry detail + decision |
| `/api/community/coverage` | GET | `community_admin` | N/A | Yes (60/min) | Coverage stats (no user input) |
| `/api/host/organizations` | GET/POST | Auth required | Yes | Yes (60/30 min) | Org CRUD; fail-closed in prod |
| `/api/host/organizations/[id]` | GET/PUT/DELETE | Auth + org scope | Yes (UUID) | Yes | Org detail; UUID-validated |
| `/api/host/services` | GET/POST | Auth + org scope | Yes | Yes (60/30 min) | Service CRUD |
| `/api/host/services/[id]` | GET/PUT/DELETE | Auth + org scope | Yes (UUID) | Yes | Service detail; UUID-validated |
| `/api/host/locations` | GET/POST | Auth + org scope | Yes | Yes (60/30 min) | Location CRUD |
| `/api/host/locations/[id]` | GET/PUT/DELETE | Auth + org scope | Yes (UUID) | Yes | Location detail; UUID-validated |
| `/api/host/admins` | GET/POST | `host_admin`/`oran_admin` | Yes | Yes (60/30 min) | Team member management |
| `/api/host/admins/[id]` | GET/PUT/DELETE | `host_admin`/`oran_admin` | Yes (UUID) | Yes | Team member detail |
| `/api/host/claim` | POST | Conditional | Yes | Yes (30/min) | Org claim; auth if configured |
| `/api/resource-submissions` | GET/POST | Auth or public create | Yes | Yes (60/30 min) | Canonical listing/claim draft collection |
| `/api/resource-submissions/[id]` | GET/PUT | Auth or public token | Yes (UUID) | Yes (60/30 min) | Canonical listing/claim draft detail + workflow actions |
| `/api/resource-submissions/[id]/assist` | POST | Auth or public token | Yes (UUID + body) | Yes (30/min) | Source-link assist that suggests canonical draft fields without publishing |
| `/api/admin/scopes` | GET/POST | `oran_admin` | Yes | Yes (60/30 min) | Platform scope CRUD |
| `/api/admin/scopes/grants` | GET/POST | `oran_admin` | Yes | Yes (60/30 min) | Scope grant requests |
| `/api/admin/scopes/grants/[id]` | PUT/DELETE | `oran_admin` | Yes (UUID) | Yes (30/min) | Grant approve/deny/revoke |
| `/api/user/scopes` | GET | Auth required | N/A | Yes (60/min) | Current user's scopes |
| `/api/user/notifications` | GET | Auth required | Yes | Yes (60/min) | Notification listing |
| `/api/user/notifications/[id]/read` | PUT | Auth required | Yes (UUID) | Yes (30/min) | Mark notification read |
| `/api/user/notifications/read-all` | PUT | Auth required | N/A | Yes (30/min) | Mark all notifications read |
| `/api/user/notifications/preferences` | GET/PUT | Auth required | Yes | Yes (60/30 min) | Notification preferences |
| `/api/user/data-export` | GET | Auth required | N/A | Yes | Typed, bounded personal-data export |
| `/api/user/data-delete` | DELETE | Auth required | N/A | Yes (1/10 min) | Atomically revokes access, deletes Clerk identity, and advances durable bounded erasure; may return 202 while work continues |
| `/api/admin/appeals` | GET/POST | `community_admin` | Yes | Yes (60/30 min) | Appeal review queue + decisions |
| `/api/submissions/appeal` | POST/GET | Auth required | Yes | Yes (30/60 min) | Submit appeal + list own appeals |
| `/api/submissions/report` | POST/GET | Optional/Auth | Yes | Yes (10/60 min) | Report listing issue + list own reports |

## Auth Enforcement

- **Proxy** (`src/proxy.ts`): Clerk identity gating and same-origin write protection.
- **API routes**: Clerk-to-ORAN authorization resolution via `getAuthContext()` plus guards from `src/services/auth/guards.ts`.
- **Production fail-closed**: protected API routes use `shouldEnforceAuth()`, which returns `true` in production even if Clerk is misconfigured.

## Update-on-touch

If you add or change an API route:

- Document the API boundary in the relevant SSOT doc (chat/search/security/privacy)
- Update `docs/contracts/RESOURCE_DISTRIBUTION_API.md` when changing `/api/search`, `/api/services`, or `/api/hsds/**`
- Add targeted unit tests for the underlying service module
- Add rate limiting where the endpoint is exposed publicly
- Include `Retry-After` header on 429 responses
