# Org Portals Audit Report

**Scope**: Host Portal · Community Admin Portal · ORAN Admin Portal
**Date**: 2025-07-16
**Method**: Static analysis — all page, layout, API route, auth, and domain type files read with tooling
**Format**: Same graded, evidence-backed structure as `docs/AUDIT_SEEKER_UX.md`

---

## Executive Summary

| Portal | Pages | API Routes | Overall Grade |
|--------|-------|-----------|---------------|
| Host (`host_member+`) | 5 | 8 | **B–** |
| Community Admin (`community_admin+`) | 3 | 3 | **B** |
| ORAN Admin (`oran_admin`) | 4 | 5 | **B+** |
| Auth / Role System | — | — | **A–** |
| End-to-End Claim → Verify Flow | — | — | **B–** |
| Security (server-side) | — | — | **B+** |
| SEO / Metadata | — | — | **D** |
| Accessibility | — | — | **C+** |
| Form Design / UX | — | — | **C** |

---

## 1. Role & Auth Architecture

**Grade: A–**

### What works well

**Defense-in-depth: 3 independent layers**

| Layer | Mechanism | File |
|-------|-----------|------|
| Edge (CDN) | `proxy.ts` — JWT decode via `next-auth/jwt`, `isRoleAtLeast()` check | `src/proxy.ts` |
| UI | Layout `'use client'` + `useSession` + `isRoleAtLeast` + `AccessDenied` render | all 3 `layout.tsx` |
| Server | `getAuthContext()` + `requireMinRole()` / `requireOrgAccess()` / `requireOrgRole()` in every handler | all API routes |

**Role hierarchy** is a clean numeric map — easy to reason about:

```ts
seeker: 0 < host_member: 1 < host_admin: 2 < community_admin: 3 < oran_admin: 4
```

Evidence: `src/services/auth/guards.ts` L17–24

**`AuthContext` is well-typed** with `orgIds: string[]` + `orgRoles: Map<string, 'host_member'|'host_admin'>` for per-org granularity.

**Organisation-level ownership** enforced via `requireOrgAccess(ctx, orgId)` on all host PUT/DELETE endpoints.
Evidence: `src/app/api/host/organizations/[id]/route.ts` L64–67

**Team management locked** to `host_admin` (not just `host_member`):

```ts
if (!requireOrgRole(auth, organizationId, 'host_admin') && !isOranAdmin(auth))
```

Evidence: `src/app/api/host/admins/route.ts` L84–86

### Issues

**[AUTH-1] `shouldEnforceAuth()` allows unauthenticated claim submission in non-production (High)**

`POST /api/host/claim` creates an organization and a verification queue entry using an IP hash as `submittedByUserId` when no auth token is present:

```ts
// claim/route.ts — auth block
const authCtx = await getAuthContext();
const submittedByUserId = authCtx?.userId ?? `anon-${ipHash}`;
```

If the environment flag `ENFORCE_AUTH=false` (default in dev) is set in any staging or preview environment, anonymous org claims flow straight into the approval queue. A bad actor can enumerate IPs or rotate the IP hash. The `shouldEnforceAuth()` bypass is too broad for a write endpoint.

**Recommendation**: Make `POST /api/host/claim` unconditionally require auth regardless of `shouldEnforceAuth()`.

---

**[AUTH-2] `organization_members` table probed at runtime rather than guaranteed by migration (Medium)**

`session.ts`, `admins/route.ts`, and the invite flow all include a runtime `table EXISTS` check:

```ts
const tableCheck = await executeQuery<{ exists: boolean }>(
  `SELECT EXISTS (SELECT FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'organization_members') as exists`,
  [],
);
```

This adds one extra query per request, introduces drift risk (table can disappear or be renamed and the app silently returns empty data), and signals the migration lifecycle is incomplete. Once the migration is committed and irreversible, remove the guard. Use database health probes, not per-request schema probes.

---

**[AUTH-3] `proxy.ts` no-op in dev when `AZURE_AD_CLIENT_ID` is unset (Low)**

```ts
if (!ENTRA_CLIENT_ID) {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse('Authentication is not configured', { status: 503 });
  }
  return NextResponse.next(); // ← all routes open in dev
}
```

This is documented and intentional, but it means any developer running locally can visit `/approvals`, `/audit`, or `/zone-management` without credentials. This is acceptable for local dev but must be noted in the runbook and blocked in preview deployments.

---

## 2. Host Portal (`/org`, `/services`, `/locations`, `/admins`, `/claim`)

**Grade: B–**

### 2a. Organization Dashboard (`/org`)

**Grade: B**

**Good**: Search via `plainto_tsquery`, pagination (12/page), edit-in-place Dialog, delete confirmation, empty-state copy.

**Issues**:

| ID | Severity | Finding | Evidence |
|----|----------|---------|---------|
| HOST-ORG-1 | Medium | `window.location.origin` used to construct absolute URLs during server-rendered pass — should use relative URLs or `headers().get('host')` | `(host)/org/page.tsx` |
| HOST-ORG-2 | Low | Edit Dialog wraps fields in a `<div>` rather than a `<form>`. `Enter` key submit doesn't work; screen readers don't announce a form landmark | `(host)/org/page.tsx` |
| HOST-ORG-3 | Low | No character counters on `description` (max 5000 server-side) | API schema |

---

### 2b. Services Page (`/services`)

**Grade: C+**

**Good**: Full CRUD, 3-state status management with color labels, org filter.

**Issues**:

| ID | Severity | Finding |
|----|----------|---------|
| HOST-SVC-1 | **High** | 12-field Dialog modal with no grouping, no step indicator, and no field-level validation. On a 375px phone, this requires significant vertical scroll inside a modal with no fixed footer. Fields like `applicationProcess`, `fees`, `waitTime` are `<textarea>` elements with no character count. |
| HOST-SVC-2 | Medium | `status` field defaults to `'active'` on create — a service is live the moment it is saved, before any verification. Should default to `'inactive'` pending verification cycle. |
| HOST-SVC-3 | Low | No bulk operations. When migrating a legacy provider, adding 50+ services one at a time via modal is untenable. Import / CSV upload not available from UI. |

---

### 2c. Locations Page (`/locations`)

**Grade: C+**

**Good**: CRUD, delete confirmation, org-scoped listing.

**Issues**:

| ID | Severity | Finding |
|----|----------|---------|
| HOST-LOC-1 | **High** | `latitude` and `longitude` are initialized as empty strings (`''`) in form state, then sent as strings to the API. No range validation (`lat: -90..90`, `lng: -180..180`), no numeric enforcement. A user can submit `latitude: "abc"` or `latitude: "999"`. |
| HOST-LOC-2 | High | Azure Maps is already integrated in the codebase (`/api/maps/token` exists, `AZURE_MAPS_KEY` in env). Location entry has no map picker despite the infrastructure being available. Manual lat/lng entry is error-prone. |
| HOST-LOC-3 | Medium | `transitAccess` is a tags array in the domain type but the form shows a plain `<input type="text">` — no multi-select or tag input. Users don't know valid values (`bus_stop_nearby`, `subway_nearby`, etc.). |
| HOST-LOC-4 | Low | `parkingAvailable` dropdown values (`yes`, `no`, `street_only`, `paid`, `unknown`) are not labelled — "street_only" and "paid" need plain-English descriptions in the Select option. |

---

### 2d. Team Management (`/admins`)

**Grade: D+**

This is the most critical UX gap in the org portal.

**Issues**:

| ID | Severity | Finding |
|----|----------|---------|
| HOST-ADM-1 | **Critical** | Invite requires a user UUID. There is no user directory, no search-by-email, no invite-by-email-link. A host_admin must obtain the invitee's UUID out-of-band (copy-paste from somewhere). This makes legitimate team management nearly impossible for non-engineer users. |
| HOST-ADM-2 | **High** | No pending invitation concept. Invites either succeed immediately (user exists and is added) or fail. There's no email-based "invite link" flow using a token. |
| HOST-ADM-3 | Medium | Role change and remove actions have no confirmation dialog. A fat-finger role change or accidental remove has no undo. |
| HOST-ADM-4 | Medium | `inviteRole` auto-defaults to `host_member`. The UI doesn't explain the difference between `host_member` (read + edit own) and `host_admin` (full team management). The role labels need a tooltip or description. |
| HOST-ADM-5 | Low | `organizationId` is sourced from URL param OR auto-first. When a user belongs to multiple orgs and navigates to `/admins` directly, they silently end up in whichever org comes first in the array — with no indication of which org is selected. |

**Recommendation**: Implement email-based invitation tokens (generate a short-lived signed token, store in DB, email the link, redeem on landing). This is table-stakes for multi-tenant team management.

---

### 2e. Claim Page (`/claim`)

**Grade: B–**

**Good**: 5-step idle→submitting→success flow is clean, rate-limited, Zod-validated on server.

**Issues**:

| ID | Severity | Finding |
|----|----------|---------|
| HOST-CLM-1 | Medium | No client-side field validation before submit. URL field calls `z.string().url()` on server but the client allows plain text (e.g., `google.com` without `https://`). User only sees the error after a round-trip. |
| HOST-CLM-2 | Medium | `claimNotes` textarea has no character counter despite a 2000-char server limit. Users can write long essays and only learn the limit on server rejection. |
| HOST-CLM-3 | Low | On success, the page shows `Organization ID: [uuid]` and `Service ID: [uuid]` in raw UUID form. This is useless to the submitter. Show the org/service name and a link to the org dashboard instead. |
| HOST-CLM-4 | Low | `orgName` is the only required field (required marker `*`). The other 4 fields have no required/optional indicator. |

---

## 3. Community Admin Portal (`/queue`, `/verify`, `/coverage`)

**Grade: B**

### 3a. Queue Page (`/queue`)

**Grade: B+**

**Good**: 6 status tabs (+ escalated), pagination 20/page, "Claim" assign-to-self, link to verify page, empty states.

**Issues**:

| ID | Severity | Finding |
|----|----------|---------|
| COM-Q-1 | Medium | No sort controls. Queue is ordered by `created_at ASC` by default. A high-volume queue needs sort-by-age, sort-by-org, sort-by-score to triage effectively. |
| COM-Q-2 | Low | "Claim" button assigns to self. There is no "unclaim" / "release" action visible on the queue listing — users must go into the verify page and manually change status. |
| COM-Q-3 | Low | No "bulk assign" or "reassign to another admin" capability. For zone management, admins need to redistribute work. |

---

### 3b. Verify Page (`/verify`)

**Grade: B–**

This is the most information-dense page in the entire application (767 lines, 20+ data fields, ScoreMeter component).

**Good**: Confidence score visualised, `ScoreMeter` green/yellow/red, full service detail, decision form with notes, `In Review` auto-status on open.

**Issues**:

| ID | Severity | Finding |
|----|----------|---------|
| COM-V-1 | **High** | 767-line single `'use client'` component with no code splitting, no lazy loading, no Suspense boundaries inside the card sections. On slow connections this load is all-or-nothing. |
| COM-V-2 | Medium | Decision options are `verified`, `rejected`, `escalated`. There's no `needs_info` / "Request More Information" state that pauses the clock without a final decision. In practice admins escalate when they need more info, inflating escalation counts. |
| COM-V-3 | Medium | Notes textarea has no minLength prompt for rejection/escalation. A rejection with empty notes (`notes` is optional) gives the host no actionable feedback. Enforce `notes` required for `rejected` and `escalated` clientside. |
| COM-V-4 | Low | `confidenceScore` (0–100) is shown via ScoreMeter but there's no tooltip explaining what the score represents or how it was computed. New community admins have no reference point for "is 62 good or bad?" |
| COM-V-5 | Low | No keyboard shortcut or quick-action button for common flow: open → claim → verify. Context-switching between queue and detail pages adds friction. |

---

### 3c. Coverage Page (`/coverage`)

**Grade: C**

**Issues**:

| ID | Severity | Finding |
|----|----------|---------|
| COM-COV-1 | **High** | The `coverage_zones` table does not yet exist. The page comment says: *"Note: coverage_zones table does not exist yet (see docs/agents/prompts/AGENT_PROMPT_SQL.md). When it ships, this page will show zone boundary + per-zone filters."* The stat cards and activity chart currently show aggregate totals for **all** queue entries, not just the admin's zone. This means a community admin believes they are seeing their zone but actually sees the global queue. |
| COM-COV-2 | High | `TopOrganizations` section shows all orgs with pending queue entries. Without zone filtering this is an information disclosure — Community Admin A can see org names pending in Community Admin B's zone. |
| COM-COV-3 | Medium | Activity chart (`ActivityDay[]`) is a raw date/count table with no visual chart (presumably uses raw list). No progress trend visualization is wired. |
| COM-COV-4 | Low | "stale" count appears in the summary stats but is not defined anywhere in the UI — no tooltip, no benchmark ("older than X days"). |

---

## 4. ORAN Admin Portal (`/approvals`, `/rules`, `/audit`, `/zone-management`)

**Grade: B+**

### 4a. Approvals Page (`/approvals`)

**Grade: A–**

**Good**: 5-status tabs, `daysAgo()` helper, `StatusBadge` with colour semantics, approve/deny with notes, pagination, empty states confirmed.

**Issues**:

| ID | Severity | Finding |
|----|----------|---------|
| ADM-APR-1 | Low | `denyNotes` is optional on the schema (`notes: z.string().max(5000).optional()`). A denial without notes gives the claiming org no path to remediation. Should enforce notes for `denied` decisions. |
| ADM-APR-2 | Low | No batch approve/deny. Processing a backlog of 50+ claim approvals requires 50 individual dialog confirmations. |

---

### 4b. Rules / Feature Flags Page (`/rules`)

**Grade: B+**

**Good**: Toggle + rollout percentage per flag, inline save with result feedback, error boundary, skeleton loading.

**Issues**:

| ID | Severity | Finding |
|----|----------|---------|
| ADM-RUL-1 | Medium | `rolloutPct` is editable as a number input with no constrained range UI (no slider). An admin typing `150` would send an invalid value. The server should reject values outside `0–100` but the client offers no affordance. |
| ADM-RUL-2 | Low | Flag names are raw strings (`llm_summarize`, etc.) with no human-readable labels or descriptions in the UI. New ORAN admins won't know what toggling `llm_summarize` will do to end users. |
| ADM-RUL-3 | Low | No audit log integration — flag changes are saved but the only audit trail is the generic audit log. The rules page doesn't show "last changed by / at". |

---

### 4c. Audit Log Page (`/audit`)

**Grade: A–**

**Good**: 9-action type filter with colour-coded badges, expandable old/new data diff rows, pagination 25/page, IP address logged, user ID logged.

**Issues**:

| ID | Severity | Finding |
|----|----------|---------|
| ADM-AUD-1 | Medium | `old_data` / `new_data` are stored as raw JSON strings. The expand-row JSON display is un-diffed (no side-by-side color diff). Finding what changed in a large object edit requires manually comparing. |
| ADM-AUD-2 | Low | `user_id` is shown as raw UUID. Without a user lookup, admins cannot tell who made a change. Add user email/name denormalization or a hover tooltip resolution. |
| ADM-AUD-3 | Low | Filter is action-only. No date range filter, no table_name filter, no user_id filter. High-volume audit logs become unsearchable. |

---

### 4d. Zone Management Page (`/zone-management`)

**Grade: B–**

**Good**: CRUD for coverage zones, status filter tabs, pagination, Dialog modals for create/edit/delete.

**Issues**:

| ID | Severity | Finding |
|----|----------|---------|
| ADM-ZON-1 | **High** | `assigned_user_id` is a free-form UUID input. There's no user picker, no validation that the UUID belongs to a `community_admin`, and no lookup of the user's name. An ORAN admin must paste a UUID with no confirmation of who they're assigning. |
| ADM-ZON-2 | High | Zone has `name` + `description` but no actual geographic boundary (no polygon, no bounding box, no PostGIS geometry). Coverage zones are purely nominal labels. The system cannot enforce "Community Admin A only sees services in Zone 3." This is the root cause of `COM-COV-1`. |
| ADM-ZON-3 | Medium | No map visualization for zones. For civic coverage planning, a map showing zone boundaries and their assigned admins is essential. Azure Maps integration exists but is not used here. |
| ADM-ZON-4 | Low | `status: 'active' \| 'inactive'` — no lifecycle explanation. Deactivating a zone while it has assigned items (queue entries, admins) has undocumented side effects. |

---

## 5. End-to-End Claim → Verify Flow

**Grade: B–**

### Flow Map

```
[Anyone]  POST /api/host/claim
              → creates org + verification_queue entry (status: pending)
              → [AUTH-1] unauthenticated possible in dev

[ORAN Admin]  GET /approvals + POST /api/admin/approvals
              → approve/deny the claim (org ownership)
              → status: approved | denied

[Host Admin]  POST /api/host/services
              → creates a service under the org

[System/Host] POST /api/community/queue  (via AssignSchema)
              → community admin claims/assigns the service queue entry

[Community Admin]  PUT /api/community/queue/[id]
              → decision: verified | rejected | escalated
              → status: verified | rejected | escalated

[ORAN Admin]  GET /approvals (escalated tab)
              → reviews escalations
```

### Flow Issues

| ID | Severity | Finding |
|----|----------|---------|
| FLOW-1 | **High** | There is no mechanism for a service to automatically enter the verification queue after creation. `POST /api/host/services` creates a service but does **not** insert a `verification_queue` row. Queue entries only exist for claim submissions, not for individually-added services. A host admin can add unlimited services that never get verified. |
| FLOW-2 | High | Coverage zones are not filtering the queue (`COM-COV-1`, `ADM-ZON-2`). Community admins see the global queue regardless of zone assignment. Zone-scoped assignment is the primary mechanism for scaling to multiple geographic regions — it doesn't work yet. |
| FLOW-3 | Medium | After an ORAN Admin denies a claim, the claiming organization still exists in the DB (status unchanged). The expected UX is: denial → org flagged inactive or deleted and notify submitter. This is not implemented. |
| FLOW-4 | Medium | No email/notification at any step. Submitter gets no email confirmation of claim receipt. Host gets no notification when approved/denied. Community admin gets no notification of new assignments. This is a manual polling-only flow. |
| FLOW-5 | Low | The `/claim` page success message shows raw UUIDs (`Organization ID: …`). Submitters cannot navigate to their new org dashboard from the success screen. |

---

## 6. Security Posture (Server-Side)

**Grade: B+**

### Strengths

- Every API route validates input with Zod. No raw `req.body` forwarding.
- UUIDs validated with `z.string().uuid()` before DB queries — prevents injection via `[id]` path segment.
- Rate limiting on all routes with per-IP keys and `Retry-After` headers.
- `requireOrgAccess` ensures cross-tenant isolation on PUT/DELETE operations.
- Sentry capture on unhandled exceptions with no PII forwarding noted.
- `isOranAdmin` bypass is explicit and named — not a hidden flag.

### Issues

| ID | Severity | Finding |
|----|----------|---------|
| SEC-1 | **High** | `POST /api/host/claim` unauthenticated path (see `AUTH-1`). |
| SEC-2 | Medium | `window.location.origin` in client components risks open-redirect scenarios if CSP is not set. Calls like `fetch(\`${window.location.origin}/api/...\`)`should use relative paths (`fetch('/api/...')`). Found in at least`(host)/org/page.tsx`. |
| SEC-3 | Medium | `old_data` / `new_data` in audit log may contain PII (user email, org contact info). The audit GET endpoint is `oran_admin` only but the data lands in the PostgreSQL `audit_logs` table with no field-level redaction. Confirm that PII fields (email, phone) are excluded from `new_data` JSON before storage. |
| SEC-4 | Low | The `proxy.ts` route patterns use simple string regex without anchoring to specific app-router segment boundaries (e.g., `/^\/(claim\|org\|...)` could theoretically match `/claim-forms/public` if such a route were added). Patterns should be more specific where possible. |

---

## 7. SEO & Metadata

**Grade: D**

All three portals use `'use client'` layouts with no `generateMetadata` export. This produces:

- No `<title>` tag on any org portal page (browser tab shows the app name or blank)
- No Open Graph or social share metadata
- No `<meta name="robots" content="noindex, nofollow">` — authenticated portals should declare themselves non-indexable as a defense-in-depth measure even if auth prevents access

**Evidence**: `src/app/(host)/layout.tsx`, `src/app/(community-admin)/layout.tsx`, `src/app/(oran-admin)/layout.tsx` — all `'use client'`, no `metadata` export.

| ID | Severity | Finding |
|----|----------|---------|
| SEO-1 | **High** | No `<title>` on any org portal page. Screen readers announce the tab title; absence degrades accessibility for keyboard users navigating multiple tabs. |
| SEO-2 | Medium | No `<meta name="robots" content="noindex">`. The routes are auth-gated but search engine crawlers running with a valid session token from a logged-in user (e.g., GoogleBot with GSC verification) could theoretically index these pages. |
| SEO-3 | Low | No breadcrumb structured data. Admin decision pages would benefit from `<title>Approvals — ORAN Admin</title>` for orientation. |

**Recommendation**: Add a `metadata` export to each portal's `layout.tsx`. This requires either (a) a separate server-side `layout-metadata.ts` companion or (b) moving the `metadata` export into a parent layout above the client shell. The client guard can remain `'use client'` but the `metadata` lives in the server segment.

---

## 8. Accessibility

**Grade: C+**

### Strengths

- All 3 layouts include a `<a href="#main-content" class="sr-only focus:not-sr-only">Skip to main content</a>` skip link.
- `aria-current="page"` on active nav links.
- `aria-label` on nav landmarks.
- `aria-busy="true"` on loading states in layouts.

### Issues

| ID | Severity | Finding |
|----|----------|---------|
| A11Y-1 | **High** | Skip link target `#main-content` is never rendered — no `<main id="main-content">` in any layout. The skip link points to a non-existent anchor (verified: all 3 layout files use a `<div>` wrapper, not `<main id="main-content">`). Screen readers do the right thing but keyboard users who activate the skip link land nowhere. |
| A11Y-2 | High | The 12-field services Dialog modal has no focus trap management confirmed. When the Dialog opens, focus must move to the first interactive element and be trapped inside. Verify `@radix-ui/react-dialog` focus trapping is working for all nested inputs. |
| A11Y-3 | Medium | Form fields in host portal Dialogs (org edit, service create/edit, location create/edit) use `<div>` containers without `role="form"` or `<form>` elements. Field validation errors rendered in a `<p>` below the input need `aria-describedby` linking input→error. |
| A11Y-4 | Medium | `StatusBadge` and `ScoreMeter` components use colour alone to convey status (red/yellow/green). For WCAG 2.1 SC 1.4.1 (Use of Colour), a text label or shape indicator is required alongside colour. The badge text is present for `StatusBadge` but verify `ScoreMeter` includes a screen-reader-accessible value. |
| A11Y-5 | Low | Delete/Remove confirmation dialogs do not move focus to the "Cancel" button by default. Destructive dialogs should default focus to the non-destructive action. |

---

## 9. Form Design & UX

**Grade: C**

### Summary Table

| Form | Fields | Validation | Modal/Page | Mobile-Friendly | Grade |
|------|--------|-----------|------------|----------------|-------|
| Claim (`/claim`) | 5 | Server-only | Page | ✓ | B |
| Create Org | 8 | Server-only | Dialog | △ | C+ |
| Edit Org | 4 | Server-only | Dialog | ✓ | B– |
| Create/Edit Service | 12 | Server-only | Dialog | ✗ | D |
| Create/Edit Location | 13 | Server-only | Dialog | ✗ | D |
| Invite Member | 3 | UUID-only client | Dialog | ✓ | D+ |
| Verify Decision | 2 | Server | Page section | ✓ | B |
| Approve/Deny Claim | 2 | Server | Dialog | ✓ | B |
| Zone Create/Edit | 4 | Server-only | Dialog | △ | C |
| Flag Edit | 2 | No client range | Inline | ✓ | C+ |

**Cross-cutting issues**:

| ID | Severity | Finding |
|----|----------|---------|
| FORM-1 | **High** | Service and Location create/edit forms (12–13 fields each) are presented in Dialog modals. These forms need either (a) their own full pages, (b) a multi-step wizard, or (c) progressive disclosure grouping related fields (Basic Info / Contact / Operational Details / Accreditation). |
| FORM-2 | **High** | No client-side validation on any form. All validation is server-round-trip. This violates baseline form UX: users should see inline errors before submission. Use `react-hook-form` + `zodResolver` to share the server-side Zod schema client-side. |
| FORM-3 | Medium | No required vs optional field indicators beyond the `/claim` page. Users submitting 12-field service forms don't know which fields matter. |
| FORM-4 | Medium | No autosave or draft state. A host admin filling in a 12-field service form who accidentally navigates away loses all work. |
| FORM-5 | Low | Character counters are missing on all long-text areas (description, claimNotes, applicationProcess, fees, waitTime, etc.) despite server-side length limits. |

---

## 10. Summary Findings by Severity

### Critical (0)

No P0 blocking bugs found.

### High (14 confirmed)

| # | ID | Area | Summary |
|---|-----|------|---------|
| 1 | AUTH-1 | Security | Unauthenticated claim submission possible when `shouldEnforceAuth=false` |
| 2 | HOST-SVC-1 | UX | 12-field Dialog modal — no grouping, no step, no client validation |
| 3 | HOST-LOC-1 | Data | lat/lng as strings — no range or format validation client or server (confirm server) |
| 4 | HOST-LOC-2 | Feature | Azure Maps picker unused despite infrastructure existing |
| 5 | HOST-ADM-1 | UX | Invite by UUID only — impossible for non-engineer users |
| 6 | HOST-ADM-2 | Feature | No email-based invite link flow |
| 7 | COM-COV-1 | Data | coverage_zones table missing — Community Admin Coverage page shows global, not zone-scoped data |
| 8 | COM-COV-2 | Privacy | Coverage page leaks org names across zone boundaries |
| 9 | ADM-ZON-1 | UX | Zone assigned_user_id — no user picker, no validation that UUID is a community_admin |
| 10 | ADM-ZON-2 | Architecture | Coverage zones have no geographic boundary — zone assignment enforcement impossible |
| 11 | FLOW-1 | Architecture | Services created via `/services` page never enter verification queue automatically |
| 12 | FLOW-2 | Architecture | Queue is not zone-filtered — zone system non-functional end-to-end |
| 13 | SEO-1 | A11y/SEO | No `<title>` on any org portal page |
| 14 | A11Y-1 | Accessibility | Skip link target `#main-content` element does not exist in any layout |

### Medium (16 confirmed)

AUTH-2, HOST-ORG-1, HOST-SVC-2, HOST-LOC-3, HOST-ADM-3, HOST-ADM-4, HOST-CLM-1, HOST-CLM-2, COM-Q-1, COM-V-2, COM-V-3, COM-COV-3, ADM-RUL-1, SEC-2, SEC-3, A11Y-3, A11Y-4, FORM-1, FORM-2, FORM-3, FLOW-3, FLOW-4 *(some counted above in High)*

---

## 11. Prioritised Recommendations

### Sprint 1 — Correctness & Safety (Do Now)

1. **FLOW-1**: Auto-insert `verification_queue` entry when a service is created via `POST /api/host/services`.
2. **AUTH-1**: Remove the anonymous-claim path; require auth unconditionally on `POST /api/host/claim`.
3. **A11Y-1**: Add `<main id="main-content">` to all 3 portal layouts.
4. **HOST-LOC-1**: Add numeric range validation to `latitude`/`longitude` in both the form (client) and the API route (server Zod schema).
5. **COM-COV-1/2**: Add a `zone_id` column to `verification_queue` and filter the coverage page to `authCtx.userId`'s assigned zone once the migration exists. Block launch of coverage stats until zone filtering is ready.

### Sprint 2 — Core UX Repair

1. **HOST-ADM-1/2**: Replace UUID invite with email-based invite token flow.
2. **FORM-2**: Add `react-hook-form` + `zodResolver` to all host forms (at minimum: service, location, claim).
3. **HOST-SVC-1/HOST-LOC-**: Break 12-field service and 13-field location Dialogs into multi-step forms or dedicated pages with grouped sections.
4. **SEO-1**: Add `<title>` metadata to all portal layouts.
5. **ADM-ZON-1/2**: Add PostGIS polygon storage for zones + community_admin user picker for assignment.

### Sprint 3 — Quality of Life

1. **HOST-LOC-2/ADM-ZON-3**: Wire Azure Maps picker for location entry and zone boundary drawing.
2. **FLOW-4**: Add email/webhook notifications at each flow transition (claim received, approved/denied, service verified).
3. **COM-V-2**: Add `needs_more_info` decision state to reduce incorrect escalation.
4. **COM-V-3**: Enforce `notes` required on `rejected`/`escalated` decisions client-side.
5. **ADM-AUD-3**: Add date range + table_name + user_id filters to audit log.
6. **FORM-4**: Add draft/autosave state to service and location forms.

---

## 12. What Is Working Well (Preserve)

- **Role architecture** is clean, hierarchical, and well-layered. `isRoleAtLeast` is pure and edge-compatible.
- **Org isolation** on all PUT/DELETE routes via `requireOrgAccess` is solid.
- **Zod validation on all API routes** — no raw passthrough. Server is the canonical validator.
- **Rate limiting** is per-IP, per-route, with correct `Retry-After` headers.
- **Approvals, Audit, and Rules pages** for ORAN admin are functional, well-structured, and appropriately gated.
- **Skip links, aria-current, aria-label, aria-busy** are present across all layouts.
- **Error boundaries** (`<ErrorBoundary>`) wrap all major page content.
- **Skeleton loading states** are consistent across all 3 portals.
- **Confirmation dialogs** for destructive actions (delete org, remove member) are present in most places.
