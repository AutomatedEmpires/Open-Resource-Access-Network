# AGENT SKY — Activation Prompt

**Role:** Senior UI/Performance/Accessibility Engineer
**Mission:** Systematically execute every improvement task in this document. Work in priority order. Each task includes a timestamp indicating when it was identified, the exact problem, exact files to change, measurable definition of done, and any constraints.

**Timestamp key:** Times are in UTC. `[OMEGA-2026-03-03]` = identified by Agent OMEGA. `[VALID-2026-03-03]` = discovered during objective validation run.

---

## BEFORE YOU START — Required Reading (in order)

You MUST read these before touching any file:

1. `docs/SSOT.md` — ORAN system of record hierarchy
2. `docs/ui/UI_UX_CONTRACT.md` — non-negotiable UI standards (MUST / SHOULD / MAY)
3. `docs/ui/UI_UX_TOKENS.md` — spacing, typography, color semantic tokens
4. `docs/SECURITY_PRIVACY.md` — what must never happen (PII, GPS, hallucination)
5. `docs/governance/OPERATING_MODEL.md` — how changes are validated before shipping
6. `.github/copilot-instructions.md` — the 6 non-negotiables that can never break
7. `src/components/ui/README.md` — existing component API
8. `src/app/globals.css` — CSS custom properties and global rules

**Architecture map:**

- Seeker pages: `src/app/(seeker)/`
- Admin pages: `src/app/(oran-admin)/`, `src/app/(community-admin)/`, `src/app/(host)/`
- Shared UI primitives: `src/components/ui/`
- Domain types: `src/domain/types.ts`
- Design tokens doc: `docs/ui/UI_UX_TOKENS.md`

**Validation commands to run after every task:**

```bash
npx tsc --noEmit             # must produce 0 errors in src/ (test files excluded)
npm run lint                 # must produce 0 new errors
npm run test                 # 788+ passing, 0 new failures
```

---

## CRITICAL BUGS — Fix These First (Blockers)

### BUG-1 · Production Build Broken [VALID-2026-03-03]

**Severity:** 🚨 P0 — no deployment is possible
**Evidence:** `npm run build` fails with Turbopack error:

```
Module not found: Can't resolve <dynamic>
  diagnostic-channel-publishers/dist/src/mysql.pub.js
  ↳ applicationinsights → src/instrumentation.ts
```

**Root cause:** The `applicationinsights` package (Azure Monitor SDK v3) contains a MySQL diagnostics publisher that uses `require(path.dirname(...) + "/lib/Connection")` — a dynamic `require()` that Turbopack cannot statically analyze.

**Also present:** `@sentry/nextjs` dynamic import in `src/services/telemetry/sentry.ts:106` resolves to a warning.

**Fix instructions:**

1. Open `next.config.mjs`.
2. Add `serverExternalPackages: ['applicationinsights', 'diagnostic-channel-publishers']` to the Next.js config object. This tells Next.js to treat these as external Node.js packages (not bundled by Turbopack), which allows the dynamic `require()` calls to work normally at runtime.
3. Example:

   ```js
   const nextConfig = {
     output: 'standalone',
     serverExternalPackages: ['applicationinsights', 'diagnostic-channel-publishers'],
     // ... rest of config
   };
   ```

4. Run `npm run build` and confirm it succeeds with bundle size output.
5. After build succeeds — record the ACTUAL bundle sizes in `docs/agents/status/STATUS_OMEGA.md` (replacing the fabricated numbers).

**Definition of Done:** `npm run build` exits 0. Route bundle sizes appear in build output.

---

### BUG-2 · `middleware.ts` File Convention Deprecated [VALID-2026-03-03]

**Severity:** 🟡 P1 — Next.js 16.1.6 prints warning on every build
**Evidence:** Build output: `"The 'middleware' file convention is deprecated. Please use 'proxy' instead."`
**File:** `src/middleware.ts`

**Fix instructions:**

1. Rename `src/middleware.ts` → `src/proxy.ts`
2. The exported function name stays `middleware` (only the filename changes per Next.js docs)
3. Update `src/__tests__/middleware.test.ts` import path to match new filename
4. Run `npm run test` to confirm tests still pass

**Definition of Done:** Build output no longer contains the deprecation warning.

---

### BUG-3 · 3 TypeScript Errors in Test Files [VALID-2026-03-03]

**Severity:** 🟡 P1 — `npx tsc --noEmit` reports 3 errors
**Evidence:**

```
src/services/auth/__tests__/session.test.ts(26,10): error TS2704
  The operand of a 'delete' operator cannot be a read-only property.
src/services/auth/__tests__/session.test.ts(146,17): error TS2540
  Cannot assign to 'NODE_ENV' because it is a read-only property.
src/services/auth/__tests__/session.test.ts(153,17): error TS2540
  Cannot assign to 'NODE_ENV' because it is a read-only property.
```

**File:** `src/services/auth/__tests__/session.test.ts` lines 26, 146, 153
**Root cause:** Test is mutating `process.env.NODE_ENV` directly, which TypeScript strict mode forbids.

**Fix instructions:**

1. Open `src/services/auth/__tests__/session.test.ts`
2. Replace direct `process.env.NODE_ENV = 'production'` assignments with:

   ```ts
   Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', writable: true, configurable: true });
   ```

   Or use `vi.stubEnv('NODE_ENV', 'production')` (Vitest's official API for stubbing env vars)
3. For the `delete` operator issue on line 26, replace `delete process.env.SOME_KEY` with `process.env.SOME_KEY = undefined` cast or use `vi.unstubAllEnvs()` in afterEach
4. Run `npx tsc --noEmit` and confirm 0 errors

**Definition of Done:** `npx tsc --noEmit` exits 0 with zero error lines.

---

### BUG-4 · Real WCAG 2.5.5 Violations Found (Touch Target < 44px) [VALID-2026-03-03]

**Severity:** 🟠 P1 — contradicts ORAN's WCAG AA commitment
**Evidence (grep-verified):**

| File | Line | Issue |
|------|------|-------|
| `src/components/chat/ChatServiceCard.tsx` | 76 | `min-w-[32px] min-h-[32px]` — save button, below 44px |
| `src/app/(seeker)/directory/DirectoryPageClient.tsx` | 338 | `min-h-[32px]` — sort select |

**Fix instructions:**

For `ChatServiceCard.tsx` line 76:

- Change `min-w-[32px] min-h-[32px]` → `min-w-[44px] min-h-[44px]`

For `DirectoryPageClient.tsx` line 338 (sort select):

- This is a styled `<select>` input — inputs are not tap targets in the same sense (they expand on tap), so `min-h-[32px]` is acceptable for a select element within a dense filter panel
- HOWEVER: mark this as a documented exception in `docs/ui/UI_UX_TOKENS.md` with justification
- Add a comment in the JSX: `{/* select inputs: min-h-[32px] is acceptable per UI_UX_TOKENS.md §select-exception */}`

**Definition of Done:**

- `ChatServiceCard.tsx` save button is 44×44px minimum
- Exception documented for sort select

---

## TASK LIST — Ordered by Priority

---

### TASK-01 · Wire axe into Tests — A11y Gate [OMEGA-2026-03-03] [VALID-2026-03-03]

**Priority:** P0
**Why:** `axe-core`, `vitest-axe`, `@axe-core/react` are installed as dependencies but are NEVER called in any test file. Currently zero automated a11y verification exists. All accessibility claims in STATUS_OMEGA.md are unvalidated.

**Exact files to create / modify:**

1. **Create** `src/components/ui/__tests__/a11y.test.tsx`
   - Import `configureAxe` from `vitest-axe` and `render` from `@testing-library/react`
   - Write axe tests covering:
     - `<Button>` all variants
     - `<Badge>` with each confidence band
     - `<ErrorBoundary>` fallback (use `getDerivedStateFromError` to force it)
     - `<Skeleton>` and `<SkeletonCard>`
     - `<Dialog>` open state
   - Each test: render component, call `await axe(container)`, `expect(results).toHaveNoViolations()`

2. **Create** `src/components/directory/__tests__/service-card-a11y.test.tsx`
   - Render `<ServiceCard>` with a factory `EnrichedService` (copy the factory from `ui-contracts.test.ts`)
   - Run axe scan
   - Test both compact=false and compact=true modes

3. **Modify** `src/app/(seeker)/__tests__/wrapper-pages.test.tsx`
   - Add a render + axe scan for the static portion of each page wrapper

**Setup required:**

```ts
// vitest.setup.ts (or vitest.config.ts setupFiles)
import { configureAxe } from 'vitest-axe';
const axe = configureAxe({
  rules: {
    // Allow WCAG 2.1 AA rules only
  }
});
expect.extend({ toHaveNoViolations: axe.toHaveNoViolations });
```

**Definition of Done:**

- `npm run test` includes axe scan results
- If any violation is found, the test FAILS (build breaks)
- Zero violations in all covered components

---

### TASK-02 · Dark Mode (Token-Based) [OMEGA-2026-03-03]

**Priority:** P1
**Constraint:** Must NOT use arbitrary color overrides. All dark mode colors must be CSS custom properties defined in `src/app/globals.css`. No `dark:bg-[#1a1a1a]` arbitrary values.

**Architecture:**
Use Tailwind v4's `@variant dark` with `class` strategy (toggle `dark` class on `<html>`). Do NOT use `prefers-color-scheme` only — the user must be able to toggle in-app from the Profile page.

**Files to change:**

1. **`src/app/globals.css`**
   - Add dark mode tokens under a `[data-theme="dark"]` or `.dark` selector:

     ```css
     :root {
       --bg-page: #f9fafb;        /* gray-50 */
       --bg-surface: #ffffff;     /* white */
       --bg-surface-raised: #ffffff;
       --border: #e5e7eb;         /* gray-200 */
       --text-primary: #111827;   /* gray-900 */
       --text-secondary: #4b5563; /* gray-600 */
       --text-muted: #6b7280;     /* gray-500 */
       --ring: #2563eb;           /* blue-600 */
     }
     .dark {
       --bg-page: #0f172a;        /* slate-900 */
       --bg-surface: #1e293b;     /* slate-800 */
       --bg-surface-raised: #293548;
       --border: #334155;         /* slate-700 */
       --text-primary: #f1f5f9;   /* slate-100 */
       --text-secondary: #94a3b8; /* slate-400 */
       --text-muted: #64748b;     /* slate-500 */
       --ring: #60a5fa;           /* blue-400 */
     }
     ```

   - Crisis red must remain highly visible in dark mode: keep `bg-red-700`

2. **`src/components/ui/button.tsx`**, **`badge.tsx`**, **`skeleton.tsx`**, **`dialog.tsx`**, **`error-boundary.tsx`**
   - Replace hard-coded `bg-white`, `bg-gray-50`, `border-gray-200`, `text-gray-900` etc. with CSS variable references: `bg-[var(--bg-surface)]`, `text-[var(--text-primary)]` etc.
   - Use Tailwind's `dark:` prefix sparingly and only when CSS vars aren't cleaner

3. **`src/app/(seeker)/layout.tsx`**
   - Top bar: `bg-white border-gray-200` → `bg-[var(--bg-surface)] border-[var(--border)]`

4. **`src/app/(seeker)/profile/ProfilePageClient.tsx`**
   - Add dark mode toggle to the Profile page in a new section "Display":

     ```tsx
     <section ...>
       <h2>Display</h2>
       <button onClick={toggleDarkMode}>
         {isDark ? 'Switch to Light' : 'Switch to Dark'}
       </button>
     </section>
     ```

   - Persist choice in `localStorage` under `oran:preferences.theme`
   - On mount: read pref and apply `document.documentElement.classList.toggle('dark', isDark)`

5. **`src/app/layout.tsx`**
   - Add `suppressHydrationWarning` to `<html>` (required when toggling dark class server vs client)

**DO NOT touch:** Crisis banners (must stay `bg-red-700` in all themes)

**Definition of Done:**

- Toggle in Profile page works
- Preference persists across browser sessions
- All seeker surfaces readable in dark mode
- `npx tsc --noEmit` clean
- All tests pass

---

### TASK-03 · Lazy-Load Azure Maps SDK [OMEGA-2026-03-03]

**Priority:** P1
**Why:** Azure Maps SDK (~220 kB) is bundled into the Map page initial JS. This is the single largest client-side load cost, and it blocks FCP on `/map`.

**Files to change:**

1. **`src/components/map/MapContainer.tsx`**
   - This is already a `'use client'` component — add dynamic import of the SDK:

     ```tsx
     'use client';
     import dynamic from 'next/dynamic';
     // Move all azure-maps-control imports inside a useEffect or lazy import
     // Option A: entire MapContainer behind next/dynamic from parent
     // Option B: lazy import atlas inside MapContainer's useEffect
     ```

   - Recommended approach: In `src/app/(seeker)/map/MapPageClient.tsx`, wrap MapContainer in `next/dynamic`:

     ```tsx
     const MapContainer = dynamic(() => import('@/components/map/MapContainer'), {
       ssr: false,
       loading: () => <div className="w-full h-[60vh] rounded-lg bg-gray-100 animate-pulse flex items-center justify-center text-gray-400 text-sm">Loading map…</div>,
     });
     ```

   - This delays SDK loading until the Map page is actually visited

2. **`src/app/(seeker)/map/MapPageClient.tsx`**
   - Replace static import of `MapContainer` with the dynamic import above
   - The `loading` prop provides a skeleton during SDK initialization

**Definition of Done:**

- `/map` page builds and the Azure Maps JS is in a separate chunk, not the page's First Load JS
- Bundle size for `/map` first load is visibly smaller in `npm run build` output
- Map still renders and functions identically after lazy loading

---

### TASK-04 · Formalize Z-Index Scale [OMEGA-2026-03-03]

**Priority:** P2
**Current state:** Z-index values are ad-hoc across the codebase:

- `z-40` — top bar, bottom nav
- `z-40` — mobile nav
- `z-50` — modals/dialogs
- `z-[100]` — skip link (arbitrary)

**Files to change:**

1. **`src/app/globals.css`**
   Add named z-index layer CSS vars:

   ```css
   :root {
     --z-skip-link: 100;
     --z-modal: 50;
     --z-nav: 40;
     --z-sticky: 30;
     --z-elevated: 20;
     --z-base: 0;
   }
   ```

2. **`docs/ui/UI_UX_TOKENS.md`**
   Add a section §9 Z-Index Scale documenting these layers.

3. **Replace usages** across:
   - `src/app/(seeker)/layout.tsx` (nav bars)
   - `src/app/layout.tsx` (skip link)
   - Any dialog overlays
   → Replace `z-40`, `z-50`, `z-[100]` with `z-[var(--z-nav)]` etc.

**Definition of Done:**

- All z-index values reference named CSS vars
- Docs updated
- No `z-[100]` or other arbitrary z-index values remain except where semantically clearest

---

### TASK-05 · Infinite Scroll with URL-State Preservation [OMEGA-2026-03-03]

**Priority:** P1
**Why:** Directory pagination uses Prev/Next buttons. Mobile best practice is infinite scroll (no button hunting). Must preserve URL state for shareability.

**File:** `src/app/(seeker)/directory/DirectoryPageClient.tsx`

**Implementation approach:**

1. Add an `IntersectionObserver` that watches a sentinel `<div>` placed after the last result card
2. When sentinel becomes visible AND `data.hasMore` is true AND not loading → auto-fetch next page and append results (do NOT replace, append)
3. Keep URL state synced: `pushUrlState` should update `page` param as user scrolls
4. Preserve ability to land at a page mid-scroll (if URL has `?page=5`, pre-fetch pages 1–5 in order on mount)
5. Keep the explicit Prev/Next buttons as fallback (hidden only when `data.hasMore` is false and not on first page, for progressive enhancement)
6. Add `aria-live="polite"` to results container — screen readers announce "Loading more results" when fetch starts

**Definition of Done:**

- Scrolling to bottom of results auto-loads next page
- URL `page` param increments as user scrolls
- Deep links with `?page=3` work
- No regression in existing filter + sort behavior
- All previous tests pass

---

### TASK-06 · Keyboard Navigation for Map Page [OMEGA-2026-03-03]

**Priority:** P1
**File:** `src/components/map/MapContainer.tsx`

**Problem:** Azure Maps SDK provides no native keyboard navigation for map canvas (arrow keys don't pan, +/- don't zoom). This is a WCAG 2.1.1 partial failure (the map canvas is the main feature of the map page but inaccessible to keyboard users — mitigated only by the results list below).

**Implementation:**

1. Add a keyboard shortcut handler on the map container `<div>`:
   - Arrow keys → `map.setCamera({ center: [lng ± delta, lat ± delta] })`
   - `+` / `-` → `map.setCamera({ zoom: zoom ± 1 })`
   - `R` → reset to initial view
2. Add an accessible hint panel:

   ```tsx
   <p className="text-xs text-gray-500 mt-1">
     Keyboard: Arrow keys to pan, + / - to zoom.
     <a href="#map-results" className="underline">Skip to results</a>
   </p>
   ```

3. Add `role="application"` and `aria-label="Interactive service map"` to the map div — informs screen readers this is a live interactive region
4. Add `tabIndex={0}` to map div so it receives keyboard focus

**Definition of Done:**

- Arrow keys pan the map
- `+/-` keys zoom
- Hint text visible below map
- "Skip to results" link works
- `role="application"` and `aria-label` present on map container

---

### TASK-07 · Command Palette (⌘K / Ctrl+K) [OMEGA-2026-03-03]

**Priority:** P2
**Scope:** Seeker surfaces only. No admin commands.

**Files:**

1. **Create** `src/components/command/CommandPalette.tsx`
   - Built on `<Dialog>` from `src/components/ui/dialog.tsx`
   - Opens on `⌘K` (Mac) or `Ctrl+K` (Windows/Linux), closes on `Esc`
   - Contains:
     - A text input with autofocus
     - Keyboard-navigable list of commands (arrow keys, Enter to select)
   - Commands in v1:
     - "Search services" → focuses Directory search input
     - "Go to Chat" → `router.push('/chat')`
     - "Go to Map" → `router.push('/map')`
     - "Go to Saved" → `router.push('/saved')`
     - "Go to Profile" → `router.push('/profile')`
     - "Open Directory" → `router.push('/directory')`
   - Commands MUST NOT include any admin or authenticated-only actions

2. **Modify** `src/app/(seeker)/layout.tsx`
   - Add `<CommandPalette />` to the layout shell (before `{children}`)
   - Add keyboard listener for `⌘K`/`Ctrl+K` that opens the palette

**Accessibility:**

- Dialog must trap focus
- `aria-label="Command palette"` on the dialog
- `role="option"` on each command item
- `aria-activedescendant` tracks which is highlighted

**Definition of Done:**

- `⌘K` / `Ctrl+K` opens palette in seeker layout
- Keyboard navigation works (Up/Down/Enter/Esc)
- Screen reader announces options correctly
- No performance regression (dialog is not in DOM until opened)

---

### TASK-08 · Visual Regression Suite (Playwright + Screenshots) [OMEGA-2026-03-03]

**Priority:** P1
**Why:** There is zero visual regression coverage. Color changes, layout shifts, or component regressions can ship silently.

**Setup:**

1. Install: `npm install --save-dev @playwright/test`
2. Run: `npx playwright install chromium` (CI: add to devcontainer or CI workflow)

**Create** `playwright/` directory with:

```
playwright/
  visual/
    landing.spec.ts
    chat.spec.ts
    directory.spec.ts
    map.spec.ts
    service-detail.spec.ts
    saved.spec.ts
    profile.spec.ts
  playwright.config.ts
```

**Each spec:**

```ts
import { test, expect } from '@playwright/test';
test('landing page visual', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveScreenshot('landing.png', { fullPage: true });
});
```

**`playwright.config.ts`:**

- Snapshot update command: `npx playwright test --update-snapshots`
- Viewports to test: 390px (mobile), 768px (tablet), 1440px (desktop)
- Store snapshots in `playwright/snapshots/`

**GitHub Actions:**

- Create `.github/workflows/visual-regression.yml`
- Run on: `push` to any branch, PRs
- Upload diff artifacts on failure

**Definition of Done:**

- `npx playwright test` runs successfully
- Baseline screenshots committed to repo
- CI workflow defined

---

### TASK-09 · Automated A11y CI Gate [OMEGA-2026-03-03]

**Priority:** P0
**Why:** Zero automated accessibility checks in CI. The build will happily ship WCAG violations.

**Files to create:**

1. **`.github/workflows/a11y.yml`**

   ```yaml
   name: Accessibility Gate
   on: [push, pull_request]
   jobs:
     a11y:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - run: npm ci
         - run: npm run test -- --reporter=verbose src/components/ui/__tests__/a11y.test.tsx
   ```

2. **Vitest config** — ensure `vitest-axe` is configured in `vitest.config.ts`:

   ```ts
   setupFiles: ['./vitest.setup.ts']
   ```

3. **`vitest.setup.ts`** (create if not exists):

   ```ts
   import { configureAxe, toHaveNoViolations } from 'vitest-axe';
   import { expect } from 'vitest';

   const axe = configureAxe();
   expect.extend({ toHaveNoViolations });
   ```

**Definition of Done:**

- CI fails if any axe violation is introduced
- All existing components pass the gate

---

### TASK-10 · Performance Budget Enforcement [OMEGA-2026-03-03]

**Priority:** P1
**Why:** Bundle sizes were fabricated in the audit report because the build was broken. After fixing BUG-1, real budgets must be enforced.

**Budgets (set after real build output is measured):**
Suggested starting points based on Next.js best practices:

- Landing page First Load JS: ≤ 100 kB
- Chat page First Load JS: ≤ 160 kB
- Directory page First Load JS: ≤ 160 kB
- Map page First Load JS: ≤ 120 kB (after TASK-03 lazy-loads Azure Maps)

**Files to create:**

1. **`.bundlesize.json`** (using `bundlesize` npm package) OR use Next.js built-in:
   - Add to `next.config.mjs`:

     ```js
     experimental: {
       bundlePagesRouterDependencies: true,
     }
     ```

   - Alternatively, create `scripts/check-bundle-sizes.js` that parses `.next/build-manifest.json` and fails if any seeker route exceeds budget

2. **`.github/workflows/bundle-size.yml`**
   - Run `npm run build` and parse output
   - Fail job if any route exceeds budget

**Definition of Done:**

- Budget check runs in CI
- Failing build if route exceeds budget
- Real budgets committed to config after BUG-1 is resolved

---

### TASK-11 · UI Telemetry for Interaction Friction (Privacy-Safe) [OMEGA-2026-03-03]

**Priority:** P2
**Constraints from `docs/SECURITY_PRIVACY.md`:**

- NO PII in telemetry (no user IDs, no search queries, no service names)
- Only anonymous, aggregated interaction signals
- Must be gated behind a feature flag

**What to track:**

- Page views (route only, no query params)
- "Search submitted" event (no query text, just that a search happened)
- "Crisis banner shown" event (critical for safety monitoring)
- "Service saved" event (count only)
- "Filter applied" event (filter type only, not value)
- "Feedback submitted" event (no content)

**Files to change:**

1. **`src/services/flags/`** — add feature flag `telemetry_interactions` (off by default in dev)

2. **`src/services/telemetry/sentry.ts`** — add `trackInteraction(event: string, properties?: Record<string, string | number>)` function
   - Strip any potentially PII-bearing properties before sending
   - Send to Application Insights `trackEvent` (if available), otherwise no-op
   - Always check feature flag before sending

3. **Wire into seeker pages:**
   - `ChatWindow.tsx` → `trackInteraction('chat_message_sent')` on submit
   - `DirectoryPageClient.tsx` → `trackInteraction('search_submitted')` on form submit; `trackInteraction('filter_applied', { filter: 'confidence' })` etc.
   - `CrisisBanner` → `trackInteraction('crisis_banner_shown')` on mount

**Definition of Done:**

- Feature flag gates all telemetry
- No PII in any tracked event
- Application Insights receives events in production (when APPLICATIONINSIGHTS_CONNECTION_STRING is set)
- Tests confirm no PII is tracked (inspect the trackEvent call args)

---

### TASK-12 · Print Stylesheet for Service Detail [OMEGA-2026-03-03]

**Priority:** P3
**Why:** Service seekers may want to print a service record to take with them (no smartphone, paper reference).

**File:** `src/app/globals.css`

Add print media query:

```css
@media print {
  /* Hide navigation, bottom nav, skip links, feedback buttons */
  header, nav, footer, [aria-label="Mobile navigation"],
  .print-hide, button[type="button"] { display: none !important; }

  /* Ensure full-width content */
  .container { max-width: 100% !important; padding: 0 !important; }

  /* Eligibility disclaimer stays prominent */
  .print-disclaimer { font-weight: bold; border: 2px solid #000; }

  /* Service card borders visible in print */
  article { border: 1px solid #000 !important; page-break-inside: avoid; }

  /* URLs visible for tel: and href links */
  a[href^="tel:"]::after { content: " (" attr(href) ")"; }
}
```

Add `print-hide` class to:

- Navigation chrome (`src/app/(seeker)/layout.tsx`)
- Pagination buttons
- "Give feedback" button in `ServiceCard.tsx`

Add `print-disclaimer` class to the eligibility disclaimer paragraph in `ServiceCard.tsx`.

**Definition of Done:**

- Service detail page prints cleanly (no nav chrome)
- Phone number shows as text after the link
- Eligibility disclaimer is prominent in print

---

### TASK-13 · Design Token Enforcement via ESLint Rule [OMEGA-2026-03-03]

**Priority:** P2
**Why:** Nothing prevents future developers from using arbitrary Tailwind values that drift from the token system.

**Approach:**

1. Install `eslint-plugin-tailwindcss`:

   ```bash
   npm install --save-dev eslint-plugin-tailwindcss
   ```

2. Configure in `eslint.config.mjs`:

   ```js
   import tailwindPlugin from 'eslint-plugin-tailwindcss';
   // add to rules:
   'tailwindcss/no-arbitrary-value': ['warn', {
     ignore: [
       'min-h-\\[44px\\]', 'min-w-\\[44px\\]', // a11y targets (approved)
       'h-\\[60vh\\]', 'max-h-\\[85vh\\]',       // viewport heights (approved)
       'max-w-\\[120px\\]', 'max-w-\\[180px\\]', // truncation (approved)
       'z-\\[100\\]',                              // skip link (approved)
     ]
   }]
   ```

3. Document the approved exceptions list in `docs/ui/UI_UX_TOKENS.md` §8 "Approved Arbitrary Values".

**Definition of Done:**

- New arbitrary values in PRs trigger ESLint warnings
- All existing approved values are in the ignore list
- `npm run lint` still exits 0 on current codebase

---

### TASK-14 · Reduced-Motion Micro-Interaction Layer [OMEGA-2026-03-03]

**Priority:** P2
**Why:** The audit noted "minimal animations" as good, but that currently means ZERO delightful motion. A proper reduced-motion layer means: full motion for users who want it, zero motion for users who have `prefers-reduced-motion: reduce`.

**Files:**

1. **`src/app/globals.css`** — add motion tokens:

   ```css
   :root {
     --transition-fast: 150ms ease;
     --transition-standard: 250ms ease;
     --transition-slow: 400ms ease;
   }
   @media (prefers-reduced-motion: reduce) {
     :root {
       --transition-fast: 0ms;
       --transition-standard: 0ms;
       --transition-slow: 0ms;
     }
   }
   ```

2. **`src/components/ui/button.tsx`** — add `transition-[var(--transition-fast)]` to variants

3. **`src/app/(seeker)/layout.tsx`** — add slide-in animation on page transitions:
   - Use `transition-opacity duration-[var(--transition-standard)]` on main content

4. **`src/components/directory/ServiceCard.tsx`** — add card entrance animation:

   ```css
   @keyframes card-enter {
     from { opacity: 0; transform: translateY(4px); }
     to { opacity: 1; transform: translateY(0); }
   }
   /* motion-safe: only play if user hasn't requested reduced motion */
   .card-enter { animation: card-enter var(--transition-standard) both; }
   ```

**DO NOT add motion to:** Crisis banners, error states, loading skeletons (intentionally visible immediately).

**Definition of Done:**

- Motion present for users without `prefers-reduced-motion`
- Instant for users with `prefers-reduced-motion: reduce`
- Sentry/telemetry emit no new errors

---

### TASK-15 · UI Consistency Drift Detector [OMEGA-2026-03-03]

**Priority:** P3
**Why:** As the codebase grows, components may be re-implemented ad-hoc rather than using the shared system.

**Implementation:**

1. **Create** `scripts/audit-ui-consistency.ts`
   - Scan `src/app/**/*.tsx` for patterns that should use shared components but don't:
     - `<button` that doesn't import from `@/components/ui/button` → report as drift
     - `className.*bg-blue` or `className.*bg-red` that aren't on the approved palette → report
     - `<input` elements without an associated label or `aria-label` → report
   - Output a markdown summary of findings

2. **`package.json`** — add script:

   ```json
   "audit:ui": "npx ts-node scripts/audit-ui-consistency.ts"
   ```

3. **Run in CI** (optional, non-blocking in v1 — report only):

   ```yaml
   - run: npm run audit:ui >> $GITHUB_STEP_SUMMARY
   ```

**Definition of Done:**

- Script runs without crashing
- Reports all drift accurately
- CI step uploads summary to GitHub Actions

---

### TASK-16 · Full Audit of Un-Audited Admin Surfaces [VALID-2026-03-03]

**Priority:** P1
**Context:** The OMEGA audit explicitly covered only the `(seeker)` route group. These surfaces have NEVER been audited:

| Surface | Route Group | Files |
|---------|-------------|-------|
| ORAN Admin dashboard | `src/app/(oran-admin)/` | approvals, audit, rules, zone-management |
| Community Admin dashboard | `src/app/(community-admin)/` | coverage, queue, verify |
| Host portal | `src/app/(host)/` | admins, claim, locations, org, services |
| Shared authenticated layout | `src/app/(oran-admin)/layout.tsx`, etc. | |

**What to audit for each:**

1. Does every page have exactly one `<h1>`?
2. Do all forms have proper `<label>` or `aria-label`?
3. Are all data tables using `<th scope="col">` and `<caption>`?
4. Do all icon-only buttons have `aria-label`?
5. Is there a `<main>` landmark on every page?
6. Are all modals/dialogs using the shared `<Dialog>` component?
7. Do all interactive elements meet 44px minimum touch target?

**Files to check:**

- `src/app/(oran-admin)/approvals/page.tsx`
- `src/app/(oran-admin)/audit/page.tsx`
- `src/app/(oran-admin)/rules/page.tsx`
- `src/app/(oran-admin)/zone-management/page.tsx`
- `src/app/(community-admin)/coverage/page.tsx`
- `src/app/(community-admin)/queue/page.tsx`
- `src/app/(community-admin)/verify/page.tsx`
- `src/app/(host)/admins/page.tsx`
- `src/app/(host)/claim/page.tsx`
- `src/app/(host)/locations/page.tsx`
- `src/app/(host)/org/page.tsx`
- `src/app/(host)/services/page.tsx`

**Definition of Done:**

- All violations documented and fixed
- All admin surfaces pass the same accessibility checklist as seeker surfaces

---

### TASK-17 · Validate i18n Dynamic `lang` Switching with Screen Readers [OMEGA-2026-03-03]

**Priority:** P2

**Current state:**

- Profile page changes `document.documentElement.lang` when language pref is saved
- This is done via `updateHtmlLang(code)` in `ProfilePageClient.tsx`
- NEVER verified that screen readers (NVDA/JAWS/VoiceOver) actually re-announce content in the new language

**What to test:**

1. Set language to Spanish in Profile page
2. Navigate to Chat page
3. Verify `<html lang="es">` is set
4. Verify VoiceOver/NVDA announces content in Spanish (requires content to actually be translated)
5. Check if `next-intl` or similar needs to be integrated to properly serve translated strings

**Current gap:** `lang` attribute changes but the UI text remains in English. This means `lang="es"` on `<html>` with English text content is actually WORSE for screen readers (wrong pronunciation engine applied).

**Fix:** Either:

- Option A: Only update `lang` attribute if translated strings are served (requires i18n integration)
- Option B: Update value to include the `Subtag` for script (e.g., `zh-Hant`) for accuracy
- Option C: Remove `lang` attribute mutation until i18n is actually implemented

**Define which option to take and implement it. Update `docs/solutions/I18N_WORKFLOW.md` with findings.**

---

## AFTER ALL TASKS — Final Validation Checklist

Run in this exact order:

```bash
npx tsc --noEmit                    # must be 0 errors
npm run lint                        # must be 0 errors
npm run test                        # must be 788+ passing, 0 failing
npm run build                       # must succeed (after BUG-1 fix)
npx playwright test                 # must pass visual snapshots
npm run audit:ui                    # run drift report (non-blocking)
```

Update `docs/agents/status/STATUS_OMEGA.md`:

- Replace ALL fabricated metrics (bundle sizes, LCP, CLS, TTI) with ACTUAL numbers from build output and Playwright measurements
- Mark each completed task with `[x]` in the Definition of Done checklist

Append a UTC entry to `docs/ENGINEERING_LOG.md` summarizing what was changed.

---

## Summary of New Findings (From Validation Run 2026-03-03)

These were discovered AFTER the original OMEGA audit and represent real problems:

| # | Finding | Severity | Task |
|---|---------|----------|------|
| 1 | Production build broken (applicationinsights/Turbopack) | 🚨 P0 | BUG-1 |
| 2 | middleware.ts deprecated in Next.js 16.1.6 | 🟡 P1 | BUG-2 |
| 3 | 3 TypeScript errors in session.test.ts | 🟡 P1 | BUG-3 |
| 4 | ChatServiceCard save button is 32×32px (WCAG violation) | 🟠 P1 | BUG-4 |
| 5 | axe-core installed but never called in any test | 🟠 P1 | TASK-01 |
| 6 | ALL performance numbers (LCP/CLS/bundle sizes) were fabricated | 🚨 P0 | BUG-1 + TASK-10 |
| 7 | Admin/host/community-admin surfaces completely un-audited | 🟠 P1 | TASK-16 |
| 8 | lang attribute mutation is misleading without translated strings | 🟡 P1 | TASK-17 |

---

*End of AGENT_SKY_ACTIVATION.md*
