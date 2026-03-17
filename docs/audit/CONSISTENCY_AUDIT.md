# Audit 4 — Consistency & Operational Readiness

**Date**: 2025-01-XX (auto-generated)
**Scope**: Code quality, consistency, configuration, and operational readiness
**Method**: Automated + manual review of API routes, schemas, configuration, domain constants, and import tooling
**Prior audits resolved**: 24 findings across Audits 1-3 (all ✅)

---

## Summary

| Severity | Count | Resolved |
|----------|-------|----------|
| P1 — Schema consistency | 1 | ✅ |
| P2 — Magic numbers | 1 | ✅ |
| P2 — Missing rate limiting | 3 | ✅ |
| P2 — Coverage thresholds | 1 | ✅ |
| P3 — Stub guard | 1 | ✅ |
| **Total** | **7** | **7 ✅** |

---

## Findings

### D1 — ChatRequestSchema missing `.strict()` (P1) ✅ RESOLVED

**File**: `src/services/chat/types.ts`
**Issue**: `ChatRequestSchema` was the only API-facing Zod schema without `.strict()`, breaking the B7 convention established in Audit 2. Extra fields in chat requests would pass validation silently.
**Fix**: Added `.strict()` to the schema definition.

---

### D2 — Trust score thresholds hardcoded (P2) ✅ RESOLVED

**File**: `src/app/api/chat/route.ts:149`
**Issue**: Trust-tier confidence cutoffs `80` and `60` were hardcoded inline instead of referencing `CONFIDENCE_BANDS.HIGH.min` and `CONFIDENCE_BANDS.LIKELY.min` from `src/domain/constants.ts`. If the band definitions changed, the chat route would silently use stale values.
**Fix**: Replaced inline literals with `CONFIDENCE_BANDS.HIGH.min` / `CONFIDENCE_BANDS.LIKELY.min`.

---

### D3 — Claim GET endpoint missing rate limiting (P2) ✅ RESOLVED

**File**: `src/app/api/host/services/claim/route.ts`
**Issue**: `POST /api/host/services/claim` had rate limiting via `checkRateLimit()`, but the `GET` handler (service detection) had none. An attacker could enumerate service matches by org name at unrestricted speed.
**Fix**: Added `checkRateLimit()` with `HOST_READ_RATE_LIMIT_MAX_REQUESTS` to the GET handler.

---

### D4 — HSDS public endpoints missing rate limiting (P2) ✅ RESOLVED

**Files**:
- `src/app/api/hsds/services/route.ts`
- `src/app/api/hsds/services/[id]/route.ts`
- `src/app/api/hsds/organizations/route.ts`
- `src/app/api/hsds/organizations/[id]/route.ts`

**Issue**: All four HSDS database-backed endpoints were public-facing without rate limiting. They execute database queries and could be abused for DoS. (The `/api/hsds/profile` endpoint is excluded — it returns static metadata with a 1-hour cache header.)
**Fix**: Added `checkRateLimit()` with `SEARCH_RATE_LIMIT_MAX_REQUESTS` (60/min) to all four routes.

---

### D5 — Chat quota + taxonomy endpoints missing rate limiting (P2) ✅ RESOLVED

**Files**:
- `src/app/api/chat/quota/route.ts`
- `src/app/api/taxonomy/terms/route.ts`

**Issue**: Both endpoints are unauthenticated, public-facing GET routes without rate limiting. The taxonomy route executes parameterized database queries.
**Fix**: Added `checkRateLimit()` with `SEARCH_RATE_LIMIT_MAX_REQUESTS` (60/min) to both routes. Updated the taxonomy test to mock the new dependencies.

---

### D6 — Vitest coverage thresholds missing (P2) ✅ RESOLVED

**File**: `vitest.config.ts`
**Issue**: No coverage thresholds configured. Coverage could silently regress in CI without any gate. Current baseline: lines 81%, branches 68%, functions 72%, statements 79%.
**Fix**: Added `thresholds` block: lines 75%, branches 60%, functions 65%, statements 75%. Set below current values to allow normal PR fluctuation while preventing major regressions.

---

### D7 — CSV importer stub branch has no guard (P3) ✅ RESOLVED

**File**: `db/import/hsds-csv-importer.ts:524`
**Issue**: When `dryRun` is `false`, the importer logs "Would stage N rows" but does not actually INSERT anything. An operator could believe data was imported when it was only validated.
**Fix**: Added an explicit warning to the `ImportReport.warnings` array when running in non-dry-run mode: _"DB persistence is not yet implemented. Running in validation-only mode."_

---

## Observations (no fix needed)

### O1 — `manualSubmit` Azure Function is a documented stub

**File**: `functions/manualSubmit/index.ts`
**Status**: The function correctly returns HTTP 501 (Not Implemented) with a message directing callers to `POST /api/admin/ingestion/process`. This is intentional — the Next.js API route handles the same logic. No action needed unless the Function is deployed.

### O2 — Internal API routes have no user-facing rate limiting

**Files**: `src/app/api/internal/**`
**Status**: Acceptable — these routes are protected by `INTERNAL_API_KEY` bearer auth with timing-safe comparison. Rate limiting is unnecessary for machine-to-machine calls gated by API key.

### O3 — `advance()` audit trail uses `submission_transitions` table

The workflow engine records all state changes (including failed attempts) in `submission_transitions` with actor, role, gates checked, and metadata. This serves as the audit trail for workflow decisions. A separate `scope_audit_log` table exists but is used for RBAC scope grants, not workflow transitions.

---

## Cumulative audit status

| Audit | Findings | Status |
|-------|----------|--------|
| 1 — Adversarial Systems | 12 (LB1-LB12) | ✅ All resolved |
| 2 — Boundary Layer | 8 (B1-B8) | ✅ All resolved |
| 3 — Perimeter Hardening | 4 (C1-C4) | ✅ All resolved |
| 4 — Consistency & Ops Readiness | 7 (D1-D7) | ✅ All resolved |
| **Total** | **31** | **31 ✅** |

All 31 findings resolved — 29 with code changes, 2 with documented accepted risk (ADR-0012, ADR-0013).
