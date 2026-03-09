# Remaining Work — HSDS Agent Phase 1 + Phase 2

> Generated 2026-03-08. Updated 2026-03-08 after Phase 2 completion + audit.
> **767 tests pass** (743 ingestion + 24 HSDS API), **0 failures**, **0 new TS errors**.
> **Phase 2 resolved all 22 R-items.** Audit pass found 1 minor fix (duplicate guard removed).

---

## Issues Fixed During Phase 1 (17 total)

### Audit Pass 1 (6 fixes from 24-issue report)

| # | Severity | File | Fix Applied |
|---|----------|------|-------------|
| A1 | CRITICAL | promoteToLive.ts | Address INSERT had 7 columns but 6 params ($4 duplicated). Rewrote to 6 columns with $1-$6. |
| A2 | CRITICAL | promoteToLive.ts | Phone logic checked `canonicalService.email` instead of org phone. Changed to `canonicalOrg.phone`. |
| A3 | HIGH | entityResolution.ts | `resolveByUrlPhone` referenced non-existent `c.phone` on canonical_services. Rewrote to URL-only matching (confidence 80). |
| A4 | HIGH | hsdsFeedConnector.ts | `response.json()` not in try-catch. Added try-catch with descriptive error. |
| A5 | MEDIUM | hsdsExportPipeline.ts | Error type used `serviceId` for both services and orgs. Renamed to `entityId`. |
| A6 | — | — | Issues #7 (pagination NaN) and #11 (missing return) verified as false positives. |

### Audit Pass 2 (8 fixes + 2 new tests from 18-issue report)

| # | Severity | File | Fix Applied |
|---|----------|------|-------------|
| B1 | MEDIUM | promoteToLive.ts | Removed useless `ON CONFLICT DO NOTHING` on phones INSERT (phones has no unique constraint). |
| B2 | MEDIUM | promoteToLive.ts | Snapshot version changed from hardcoded `isUpdate ? 2 : 1` to dynamic `MAX(snapshot_version) + 1`. |
| B3 | MEDIUM | hsdsExportPipeline.ts | Silent org skip now reports to `result.skipped` array. |
| B4 | MEDIUM | taxonomyCrosswalkResolver.ts | Added `seenConceptsByCode` Set to deduplicate when multiple crosswalks target same concept. |
| B5 | LOW | normalizeSourceRecord.ts | `extractArray` filter now also excludes nested arrays. |
| B6 | — | hsdsFeedConnector.test.ts | Added test: malformed JSON response. |
| B7 | — | taxonomyCrosswalkResolver.test.ts | Added test: deduplication. |
| B8 | — | Multiple test files | Fixed TS type errors in mocks across 4 test files. |

### Audit Pass 3 — Post-Summary (3 fixes from 30-issue re-audit)

| # | Severity | File | Fix Applied |
|---|----------|------|-------------|
| C1 | CRITICAL | promoteToLive.ts | `address_type` column doesn't exist on addresses table. Removed column from INSERT, replaced broken `ON CONFLICT (location_id, address_type)` with DELETE + re-INSERT pattern. |
| C2 | CRITICAL | All 4 HSDS API routes | `phone` column doesn't exist on services table. Removed from all SELECT queries. Updated test mocks. |
| C3 | CRITICAL | services/[id]/route.ts | `address_type` column doesn't exist on addresses table. Removed from SELECT. Updated test mock. |

---

## Remaining Issues — Resolved in Phase 2

### ~~HIGH — Performance (N+1 queries) — RESOLVED~~

> Fixed in Phase 2 Session 1: Added `getByIds()` to `CanonicalLocationStore` and `bulkCreate()` to `CanonicalServiceLocationStore`. All three N+1 sites replaced with batch operations.

| # | File | Status |
|---|------|--------|
| ~~R1~~ | promoteToLive.ts | **FIXED** — uses `getByIds()` |
| ~~R2~~ | hsdsExportPipeline.ts | **FIXED** — uses `getByIds()` |
| ~~R3~~ | normalizeSourceRecord.ts | **FIXED** — uses `bulkCreate()` |

### ~~HIGH — Entity Resolution Scalability — RESOLVED~~

> Fixed in Phase 2 Session 2: Added `findActiveByUrl()` and `findActiveByName()` to `CanonicalServiceStore` interface + Drizzle impl using `and(eq(...), eq(...))`. Replaced 500-row linear scan in `entityResolution.ts`.

| # | File | Status |
|---|------|--------|
| ~~R4~~ | entityResolution.ts | **FIXED** — indexed lookups via `findActiveByUrl` / `findActiveByName` |

### ~~HIGH — Network Resilience — RESOLVED~~

> Fixed in Phase 2 Session 2: Added configurable `timeoutMs`, `maxRetries`, `isTransient()` helper, and `fetchWithRetry()` with exponential backoff (500ms × 2^attempt) in `hsdsFeedConnector.ts`. Test added.

| # | File | Status |
|---|------|--------|
| ~~R5~~ | hsdsFeedConnector.ts | **FIXED** — exponential backoff retry with configurable maxRetries |

### ~~HIGH — Type Safety — RESOLVED~~

> Fixed in Phase 1 originally — `getPayload()` has runtime guard: `typeof parsed === 'object' && !Array.isArray(parsed)`.

| # | File | Status |
|---|------|--------|
| ~~R6~~ | normalizeSourceRecord.ts | **FIXED** — already had type guard |

### ~~MEDIUM — Data Quality — R7-R9 RESOLVED~~

> Fixed in Phase 2 Session 2.

| # | File | Status |
|---|------|--------|
| ~~R7~~ | normalizeSourceRecord.ts | **FIXED** — added `.trim()` to org name before falsy check |
| ~~R8~~ | normalizeSourceRecord.ts | **FIXED** — added `.trim()` to service name, falls back to orgName |
| ~~R9~~ | normalizeSourceRecord.ts | **FIXED** — added `console.warn` when zero locations extracted |

### ~~MEDIUM — Tag Assignment — R10, R11, R12 RESOLVED~~

> R10: crosswalk tags validated via `ResourceTagTypeSchema.safeParse()`. R11: keyword matching already uses `\b` word-boundary regex via `getKeywordRegex()` — `.includes()` was previously replaced. R12: dedup Map by `${tagType}::${tagValue}` keeping highest confidence. Tests added.

| # | File | Status |
|---|------|--------|
| ~~R10~~ | tagAssignment.ts | **FIXED** — Zod `safeParse()` validates tagType |
| ~~R11~~ | tagAssignment.ts | **ALREADY FIXED** — `getKeywordRegex()` uses `\b` word-boundary regex, not `.includes()` |
| ~~R12~~ | tagAssignment.ts | **FIXED** — dedup by (tagType, tagValue), keep highest confidence |

### ~~MEDIUM — Configuration Hardcoding — R13-R16 RESOLVED~~

> R13: removed hardcoded `'US'` country. R14: `EntityResolutionConfig` defaults now read from env vars (`ORAN_ER_*`). R15: `TRUST_TIER_CONFIDENCE` defaults now read from env vars (`ORAN_TRUST_*`), also accepts runtime overrides via `NormalizeSourceRecordOptions.trustTierConfidence`. R16: `Number.isFinite()` guard prevents NaN scores.

| # | File | Status |
|---|------|--------|
| ~~R13~~ | promoteToLive.ts | **FIXED** — uses `canonical.addressCountry ?? null` |
| ~~R14~~ | entityResolution.ts | **FIXED** — `parseEnvInt()` reads `ORAN_ER_*` env vars with hardcoded fallbacks |
| ~~R15~~ | normalizeSourceRecord.ts | **FIXED** — `envInt()` reads `ORAN_TRUST_*` env vars; `trustTierConfidence` option added |
| ~~R16~~ | promoteToLive.ts | **FIXED** — `Number.isFinite()` check, clamps 0-100 |

### ~~LOW — Edge Cases — R17-R20 RESOLVED~~

> R17: orphaned identifiers now detected and auto-cleaned during entity resolution (DELETE + fall-through), plus `deleteByEntity` method added to store. R18: DELETE before re-INSERT for phones on re-promote. R19: optional `limit` param added. R20: `stableStringify()` sorts keys recursively before SHA256.

| # | File | Status |
|---|------|--------|
| ~~R17~~ | entityResolution.ts | **FIXED** — orphaned identifiers auto-cleaned via `deleteByEntity` + fall-through |
| ~~R18~~ | promoteToLive.ts | **FIXED** — DELETE + re-INSERT pattern on `isUpdate` |
| ~~R19~~ | hsdsExportPipeline.ts | **FIXED** — optional `limit` param passed to `listByPublication` |
| ~~R20~~ | hsdsFeedConnector.ts | **ALREADY FIXED** — `stableStringify()` sorts keys recursively before hashing |

### ~~INFO — Documentation / Expected Behavior — R21-R22 RESOLVED~~

> R21: JSDoc on `normalizeSourceRecord()` documents that zero services/locations is valid, not an error. R22: JSDoc on `autoPublish()` documents the `winningSourceSystemId` dependency.

| # | File | Status |
|---|------|--------|
| ~~R21~~ | normalizeSourceRecord.ts | **ALREADY DOCUMENTED** — JSDoc above function |
| ~~R22~~ | autoPublish.ts | **ALREADY DOCUMENTED** — JSDoc above `autoPublish()` |

---

## Phase 2 Audit Findings

### Audit Pass 4 (1 fix from systematic review of all Phase 2 changes)

| # | Severity | File | Finding |
|---|----------|------|---------|
| D1 | LOW | entityResolution.ts | Duplicate `if (!input.sourceRecordId) return null;` guard in `resolveByIdentifier()`. Removed redundant second check. |

### Audit Observations (no action needed)

| # | Category | Finding |
|---|----------|---------|
| O1 | Scope boundary | 6 remaining `?? 'US'` hardcodes exist in files outside Phase 2 scope (tags.ts, candidateStore.ts, materialize.ts, adminProfiles.ts). Not Phase 2 regressions. |
| O2 | Safe casts | 3 `as ResourceTagType` casts remain in persistence stores (tagStore.ts, tagConfirmationStore.ts, tagConfirmations.ts). All are safe — data validated by Zod schema on write or by `ResourceTagTypeSchema` in the Zod object. |
| O3 | Env var helpers | `parseEnvInt()` (entityResolution.ts) and `envInt()` (normalizeSourceRecord.ts) are identical in logic but duplicated. Acceptable — module-scoped, avoids cross-module dependency. |

---

## Pre-Existing Issues (NOT caused by Phase 1/2 work)

These exist outside the Phase 1/2 scope and were present before this work began:

| Category | Count | Details |
|----------|-------|---------|
| UI test failures | 15 files | React component tests: MapContainer, coverage-page, verify-page, queue-page, host pages, community admin pages. `window is not defined` and similar SSR issues. |
| TS errors: run-pipeline-demo.ts | 7 errors | Pipeline demo script references outdated store interfaces. |
| TS errors: taxonomyFederation.schema.test.ts | 10 errors | `PgTable` type not assignable to `Record<string, unknown>`. Drizzle ORM type mismatch. |
| Hardcoded `'US'` country | 6 sites | tags.ts, candidateStore.ts (×2), materialize.ts (×2), adminProfiles.ts. Pre-existing — flagged as O1 above. |
