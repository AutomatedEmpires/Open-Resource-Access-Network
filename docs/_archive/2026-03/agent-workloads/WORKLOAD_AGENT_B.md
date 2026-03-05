# (ARCHIVED) Agent B — Frontend: Pages, Components, & UX Wiring

Archived on 2026-03-05.

Reason: superseded by the per-area activation docs in `docs/agents/activation/`.

Replacement:
- `docs/agents/activation/AGENT_OMEGA_ACTIVATION.md`

**Scope**: All seeker-facing pages (`src/app/(seeker)/`), UI components (`src/components/`), and their tests.
**Boundary**: Agent B does NOT touch `src/middleware.ts`, `src/services/auth/`, `src/services/search/engine.ts`, `src/app/api/chat/route.ts`, or create any new API routes. Those belong exclusively to Agent A.

---

## Operating Rules

1. **Read the project instructions first**: `docs/SSOT.md`, `docs/governance/OPERATING_MODEL.md`, `.github/copilot-instructions.md`.
2. **Read the audit**: `docs/audit/AUDIT_SEEKER_UX.md` — sections 2, 5, and 7 are your primary input.
3. **Read Agent A's contract**: `docs/_archive/2026-03/agent-workloads/WORKLOAD_AGENT_A.md` — sections A2/A3/A4 define the API shapes you code against. If Agent A's APIs are not yet live, your code must still compile and work with graceful fallback (try the API, fall back to localStorage if it returns 401 or fails).
4. **No hallucinated facts**: never invent service names, phone numbers, addresses, hours. All data comes from API responses.
5. **Eligibility caution**: always use "may qualify" language. Never say "you are eligible."
6. **Follow existing component patterns**: look at `src/components/directory/ServiceCard.tsx` and `src/components/chat/ChatWindow.tsx` for structure.
7. **Test everything**: every new component and page change gets tests. Use Vitest + React Testing Library. Match existing test patterns in `__tests__/` directories.
8. **Run validation before declaring done**: `npx tsc --noEmit && npm run lint && npm run test`.

---

## API Contracts (Provided by Agent A)

Agent B codes against these. If the endpoint returns 401/500/network error, fall back to localStorage gracefully.

### Batch fetch services by IDs
```
GET /api/services?ids=uuid1,uuid2,uuid3
Response 200: { results: EnrichedService[] }
Response 400: { error: string }
```

### Profile
```
GET /api/profile
  Response 200: { profile: { userId: string, preferredLocale: string | null, approximateCity: string | null } | null }
  Response 401: { error: "Authentication required" }

PUT /api/profile
  Body: { approximateCity?: string, preferredLocale?: string }
  Response 200: { profile: { userId: string, preferredLocale: string | null, approximateCity: string | null } }
  Response 401: { error: "Authentication required" }
```

### Saved services
```
GET /api/saved
  Response 200: { savedIds: string[] }
  Response 401: { error: "Authentication required" }

POST /api/saved
  Body: { serviceId: string }
  Response 200: { saved: true, serviceId: string }
  Response 401: { error: "Authentication required" }

DELETE /api/saved
  Body: { serviceId: string }
  Response 200: { removed: true, serviceId: string }
  Response 401: { error: "Authentication required" }
```

---

## Tasks

### B1. Rewire saved page to use batch-fetch API (G3)

**Problem**: `/saved` page fetches ALL services via `/api/search?limit=100` then filters client-side. Services beyond page 1 are silently lost.

**File to modify**:
- `src/app/(seeker)/saved/page.tsx`

**What to do**:
1. Replace the current fetch-all-and-filter logic with a call to `GET /api/services?ids=...` using the IDs from localStorage.
2. Additionally attempt `GET /api/saved` to merge server-side saves (if user is authenticated). If 401, ignore silently and use localStorage only.
3. Merge strategy: union of localStorage IDs + server-side IDs. Deduplicate.
4. After fetching services by IDs, render them using the existing `ServiceCard` component.
5. Keep the existing remove/clear-all functionality. When removing: update localStorage AND attempt `DELETE /api/saved` (fire-and-forget if user is authenticated).

**Edge cases to handle**:
- No saved IDs → show existing empty state (no API call needed).
- API returns 400 (invalid IDs) → show error state with "Some saved services could not be loaded."
- Network failure → show existing error state with retry.
- Mix of valid and invalid IDs → show what loaded, note count of failures.

**Acceptance criteria**:
- Saved page loads correct services by ID (not all-and-filter).
- Works with localStorage only (unauthenticated users).
- If authenticated, merges server-side saves.
- Remove updates both localStorage and server (best-effort).
- Tests cover: empty state, localStorage-only load, API error fallback, remove.

---

### B2. Rewire profile page for server-side sync (G5 + G9)

**Problem**: Profile saves to localStorage only. "Sign in" button is disabled. Language preference has no effect.

**File to modify**:
- `src/app/(seeker)/profile/page.tsx`

**What to do**:
1. On mount, attempt `GET /api/profile`. If 200 with a profile, pre-fill fields from server data (server wins over localStorage). If 401 or error, use localStorage as before.
2. On save, write to localStorage AND attempt `PUT /api/profile` (fire-and-forget if 401).
3. Enable the "Sign in" button — change it from `disabled` to a link to `/api/auth/signin?callbackUrl=/profile`. Label: "Sign in with Microsoft". Remove "(coming soon)".
4. Add a sign-out link that navigates to `/api/auth/signout` — only show if user appears authenticated (check for session cookie or successful `GET /api/profile`).
5. Language preference: the saved locale should be passed as a `lang` attribute on the `<html>` element. Modify the profile page to store `preferredLocale` and, when it changes, call `document.documentElement.lang = locale`. This is a minimal i18n hook — full translation is out of scope, but the HTML lang attribute should reflect the user's choice for screen readers.

**Acceptance criteria**:
- Profile pre-fills from server if authenticated.
- Profile saves to server if authenticated, localStorage always.
- "Sign in" button links to `/api/auth/signin?callbackUrl=/profile`.
- Sign-out link appears when authenticated.
- `<html lang="...">` updates when language preference changes.
- Tests cover: unauthenticated flow (localStorage only), authenticated flow (server sync), sign-in button renders, language attribute update.

---

### B3. Create service detail page (G8)

**Problem**: No `/service/[id]` route exists. Users cannot deep-link to or share a specific service.

**Files to create**:
- `src/app/(seeker)/service/[id]/page.tsx`

**What to do**:
1. Create a dynamic route page at `src/app/(seeker)/service/[id]/page.tsx`.
2. On mount, fetch `GET /api/services?ids=<id>` with the single ID from the URL.
3. If service found, render using the existing `ServiceCard` component in full (non-compact) mode. Add a back link ("← Back to results" using `router.back()`).
4. If not found, show a "Service not found" message with a link to `/directory`.
5. Include loading skeleton, error state.
6. Add meta: `<title>{serviceName} | ORAN</title>` using Next.js `Metadata` or `<head>`.
7. Include the eligibility disclaimer at bottom (same as other pages).

**Wiring from existing pages**:
- Update `ServiceCard` to accept an optional `href` prop. When present, the service name becomes a clickable link to `/service/<id>`.
- Update directory page and saved page: pass `href={/service/${service.id}}` to each `ServiceCard`.
- Update `ChatServiceCard` to link the service name to `/service/<id>`.

**Acceptance criteria**:
- `/service/<valid-uuid>` renders the full service card with all fields.
- `/service/<invalid>` shows "Service not found".
- Service name in directory/saved/chat cards links to the detail page.
- Back navigation works.
- Tests cover: valid service render, not-found state, loading state.

---

### B4. Add feedback UI (G7)

**Problem**: POST `/api/feedback` exists and works but no UI triggers it.

**Files to create**:
- `src/components/feedback/FeedbackForm.tsx`

**Files to modify**:
- `src/components/directory/ServiceCard.tsx` — add feedback button
- `src/components/chat/ChatServiceCard.tsx` — add feedback button

**What to do**:
1. Create `FeedbackForm` component:
   - Props: `serviceId: string`, `sessionId: string`, `onClose: () => void`, `onSubmit?: () => void`
   - UI: a small inline form (not a modal — keep it lightweight) with:
     - Star rating (1-5) — required. Use 5 clickable star icons. Minimum touch target 44px.
     - "Were you able to contact this service?" — Yes/No toggle (optional).
     - Comment textarea (optional, max 500 chars).
     - Submit button.
   - On submit: POST `/api/feedback` with `{ serviceId, sessionId, rating, comment?, contactSuccess? }`.
   - Show success confirmation ("Thank you for your feedback") then auto-close after 2 seconds.
   - Show error state if submission fails.
   - Gate behind `feedback_form` feature flag: check `localStorage.getItem('oran:flags')` or simply render always (the API is ready).
2. In `ServiceCard`: add a "Give feedback" button (small text link below the eligibility disclaimer). Clicking toggles `FeedbackForm` inline below the card. Pass `sessionId` from `sessionStorage.getItem('oran_chat_session_id')` or generate one.
3. In `ChatServiceCard`: add a small "Feedback" text link. Same behavior.

**Acceptance criteria**:
- Star rating is required — submit disabled without it.
- Successful submission shows confirmation.
- Failed submission shows error with retry.
- Touch targets ≥ 44px on stars.
- sessionId is sourced from sessionStorage (existing chat session) or a new UUID.
- Tests cover: render, star selection, successful submission, error state, close.

---

### B5. Add save button to ChatServiceCard (G12)

**Problem**: `ChatServiceCard` has no bookmark button — users must navigate to directory to save a service.

**File to modify**:
- `src/components/chat/ChatServiceCard.tsx`

**What to do**:
1. Add optional props: `isSaved?: boolean`, `onToggleSave?: (serviceId: string) => void`.
2. Render a bookmark icon button (same as `ServiceCard`'s save button) in the card header area.
3. In `ChatWindow`, maintain the saved IDs state from localStorage (same pattern as directory/map pages). Pass `isSaved` and `onToggleSave` to each `ChatServiceCard`.
4. When toggling save: update localStorage AND attempt POST/DELETE `/api/saved` (best-effort, same pattern as B1).

**Files to modify**:
- `src/components/chat/ChatServiceCard.tsx` — add save button
- `src/components/chat/ChatWindow.tsx` — add saved state management, pass props

**Acceptance criteria**:
- Bookmark button visible on each chat service card.
- Toggle updates localStorage immediately.
- Visual state (filled/outline) reflects saved status.
- Tests cover: render with/without save props, toggle behavior.

---

### B6. Accessibility improvements (Audit Section 5 gaps)

**Files to modify**:
- `src/app/(seeker)/directory/page.tsx`
- `src/app/(seeker)/map/page.tsx`

**What to do**:
1. **`aria-live` for search results count**: On both directory and map pages, add an `aria-live="polite"` region that announces the results count when search results change. Example: `<div aria-live="polite" className="sr-only">{total} services found</div>`.
2. **Focus management**: After search results load, focus should move to the results region (not the first card — just the container). Use a `ref` + `useEffect` to call `.focus()` on the results container when `results` state changes. Add `tabIndex={-1}` to the container so it can receive focus without being in tab order.

**Acceptance criteria**:
- Screen reader announces results count after each search.
- Focus moves to results container after search completes.
- No visual change from these additions (sr-only for live region).
- Tests cover: aria-live region present, content updates with results count.

---

## Files Exclusively Owned by Agent B

These files are created or modified ONLY by Agent B. Agent A must not touch them:

| File | Action |
|------|--------|
| `src/app/(seeker)/saved/page.tsx` | Modify |
| `src/app/(seeker)/profile/page.tsx` | Modify |
| `src/app/(seeker)/service/[id]/page.tsx` | Create |
| `src/app/(seeker)/directory/page.tsx` | Modify |
| `src/app/(seeker)/map/page.tsx` | Modify |
| `src/components/chat/ChatServiceCard.tsx` | Modify |
| `src/components/chat/ChatWindow.tsx` | Modify |
| `src/components/directory/ServiceCard.tsx` | Modify |
| `src/components/feedback/FeedbackForm.tsx` | Create |
| All `__tests__/` files for the above | Create/Modify |

---

## Dependency on Agent A

Agent B can run **in parallel** with Agent A. The integration strategy:

1. **Code against the contracts** defined in Agent A's workload (copied above).
2. **Graceful fallback**: every API call to `/api/services?ids=`, `/api/profile`, `/api/saved` must handle 401, 404, 500, and network errors by falling back to localStorage. This means Agent B's code compiles and functions even if Agent A's routes don't exist yet.
3. **No mocks of Agent A's internals**: Agent B treats the API as a black box. Fetch calls only.
4. **Integration test** (after both agents are done): manually verify saved page loads services by ID, profile syncs to server, feedback submits.

---

## Definition of Done

All of the following must pass before Agent B's work is complete:

- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npm run lint` — zero errors
- [ ] `npm run test` — all tests pass, including new tests
- [ ] `/saved` page fetches services by ID (not fetch-all-and-filter)
- [ ] `/profile` page syncs to server when authenticated, falls back to localStorage
- [ ] "Sign in" button links to auth, sign-out link appears when authenticated
- [ ] `<html lang="...">` reflects language preference
- [ ] `/service/[id]` page renders full service detail
- [ ] Service name links to detail page from directory/saved/chat cards
- [ ] Feedback form submits to `/api/feedback` with star rating, optional comment/contactSuccess
- [ ] Save button on `ChatServiceCard` works (localStorage + server best-effort)
- [ ] `aria-live` announces results count on directory and map pages
- [ ] Focus moves to results container after search
- [ ] No API route files or middleware files were modified
- [ ] `docs/ENGINEERING_LOG.md` updated with summary of UI changes
