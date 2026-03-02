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
