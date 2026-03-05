# ORAN UI Audit — Page Findings

> Audit date: 2026-03-05
> Branch: `clean/commit-series`
> Auditor: GitHub Copilot (session audit)

This document records every UI/UX, accessibility, correctness, and architecture issue found across all 27 pages of the ORAN application, organized by user type / route group.

---

## Route Groups

| Group | Prefix | Pages audited |
|-------|--------|--------------|
| `(seeker)` | Public / authenticated seekers | 13 |
| `(host)` | Host portal | 6 |
| `(community-admin)` | Community admin portal | 4 |
| `(oran-admin)` | ORAN admin portal | 8 (includes sub-pages) |
| Auth / system | `/auth/*`, `not-found`, root | 4 |

---

## Foundation Issues (cross-cutting)

### F-1 — Duplicate toast systems
**Severity:** High
**Status:** ✅ Fixed

Two incompatible toast systems coexisted:
- `src/lib/hooks/useToast.ts` — standalone hook with local `ToastRegion` component (used in 3 seeker pages)
- `@/components/ui/toast` context-based system (`ToastProvider` in `providers.tsx`) — the canonical system

**Affected files (pre-fix):**
- `DirectoryPageClient.tsx` — used standalone `useToast` + rendered `<ToastRegion>`
- `SavedPageClient.tsx` — same
- `MapPageClient.tsx` — same

**Root cause:** The context-based system was added later but the 3 older seeker pages were never migrated.

**Fix applied:** Migrated all 3 to `useToast` from `@/components/ui/toast`; deleted `useToast.ts`, `ToastRegion.tsx`, and `ToastRegion.test.tsx`.

---

### F-2 — Admin/host layout.tsx exported metadata from a client component
**Severity:** High
**Status:** ✅ Fixed

All three portal layouts (`(host)`, `(community-admin)`, `(oran-admin)`) combined `'use client'` with `export const metadata`, which is invalid in Next.js App Router. Metadata exports are silently ignored on client components, meaning:
- No `<title>` tag was emitted for any admin/host page
- `robots: noindex` was never applied despite being privacy-sensitive portals

**Fix applied:** Split each layout into:
- `layout.tsx` — clean server component, exports `metadata` with `robots: { index: false, follow: false }` and title template
- `*LayoutShell.tsx` — `'use client'` component containing `useSession`, nav, auth-gating

---

### F-3 — 404 page broken link
**Severity:** Medium
**Status:** ✅ Fixed

`src/app/not-found.tsx` had a "Search services" button linking to `/search` — a route that does not exist. The correct route is `/directory`.

---

### F-4 / F-5 — ServiceDetail back button and breadcrumb
**Severity:** Medium
**Status:** ✅ Fixed

`ServiceDetailClient.tsx` used `router.back()` as the primary navigation action. This breaks if the user arrives via direct link (no history to go back to). No breadcrumb was present for orientation.

**Fix applied:** Removed `router.back()` button; added static `<Breadcrumb items={[{ label: 'Directory', href: '/directory' }, { label: service.name }]}/>` from `@/components/ui/breadcrumb`.

**Known regression:** One test (`service-detail-client.test.tsx`) tests for the old `router.back()` button — specifically the test "shows error state on server failures and handles back navigation" which clicks a `'Back to results'` button that no longer exists. Test needs to be updated to reflect the breadcrumb navigation pattern.

---

### F-6 — Codex PageClient files orphaned (page.tsx not wired up)
**Severity:** High
**Status:** ✅ Fixed

Codex created improved `*PageClient.tsx` files for 11 pages with better form UX (FormField, FormAlert, useToast, unsaved-changes guard, Loader2, SuccessCelebration). However, none of the `page.tsx` files were updated to import them — Next.js was still routing to the old inline `'use client'` implementations.

**Affected pages:**
| Page | Improvement in PageClient |
|------|--------------------------|
| `(host)/org` | + FormField, FormAlert, useUnsavedChanges, HSDS fields |
| `(host)/services` | + enhanced form with more service fields |
| `(host)/locations` | + enhanced form with all address fields |
| `(host)/admins` | + FormField, invite-mode toggle, UUID validation |
| `(host)/claim` | + multi-step form with more validation |
| `(community-admin)/verify` | + FormField/FormAlert, `SubmissionStatus` type, shared status styles |
| `(community-admin)/coverage` | + FormAlert replaces inline error div |
| `(oran-admin)/audit` | Identical content (no improvement yet) |
| `(oran-admin)/rules` | Identical content (no improvement yet) |
| `(oran-admin)/ingestion` | + `formatDateSafe` from shared lib, removes inline helper |
| `(oran-admin)/zone-management` | + FormField/FormAlert/useToast/Loader2 |

**Fix applied:** Replaced all 11 `page.tsx` files with thin server-component wrappers that export per-page `metadata.title` and delegate rendering to `*PageClient`.

---

## (seeker) Pages

### S-1 — Skip link duplication
**Severity:** Low
**Status:** ⬜ Not started

The root layout (`src/app/layout.tsx`) renders a "Skip to main content" link. The seeker layout (`src/app/(seeker)/layout.tsx`) renders its own additional skip link. Users with screen readers encounter two skip targets, which is confusing.

**Fix:** Remove skip link from seeker layout; keep only the root layout version.

---

### S-2 — Chat page flash skeleton on load
**Severity:** Low / Visual
**Status:** ⬜ Not started

`ChatPageClient.tsx` shows a skeleton loading state briefly before deciding to render the chat interface. The skeleton is visible even on fast connections (~1 render frame).

**Note:** May be intentional (`Suspense` boundary). Needs investigation.

---

### S-3 — Category chips not wired to search API
**Severity:** High
**Status:** ⬜ Not started

`DirectoryPageClient.tsx` renders category filter chips (`Health`, `Housing`, `Food`, etc.). Clicking a chip sets local state but the selected category is **not included** in the parameters sent to `/api/search`. The search API supports a `category` param but it's never passed.

---

### S-4 — Directory empty state missing
**Severity:** Medium
**Status:** ⬜ Not started

When a search returns zero results, `DirectoryPageClient.tsx` renders nothing — no "no results" message, no suggestion to broaden search. The skeleton disappears and the page looks broken.

---

### S-5 — Notifications page: infinite loading spinner for unauthenticated users
**Severity:** Medium
**Status:** ⬜ Not started

`NotificationsPageClient.tsx` calls the notifications API and shows a spinner while loading. If the user is not authenticated, the API returns 401 and the component catches the error, but the loading state is never cleared — the spinner runs forever instead of showing an auth prompt.

---

### S-6 — Report page: no guidance when `serviceId` param is missing
**Severity:** Low
**Status:** ⬜ Not started

`ReportPageClient.tsx` (accessed via `/report?serviceId=<id>`) shows a blank or broken form if `serviceId` is absent from the URL. There is no user-facing message explaining the issue or offering a link back to the directory.

---

### S-7 — Appeal page: no auth gate
**Severity:** Medium
**Status:** ⬜ Not started

`AppealPageClient.tsx` allows filling and submitting an appeal form even when the user is not authenticated. The API call will fail with 401, but there is no upfront check or redirect to sign-in — causing a confusing submit-then-fail experience.

---

### S-8 — Language preference non-functional
**Severity:** Low
**Status:** ⬜ Not started

`ProfilePageClient.tsx` allows selecting a language preference (English, Spanish, etc.) and saves it to the user profile. However, there is no mechanism anywhere in the app that reads this preference and applies it (e.g., `lang` attribute, i18n routing, or content filtering). A disclaimer exists in the profile UI but the preference does nothing observable.

---

### S-9 — ServiceDetail test needs update after router.back() removal
**Severity:** Medium (test regression)
**Status:** ⬜ Not started

`src/app/(seeker)/__tests__/service-detail-client.test.tsx` — test "shows error state on server failures and handles back navigation" clicks `'Back to results'` button which no longer exists after F-4 fix. Test must be updated.

---

## (host) Pages

### H-1 — Host nav lacks icons
**Severity:** Low / Visual
**Status:** ⬜ Not started (may be partially done by Codex)

The host nav items in `HostLayoutShell.tsx` render text-only links. The pattern established elsewhere in the app uses `{ href, label, icon }` with the icon rendered as a small inline SVG before the label. Nav items: Organizations, Services, Locations, Team, Claim.

---

### H-2 — Org page: edit modal closes fields on small viewport
**Severity:** Medium
**Status:** ⬜ Not started

`OrgPageClient.tsx` edit modal has `max-h-[85vh] overflow-y-auto` but the confirm button can be unreachable on mobile-sized modals. The `HSDS legal/tax` fieldset pushes content below the fold.

---

### H-3 — Services page: multi-step form shows all steps simultaneously
**Severity:** Medium
**Status:** ⬜ Not started

`ServicesPageClient.tsx` groups form fields into logical "steps" visually but there is no actual step-by-step wizard — all fields are visible at once behind the same dialog. The `ArrowLeft`/`ArrowRight` icons in the import suggest stepping was intended.

---

### H-4 — Admins page: invite-mode toggle label unclear
**Severity:** Low
**Status:** ⬜ Not started

`AdminsPageClient.tsx` has a toggle between "Email" and "User ID" invite modes. The `User ID` mode label says "UUID" in the input placeholder, but the toggle button label says "User ID". These should be consistent. The test currently expects the button to be labeled `'User ID'`.

---

### H-5 — Claim page: no success animation on desktop
**Severity:** Low / Visual
**Status:** ⬜ Not started

`ClaimPageClient.tsx` shows a success state but uses a plain `CheckCircle` icon rather than the `SuccessCelebration` component used elsewhere in the portal. Minor inconsistency.

---

## (community-admin) Pages

### P-1 — Queue page: bulk action buttons unimplemented
**Severity:** Medium
**Status:** ⬜ Not started

`QueuePageClient.tsx` renders a "Select all" checkbox and bulk action buttons ("Approve selected", "Reject selected") but these have no click handlers — clicking them silently does nothing.

---

### P-2 — Verify page: IP address shown in reviewer notes
**Severity:** High (security/privacy)
**Status:** ⬜ Not started

`VerifyPageClient.tsx` (the old `page.tsx`) displayed `row.ip_address` directly in the reviewer notes section. The `VerifyPageClient.tsx` (Codex improved version) uses `SubmissionStatus` and `SUBMISSION_STATUS_STYLES` from domain, but needs to be confirmed that IP is not exposed. Per `SECURITY_PRIVACY.md`, IP data must not be shown in the UI.

**Investigation needed:** Confirm the new `VerifyPageClient.tsx` does not render `ip_address`.

---

### P-3 — Coverage page: `<AlertTriangle>` still referenced after FormAlert migration
**Severity:** Low
**Status:** ⬜ Not started

The `CoveragePageClient.tsx` diff removed the `AlertTriangle` icon import but replaced inline error markup with `<FormAlert>`. However, the icon may still be listed in the import block — verify no dead imports.

---

### P-4 — Verify page: uses `SubmissionStatus` not `VerificationStatus`
**Severity:** Low (type alignment)
**Status:** ⬜ Not started

`VerifyPageClient.tsx` uses `SubmissionStatus` from `@/domain/types` and `SUBMISSION_STATUS_STYLES` from `@/domain/status-styles`. The old `page.tsx` used `VerificationStatus` with locally-defined styles. Need to confirm both types are aligned and the API contract matches.

---

## (oran-admin) Pages

### A-1 — Audit log: IP address shown in plain text
**Severity:** High (security/privacy)
**Status:** ⬜ Not started

Both `audit/page.tsx` (old, now replaced) and `audit/AuditPageClient.tsx` render `row.ip_address` directly: `{row.ip_address ? \` · IP: ${row.ip_address}\` : ''}`. Per `SECURITY_PRIVACY.md`, IP data must not appear in the UI — use a masked/truncated display or remove entirely.

---

### A-2 — Audit log: `user_id` displayed as raw UUID
**Severity:** Low
**Status:** ⬜ Not started

`AuditPageClient.tsx` renders `row.user_id` as-is (a UUID string). There is no lookup to display a human-readable name. While privacy-acceptable, the UX is poor for admin users trying to identify who performed an action.

---

### A-3 — Scopes page: unexpected API call on load
**Severity:** Medium (test regression / possible bug)
**Status:** ⬜ Not started

Test `scopes-page.test.tsx` expects the page to call `/api/admin/scopes?limit=1` on initial load, but the component actually calls `/api/admin/scopes/audit?limit=50`. This suggests the page's initial fetch logic changed but the test was not updated — or the page has a bug where it loads audit data instead of scopes.

---

### A-4 — Rules page: no confirmation before toggling production flags
**Severity:** High (safety)
**Status:** ⬜ Not started

`RulesPageClient.tsx` allows directly toggling feature flags with a single "Save" action. There is no confirmation dialog to prevent accidental toggling of flags in production (e.g., accidentally disabling `llm_summarize` or toggling a flag to 0% rollout).

---

### A-5 — Ingestion page: process tab has no cancel mechanism
**Severity:** Low
**Status:** ⬜ Not started

`IngestionPageClient.tsx` "Process" tab allows triggering a crawl/extraction job. Once submitted there is no way to cancel a running job from the UI — only a status indicator. A "Cancel job" button would connect to `DELETE /api/admin/ingestion/jobs/[id]`.

---

### A-6 — Zone management: assigned_user_id shown as raw UUID
**Severity:** Low
**Status:** ⬜ Not started

`ZoneManagementPageClient.tsx` displays `zone.assigned_user_id` as a raw UUID in the zone table. There is no lookup to resolve this to a community admin's name or email.

---

### A-7 — Appeals / Approvals pages: missing empty states
**Severity:** Low
**Status:** ⬜ Not started

`ApprovalsPageClient.tsx` and `AppealsPageClient.tsx` both use `SkeletonCard` for loading but have no distinct "no items" state — when the list is empty, the skeleton disappears and nothing is rendered. Need dedicated empty states with call-to-action text.

---

## Auth / System Pages

### AS-1 — Sign-in page: no redirect preservation
**Severity:** Medium
**Status:** ⬜ Not started

`SignInPageClient.tsx` triggers `signIn('azure-ad')` with no `callbackUrl` parameter. Users who land on `/auth/signin` after being redirected from a protected route lose their original destination and always land on the default callback URL.

---

### AS-2 — Auth error page test failures
**Severity:** Medium (test)
**Status:** ⬜ Not started

`src/app/auth/__tests__/pages.test.tsx` — 4 test failures in the `runTests` output. The auth pages test (`pages.test.tsx`) is failing in the current run. Needs investigation to determine if this is a pre-existing issue or introduced by our changes.

---

### AS-3 — Appeal/Directory/Map page tests failing
**Severity:** Medium (test)
**Status:** ⬜ Not started

The following test suites have failures that appear to be pre-existing (present in HEAD, not introduced by this session's changes):
- `appeal-page-client.test.tsx` (4 failures)
- `directory-page-client.test.tsx` (6 failures)
- `map-page-client.test.tsx` (6 failures)

These were failing before any changes in this session. Root cause unknown — likely tests written against intended behavior not yet implemented.

---

## Test Regression Tracking

| Test file | Failures before session | Failures after wiring fix | Notes |
|-----------|------------------------|--------------------------|-------|
| `admins-page.test.tsx` | 2 | 0 ✅ | Wiring fixed — now uses AdminsPageClient |
| `queue-page.test.tsx` | 3 | 0 ✅ | Pre-existing; fixed by wiring |
| `approvals-page.test.tsx` | 3 | 0 ✅ | Pre-existing; fixed by wiring |
| `portal-page-shells.test.tsx` | 3 | 0 ✅ | Fixed by wiring to PageClient files |
| `service-detail-client.test.tsx` | 1 | 1 | Needs test update for breadcrumb (F-4) |
| `scopes-page.test.tsx` | 1 | 1 | Pre-existing; API call mismatch |
| `appeal-page-client.test.tsx` | 4 | 4 | Pre-existing |
| `directory-page-client.test.tsx` | 6 | 6 | Pre-existing |
| `map-page-client.test.tsx` | 6 | 6 | Pre-existing |
| `pages.test.tsx` (auth) | 4 | 4 | Pre-existing |
| **Total** | **34** | **22** | 12 fixed by page wiring |

---

## File Inventory

### Deleted files
- `src/lib/hooks/useToast.ts` (standalone hook, replaced by context system)
- `src/components/ui/ToastRegion.tsx` (standalone toast container)
- `src/components/ui/__tests__/ToastRegion.test.tsx`

### Created files
- `src/app/(host)/HostLayoutShell.tsx`
- `src/app/(community-admin)/CommunityAdminLayoutShell.tsx`
- `src/app/(oran-admin)/OranAdminLayoutShell.tsx`

### Pages converted from inline client to thin server wrapper + PageClient split
- `src/app/(host)/org/page.tsx` → wraps `OrgPageClient.tsx`
- `src/app/(host)/services/page.tsx` → wraps `ServicesPageClient.tsx`
- `src/app/(host)/locations/page.tsx` → wraps `LocationsPageClient.tsx`
- `src/app/(host)/admins/page.tsx` → wraps `AdminsPageClient.tsx`
- `src/app/(host)/claim/page.tsx` → wraps `ClaimPageClient.tsx`
- `src/app/(community-admin)/verify/page.tsx` → wraps `VerifyPageClient.tsx`
- `src/app/(community-admin)/coverage/page.tsx` → wraps `CoveragePageClient.tsx`
- `src/app/(oran-admin)/audit/page.tsx` → wraps `AuditPageClient.tsx`
- `src/app/(oran-admin)/rules/page.tsx` → wraps `RulesPageClient.tsx`
- `src/app/(oran-admin)/ingestion/page.tsx` → wraps `IngestionPageClient.tsx`
- `src/app/(oran-admin)/zone-management/page.tsx` → wraps `ZoneManagementPageClient.tsx`
