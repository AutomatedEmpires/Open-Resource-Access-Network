# ORAN UI/UX Tokens (Sitewide Parameters)

Status: **Accepted** (paired with docs/UI_UX_CONTRACT.md, per ADR-0002)

This doc defines the concrete parameters we apply sitewide to achieve a coherent, modern, mobile-first UI.

Principle: **standardize the defaults** so individual pages don’t invent their own spacing, typography, or states.

---

## 1) Breakpoints (Tailwind defaults)

- `sm` ≈ 640px
- `md` ≈ 768px
- `lg` ≈ 1024px
- `xl` ≈ 1280px

Mobile-first requirement:

- Layout MUST work at 360–390px wide without horizontal scroll.

---

## 2) Containers (standard page widths)

Use these as defaults (deviation requires a reason):

- Seeker chat: `container mx-auto max-w-2xl px-4 py-8`
- Seeker directory/map: `container mx-auto max-w-6xl px-4 py-8`
- Dashboards: `container mx-auto max-w-7xl px-4 py-8`

---

## 3) Typography scale (Tailwind classes)

Page title (H1):

- `text-2xl font-bold` (mobile) and MAY increase to `sm:text-3xl` for dashboard titles

Section title (H2):

- `text-lg font-semibold`

Body:

- Default `text-sm` to `text-base` depending on density

Muted/supporting:

- `text-gray-500` for subtitles

---

## 4) Spacing + density

Standard spacing:

- Page section spacing: `mb-6`
- Card padding: `p-4` (dense lists MAY use `p-3`)
- Panel padding: `p-6` or `p-8` for empty states

---

## 5) Surfaces (cards/panels)

Card baseline:

- `bg-white border border-gray-200 rounded-lg`
- Shadows MUST be subtle: `shadow-sm` and `hover:shadow-md` only where interactive.

---

## 6) Buttons and badges

Use the shared components:

- Buttons: `src/components/ui/button.tsx`
- Confidence badges: `src/components/ui/badge.tsx`

Rules:

- Primary CTA MUST be a `Button` `variant="default"`.
- Destructive actions MUST be `variant="destructive"`.
- Crisis CTAs MUST be `variant="crisis"`.

---

## 7) States (contract)

Every page with data MUST show:

- Loading state (skeleton or clear loading panel)
- Empty state (explain + next action)
- Error state (human readable + retry)

Standard copy conventions:

- Don’t blame the user.
- Don’t claim certainty.
- Provide one next action.

---

## 8) Motion

- Keep animations minimal.
- Any animation MUST remain functional with `prefers-reduced-motion`.

---

## 9) Touch targets

- Interactive controls (buttons, icon buttons, clickable cards) MUST have a minimum tap target of **44×44px**.

### Select exception

- Native `<select>` inputs MAY use a minimum height of **32px** in dense filter panels.
- Justification: the native control opens a platform picker on tap; this is treated as an input control rather than a small icon button.
- When used, add a short inline note referencing this section (see directory sort select).

---

## 10) Z-Index Scale

Named CSS custom properties in `:root` of `src/app/globals.css`. **Always use these — never use arbitrary numeric `z-*` values.**

| Variable | Value | Use |
|---|---|---|
| `--z-skip-link` | 100 | Keyboard skip-to-content link (always on top) |
| `--z-toast` | 100 | Toast / notification stack |
| `--z-modal` | 50 | Dialog overlays, floating dropdowns, chat bubble |
| `--z-nav` | 40 | Sticky header bar, fixed bottom nav |
| `--z-sticky` | 30 | Sticky sub-headers or table headers |
| `--z-elevated` | 20 | Cards with drop-shadows that need to float above siblings |

In Tailwind: `z-[var(--z-modal)]`, `z-[var(--z-nav)]`, etc.

---

## 11) Approved Arbitrary Tailwind Values

Arbitrary Tailwind values (`utility-[value]`) are restricted by the `oran/no-unapproved-arbitrary` ESLint rule defined in `eslint-plugin-oran.mjs`. New values not in the list below will trigger a **warning** at lint time.

To add a new value: add it to both `APPROVED_ARBITRARY` in `eslint-plugin-oran.mjs` **and** the table below.

The following categories are **unconditionally approved** without appearing in the list:

- CSS custom-property references: `z-[var(--z-nav)]`, `bg-[var(--bg-surface)]`, etc.
- Radix UI data-attribute selectors: `data-[state=open]`, `data-[state=closed]`

### Approved list

| Class | Reason |
|---|---|
| `min-h-[44px]`, `min-w-[44px]` | WCAG 2.5.5 minimum touch target (44 × 44 px) |
| `min-h-[26px]`, `min-h-[28px]`…`min-h-[80px]`, `min-h-[84px]`, `min-h-[700px]` | Badge/tag heights, textarea height, chat grid floor |
| `min-w-[14px]`…`min-w-[200px]`, `min-w-[64px]` | Icon / badge / button sizes inside labelled containers |
| `min-h-[34px]`, `min-h-[64px]` | Tag button and send-button minimum heights |
| `h-[60vh]`, `h-[50vh]`, `min-h-[60vh]` | Content-well viewport heights |
| `max-h-[85vh]`, `max-h-[80vh]` | Modal / panel max heights |
| `h-[calc(100dvh-13rem)]`, `h-[calc(100vh-16rem)]`, `max-h-[calc(100vh-16rem)]` | Computed scroll container heights |
| `max-w-[120px]`…`max-w-[220px]`, `max-w-[18rem]`, `max-w-[46rem]`, `max-w-[85%]` | Truncation / message column constraints |
| `max-h-[120px]`, `max-h-[160px]`, `max-h-[420px]` | Scrollable list max heights |
| `grid-cols-[1fr,auto,auto]`, `grid-cols-[1fr_380px]`, `grid-cols-[260px_minmax(0,1fr)]`, `grid-cols-[280px_minmax(0,1fr)]`, `grid-cols-[300px_minmax(0,1fr)]` | Two-panel / sidebar layouts |
| `rounded-[32px]` | Chat main panel border radius |
| `text-[9px]`, `text-[10px]`, `text-[11px]` | Sub-`xs` font sizes for badge labels |
| `text-[15px]` | Compact body text in service cards |
| `text-[2rem]` | Large display heading in PageHeader |
| `bottom-[4.5rem]`, `top-[20%]`, `z-[9999]` | Fixed / absolute positioning; skip-to-content a11y link z-index |
| `[animation-delay:-0.3s]`, `[animation-delay:-0.15s]` | Staggered loading-dot animation delays |
| `animate-[page-enter_var(--transition-standard)_both]` | Page-enter transition animation |
| `tracking-[0.24em]` | Extended letter-spacing for uppercase display labels |
| `min-h-[38px]` | Surface tab minimum touch height |
| `min-h-[46px]` | Filter panel input minimum touch height |
| `shadow-[0_12px_28px_rgba(15,23,42,0.06)]` | Service card hover shadow (light) |
| `shadow-[0_18px_40px_rgba(15,23,42,0.08)]` | Service card active/focus shadow (medium) |
| `shadow-[0_12px_32px_rgba(15,23,42,0.05)]`, `shadow-[0_14px_36px_rgba(15,23,42,0.05)]` | Chat window subtle surface shadows |
| `shadow-[0_24px_70px_rgba(15,23,42,0.08)]`, `shadow-[0_18px_42px_rgba(15,23,42,0.08)]` | Chat panel deep shadow and input area shadow |
| `bg-[linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.96))]` | Filter panel backdrop gradient |
| `bg-[radial-gradient(circle_at_top,_rgba(186,230,253,0.32),_transparent_26%),linear-gradient(180deg,_#f7fafc_0%,_#f8fbfd_48%,_#f2f7fb_100%)]` | Directory / map page background gradient |
