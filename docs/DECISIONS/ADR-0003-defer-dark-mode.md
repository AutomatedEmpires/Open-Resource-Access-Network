# ADR-0003: Defer Dark Mode

Status: **Accepted**

## Context

The Next.js starter template shipped with `prefers-color-scheme: dark` overrides in `globals.css` and scattered `dark:` utility classes. ORAN has no design-reviewed dark palette, and adding dark mode creates a surface-area multiplier for visual QA at a stage when the light-mode design system is still being established.

Dark mode done poorly undermines trust (contrast failures, unreadable badges, invisible confidence bands).

## Decision

1. Remove all `prefers-color-scheme: dark` blocks from `globals.css`.
2. Remove any remaining `dark:*` Tailwind utilities from templates.
3. Do **not** implement dark mode until:
   - The light-mode token set in `docs/ui/UI_UX_TOKENS.md` is finalized.
   - A dark palette is designed and accessibility-reviewed (WCAG AA contrast).
   - Dark mode can be feature-flagged and QA'd independently.

## Consequences

Positive:

- Halves visual QA surface until the design system is stable.
- Prevents contrast and readability regressions.
- Keeps `globals.css` minimal and predictable.

Tradeoffs:

- Users who prefer dark mode will see light UI only (acceptable for MVP).
- Re-introducing dark mode later requires a dedicated token pass.
