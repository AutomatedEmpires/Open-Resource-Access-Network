# ORAN UI/UX Contract (Sitewide)

Status: **Accepted** (SSOT per ADR-0002)

ORAN is safety-critical. This document defines the **non-negotiable UI/UX standards** that every surface must follow so the product remains coherent, mobile-first, accessible, and trustworthy.

This contract is intentionally written in normative language:

- **MUST** = required for merge
- **SHOULD** = strong default; deviation requires justification in PR
- **MAY** = optional

If a UI implementation conflicts with this doc, update this doc (and add an ADR if it changes a contract) or fix the UI.

---

## 0) Safety + Trust invariants (UI must never break these)

1. **Retrieval-first truthfulness**
   - UI MUST display service facts (name, phone, address, hours, eligibility details) only when provided by stored records or approved constants.
   - UI MUST NOT fabricate or “fill in” missing fields.

2. **Crisis hard gate**
   - Any crisis detection MUST preempt normal flows.
   - Crisis UI MUST route to **911 / 988 / 211** immediately and stop the “search assistance” flow.
   - Crisis UI MUST be highly visible, accessible, and persist during the session.

3. **Eligibility caution**
   - UI MUST avoid guarantees. Allowed language: “may qualify”, “confirm with provider”.

4. **Privacy-first**
   - UI MUST default to approximate location.
   - UI MUST require explicit consent before saving profile details.
   - UI MUST NOT request precise GPS (unless/until a future ADR + security review approves it).

---

## 1) Design system sources (what we use)

1. **Icons**: `lucide-react` (single icon family across the app)
   - UI MUST use Lucide icons only.
   - UI SHOULD centralize icon usage via a small wrapper module once icon usage grows (planned).

2. **Primitives**: Radix UI components
   - UI MUST use our wrappers under `src/components/ui/*` where they exist.

3. **Styling**: Tailwind v4 (CSS-first) + theme variables
   - UI MUST avoid ad-hoc hard-coded styling that diverges from the tokens in docs/UI_UX_TOKENS.md.
   - UI MUST keep motion minimal and respect prefers-reduced-motion.

---

## 2) Global UI parameters (apply sitewide)

### 2.1 Layout + spacing

- Pages MUST be **mobile-first**.
- Primary content MUST render in a single column on small screens.
- Content containers MUST use a consistent max width per surface:
  - Seeker: `max-w-2xl` for chat; `max-w-6xl` for map/directory lists.
  - Dashboards: `max-w-7xl` with responsive grid.
- Spacing MUST use Tailwind spacing scale (no arbitrary pixel values unless justified).

### 2.2 Typography

- Use the default sans font stack configured in CSS.
- All pages MUST have exactly one `h1`.
- Headings MUST follow a consistent scale (see docs/UI_UX_TOKENS.md).

### 2.3 Color + semantics

- UI MUST use a consistent semantic mapping:
  - Primary action: `Button` variant `default`.
  - Destructive: `Button` variant `destructive`.
  - Crisis: `Button` variant `crisis`.
  - Confidence band colors MUST be the `Badge` component.
- UI MUST NOT introduce new color palettes ad-hoc.

### 2.4 Components + composition

- UI MUST prefer shared components over per-page bespoke UI.
- All new UI primitives MUST be placed under `src/components/ui/*`.
- All domain-specific reusable components MUST be placed under `src/components/<area>/*`.

### 2.5 Empty / loading / error states (required)

Every page and any network-bound panel MUST implement:

- **Loading**: visible skeleton or loading state (no layout jump).
- **Empty**: clear explanation + next action.
- **Error**: human readable error + retry where possible.

### 2.6 Accessibility (required)

- Keyboard navigation MUST work for all interactive elements.
- All icon-only buttons MUST have `aria-label`.
- Dialogs MUST trap focus and have a close affordance.
- Headings/landmarks MUST be semantic (`main`, `nav`, `header`).

### 2.7 I18n readiness

- UI SHOULD avoid embedding long prose in components without a localization plan.
- Any new user-facing string SHOULD be centralized once i18n coverage expands.

---

## 3) Global app shell contract (consistency across pages)

### 3.1 Separate verticals

ORAN is multi-role. To keep UX coherent, we define **vertical shells**:

1. **Seeker (public)** — service discovery
2. **Host (authenticated)** — organization management
3. **Community Admin (authenticated)** — verification operations
4. **ORAN Admin (authenticated)** — system governance

Each vertical SHOULD have its own App Router route group layout file:

- `src/app/(seeker)/layout.tsx`
- `src/app/(host)/layout.tsx`
- `src/app/(community-admin)/layout.tsx`
- `src/app/(oran-admin)/layout.tsx`

These layouts define navigation, consistent page chrome, and responsive behavior.

### 3.2 Navigation rules

- Seeker navigation MUST prioritize the primary discovery method (Chat) and provide clear paths to Directory/Map.
- Dashboard navigation MUST expose only the pages relevant to that role.
- Navigation MUST not leak admin-only links on public surfaces.

### 3.3 Seeker navigation (mobile-first)

Seeker behavior is predominantly mobile and task-driven (“I need help now”). For seekers:

- Seeker surfaces SHOULD use a **bottom navigation** on mobile for primary destinations.
- A minimal **top bar** MUST exist for identity and trust: ORAN name/logo; `Sign in` / account menu; (optional) help/about entry.

Default seeker bottom nav (recommended):

- **Find** (Chat)
- **Directory**
- **Map**

Rules:

- Labels MUST be words (not icons-only).
- The active destination MUST be clearly indicated.
- Bottom nav MUST not appear on non-seeker verticals.

### 3.4 Onboarding + authentication (progressive, not blocking)

We optimize for access while preserving privacy and increasing engagement.

Non-negotiables:

- The seeker MUST be able to use discovery without signing in.
- The UI MUST clearly explain what sign-in enables (saving preferences, saving services, personalization).
- The UI MUST NOT imply that ORAN “knows” sensitive attributes.

First-time seeker experience (recommended):

- The landing experience MUST communicate: “This is a **resource directory** searching verified records.”
- Primary CTA SHOULD be action-oriented (e.g., “Find services”).
- After the first successful result set, the UI SHOULD present a **non-blocking** nudge: “Save your preferences to get better matches next time.” Actions: `Create profile` (sign in) and `Continue anonymously`.

Returning seeker experience (recommended):

- If not signed in, the UI SHOULD offer a lightweight prompt to sign in **before** starting a long session, but MUST provide a clear “Continue anonymously” path.

Popup/modals:

- The product SHOULD avoid interruptive modals by default.
- If a modal is used, it MUST be dismissible, accessible, and shown at most once per session unless user-initiated.

### 3.5 “Not just a chatbot” positioning

Chat is the primary entry point, but the UI must frame it as a directory interface:

- Chat surfaces MUST include copy like: “Searches verified service records” (or equivalent).
- Chat responses MUST present results as service listings (cards) with confidence bands.
- The UI MUST provide explicit escape hatches: Directory and Map are first-class alternatives.

Chat bubble pattern:

- A floating “chat bubble” MAY exist on non-chat seeker pages as a shortcut.
- If implemented, it MUST open to the same chat experience and MUST NOT hide core navigation.

---

## 4) Domain UI contracts (what must be shown)

### 4.1 Service list item (card) contract

Any “service card” UI (chat/directory/map/results lists) MUST:

- Show `service.name` and `organization.name`.
- Show confidence band (`HIGH`/`LIKELY`/`POSSIBLE`).
- Show only fields present in the record (phone/address/hours/url).
- Include eligibility caution (“may qualify / confirm with provider”).

### 4.2 Confidence score contract (surface behavior)

- Surfaces MUST use the 3-score model described in docs/SCORING_MODEL.md.
- Surfaces MUST NOT invent new trust labels.

### 4.3 Verification workflow contract (ops clarity)

- Verification UIs MUST clearly show:
  - current status
  - evidence/notes
  - decision history (planned)
  - the exact changes required to re-submit (when rejected)

---

## 5) Page build contract (how we implement pages)

We build one page at a time, most-to-least important. For each page PR:

1. MUST add/extend the page’s **contract checklist** (docs/PAGE_DEFINITION_OF_DONE.md)
2. MUST include at least one focused test for any non-trivial logic
3. MUST include mobile screenshots for UI changes
4. MUST preserve safety/privacy invariants

Build order reference:

- `docs/UI_BUILD_ORDER.md`

---

## 6) Non-goals (to prevent scope drift)

- No new design system libraries without an ADR.
- No custom icon sets.
- No “AI-generated” service facts.
- No precise location capture.
