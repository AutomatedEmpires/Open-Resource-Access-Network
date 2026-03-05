# API Routes (src/app/api)

All API routes must:

- validate untrusted input using Zod
- avoid logging PII
- enforce safety gates before returning service recommendations
- guard on `isDatabaseConfigured()` and return **503** if `DATABASE_URL` is not set
- include `Retry-After` header on all 429 responses
- call `getAuthContext()` for protected routes (not rely on middleware alone)

## Endpoints

| Route | Method | Auth | Zod | Rate Limit | Notes |
|-------|--------|------|-----|------------|-------|
| `/api/auth/[...nextauth]` | GET/POST | NextAuth handler | N/A | Yes (30/min) | OAuth flow; rate-limited per IP |
| `/api/chat` | POST | Optional | Yes | Yes (20/min) | Crisis-first gate; rate limit inside orchestrator |
| `/api/search` | GET | No | Yes | Yes (60/min) | Public search |
| `/api/feedback` | POST | No | Yes | Yes (10/min) | Public feedback submission |
| `/api/services` | GET | No | Yes | Yes (60/min) | Batch service fetch by IDs |
| `/api/maps/token` | GET | No | N/A | Yes (60/5min) | Azure Maps key broker |
| `/api/internal/sla-check` | POST | Internal (Bearer `INTERNAL_API_KEY`) | N/A | No | SLA breach scanner (timer-triggered) |
| `/api/internal/confidence-regression-scan` | POST | Internal (Bearer `INTERNAL_API_KEY`) | N/A | No | Creates deduped confidence regression submissions |
| `/api/profile` | GET/PUT | Auth required | Yes | Yes | Seeker profile CRUD |
| `/api/saved` | GET/POST/DELETE | Auth required | Yes | Yes | Saved services CRUD |
| `/api/admin/audit` | GET | `oran_admin` | Yes | Yes (60/min) | Audit log read |
| `/api/admin/approvals` | GET/POST | `oran_admin` | Yes | Yes (30/min write) | Approval queue |
| `/api/admin/rules` | GET/PUT | `oran_admin` | Yes | Yes (30/min write) | Feature flag management |
| `/api/admin/zones` | GET/POST | `oran_admin` | Yes | Yes (30/min write) | Coverage zone CRUD |
| `/api/admin/zones/[id]` | PUT/DELETE | `oran_admin` | Yes (UUID) | Yes (30/min) | Zone update/delete; UUID-validated |
| `/api/community/queue` | GET/POST | `community_admin` | Yes | Yes (60/30 min) | Verification queue |
| `/api/community/queue/[id]` | GET/PUT | `community_admin` | Yes (UUID) | Yes (60/30 min) | Queue entry detail + decision |
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
| `/api/admin/scopes` | GET/POST | `oran_admin` | Yes | Yes (60/30 min) | Platform scope CRUD |
| `/api/admin/scopes/grants` | GET/POST | `oran_admin` | Yes | Yes (60/30 min) | Scope grant requests |
| `/api/admin/scopes/grants/[id]` | PUT/DELETE | `oran_admin` | Yes (UUID) | Yes (30/min) | Grant approve/deny/revoke |
| `/api/user/scopes` | GET | Auth required | N/A | Yes (60/min) | Current user's scopes |
| `/api/user/notifications` | GET | Auth required | Yes | Yes (60/min) | Notification listing |
| `/api/user/notifications/[id]/read` | PUT | Auth required | Yes (UUID) | Yes (30/min) | Mark notification read |
| `/api/user/notifications/read-all` | PUT | Auth required | N/A | Yes (30/min) | Mark all notifications read |
| `/api/user/notifications/preferences` | GET/PUT | Auth required | Yes | Yes (60/30 min) | Notification preferences |
| `/api/admin/appeals` | GET/POST | `community_admin` | Yes | Yes (60/30 min) | Appeal review queue + decisions |
| `/api/submissions/appeal` | POST/GET | Auth required | Yes | Yes (30/60 min) | Submit appeal + list own appeals |
| `/api/submissions/report` | POST/GET | Optional/Auth | Yes | Yes (10/60 min) | Report listing issue + list own reports |

## Auth Enforcement

- **Middleware** (`src/middleware.ts`): page-level route protection with JWT role enforcement.
- **API routes**: server-side session validation via `getAuthContext()` + guards from `src/services/auth/guards.ts`.
- **Production fail-closed**: host API routes use `shouldEnforceAuth()` which returns `true` in production even if Entra ID is not configured.

## Update-on-touch

If you add or change an API route:

- Document the API boundary in the relevant SSOT doc (chat/search/security/privacy)
- Add targeted unit tests for the underlying service module
- Add rate limiting where the endpoint is exposed publicly
- Include `Retry-After` header on 429 responses
