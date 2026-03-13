# UI Snapshot & Flow Documentation

This directory holds visual layout documentation, viewport references, and Mermaid flow charts for the ORAN seeker-side interface.

Complements the existing `docs/ui/` UX contract library with **generated snapshot infrastructure** and **coded flow diagrams** that can be kept current as the UI evolves.

---

## Structure

```
docs/ui/
├── SNAPSHOT_SYSTEM.md     ← You are here
├── viewports.json         ← Canonical viewport sizes (360→1920)
├── flows/
│   ├── seeker-discovery.md   ← Chat → Directory → Map → Service Detail
│   ├── seeker-profile.md     ← Profile setup & cross-device sync
│   └── seeker-forms.md       ← Submit / Report / Appeal forms
└── snapshots/             ← Visual screenshots (generated — do not hand-edit)
    └── <page>/<viewport-id>.png
```

---

## Canonical Viewports

All snapshots use the six sizes defined in [`viewports.json`](./viewports.json):

| ID | Width | Description |
|----|-------|-------------|
| `mobile-xs` | 360px | Minimum supported — small Android / older iPhones |
| `mobile-sm` | 390px | iPhone SE / mid-range Android |
| `mobile-lg` | 430px | iPhone Pro Max / large Android |
| `tablet` | 768px | iPad / large Android tablet |
| `desktop-sm` | 1280px | Compact laptop / 13″ |
| `desktop-lg` | 1920px | Full HD monitor |

> **Rule**: All seeker features must be fully usable at `mobile-xs` (360 × 640 px).
> Touch targets must be ≥ 44 × 44 px ([WCAG 2.5.5](https://www.w3.org/WAI/WCAG21/Understanding/target-size.html)).

---

## Taking Snapshots

### Prerequisites

```bash
npm install
npx playwright install --with-deps chromium
```

### Run snapshot script

```bash
# Capture all seeker pages at all canonical viewports
node scripts/capture-ui-snapshots.mjs

# Capture a specific page
node scripts/capture-ui-snapshots.mjs --page directory

# Capture a specific viewport
node scripts/capture-ui-snapshots.mjs --viewport mobile-xs
```

Snapshots are saved to `docs/ui/snapshots/<page>/<viewport-id>.png`.

### Updating Playwright visual regression baselines

```bash
npx playwright test e2e/visual/ --update-snapshots
```

---

## Flow Charts

Each file in `flows/` contains:

1. A **Mermaid flowchart** — paste into any Mermaid-compatible renderer or view on GitHub.
2. **Mobile layout notes** — exact Tailwind classes and breakpoint decisions.
3. **ARIA attribute map** — roles, labels, and live regions per surface.

Render locally:

```bash
# VS Code: Install "Markdown Preview Mermaid Support"
# CLI:
npx @mermaid-js/mermaid-cli -i docs/ui/flows/seeker-discovery.md -o docs/ui/flows/seeker-discovery.svg
```

---

## UI Change Checklist

Before merging a seeker page change, verify:

- [ ] **360px** — no horizontal scroll; content not clipped.
- [ ] **Touch targets** — all interactive elements ≥ 44 × 44 px.
- [ ] **Text zoom 200%** — layout holds without overlap.
- [ ] **ARIA** — loading: `role="status"`; errors: `role="alert"`; icon-only buttons: `aria-label`.
- [ ] **Reduced motion** — animations use `--transition-standard` (zero when `prefers-reduced-motion`).
- [ ] **Semantic tokens** — colours via `text-action-base`, `bg-info-subtle`, etc., not hard-coded hex.
- [ ] **Snapshot updated** — run script and commit images if layout changed intentionally.

---

## Design Token Quick Reference

Defined in `src/app/globals.css` via `@theme inline {}`:

| Token | Value | Usage |
|-------|-------|-------|
| `text-action-base` | orange-500 | Primary interactive text, active tabs |
| `text-action-strong` | orange-600 | Hover/pressed state |
| `bg-info-subtle` | orange-50 | Active tab / chip background |
| `bg-info-muted` | orange-100 | Hover background |
| `scrollbar-none` | utility | Cross-browser scrollbar hiding |
| `--transition-standard` | 250ms ease | Standard animation (0ms with reduced-motion) |

Z-index scale: nav = 40, fab = 45, modal = 50, toast = 100.

---

## Seeker Route → Component Map

| Route | Server wrapper | Client component |
|-------|---------------|-----------------|
| `/chat` | `(seeker)/chat/page.tsx` | `ChatPageClient.tsx` |
| `/directory` | `(seeker)/directory/page.tsx` | `DirectoryPageClient.tsx` |
| `/map` | `(seeker)/map/page.tsx` | `MapPageClient.tsx` |
| `/service/:id` | `(seeker)/service/[id]/page.tsx` | `ServiceDetailClient.tsx` |
| `/saved` | `(seeker)/saved/page.tsx` | `SavedPageClient.tsx` |
| `/profile` | `(seeker)/profile/page.tsx` | `ProfilePageClient.tsx` |
| `/notifications` | `(seeker)/notifications/page.tsx` | `NotificationsPageClient.tsx` |
| `/submit-resource` | `(seeker)/submit-resource/page.tsx` | `SubmitResourcePageClient.tsx` |
| `/report` | `(seeker)/report/page.tsx` | `ReportPageClient.tsx` |
| `/appeal` | `(seeker)/appeal/page.tsx` | `AppealPageClient.tsx` |
| `/invitations` | `(seeker)/invitations/page.tsx` | `InvitationsPageClient.tsx` |

All routes share the shell at `(seeker)/layout.tsx` — top nav (desktop), bottom nav (mobile), skip-to-content link, mobile search FAB.

---

## See Also

- [docs/ui/UX_FLOWS.md](./UX_FLOWS.md) — existing journey diagrams
- [docs/ui/UI_UX_TOKENS.md](./UI_UX_TOKENS.md) — full token catalogue
- [docs/ui/SEEKER_SURFACE_ENHANCEMENT_PLAN.md](./SEEKER_SURFACE_ENHANCEMENT_PLAN.md) — enhancement roadmap
