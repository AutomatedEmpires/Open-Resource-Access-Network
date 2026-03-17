# ORAN Boundary Layer Security Audit

**Auth · API Routes · Chat/Search · DB · Publish Path**

| Field | Value |
|---|---|
| **Audit date** | 2025-07-14 |
| **Scope** | Auth/authz boundaries, all 119 API routes, chat & search retrieval safety, database layer, publish/promote path, internal API key handling |
| **Codebase snapshot** | Commit a75cf82 (HEAD of main) |
| **Prior audit** | `docs/audit/ADVERSARIAL_SYSTEMS_AUDIT.md` — covered ingestion, ownership, dedup, scoring, workflow, merge, notification, governance. All 12 launch blockers (LB1-LB12) resolved. |
| **Auditor** | Automated boundary-layer analysis |

---

## Section A — Executive Summary

**Overall posture: STRONG.** No critical vulnerabilities found across 119 API routes, 5 auth modules, 14 chat/search files, 4 internal endpoints, and 2 publish paths. The prior audit's 12 launch blockers are confirmed fixed. This audit covers the surfaces NOT addressed in the original audit.

**Key strengths:**
- 100% of protected routes call `getAuthContext()` with role verification
- All SQL queries are parameterized — zero injection vectors
- Published-only filter (`s.status = 'active' AND integrity_hold_at IS NULL`) enforced at SQL layer for all seeker-visible queries
- LLM has no database access — operates only on pre-fetched, published records
- Rate limiting present on all endpoints with Redis + in-memory fallback
- IDOR protection verified via ownership checks (`WHERE id = $1 AND user_id = $2`)
- Advisory locks + authority checks prevent concurrent/unauthorized publishes
- Ownership transfer tokens use `crypto.timingSafeEqual()`

---

## Section B — Findings

### B1. Timing-unsafe internal API key comparison (P1 — 4 routes) — ✅ RESOLVED

| Property | Detail |
|---|---|
| **Severity** | P1 (fix before scale) |
| **Status** | ✅ **RESOLVED** — all 4 internal routes use `crypto.timingSafeEqual()` with Buffer comparison |
| **Affected files** | `src/app/api/internal/confidence-regression-scan/route.ts`, `sla-check/route.ts`, `coverage-gaps/route.ts`, `ingestion/feed-poll/route.ts` |
| **Fix applied** | `const authBuf = Buffer.from(authHeader); const expectedBuf = Buffer.from(expected); if (authBuf.length !== expectedBuf.length \|\| !timingSafeEqual(authBuf, expectedBuf))` |

### B2. Database error degrades frozen-account enforcement (P1) — ✅ RESOLVED

| Property | Detail |
|---|---|
| **Severity** | P1 (fix before scale) |
| **Status** | ✅ **RESOLVED** — both catch blocks return `'frozen'` on DB error, denying access |
| **Affected files** | `src/lib/auth.ts` (`getDbAccountState`), `src/services/auth/session.ts` (`getAccountStatus`) |
| **Fix applied** | `getDbAccountState()` catch returns `{ role: null, accountStatus: 'frozen' }`. `getAccountStatus()` catch returns `'frozen'`. Test added in `session.test.ts`. |

### B3. Bcrypt silently truncates passwords >72 chars (P2) — ✅ RESOLVED

| Property | Detail |
|---|---|
| **Severity** | P2 (fix before GA) |
| **Status** | ✅ **RESOLVED** — Zod schema now enforces `.max(72, 'Password must be 72 characters or fewer')` |
| **Affected file** | `src/app/api/auth/register/route.ts` |
| **Fix applied** | Changed `.max(128)` → `.max(72, ...)`. Tests added for 72-char (accepted) and 73-char (rejected) boundaries in `register/__tests__/route.test.ts`. |

### B4. Username enumeration via registration error messages (P2)

| Property | Detail |
|---|---|
| **Severity** | P2 (acceptable risk — document decision) |
| **Affected file** | `src/app/api/auth/register/route.ts:204` |
| **Pattern** | Returns `"That username is already taken"` on duplicate username |
| **Risk** | Attackers can enumerate valid usernames on the platform. |
| **Current mitigation** | Rate limit (5 registrations/IP/window) slows enumeration. |
| **Decision** | Acceptable tradeoff for UX on a civic platform. Document in ADR if retaining. |

### B5. No `middleware.ts` — route protection is server-side only (P2)

| Property | Detail |
|---|---|
| **Severity** | P2 (design note) |
| **Affected** | No `src/middleware.ts` file exists in the codebase |
| **Pattern** | All auth is enforced per-route via `getAuthContext()` calls; no middleware-level gating |
| **Risk** | If a new route handler is added without calling `getAuthContext()`, it becomes unprotected by default. No defense-in-depth layer exists. |
| **Mitigation** | Consider adding a middleware that requires auth for `/api/admin/**`, `/api/host/**`, `/api/user/**`, `/api/community/**` patterns, with an explicit public allowlist. |

### B6. `x-forwarded-for` header used for IP extraction across 20+ routes (P2)

| Property | Detail |
|---|---|
| **Severity** | P2 (verify proxy config) |
| **Affected files** | 20+ route handlers extract IP via `req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'` |
| **Risk** | `x-forwarded-for` is user-controlled unless a trusted reverse proxy strips/overwrites it. If Next.js is exposed directly (without Azure App Service or CDN), attackers can spoof their IP to bypass rate limiting. |
| **Current mitigation** | Azure App Service sets `x-forwarded-for` from the actual client IP. |
| **Fix** | Add a centralized `getClientIp(req)` utility and document the trusted-proxy assumption. Consider using `x-azure-clientip` or `x-real-ip` where available. |

### B7. Zod `.strict()` not applied to most request schemas (P3)

| Property | Detail |
|---|---|
| **Severity** | P3 (hardening) |
| **Affected** | ~90% of API route Zod schemas use `.object()` without `.strict()` |
| **Pattern** | Without `.strict()`, extra properties in request bodies are silently stripped but accepted |
| **Risk** | Low — stripped properties have no effect on logic. However, `.strict()` helps catch client bugs and prevents future regressions where a new field might accidentally pass through. |
| **Note** | The `admin/ingestion/source-feeds` and `admin/ingestion/source-systems` routes already use `.strict()`. |

### B8. Crisis detection is keyword-only by default (P3)

| Property | Detail |
|---|---|
| **Severity** | P3 (enhancement — feature-flagged semantic layer exists) |
| **Affected file** | `src/services/chat/orchestrator.ts:50-68` |
| **Pattern** | `detectCrisis()` uses `CRISIS_KEYWORDS.some((keyword) => normalized.includes(keyword))` |
| **Risk** | Paraphrased or euphemistic self-harm expressions may bypass keyword detection. |
| **Mitigation** | Stage 1b content safety (Azure Content Safety API) is already implemented and feature-flagged via `CONTENT_SAFETY_CRISIS`. Enable in production when ready. |

---

## Section C — Attack Surface Verification Matrix

| Attack vector | Blocked by | Verified |
|---|---|---|
| **SQL injection** (all routes) | Parameterized queries (`$1, $2...`) exclusively; Drizzle ORM for typed queries | ✅ 119 routes |
| **Retrieve unpublished records** | `publishedOnly: true` → `s.status = 'active' AND integrity_hold_at IS NULL` | ✅ engine.ts, retrievalProfile.ts |
| **IDOR** (horizontal privilege escalation) | `WHERE id = $1 AND user_id = $2` ownership checks | ✅ Saved, notifications, profile, collections |
| **Vertical privilege escalation** | `requireMinRole()`, `requireOrgAccess()`, `requireOrgRole()` guards | ✅ All admin/host/community routes |
| **Unauthenticated access** (protected routes) | `getAuthContext()` returns null → 401 | ✅ 100% of non-public routes |
| **Frozen account access** | Checked in JWT callback, signIn callback, and `getAuthContext()` | ✅ Triple enforcement |
| **Prompt injection → data retrieval** | LLM has no DB access; receives only pre-fetched service cards | ✅ llm.ts, orchestrator.ts |
| **Prompt injection → hallucination** | System prompt forbids inventing facts; LLM output validated | ✅ llm.ts:30-43 |
| **Chat quota bypass** | Per-session + 24-hr window, keyed on userId AND deviceId | ✅ quota.ts |
| **Rate limit bypass** | Redis-backed shared limiting with in-memory fallback | ✅ rateLimit.ts + all routes |
| **Publish quarantined candidate** | Quarantine → `oran_admin` only + 11-criteria readiness gate | ✅ materialize.ts, publish.ts |
| **Concurrent publish race condition** | PostgreSQL advisory locks via `acquireLivePublicationAdvisoryLock()` | ✅ livePublish.ts, promoteToLive.ts |
| **Low-trust source overwrites high-trust** | `decidePublicationOverwrite()` authority check | ✅ livePublish.ts:227 |
| **Link/URL injection in chat** | `safeHttpUrl()` validates HTTP/HTTPS only; labels are enums | ✅ links.ts |
| **PII in chat response** | ServiceCard exposes only published fields; no user data | ✅ types.ts:227-239 |
| **Test auth in production** | `NODE_ENV !== 'production'` guard on test provider | ✅ auth.ts:180 |
| **Registration spam** | 5 reg/IP/window + honeypot field | ✅ register/route.ts |
| **Ownership token timing attack** | `crypto.timingSafeEqual()` | ✅ ownershipTransfer/service.ts:316 |

---

## Section D — Strengths Catalog

These security patterns are well-implemented and should be preserved:

1. **Fail-closed auth in production** — `shouldEnforceAuth()` always returns `true` in production regardless of Entra config
2. **Triple frozen-account enforcement** — JWT callback + signIn callback + `getAuthContext()`
3. **Role hierarchy with numeric levels** — prevents privilege escalation via role injection
4. **Per-route auth validation** — every protected handler independently calls `getAuthContext()`
5. **Published-only SQL predicate** — `buildPublishedServicePredicate()` enforced at engine level, not per-query
6. **LLM isolation** — no DB access, pre-fetched records only, explicit anti-hallucination system prompt
7. **Advisory locks for publish atomicity** — prevents concurrent publication race conditions
8. **Authority-gated overwrites** — `decidePublicationOverwrite()` prevents low-trust sources from overwriting official data
9. **Device + user quota tracking** — cross-session, cross-device chat abuse prevention
10. **Ownership transfer token security** — `crypto.timingSafeEqual()` + expiry + audit logging
11. **Connection pool safety** — 10 max connections, 5s connect timeout, 30s statement timeout, 30s idle timeout
12. **Honeypot bot prevention** — invisible `website` field returns fake 201 to confuse scrapers

---

## Section E — Recommendations Priority Matrix

| ID | Finding | Priority | Effort | Recommendation |
|---|---|---|---|---|
| B1 | Timing-unsafe API key comparison | **P1** | ✅ Done | All 4 routes use `crypto.timingSafeEqual()` |
| B2 | DB error → frozen bypass | **P1** | ✅ Done | Both catch blocks return `'frozen'`; test added |
| B3 | Bcrypt 72-char truncation | **P2** | ✅ Done | Zod `.max(72)` enforced; boundary tests added |
| B4 | Username enumeration | **P2** | — | Document as accepted risk in ADR |
| B5 | No middleware.ts | **P2** | 2 hours | Add route-pattern middleware for defense-in-depth |
| B6 | x-forwarded-for trust | **P2** | 1 hour | Centralize `getClientIp()` + document proxy assumption |
| B7 | Missing `.strict()` on Zod schemas | **P3** | 2 hours | Add `.strict()` to remaining API schemas |
| B8 | Keyword-only crisis detection | **P3** | — | Enable feature-flagged semantic layer in production |

---

## Section F — Coverage Summary

| Surface | Files examined | Routes | Issues found |
|---|---|---|---|
| Auth / session / guards | 6 files | — | 2 (B2, B4) |
| API routes | 119 routes across 34+ endpoints | 119 | 3 (B5, B6, B7) |
| Chat pipeline | 8 files (orchestrator, llm, links, quota, intentEnrich, types, retrievalProfile) | 2 | 1 (B8) |
| Search engine | 4 files (engine, discovery, publication, types) | 1 | 0 |
| Database layer | 2 files (postgres.ts, drizzle.ts) | — | 0 |
| Internal API auth | 4 routes | 4 | 1 (B1) |
| Publish/promote path | 4 files (publish.ts, livePublish.ts, promoteToLive.ts, materialize.ts) | — | 0 |
| Registration | 1 file | 1 | 2 (B3, B4) |
| Rate limiting | 1 file (rateLimit.ts) | — | 0 |
| **Totals** | **30+ files** | **127 routes** | **8 findings (0 critical, 2 P1, 4 P2, 2 P3)** |

---

## Section G — Relation to Prior Audit

All 12 launch blockers from `docs/audit/ADVERSARIAL_SYSTEMS_AUDIT.md` are confirmed resolved:

| LB | Status | Verification |
|---|---|---|
| LB1 — Merge auth | ✅ Fixed | `assertMergeAuthorized()` in merge/service.ts |
| LB2 — skipGates boolean | ✅ Fixed | `SkipGateOptions` object replaced boolean |
| LB3 — Ownership self-approve | ✅ Fixed | Routes through `advance()` |
| LB4 — Notification idempotency | ✅ Fixed | `Date.now()` → stable keys |
| LB5 — autoPublish default tier | ✅ Fixed | Default handler added |
| LB6 — Cross-path dedup | ✅ Fixed | `findByNormalizedName()` in CandidateStore |
| LB7 — Notification rate limiting | ✅ Fixed | 100/hour in notifications/service.ts |
| LB8 — Admin capacity | ✅ Fixed | `pending_count` check in `assignSubmission()` |
| LB9 — Raw confidence score | ✅ Fixed | `computeRawConfidenceScore()` preserves negatives |
| LB10 — .gov/.edu quarantine | ✅ Fixed | Changed from `allowlisted` to `quarantine` |
| LB11 — Merge snapshot | ✅ Fixed | `recordMergeSnapshot()` before merge |
| LB12 — Score regression demotion | ✅ Fixed | `determineReviewStatus()` demotes below 60 |

---

---

## Section H — Resolution Log

| ID | Resolved | Method | Test coverage |
|---|---|---|---|
| B1 | 2025-07-14 | `crypto.timingSafeEqual()` in all 4 internal routes | Existing route tests verify 401/503 auth patterns |
| B2 | 2025-07-14 | Catch blocks return `'frozen'` in `auth.ts` and `session.ts` | `session.test.ts` — "returns null when getAccountStatus throws" |
| B3 | 2025-07-14 | Zod `.max(72)` in register schema | `register/__tests__/route.test.ts` — 72-char boundary tests |

*B1–B3 (both P1s + one P2) resolved. Remaining: B4 (accept & document), B5–B6 (P2 hardening), B7–B8 (P3 enhancements).*
