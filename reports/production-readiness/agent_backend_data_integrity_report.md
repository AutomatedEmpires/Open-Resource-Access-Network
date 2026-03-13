# Agent Backend & Data Integrity Report

Date: 2026-03-09 UTC
Scope: Backend API routes, database schema alignment, GDPR data lifecycle, type safety, and retrieval-first integrity.
Auditor mode: active remediation with verification (Audit → Identify → Fix → Verify → Report → Re-audit).

---

## 1. Domain Inventory

Files audited and/or modified in this cycle:

| File | Action | Severity |
|------|--------|----------|
| `src/app/api/admin/audit/route.ts` | **Fixed** — wrong table name + 6 wrong column names | P0 Critical |
| `src/app/api/reports/route.ts` | **Fixed** — NULL into NOT NULL `submitted_by_user_id` | P0 Critical |
| `src/app/api/user/data-export/route.ts` | **Fixed** — 3 missing GDPR tables, wrong columns | P1 High |
| `src/app/api/user/data-delete/route.ts` | **Fixed** — 3 missing GDPR tables, NOT NULL sentinel | P1 High |
| `src/lib/auth.ts` | **Fixed** — TS2345 type narrowing for `GOOGLE_CLIENT_ID` | P2 Medium |
| `src/app/api/auth/register/__tests__/route.test.ts` | **Fixed** — TS2540 readonly `NODE_ENV` assignment | P2 Medium |
| `src/app/api/user/security/password/__tests__/route.test.ts` | **Fixed** — TS2540 readonly `NODE_ENV` assignment | P2 Medium |
| `src/app/api/admin/audit/__tests__/route.test.ts` | **Created** — 8 new tests (previously zero coverage) | P2 Medium |
| `src/app/api/reports/__tests__/route.test.ts` | **Updated** — aligned with sentinel fix | Alignment |
| `src/app/api/user/data-delete/__tests__/route.test.ts` | **Updated** — query count 12→14, shifted indices | Alignment |
| `src/components/chat/ChatWindow.tsx` | **Restored** — prior session corruption (git checkout) | P0 Critical |

Additional files read-only audited (no changes needed):

- `db/migrations/` — all 41 migration files reviewed for schema drift
- `src/db/schema.ts` — Drizzle ORM schema cross-referenced
- `src/services/chat/orchestrator.ts` — retrieval-first compliance verified
- `src/services/search/engine.ts` — no LLM in retrieval/ranking confirmed
- `src/app/api/chat/route.ts` — crisis gate + retrieval-first pipeline verified
- `src/services/flags/flags.ts` — `llm_summarize` gating confirmed
- `docs/SSOT.md`, `docs/DATA_MODEL.md`, `docs/CHAT_ARCHITECTURE.md`, `docs/SCORING_MODEL.md`, `docs/SECURITY_PRIVACY.md` — cross-referenced as authoritative

---

## 2. Findings Summary

### P0 — Critical (would crash or corrupt in production)

| ID | Finding | Root Cause | Fix |
|----|---------|------------|-----|
| P0-1 | `GET /api/admin/audit` queries `audit_log` (singular) | Table was renamed to `audit_logs` in migration 0001; route never updated | Changed to `audit_logs` |
| P0-2 | Audit route uses 6 wrong column names | Columns were renamed in schema evolution; route hardcoded stale names | `table_name`→`resource_type`, `record_id`→`resource_id`, `user_id`→`actor_user_id`, `old_data`→`before`, `new_data`→`after`, `ip_address`→`ip_digest` |
| P0-3 | `POST /api/reports` inserts NULL for NOT NULL `submitted_by_user_id` | Anonymous reports had no user ID; column constraint is NOT NULL | Sentinel value `'anon_reporter'` used instead |
| P0-4 | `ChatWindow.tsx` corrupted — JSX fragments spliced into import block | Prior agent session's failed edit left partial content | Restored via `git checkout HEAD` |

### P1 — High (data loss or regulatory exposure)

| ID | Finding | Root Cause | Fix |
|----|---------|------------|-----|
| P1-1 | GDPR data-export missing `chat_sessions`, `seeker_feedback`, `seeker_profiles` | Tables added in later migrations; export route not updated | Added 3 new SELECT queries |
| P1-2 | GDPR data-export queries non-existent `payload` column on `notification_events` | Column never existed in migration; was placeholder code | Replaced with actual columns: `title`, `body`, `event_type`, `channel`, `resource_type`, `is_read`, `created_at` |
| P1-3 | GDPR data-delete missing same 3 tables | Same root cause as P1-1 | Added 3 new DELETE/cleanup queries |
| P1-4 | GDPR data-delete sets `submitted_by_user_id = NULL` | Column is NOT NULL constrained | Changed to sentinel `'[deleted]'` |

### P2 — Medium (type errors or test reliability)

| ID | Finding | Root Cause | Fix |
|----|---------|------------|-----|
| P2-1 | `GOOGLE_CLIENT_ID` is `string \| undefined`, passed where `string` required | Missing nullish coalescing | Added `?? ''` |
| P2-2 | Two test files assign `process.env.NODE_ENV` directly | `NODE_ENV` is readonly in TypeScript strict | Replaced with `vi.stubEnv()` / `vi.unstubAllEnvs()` |
| P2-3 | Audit route had zero test coverage | Gap in test suite | Created 8 new tests covering auth, validation, column correctness, filtering, error handling |

---

## 3. Schema vs Migration Alignment Audit

Cross-referenced all 41 SQL migration files against `src/db/schema.ts` and live API route queries.

| Table | Status | Notes |
|-------|--------|-------|
| `audit_logs` | **FIXED** | Route was using `audit_log` (singular) + 6 wrong columns |
| `submissions` | Clean | Legacy `verification_queue` references only in tests/docs, not live code |
| `scope_audit_log` | Clean | Correctly mapped throughout |
| `notification_events` | **FIXED** | data-export was querying non-existent `payload` column |
| `chat_sessions` | **FIXED** | Missing from GDPR export/delete paths |
| `seeker_feedback` | **FIXED** | Missing from GDPR export/delete paths |
| `seeker_profiles` | **FIXED** | Missing from GDPR export/delete paths |
| `saved_services` | Clean | Already in GDPR paths |
| `user_profiles` | Clean | Correctly referenced |
| All other tables | Clean | No drift detected between migrations and query usage |

---

## 4. Retrieval-First Integrity Audit

Per `docs/CHAT_ARCHITECTURE.md` and SSOT non-negotiables:

| Rule | Status | Evidence |
|------|--------|----------|
| Chat results come from stored records only | **PASS** | `src/app/api/chat/route.ts` calls `ServiceSearchEngine` with text queries derived from user intent; results are DB rows only |
| No LLM participates in retrieval or ranking | **PASS** | `ServiceSearchEngine.search()` uses SQL full-text search + PostGIS distance; no LLM call in retrieval path |
| LLM summarization gated by `llm_summarize` flag | **PASS** | `src/services/flags/flags.ts` checks flag before any LLM summarization; flag is off by default |
| Crisis hard gate fires first | **PASS** | `src/app/api/chat/route.ts` checks crisis indicators before retrieval; returns 911/988/211 routing |
| No hallucinated facts | **PASS** | LLM (when enabled) receives only already-retrieved records; prompt instructs "do not add facts" |

---

## 5. GDPR Data Lifecycle Completeness

After fixes, the GDPR data paths now cover all user-linked tables:

| Table | Export | Delete | Method |
|-------|--------|--------|--------|
| `user_profiles` | ✅ | ✅ | SELECT / DELETE |
| `saved_services` | ✅ | ✅ | SELECT / DELETE |
| `notification_events` | ✅ | ✅ | SELECT / DELETE |
| `seeker_feedback` | ✅ | ✅ | SELECT / DELETE |
| `seeker_profiles` | ✅ | ✅ | SELECT / DELETE |
| `chat_sessions` | ✅ | ✅ | SELECT / DELETE |
| `submissions` | ✅ | ✅ | SELECT / SET sentinel `'[deleted]'` |
| `audit_logs` | ✅ | ✅ | SELECT / SET sentinel `'[deleted]'` |

---

## 6. Type Safety

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | **0 errors** |
| Strict mode enabled | Yes (`tsconfig.json`: `"strict": true`) |
| Zod validation at API boundaries | Confirmed on all modified routes |

---

## 7. Test Coverage

| Scope | Tests | Status |
|-------|-------|--------|
| All API routes (`src/app/api/`) | 804 | ✅ All pass |
| New audit route tests | 8 | ✅ All pass |
| Agent 2-modified files only | 50 | ✅ All pass |
| Full suite | 3,083+ | 27 failures (all pre-existing, not from Agent 2 work) |

Pre-existing failures not owned by this agent:
- 16 in `directory-page-client.test.tsx` — Agent 4 uncommitted UI changes
- 7 in `map-page-client.test.tsx` — Agent 4 uncommitted UI changes
- 2 in `layout-shell.test.tsx` — Agent 4 uncommitted UI changes
- 2 in `envContract.test.ts` — Agent 1 new env vars (`AZURE_MAPS_KEY`, `AZURE_MAPS_SAS_TOKEN`, `AZURE_TRANSLATOR_*`)

---

## 8. Security Posture (Agent 2 scope)

| Control | Status |
|---------|--------|
| No PII in logs/telemetry | ✅ Audit route returns pseudonymised hashes; Sentry calls do not include user data |
| SQL injection prevention | ✅ All queries use parameterised `$N` placeholders via `executeQuery()` |
| Rate limiting | ✅ All modified routes use `checkRateLimit()` |
| Auth enforcement | ✅ All admin routes check `getAuthContext()` + `requireMinRole()` |
| Cache-Control | ✅ Audit route returns `private, no-store` |
| NOT NULL constraint safety | ✅ Sentinel values used instead of NULL for constrained columns |

---

## 9. Non-Negotiable Compliance

| ORAN Non-Negotiable | Status |
|---------------------|--------|
| Retrieval-first: results from stored records only | ✅ Verified |
| No hallucinated facts | ✅ Verified |
| Crisis hard gate (911/988/211) | ✅ Verified |
| Eligibility caution ("may qualify") | ✅ Not affected by Agent 2 changes |
| Privacy-first (approximate location, no PII in logs) | ✅ Verified |
| Security (SECURITY_PRIVACY.md compliance) | ✅ Verified |

---

## 10. Remaining Risks / Recommendations

| # | Risk | Severity | Recommendation |
|---|------|----------|----------------|
| R-1 | `params` array shared by reference between count and select queries in audit route | Low | PostgreSQL ignores extra params beyond `$N` placeholders; functionally safe but could be cleaner with `[...params]` spread for the count query |
| R-2 | `anon_reporter` sentinel in submissions table has no formal documentation | Low | Add a comment in DATA_MODEL.md explaining sentinel values for NOT NULL columns |
| R-3 | Pre-existing test failures from other agents (27 tests) | Medium | Other agents should fix their own test regressions before merge |
| R-4 | No integration test for GDPR export/delete against a real DB | Medium | Consider adding a DB-backed integration test in a future cycle |

---

## 11. Verification Commands

```bash
# Typecheck (expect 0 errors)
npx tsc --noEmit

# All API route tests (expect 804 pass)
npx vitest run src/app/api/

# Audit route tests specifically (expect 8 pass)
npx vitest run src/app/api/admin/audit/__tests__/route.test.ts

# Full suite (expect ~27 pre-existing failures, none from Agent 2)
npm run test
```

---

## Files Modified (Agent 2 only)

```
 M  src/app/api/admin/audit/route.ts
 M  src/app/api/reports/route.ts
 M  src/app/api/reports/__tests__/route.test.ts
 M  src/app/api/user/data-delete/route.ts
 M  src/app/api/user/data-delete/__tests__/route.test.ts
 M  src/app/api/user/data-export/route.ts
 M  src/app/api/user/security/password/__tests__/route.test.ts
 M  src/lib/auth.ts                    (1 line: ?? '' narrowing)
??  src/app/api/admin/audit/__tests__/  (new test file)
??  src/app/api/auth/register/__tests__/ (vi.stubEnv fix)
    src/components/chat/ChatWindow.tsx  (restored to HEAD)
```
