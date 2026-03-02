# ORAN Page Definition of Done (DoD)

Status: **Accepted** (per ADR-0002)

This checklist is the **contract** we apply to each new/modified UI page. A page is “done” only when all required items are satisfied.

Use this file as the authoritative checklist in PRs.

---

## A) UX completeness (required)

- [ ] **Entry point exists**: users can reach this page from its vertical navigation (or a deliberate deep link).
- [ ] **Exit path exists**: the page has a clear next action; no dead ends.
- [ ] **Happy path** implemented end-to-end for the page’s core job.
- [ ] **Loading state** implemented (no blank screen).
- [ ] **Empty state** implemented with explanation + next action.
- [ ] **Error state** implemented with human text + retry where possible.

---

## B) Consistency contract (required)

- [ ] Uses container width + typography scale from docs/UI_UX_TOKENS.md.
- [ ] Uses shared primitives from `src/components/ui/*` (no bespoke buttons/badges/dialogs).
- [ ] Uses only `lucide-react` icons.
- [ ] Uses `Badge` for confidence messaging.

---

## C) Accessibility (required)

- [ ] Keyboard navigation works (Tab order is logical).
- [ ] All controls have accessible names (`aria-label` for icon-only).
- [ ] Focus styles visible.
- [ ] Dialogs trap focus and close works.
- [ ] Semantics: exactly one `h1`, main content in `<main>`.

---

## D) Safety-critical constraints (required)

- [ ] No invented service facts (UI renders only stored record fields).
- [ ] Crisis gate preserved (911/988/211 path is prominent and interrupts the flow).
- [ ] Eligibility language uses “may qualify / confirm with provider”.

---

## E) Security + privacy (required)

- [ ] No PII added to logs/telemetry.
- [ ] Any new API call validates input via Zod (if applicable).
- [ ] Any profile persistence requires explicit consent UI and matches docs/SECURITY_PRIVACY.md.
- [ ] Location remains approximate by default (no precise GPS requests).

---

## F) Testing (required)

Minimums:
- [ ] Non-trivial logic has a unit test (Vitest).
- [ ] Any modified safety-critical logic has a focused test and doc alignment.

Recommended (when we add tooling):
- [ ] UI interaction test for the page (future: Playwright).

---

## G) Documentation alignment (required)

- [ ] docs/UI_SURFACE_MAP.md updated if routes/components changed.
- [ ] Contract changes come with an ADR (docs/DECISIONS/*).
- [ ] docs/ENGINEERING_LOG.md has a UTC entry for contract-level changes.
