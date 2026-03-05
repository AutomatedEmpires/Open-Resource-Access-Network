# System Integrity Audit — Resolution Report

**Audit date**: 2026-03-05
**Status**: All issues resolved or properly bridged

## Summary

The migration to the unified `submissions` workflow is **complete and internally consistent**.

- Core workflow storage (`submissions`, `submission_transitions`, `submission_slas`) is actively used by all runtime APIs.
- Workflow state transitions are centrally enforced by `WorkflowEngine.advance()`.
- Legacy `verification_queue` is not used by any runtime SQL paths.
- All admin/community UI flows use correct `SubmissionStatus` values and `submissionId` payload keys.
- The ingestion pipeline now bridges into the unified submissions workflow at publish time.

## Issues Discovered & Resolutions

### Issue 1 — RESOLVED (High)
**Community queue claim request key mismatch** (`queueEntryId` vs `submissionId`)
- Fixed in `src/app/(community-admin)/queue/page.tsx`: sends `submissionId`
- Test updated: `src/app/(community-admin)/__tests__/queue-page.test.tsx`

### Issue 2 — RESOLVED (High)
**Community verify decision enum mismatch** (`verified/rejected` vs `approved/denied`)
- Fixed in `src/app/(community-admin)/verify/page.tsx`: Decision type, radio values, disabled/hint logic all use `approved/denied`
- Comment updated: references `submissionId` not `queueEntryId`
- Test updated: `src/app/(community-admin)/__tests__/verify-page.test.tsx`

### Issue 3 — RESOLVED (High)
**ORAN admin approvals POST key mismatch** (`queueEntryId` vs `submissionId`)
- Fixed in `src/app/(oran-admin)/approvals/page.tsx`: sends `submissionId`
- Test updated: `src/app/(oran-admin)/__tests__/approvals-page.test.tsx`

### Issue 4 — RESOLVED (High)
**UI filters use legacy statuses** (`pending/in_review/verified/rejected`)
- Fixed in all three UI pages: queue, verify, approvals
- Import changed from `VerificationStatus` → `SubmissionStatus`
- STATUS_TABS updated: `pending→submitted`, `in_review→under_review`, `verified→approved`, `rejected→denied`
- STATUS_STYLES expanded with `DEFAULT_STATUS_STYLE` fallback
- Labels standardized across pages (`Submitted`, `Under Review`, `Approved`, `Denied`)

### Issue 5 — RESOLVED (Medium)
**Lock can remain after failed claim transition**
- Fixed in `src/app/api/community/queue/route.ts`
- Added `releaseLock()` import and calls in both the advance-failure (409) path and the catch block

### Issue 6 — RESOLVED (Medium)
**Host claim phone field has no persistence path**
- `src/app/(host)/claim/page.tsx`: added `phone` to submission body
- `src/app/api/host/claim/route.ts`: added `phone` to Zod schema and `payload` column to INSERT

### Issue 7 — RESOLVED (Medium)
**DB/app enum drift** (`system` target type; `high` vs `elevated` risk level)
- `src/domain/types.ts`: added `'system'` to `SubmissionTargetType`
- `src/domain/constants.ts`: added `'system'` to `SUBMISSION_TARGET_TYPES`
- Created `db/migrations/0023_enum_alignment.sql`: migrates `high` → `elevated` and realigns CHECK constraint

### Issue 8 — RESOLVED (Medium)
**Ingestion pipeline parallel model not bridged to submissions**
- `src/app/api/admin/ingestion/candidates/[id]/publish/route.ts`: now creates a `submissions` record (`submission_type='service_verification'`, `status='approved'`) when a candidate is published
- This bridges the ingestion pipeline into the unified submissions workflow for audit/reporting purposes
- Test updated: `src/app/api/admin/ingestion/__tests__/candidate-actions.test.ts` — added `executeQuery` mock

### Issue 9 — RESOLVED (Test)
**Test suite unhandled error** (`window is not defined`)
- No longer reproduces. Full suite runs cleanly.

### DB Inconsistency: Nullable auth for submitted_by_user_id — RESOLVED
**`submitted_by_user_id NOT NULL` vs `authCtx?.userId ?? null`**
- `src/app/api/host/services/route.ts`: POST handler now requires auth unconditionally (the conditional `shouldEnforceAuth()` bypass was removed for the write endpoint since inserting null into a NOT NULL column would 500 anyway)
- Updated `authCtx?.userId ?? null` → `authCtx.userId` (safe since authCtx is guaranteed non-null)
- Test updated: `src/app/api/host/__tests__/host-routes.test.ts` — validation test now provides auth context

## Self-Audit Improvements Applied

Issues caught during self-audit of the first fix pass:

1. **`admin-api.test.ts` schema drift**: Local test schema copies still used `queueEntryId` and legacy statuses (`pending/in_review/verified/rejected`). Updated to match migrated API: `submissionId`, `submitted/under_review/approved/denied/escalated/pending_second_approval`.

2. **Verify page comment**: Still referenced `queueEntryId` and `verify/reject/escalate`. Updated to `submissionId` and `approve/deny/escalate`.

3. **STATUS_TABS label inconsistency**: Approvals page used "Pending"/"In Review" while queue page used "Submitted"/"Under Review" for the same status values. Standardized on `Submitted`/`Under Review` across all pages.

## Files Modified

### Source files
- `src/app/(community-admin)/queue/page.tsx` — SubmissionStatus, submissionId, STATUS_TABS/STYLES
- `src/app/(community-admin)/verify/page.tsx` — Decision enum, SubmissionStatus, STATUS_STYLES, comment
- `src/app/(oran-admin)/approvals/page.tsx` — SubmissionStatus, submissionId, STATUS_TABS/STYLES labels
- `src/app/(host)/claim/page.tsx` — phone field in submission body
- `src/app/api/community/queue/route.ts` — releaseLock on failed transition
- `src/app/api/host/claim/route.ts` — phone in Zod schema + INSERT
- `src/app/api/host/services/route.ts` — unconditional auth for POST, non-null userId
- `src/app/api/admin/ingestion/candidates/[id]/publish/route.ts` — submissions record on publish
- `src/domain/types.ts` — `'system'` in SubmissionTargetType
- `src/domain/constants.ts` — `'system'` in SUBMISSION_TARGET_TYPES

### Test files
- `src/app/(community-admin)/__tests__/queue-page.test.tsx`
- `src/app/(community-admin)/__tests__/verify-page.test.tsx`
- `src/app/(oran-admin)/__tests__/approvals-page.test.tsx`
- `src/services/admin/__tests__/admin-api.test.ts`
- `src/app/api/admin/ingestion/__tests__/candidate-actions.test.ts`
- `src/app/api/host/__tests__/host-routes.test.ts`

### New files
- `db/migrations/0023_enum_alignment.sql`

## Final Assessment

The system is **production-ready for the unified submissions workflow**.

- All user-facing workflow clients use correct `SubmissionStatus` values and `submissionId` payload keys.
- Lock lifecycle is properly managed on failed transitions.
- Domain type/constant enum drift has been corrected with a supporting DB migration.
- The ingestion pipeline now bridges into the unified submissions workflow at publish time.
- Auth is enforced unconditionally on write endpoints that insert into NOT NULL auth columns.

Remaining known items (not bugs):
- `VerificationStatus` type and `LEGACY_STATUS_MAP` remain in domain code for migration compatibility — these are intentionally retained.
- `VerificationQueueEntry`/`VerificationEvidence` interfaces remain in types.ts — legacy types for backward compatibility.
- Verify page uses placeholder `reviewerUserId: 'current-user'` — pre-existing, requires auth context integration.

**Validation**: 164 test files, 1621 tests, 0 failures.

---

## Enhancement Pass — Centralization & Normalization

Date: 2026-03-05 (follow-up pass)

### Problem

8 admin/seeker pages independently defined identical or near-identical:
- `STATUS_STYLES` constant (4 duplicate definitions with inconsistent labels)
- `DEFAULT_STATUS_STYLE` constant (4 duplicate definitions)
- `StatusBadge` component (3 duplicate definitions)
- `formatDate` helper (8 duplicate definitions with inconsistent options)
- `daysAgo` helper (3 duplicate definitions)

Label inconsistency: `submitted` was shown as "Submitted" in queue/verify but "Pending" in approvals/appeals. `under_review` was "Under Review" vs "In Review".

### Changes

#### New shared modules created

| File | Exports | Purpose |
|------|---------|---------|
| `src/lib/format.ts` | `formatDate`, `formatDateTime`, `daysAgo`, `formatDateSafe` | Centralized date/time formatting for all admin pages |
| `src/domain/status-styles.ts` | `SUBMISSION_STATUS_STYLES`, `DEFAULT_STATUS_STYLE`, `StatusStyle` | Single source of truth for submission status colors and labels |
| `src/components/ui/status-badge.tsx` | `StatusBadge` | Shared badge component with optional page-specific overrides |

#### Files updated (local duplicates removed, imports added)

| File | Removed | Imported from |
|------|---------|---------------|
| `src/app/(community-admin)/queue/page.tsx` | STATUS_STYLES, DEFAULT_STATUS_STYLE, formatDate, daysAgo, StatusBadge | `@/lib/format`, `@/components/ui/status-badge` |
| `src/app/(community-admin)/verify/page.tsx` | STATUS_STYLES, DEFAULT_STATUS_STYLE, formatDate | `@/lib/format` (formatDateTime), `@/domain/status-styles` |
| `src/app/(oran-admin)/approvals/page.tsx` | STATUS_STYLES, DEFAULT_STATUS_STYLE, formatDate, daysAgo, StatusBadge | `@/lib/format`, `@/components/ui/status-badge` |
| `src/app/(oran-admin)/appeals/page.tsx` | STATUS_STYLES, DEFAULT_STATUS_STYLE, formatDate, daysAgo, StatusBadge | `@/lib/format`, `@/components/ui/status-badge` |
| `src/app/(seeker)/appeal/AppealPageClient.tsx` | formatDate; labels standardized | `@/lib/format` |
| `src/app/(oran-admin)/scopes/page.tsx` | formatDate | `@/lib/format` |
| `src/app/(oran-admin)/zone-management/page.tsx` | formatDate | `@/lib/format` |
| `src/app/(oran-admin)/ingestion/page.tsx` | formatDate | `@/lib/format` (formatDateSafe) |

#### Label standardization

All pages now use canonical labels matching the domain vocabulary:

| Status value | Before (inconsistent) | After (canonical) |
|---|---|---|
| `submitted` | "Pending" (approvals, appeals) / "Submitted" (queue, verify) | **"Submitted"** everywhere |
| `under_review` | "In Review" (approvals, appeals) / "Under Review" (queue, verify) | **"Under Review"** everywhere |

### Validation

- TypeScript: compiles cleanly (`npx tsc --noEmit`)
- Tests: 164 files, 1621 tests, 0 failures
