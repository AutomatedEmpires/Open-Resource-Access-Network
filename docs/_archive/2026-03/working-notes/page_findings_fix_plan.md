# ORAN UI Fix Plan

> Created: 2026-03-05
> Branch: `clean/commit-series`
> Companion doc: `page_findings.md`

Each phase groups related fixes. Items within a phase are ordered by severity / dependency. A checkbox means both the code change and any test update are complete.

---

## Phase 0 — Foundation (cross-cutting, must ship first)

- [x] **F-1** Unify toast systems → migrate `DirectoryPageClient`, `SavedPageClient`, `MapPageClient` to `useToast` from `@/components/ui/toast`; delete `useToast.ts`, `ToastRegion.tsx`, `ToastRegion.test.tsx`
- [x] **F-2** Fix admin/host layout metadata → split all 3 portal layouts into server `layout.tsx` (exports `metadata` with `robots: noindex`) + client `*LayoutShell.tsx`
- [x] **F-3** Fix 404 broken link → change `/search` → `/directory` in `not-found.tsx`
- [x] **F-4/F-5** ServiceDetail navigation → remove `router.back()` button; add static `<Breadcrumb>` (`Directory > [service name]`)
- [x] **F-6** Wire orphaned PageClient files → replace 11 inline `page.tsx` files with thin server wrappers importing their `*PageClient.tsx`; add per-page `title` metadata

---

## Phase 1 — Seeker (public-facing fixes)

### 1a — Test regressions (blocking — fix before writing new features)

- [x] **S-9 / Test** Update `service-detail-client.test.tsx` test "shows error state on server failures and handles back navigation" — remove `fireEvent.click('Back to results')` and `expect(backMock)` assertions; replace with assertion that breadcrumb "Directory" link renders correctly on error state
- [x] **AS-3 investigate** Run `directory-page-client.test.tsx`, `map-page-client.test.tsx`, `appeal-page-client.test.tsx` individually and document root cause of each failure group before attempting fixes
- [x] **AS-2 investigate** Run `auth/pages.test.tsx` individually and document root cause of 4 failures

### 1b — Functional fixes

- [x] **S-3** Wire category chips to search API — when a chip is selected in `DirectoryPageClient`, include `category=<value>` in the `/api/search` query params
- [x] **S-4** Add empty state to `DirectoryPageClient` — when `results.length === 0` after a search, render a "No results" card with suggestion to broaden filters
- [x] **S-5** Fix notification spinner for unauthenticated users in `NotificationsPageClient` — on 401 response, clear loading state and render an auth prompt
- [x] **S-6** Add missing-serviceId guidance to `ReportPageClient` — when `searchParams.get('serviceId')` is null/empty, render an error card with link to `/directory`
- [x] **S-7** Auth-gate `AppealPageClient` — check session at render; if unauthenticated, redirect to `/auth/signin?callbackUrl=/appeal` (or render an auth-required card)

### 1c — Lower priority

- [x] **S-1** Remove duplicate skip link from `(seeker)/layout.tsx` — root layout already provides skip link
- [x] **S-2** Investigate chat flash skeleton — determine if `Suspense` boundary introduction would eliminate the loading flicker on first paint
- [x] **S-8** Language preference — add comment/note in `ProfilePageClient` that the preference is stored but not yet consumed; optionally add a UI notice to the user ("Language preference saved — translation coming soon")

---

## Phase 2 — Host Portal

### 2a — Test alignment

- [x] Verify all `src/app/(host)/__tests__/` tests pass after Phase 0 wiring (should already pass — confirm)
- [x] Confirm `admins-page.test.tsx` test that expects `inviteMode: true` in POST body matches `AdminsPageClient.tsx` implementation

### 2b — Functional / UX

- [x] **H-1** Add icons to host nav items in `HostLayoutShell.tsx` — `{ href: '/org', label: 'Organization', icon: Building2 }` etc., rendered as `<Icon className="h-4 w-4" />` before the label text
- [x] **H-2** Fix tall edit modal scroll on mobile — ensure `DialogFooter` buttons are always reachable; consider sticky footer inside `max-h` container in `OrgPageClient`
- [x] **H-3** Investigate Services page multi-step intent — clarify if a wizard stepper is planned; if so, implement step navigation in `ServicesPageClient`; if not, remove `ArrowLeft`/`ArrowRight` step hint icons
- [x] **H-4** Standardize invite-mode label in `AdminsPageClient` — button: `"User ID"`, input label: `"User ID (UUID)"`, placeholder: `"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"` (confirm test alignment)
- [x] **H-5** Replace plain `CheckCircle` success in `ClaimPageClient` with `<SuccessCelebration>` component for visual consistency

---

## Phase 3 — Community Admin Portal

### 3a — Security / privacy (highest priority in phase)

- [x] **P-2** Audit `VerifyPageClient.tsx` for IP address exposure — search for `ip_address` in the component; if present, mask or remove per `SECURITY_PRIVACY.md`

### 3b — Type alignment

- [x] **P-4** Confirm `SubmissionStatus` vs `VerificationStatus` alignment — check `@/domain/types` exports both; verify `/api/community/queue/[id]` API route returns `SubmissionStatus` keys (`approved`, `denied`, `escalated`) not `VerificationStatus` keys (`verified`, `rejected`)

### 3c — Functional

- [x] **P-1** Implement bulk actions in `QueuePageClient` — wire "Approve selected" and "Reject selected" buttons to `PATCH /api/community/queue/bulk` with selected IDs; add loading/error states
- [x] **P-3** Clean up dead `AlertTriangle` import in `CoveragePageClient.tsx` if present after `FormAlert` migration

---

## Phase 4 — ORAN Admin Portal

### 4a — Security / safety (highest priority in phase)

- [x] **A-1** Mask IP address in `AuditPageClient` — replace `row.ip_address ? \` · IP: ${row.ip_address}\` : ''` with either: (a) remove entirely, or (b) render truncated/masked form `x.x.x.xxx` per `SECURITY_PRIVACY.md`
- [x] **A-4** Add confirmation dialog to `RulesPageClient` before saving flag changes — modal: "Are you sure you want to change `[flag name]` to `[enabled/disabled]` at `[rollout%]`%? This affects production."

### 4b — Test regressions

- [x] **A-3** Investigate `scopes-page.test.tsx` failure — component calls `/api/admin/scopes/audit?limit=50` but test expects `/api/admin/scopes?limit=1`; determine if the component or the test is wrong and fix accordingly

### 4c — UX improvements

- [x] **A-2** Resolve `user_id` UUID display in `AuditPageClient` — either fetch user display names via `/api/admin/users/[id]` or render the first 8 chars of UUID with a tooltip showing the full ID
- [x] **A-5** Add "Cancel job" button to running jobs in `IngestionPageClient` process tab — wire to `DELETE /api/admin/ingestion/jobs/[id]`
- [x] **A-6** Resolve `assigned_user_id` UUID in `ZoneManagementPageClient` — either display truncated UUID + tooltip, or fetch admin name from `/api/admin/users`
- [x] **A-7** Add empty states to `ApprovalsPageClient` and `AppealsPageClient` — "No pending approvals" / "No appeals" with icon and descriptive text when lists are empty

---

## Phase 5 — Auth / System

- [x] **AS-1** Preserve `callbackUrl` in `SignInPageClient` sign-in flow — pass `callbackUrl: searchParams.get('callbackUrl') ?? '/'` to `signIn('azure-ad', { callbackUrl })`
- [x] **AS-2** Fix `auth/pages.test.tsx` failures (once root cause identified)
- [x] **AS-3** Fix `appeal-page-client.test.tsx`, `directory-page-client.test.tsx`, `map-page-client.test.tsx` failures (once root cause identified)

---

## Phase 6 — Test Hygiene (final pass)

- [x] Ensure all `*PageClient` test files import from `*PageClient.tsx` not `page.tsx` (spot-check: `admins-page.test.tsx` imports `AdminsPage` from `@/app/(host)/admins/page` — this is valid since `page.tsx` is now a thin wrapper that re-exports from `AdminsPageClient`)
- [x] Run `npx tsc --noEmit` — confirm still 2 errors only (pre-existing in `llm.test.ts`)
- [x] Run full test suite — confirm ≤22 failures (all pre-existing), zero new regressions
- [x] Run `npm run lint` — confirm zero lint errors

---

## Progress Summary (as of 2026-03-05)

| Phase | Items | Done | Remaining |
|-------|-------|------|-----------|
| Phase 0 — Foundation | 5 | 5 ✅ | 0 |
| Phase 1 — Seeker | 10 | 10 ✅ | 0 |
| Phase 2 — Host | 7 | 7 ✅ | 0 |
| Phase 3 — Community Admin | 4 | 4 ✅ | 0 |
| Phase 4 — ORAN Admin | 7 | 7 ✅ | 0 |
| Phase 5 — Auth/System | 3 | 3 ✅ | 0 |
| Phase 6 — Test Hygiene | 4 | 4 ✅ | 0 |
| **Total** | **40** | **40 ✅** | **0** |

---

## Dependency Map

```
Phase 0 (Foundation)
  └─► Phase 1a (Test regressions — must be cleared before new seeker work)
        └─► Phase 1b/1c (Seeker functional fixes)
              └─► Phase 6 (Final test hygiene pass)
Phase 0
  └─► Phase 3a (P-2 IP audit — security, can run in parallel with Phase 1)
  └─► Phase 4a (A-1 IP mask — security, can run in parallel with Phase 1)
```

Items marked **security/privacy** (P-2, A-1, A-4) should be prioritized regardless of phase order.
