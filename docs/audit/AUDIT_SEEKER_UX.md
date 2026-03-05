# ORAN Seeker Experience — Formal Internal Audit

**Date**: 2026-03-02
**Scope**: All seeker-facing pages, components, API routes, authentication boundaries, data model, and safety constraints
**Method**: Full source read of every relevant file; no assumptions from docs alone

---

## 1. Seeker Pages Inventory

| # | Route | Source File | Auth Required | Implementation Status |
|---|-------|------------|---------------|----------------------|
| 1 | `/` | `src/app/page.tsx` | No | **Implemented** — Landing page with CTAs to `/chat`, `/directory`, `/map` |
| 2 | `/chat` | `src/app/(seeker)/chat/page.tsx` | No | **Implemented** — Full chat UI with crisis detection, quota, service cards |
| 3 | `/directory` | `src/app/(seeker)/directory/page.tsx` | No | **Implemented** — Text search, pagination, confidence filter, save wiring |
| 4 | `/map` | `src/app/(seeker)/map/page.tsx` | No | **Implemented** — Text search + bbox (search-this-area), save wiring, debounced re-query |
| 5 | `/saved` | `src/app/(seeker)/saved/page.tsx` | Declared (`seeker`) but **not enforced** | **Partially implemented** — localStorage only, no server persistence |
| 6 | `/profile` | `src/app/(seeker)/profile/page.tsx` | Declared (`seeker`) but **not enforced** | **Partially implemented** — localStorage only, "Sign in" disabled |

**Missing seeker pages (no route exists)**:
- `/service/[id]` — No individual service detail page. Users see cards inline but cannot deep-link to a service.
- `/auth/signin`, `/auth/signout` — No sign-in/sign-out UI pages exist (the middleware would redirect to `/api/auth/signin` which depends on NextAuth.js provider config).

---

## 2. Seeker Flows (End-to-End)

### Flow A: Chat-based service discovery
1. User lands on `/` → clicks "Find services" → navigates to `/chat`
2. `sessionId` generated via `crypto.randomUUID()`, stored in `sessionStorage`
3. User types message → POST `/api/chat` with `{ message, sessionId }`
4. Pipeline: crisis detection → quota check → intent detection (keyword) → retrieval (SQL) → response assembly → optional LLM summary gate
5. Response rendered as `ChatServiceCard` components in chat bubble
6. **Where it breaks/degrades**:
   - No save button on `ChatServiceCard` — user cannot bookmark from chat
   - No feedback button — `/api/feedback` endpoint exists but the chat UI never calls it
   - No deep-link to full service detail
   - Quota is in-memory only — server restart resets all quotas
   - `_context` parameter in `retrieveServices` is **ignored**: no geo-filtering, no profile-based personalization despite the parameter being passed

### Flow B: Directory search
1. User navigates to `/directory` (via nav or landing page)
2. Types query → GET `/api/search?q=...&page=1&limit=10`
3. Results rendered as `ServiceCard` components with trust/match badges
4. Confidence filter: All / Likely (≥ 60) / High (≥ 80)
5. Pagination via page buttons
6. Save toggle: updates `localStorage` key `oran:saved-service-ids`
7. **Where it breaks/degrades**:
   - No category/taxonomy filter in UI (API supports `taxonomy` param but UI doesn't expose it)
   - No sort options (by distance, confidence, etc.)
   - No geo-based search from directory (no location input; geo-search only available on map page)

### Flow C: Map-based search
1. User navigates to `/map`
2. Text search → GET `/api/search?q=...`
3. Or "Search this area" → GET `/api/search?bbox=...` using map bounds
4. Results rendered as pins on `MapContainer` + list below
5. Debounced bbox re-query on pan (600ms)
6. Save toggle works same as directory (localStorage)
7. **Where it breaks/degrades**:
   - Location-based centering is opt-in only (device geolocation must be explicitly requested by the user and not stored)
   - No filter panel for taxonomy/confidence on map
   - No click-pin-to-see-detail interaction documented in `MapContainer` source

### Flow D: Viewing saved services
1. User navigates to `/saved`
2. Page reads `oran:saved-service-ids` from `localStorage` → array of service IDs
3. Fetches ALL active services via GET `/api/search?limit=100` → filters client-side by saved IDs
4. **Where it breaks**:
   - **No batch-by-ID API endpoint** — the page fetches up to 100 generic services and filters, which means if a saved service is not in the first 100 results, it will not appear. Code comment says: _"In production this would use a GET /api/services?ids=..."_
   - If `localStorage` is cleared (different browser, device, incognito), all saves are lost — no server-side persistence despite `saved_services` DB table existing
   - Auth is declared in middleware but not enforced (see Section 3)

### Flow E: Managing profile/preferences
1. User navigates to `/profile`
2. Reads `oran:preferences` from `localStorage` → `{ approximateCity?, language? }`
3. User can set approximate city (text input) and language (dropdown, 10 options)
4. Shows count of saved services from localStorage
5. "Delete all data" clears both `oran:preferences` and `oran:saved-service-ids`
6. **Where it breaks**:
   - "Sign in with Microsoft" button is `disabled` with "(coming soon)" label
   - No API routes to read/write `user_profiles` table — all preferences are localStorage only
   - Language preference is saved but **no i18n rendering** is wired: the UI is always English regardless of selection
   - No sync between client preferences and server-side profile

### Flow F: Feedback submission
1. **This flow does not exist in the UI.** POST `/api/feedback` accepts `{ serviceId, sessionId, rating, comment?, contactSuccess? }` and is rate-limited at 10/min.
2. No component in any seeker page triggers this endpoint.
3. The `feedback_form` feature flag is referenced in flag definitions but no UI checks it.

---

## 3. Authentication & Security Boundaries

### Middleware behavior (`src/middleware.ts`)

| Condition | Behavior |
|-----------|----------|
| Route not in `PROTECTED_ROUTES` | Pass through |
| `AZURE_AD_CLIENT_ID` not set + dev mode | **Pass through** — all protected routes accessible without auth |
| `AZURE_AD_CLIENT_ID` not set + production | Returns 503 |
| Cookie `next-auth.session-token` present | Pass through (no validation of token contents) |
| Cookie absent | Redirect to `/api/auth/signin?callbackUrl=...` |

### Critical gaps

1. **`minRole` is declared but never checked.** The `PROTECTED_ROUTES` array defines `minRole: 'seeker'` for `/saved` and `/profile`, `minRole: 'host_member'` for host routes, etc. **The middleware never reads this field.** Any authenticated user (regardless of role) can access any protected route.

2. **Session token is not validated.** The middleware checks for cookie *existence* only. It does not verify the token's signature, expiration, or extract any claims (including role). A forged or expired cookie would pass.

3. **Dev mode bypasses all auth.** When `AZURE_AD_CLIENT_ID` is unset (typical in dev), all protected routes — including host and admin routes — are fully accessible without any cookie.

4. **No CSRF protection** on state-changing API routes. `SECURITY_PRIVACY.md` marks this as "Planned."

5. **No sign-in / sign-out UI** exists. NextAuth.js routes (`/api/auth/signin`, etc.) may function if a provider is configured, but no seeker-visible sign-in page, session indicator, or sign-out button is rendered in the app.

### What IS enforced
- Rate limiting on `/api/chat` (20/min), `/api/search` (60/min), `/api/feedback` (10/min) — in-memory, per-IP
- Input validation via Zod on all three API routes
- Security headers in `next.config.mjs`: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` disabling camera/mic and allowing geolocation for same-origin opt-in flows

---

## 4. Seeker Profile → Data Model Mapping

### DB table: `user_profiles` (migration 0006)

| DB Column | Type | UI Field | Sync'd? |
|-----------|------|----------|---------|
| `user_id` | TEXT (Entra OID) | — | **No** — no sign-in flow |
| `display_name` | TEXT | — | **No** — not shown in profile UI |
| `preferred_locale` | TEXT | Language dropdown (10 options) | **No** — stored in localStorage only |
| `approximate_city` | TEXT | City text input | **No** — stored in localStorage only |
| `role` | TEXT | — | **No** — not shown or settable |
| `created_at` / `updated_at` | TIMESTAMPTZ | — | N/A |

### DB table: `saved_services` (migration 0011)

| DB Column | Type | UI Field | Sync'd? |
|-----------|------|----------|---------|
| `user_id` | UUID FK | — | **No** — no sign-in flow |
| `service_id` | UUID FK | Bookmark toggle | **No** — localStorage key `oran:saved-service-ids` |
| `notes` | TEXT | — | **No** — no UI for notes |
| `saved_at` | TIMESTAMPTZ | — | N/A |

### Summary
**Zero profile fields are synced server-side.** Both `user_profiles` and `saved_services` tables exist in the DB schema but have no corresponding API routes for seeker CRUD. All seeker state lives exclusively in `localStorage` / `sessionStorage`.

**Missing API routes needed for server-side profile**:
- `GET/PUT /api/profile` — read/write `user_profiles`
- `GET/POST/DELETE /api/saved` — CRUD `saved_services`

---

## 5. Mobile-First & UX Quality Audit

### Navigation: `AppNav` (`src/components/nav/AppNav.tsx`)
- 5 nav items: Chat, Directory, Map, Saved, Profile
- Mobile hamburger menu with `min-h-[44px]` / `min-w-[44px]` touch targets (meets WCAG 2.5.5)
- Route-aware active state via `usePathname()`
- Skip-to-content link on landing page
- **Gap**: Only shows seeker links — no role-adaptive navigation for host/admin users

### Page-level state coverage

| Page | Loading | Error | Empty | Results | Offline |
|------|---------|-------|-------|---------|---------|
| `/chat` | Skeleton (SSR) | Error display in ChatWindow | Initial prompt shown | Service cards in bubbles | Not handled |
| `/directory` | Spinner + "Searching…" | "Something went wrong" with retry | "No services found" | ServiceCard list | Not handled |
| `/map` | Spinner + "Searching…" | "Something went wrong" with retry | "No services found in this area" | Pins + list | Not handled |
| `/saved` | Spinner + "Loading…" | "Could not load details" fallback | "No saved services yet" with CTA to directory | ServiceCard list | Not handled |
| `/profile` | None needed (localStorage sync) | None (localStorage read can't fail) | Default empty state | Form fields populated | Not handled |

### Touch target compliance
- All buttons: Tailwind `p-2` or larger → ≥ 40px effective area
- Nav links: explicitly `min-h-[44px]`
- Phone links in ServiceCard: standard anchor, could be undersized (text-only)

### Responsive layout
- All pages use Tailwind responsive classes (`max-w-2xl mx-auto` patterns)
- ServiceCard: single-column card layout, no multi-column grid issues
- Map page: `h-[50vh]` for map + scrollable list below — functional on mobile but map could be cramped on small screens

### Accessibility observations
- `aria-label` on all interactive elements in ServiceCard, ChatWindow, nav
- `role="status"` on chat loading indicator
- `aria-live="polite"` on chat message list
- Eligibility disclaimer and crisis banner use semantic markup
- **Gap**: No focus management on route transitions. No `aria-live` region for search results count on directory/map pages.

---

## 6. LLM & Directory Safety Constraints

### Retrieval-first pipeline — confirmed

The chat pipeline in `src/services/chat/orchestrator.ts` implements an 8-stage pipeline. **No LLM participates in retrieval, ranking, or intent detection.** All three use keyword matching and SQL queries only.

| Stage | Method | LLM Involved? |
|-------|--------|---------------|
| 1. Crisis detection | Keyword match against `CRISIS_KEYWORDS` | No |
| 2. Quota check | In-memory counter | No |
| 3. Rate limit | IP-based sliding window | No |
| 4. Intent detection | Keyword frequency scoring across 9 categories | No |
| 5. Profile hydration | `assembleContext()` — reads sessionId/userId | No |
| 6. Service retrieval | SQL via `deps.retrieveServices()` | No |
| 7. Response assembly | Template-based message + `enrichedServiceToCard()` | No |
| 8. LLM summarization gate | Gated by `llm_summarize` flag (**default: false**) | **Only if flag enabled** |

### LLM summarization safety
- Feature flag `llm_summarize` defaults to `false` — LLM never called in current config
- If enabled, `deps.summarizeWithLLM` receives **only already-retrieved records** — cannot hallucinate new services
- LLM failure is non-fatal: catch block falls back to assembled template message
- `llmSummarized: boolean` flag is set on every response, making it auditable

### Crisis detection
- Keyword list in `CRISIS_KEYWORDS`: `suicide`, `kill myself`, `self-harm`, `hurt myself`, `end my life`, `overdose`, `abuse`, `domestic violence`, `assault`, `trafficking` (plus others)
- Crisis fires **before** quota check — never penalizes a crisis message
- Returns hard-coded resources: **911**, **988 Suicide & Crisis Lifeline**, **211**
- `ChatWindow` renders a persistent `CrisisBanner` once `isCrisis` is true — banner stays visible for remainder of session

### Eligibility safety
- `ELIGIBILITY_DISCLAIMER` constant shown on every chat response
- ServiceCard always renders: _"You may qualify for this service. Confirm eligibility with the provider before visiting."_
- ChatServiceCard always renders an eligibility hint line
- **Never says "you are eligible"** — always "may qualify"

### Gaps in safety
1. Crisis detection is keyword-only — no fuzzy matching, no synonym expansion. Indirect phrasing may be missed.
2. Intent detection has no "unknown" fallback — if no keywords match, category defaults to `general`, which searches broadly. This is safe (no harm) but may produce low-relevance results.
3. Quota is in-memory only — server restart resets all session quotas.

---

## 7. Gaps & Blockers

### Critical (blocking production readiness)

| # | Gap | Category | Detail |
|---|-----|----------|--------|
| G1 | **Middleware role enforcement is a no-op** | Architecture | `minRole` field declared but never evaluated. Any authenticated user accesses any protected route. |
| G2 | **Session token not validated** | Security | Middleware checks cookie existence only — no signature/expiry/claims verification. |
| G3 | **Saved services fetch-all-and-filter** | Data/Perf | `/saved` page fetches first 100 services from `/api/search` and filters client-side. Saved services beyond page 1 are silently lost. No `GET /api/services?ids=...` endpoint exists. |
| G4 | **No sign-in/sign-out flow** | Architecture | "Sign in" button is disabled. No NextAuth.js provider configuration or sign-in UI page exists. Prerequisite for any server-side profile/saves. |

### High (significant UX gaps)

| # | Gap | Category | Detail |
|---|-----|----------|--------|
| G5 | **No server-side profile persistence** | Data | `user_profiles` DB table exists but no API routes. All prefs in localStorage — lost on device/browser switch. |
| G6 | **No server-side saved services** | Data | `saved_services` DB table exists but no API routes. Same localStorage limitation. |
| G7 | **No feedback UI** | UX | POST `/api/feedback` exists and works. Zero UI elements in any page call it. `feedback_form` feature flag unused. |
| G8 | **No individual service detail page** | UX | No `/service/[id]` route. Users cannot deep-link to or share a specific service. |
| G9 | **Language preference has no effect** | UX | Profile page saves language to localStorage but the entire UI renders in English only. No i18n wiring. |

### Medium (functional but incomplete)

| # | Gap | Category | Detail |
|---|-----|----------|--------|
| G10 | Chat doesn't use profile context | Data | `_context` param in `retrieveServices` is accepted but ignored — no geo/locale/preference filtering. |
| G11 | Chat quota not persisted | Architecture | In-memory `Map<string, {count, lastSeen}>`. Server restart = quota reset. |
| G12 | No save from chat | UX | `ChatServiceCard` has no bookmark button — user must find the same service in directory/map to save. |
| G13 | No offline/PWA support | UX | No service worker, no offline fallback on any page. |
| G14 | No taxonomy/sort filters on directory | UX | API supports `taxonomy` param and multiple sort strategies, but the UI exposes only text search + confidence filter. |

---

## 8. Definition of Done — Seeker UX Checklist

### Pages & Navigation
- [x] Landing page with primary CTA to chat, secondary to directory/map
- [x] Chat page — functional, no auth required
- [x] Directory page — search, pagination, confidence filter, save
- [x] Map page — text search, bbox search, save, pin display
- [x] Saved page — basic display of saved services
- [x] Profile page — basic preferences form
- [ ] **Service detail page** (`/service/[id]`) — does not exist
- [x] Global nav with 5 seeker links, mobile hamburger, active states
- [ ] **Role-adaptive navigation** — nav only shows seeker links regardless of role

### Authentication & Authorization
- [ ] **Sign-in flow** — button exists but is disabled; no provider configured
- [ ] **Sign-out flow** — no UI element
- [ ] **Session indicator** — no visual indication of signed-in state
- [ ] **Role enforcement in middleware** — `minRole` declared but not evaluated
- [ ] **Session token validation** — cookie existence only, no verification
- [x] Rate limiting on all seeker API routes
- [x] Input validation (Zod) on all seeker API routes
- [x] Security headers configured

### Data Persistence
- [ ] **Server-side profile read/write** — DB table exists, no API
- [ ] **Server-side saved services** — DB table exists, no API
- [ ] **Batch service fetch by IDs** — `/saved` page uses workaround
- [x] localStorage fallback for profile preferences
- [x] localStorage fallback for saved service IDs

### Chat Pipeline
- [x] Crisis detection with 911/988/211 routing
- [x] Crisis banner persists in UI once triggered
- [x] Quota enforcement (50 messages/session, in-memory)
- [x] Intent detection (9 categories, keyword-based)
- [x] Retrieval-first — no LLM in search/rank
- [x] LLM summarization gated by feature flag (default off)
- [x] LLM failure is non-fatal (fallback to template)
- [x] `llmSummarized` audit flag on every response
- [x] Eligibility disclaimer on every response
- [ ] **Profile-based personalization in retrieval** — context param ignored
- [ ] **Persistent quota** — in-memory only

### Safety & Compliance
- [x] Never guarantees eligibility — "may qualify" language everywhere
- [x] No PII stored in telemetry
- [x] No browser GPS requested without explicit user action
- [x] Approximate location only; device geolocation rounded (~1km) if user opts in
- [x] Crisis detection fires before quota (never rate-limited)
- [ ] **Consent gates** — documented in SECURITY_PRIVACY.md but not implemented
- [ ] **Cookie consent banner** — not implemented
- [x] Location consent flow (map) — explicit opt-in; in-session only; not stored

### UX Quality
- [x] Loading states on all async pages
- [x] Error states with retry on directory/map
- [x] Empty states with guidance on all pages
- [x] 44px touch targets on nav
- [x] `aria-label` on interactive elements
- [x] `aria-live` on chat message list
- [ ] **Focus management on route transitions**
- [ ] **`aria-live` for search results count** changes
- [ ] **Feedback UI** — no form or button exists
- [ ] **Offline fallback** — no service worker

---

**Summary**: The seeker UX has a solid foundation — all 5 primary pages render, the chat pipeline is retrieval-first with proper safety rails, and edge states (loading/error/empty) are covered. The critical blockers are: (1) authentication is structurally present but functionally inert (no role enforcement, no token validation, no sign-in UI), (2) all user state is localStorage-only despite DB tables existing, (3) the saved-services page uses a fundamentally broken fetch pattern, and (4) there is no feedback UI despite the backend being ready.
