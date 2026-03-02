# Agent A — Backend: Auth, Middleware, & Data APIs

**Scope**: Server-side infrastructure only. Middleware, API routes, service-layer functions, and their tests.
**Boundary**: Agent A does NOT touch any file under `src/app/(seeker)/`, `src/components/`, or any `.tsx` page/component. Those belong exclusively to Agent B.

---

## Operating Rules

1. **Read the project instructions first**: `docs/SSOT.md`, `docs/OPERATING_MODEL.md`, `.github/copilot-instructions.md`.
2. **Read the audit**: `docs/AUDIT_SEEKER_UX.md` — sections 3, 4, and 7 are your primary input.
3. **No hallucinated data**: never invent service records, user IDs, or auth tokens in production code.
4. **Validate all input** with Zod on every new API route.
5. **Follow existing patterns**: look at `src/app/api/search/route.ts` and `src/app/api/host/` routes for structure.
6. **Test everything**: every new function and route gets unit tests under `__tests__/`. Use Vitest. Match existing test patterns.
7. **Update docs on touch**: if you change a contract, update the relevant `README.md` under `src/services/` and append to `docs/ENGINEERING_LOG.md`.
8. **Run validation before declaring done**: `npx tsc --noEmit && npm run lint && npm run test`.

---

## Tasks

### A1. Fix middleware role enforcement (G1 + G2)

**Problem**: `src/middleware.ts` declares `minRole` per route but never evaluates it. Session token existence is checked but the token is never validated and no role is extracted.

**Files to modify**:
- `src/middleware.ts`

**What to do**:
1. After confirming the session cookie exists, call a lightweight session-validation helper to extract the user's role. Since NextAuth.js sessions are stored in a JWT or DB, you need to decode the session to get claims. Use `getToken()` from `next-auth/jwt` (already a dependency) — this works in Edge middleware and returns the decoded JWT with the user's role claim.
2. Compare the extracted role against the route's `minRole` using the existing role hierarchy in `src/domain/types.ts` (`OranRole`). A helper `isRoleAtLeast(userRole, minRole)` should be created in `src/services/auth/guards.ts` (a `requireMinRole` function already exists there — verify it works for middleware or create a pure function variant that doesn't need `AuthContext`).
3. If the user's role is insufficient, return a 403 response (not a redirect).
4. If token decoding fails, maintain current behavior: 503 in production, pass-through in dev.

**Acceptance criteria**:
- A request with a valid session cookie but role `seeker` hitting `/org` (requires `host_member`) returns 403.
- A request with role `host_admin` hitting `/saved` (requires `seeker`) passes through (higher role satisfies lower).
- A request with no cookie still redirects to sign-in.
- Dev-mode bypass (no `AZURE_AD_CLIENT_ID`) still works for local development.
- Tests in `src/middleware.test.ts` (or `__tests__/middleware.test.ts`) cover: no cookie → redirect, valid cookie + sufficient role → pass, valid cookie + insufficient role → 403, decode failure in prod → 503.

**Do NOT**:
- Touch any page component or UI file.
- Add a sign-in page (that's Agent B).

---

### A2. Create batch-fetch-by-IDs endpoint (G3)

**Problem**: `/saved` page fetches all services then filters client-side. No endpoint accepts a list of service IDs.

**Files to create**:
- `src/app/api/services/route.ts`

**Files to modify**:
- `src/services/search/engine.ts` — add a `searchByIds` method to `ServiceSearchEngine`

**What to do**:
1. In `src/services/search/engine.ts`, add a method `searchByIds(ids: string[]): Promise<SearchResult[]>` that queries services by a list of UUIDs. Limit to 50 IDs max. Use parameterized SQL (`WHERE s.id = ANY($1::uuid[])`). Return the same `SearchResult` shape as the existing `search()` method including org, location, address, confidence data.
2. Create `src/app/api/services/route.ts` with a `GET` handler:
   - Query param: `ids` — comma-separated UUIDs, validated with Zod (array of UUID strings, max 50).
   - Rate limit: 30 req/min (use existing `checkRateLimitBase`).
   - Returns `{ results: EnrichedService[] }`.
   - No auth required (service data is public, same as `/api/search`).

**API contract (Agent B will code against this)**:
```
GET /api/services?ids=uuid1,uuid2,uuid3
Response 200: { results: EnrichedService[] }
Response 400: { error: string } (invalid IDs or >50)
Response 429: { error: string } (rate limited)
```

**Acceptance criteria**:
- `GET /api/services?ids=<valid-uuid>` returns the matching service in `results[]`.
- `GET /api/services?ids=<invalid>` returns 400.
- `GET /api/services?ids=` with >50 IDs returns 400.
- `GET /api/services` with no `ids` param returns 400.
- Unit tests for `searchByIds` in `src/services/search/__tests__/`.
- Route-level tests in `src/app/api/services/__tests__/` or co-located.

---

### A3. Create profile API routes (G5)

**Problem**: `user_profiles` DB table exists (migration 0006) but no API routes exist.

**Files to create**:
- `src/app/api/profile/route.ts`

**What to do**:
1. `GET /api/profile` — requires authentication (call `getAuthContext()`, return 401 if null). Returns the user's profile from `user_profiles` table. If no row exists, return `{ profile: null }` (not 404).
2. `PUT /api/profile` — requires authentication. Accepts `{ approximateCity?: string, preferredLocale?: string }`. Upserts into `user_profiles` using the `userId` from `AuthContext`. Validate with Zod. Do NOT allow setting `role` or `display_name` via this endpoint (those are admin-managed).
3. Both endpoints use `getAuthContext()` from `src/services/auth`.
4. Rate limit: 20 req/min.

**API contract (Agent B will code against this)**:
```
GET /api/profile
  Headers: Cookie (session)
  Response 200: { profile: { userId: string, preferredLocale: string | null, approximateCity: string | null } | null }
  Response 401: { error: "Authentication required" }

PUT /api/profile
  Headers: Cookie (session)
  Body: { approximateCity?: string, preferredLocale?: string }
  Response 200: { profile: { userId: string, preferredLocale: string | null, approximateCity: string | null } }
  Response 400: { error: string }
  Response 401: { error: "Authentication required" }
```

**Acceptance criteria**:
- Unauthenticated request → 401 on both GET and PUT.
- GET with no existing profile → `{ profile: null }`.
- PUT creates a new row if none exists (upsert).
- PUT with `{ role: 'oran_admin' }` in body is ignored (not settable).
- Zod validation rejects invalid locale strings.
- Tests cover: auth gate, upsert, field filtering, validation.

---

### A4. Create saved-services API routes (G6)

**Problem**: `saved_services` DB table exists (migration 0011) but no API routes exist.

**Files to create**:
- `src/app/api/saved/route.ts`

**What to do**:
1. `GET /api/saved` — requires auth. Returns `{ savedIds: string[] }` — list of service IDs saved by this user. Query: `SELECT service_id FROM saved_services WHERE user_id = $1 ORDER BY saved_at DESC`.
2. `POST /api/saved` — requires auth. Body: `{ serviceId: string }`. Inserts into `saved_services`. If already saved, return 200 (idempotent, no error). Returns `{ saved: true, serviceId: string }`.
3. `DELETE /api/saved` — requires auth. Body or query param: `{ serviceId: string }`. Deletes from `saved_services`. Idempotent. Returns `{ removed: true, serviceId: string }`.
4. Rate limit: 30 req/min.

**API contract (Agent B will code against this)**:
```
GET /api/saved
  Response 200: { savedIds: string[] }
  Response 401: { error: "Authentication required" }

POST /api/saved
  Body: { serviceId: string (uuid) }
  Response 200: { saved: true, serviceId: string }
  Response 400: { error: string }
  Response 401: { error: "Authentication required" }

DELETE /api/saved
  Body: { serviceId: string (uuid) }
  Response 200: { removed: true, serviceId: string }
  Response 401: { error: "Authentication required" }
```

**Acceptance criteria**:
- Unauthenticated → 401 on all three methods.
- POST same serviceId twice → 200 both times (idempotent).
- DELETE non-existent serviceId → 200 (idempotent).
- GET returns IDs in reverse chronological order.
- Zod validates serviceId as UUID.
- Tests cover: auth gate, idempotency, ordering, validation.

---

### A5. Wire chat retrieval to use profile context (G10)

**Problem**: `orchestrateChat` passes `context` to `deps.retrieveServices()` but the search engine ignores it. The `_context` parameter in the chat API route's `retrieveServices` callback is unused.

**Files to modify**:
- `src/app/api/chat/route.ts` — update the `retrieveServices` callback to use `context.userProfile.approximateCity` (if present) for geo-biased search.
- `src/services/search/engine.ts` — add an optional `cityBias?: string` filter that, if the city matches a known location, adds a soft distance-sort preference (not a hard filter — never excludes results).

**What to do**:
1. In the chat route's `retrieveServices` callback, read `context.userProfile` and, if `approximateCity` is set, add it as a `cityBias` param to the search query.
2. In the search engine, if `cityBias` is provided, attempt a geocode lookup (city name → lat/lng from the `addresses` table itself — `SELECT DISTINCT city, AVG(l.latitude), AVG(l.longitude) FROM addresses a JOIN locations l ON l.id = a.location_id WHERE LOWER(a.city) = LOWER($1) GROUP BY city LIMIT 1`). If found, add a distance-sort preference. If not found, ignore silently.
3. This must NOT exclude results — it only adjusts sort order. A user in "Portland" still sees all matching services, but Portland-area services sort higher.

**Acceptance criteria**:
- Chat with `approximateCity = "Portland"` sorts Portland-area services higher (if any exist in DB).
- Chat without a profile still works identically to current behavior.
- No new external API calls (geocode from own DB data only).
- Tests cover: with city bias, without city bias, unknown city gracefully ignored.

---

## Files Exclusively Owned by Agent A

These files are created or modified ONLY by Agent A. Agent B must not touch them:

| File | Action |
|------|--------|
| `src/middleware.ts` | Modify |
| `src/app/api/services/route.ts` | Create |
| `src/app/api/profile/route.ts` | Create |
| `src/app/api/saved/route.ts` | Create |
| `src/services/auth/guards.ts` | Modify (add `isRoleAtLeast` helper) |
| `src/services/search/engine.ts` | Modify (add `searchByIds`, `cityBias`) |
| `src/app/api/chat/route.ts` | Modify (wire `_context`) |
| All `__tests__/` files for the above | Create |

---

## Definition of Done

All of the following must pass before Agent A's work is complete:

- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npm run lint` — zero errors
- [ ] `npm run test` — all tests pass, including new tests
- [ ] Middleware rejects insufficient roles with 403 (tested)
- [ ] `GET /api/services?ids=...` returns correct services (tested)
- [ ] `GET/PUT /api/profile` auth-gated and functional (tested)
- [ ] `GET/POST/DELETE /api/saved` auth-gated, idempotent, functional (tested)
- [ ] Chat retrieval respects `approximateCity` sort bias (tested)
- [ ] No `.tsx` page or component files were modified
- [ ] `docs/ENGINEERING_LOG.md` updated with summary of new API contracts
