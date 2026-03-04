# ORAN UI Primitives

Low-level, accessible components used throughout the seeker experience.
All components are tested for WCAG 2.1 AA and respect `prefers-reduced-motion`.

---

## Button (`button.tsx`)

Shadcn-style button using `class-variance-authority`.

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'default' \| 'destructive' \| 'outline' \| 'secondary' \| 'ghost' \| 'link' \| 'crisis'` | `'default'` | Visual style |
| `size` | `'default' \| 'sm' \| 'lg' \| 'icon'` | `'default'` | Button size |
| `asChild` | `boolean` | `false` | Renders inner `<Slot>` instead of `<button>` |

**Crisis variant** is bold red (`bg-red-700`) — use only for hard-gate 911/988/211 CTAs.

```tsx
import { Button } from '@/components/ui/button';

<Button variant="crisis">Call 911</Button>
<Button variant="outline" size="sm">Filter</Button>
```

---

## Badge (`badge.tsx`)

Displays confidence bands with color-coding per ORAN scoring model.

| Prop | Type | Description |
|------|------|-------------|
| `band` | `'HIGH' \| 'LIKELY' \| 'POSSIBLE'` | Confidence level – sets color and label automatically |
| `variant` | same as `band` | Alternative manual variant selector |

Tooltip-ready labels:
- **HIGH** → "High confidence"
- **LIKELY** → "Likely — confirm hours/eligibility"
- **POSSIBLE** → "Possible — here's what to verify"

```tsx
import { Badge } from '@/components/ui/badge';

<Badge band="HIGH">Verified</Badge>
<Badge band="LIKELY">Last updated 3d ago</Badge>
```

---

## Skeleton (`skeleton.tsx`)

Loading placeholder that respects `prefers-reduced-motion`.

| Prop | Type | Description |
|------|------|-------------|
| `circle` | `boolean` | Render circular skeleton (avatar placeholder) |

Preset compositions:
- `SkeletonCard` — matches ORAN service card dimensions
- `ChatSkeletonLoader` — chat message loading state

```tsx
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton';

<Skeleton className="h-4 w-1/2" />
<SkeletonCard />
```

---

## Dialog (`dialog.tsx`)

Accessible modal dialog using Radix UI primitives.

Exported parts:
- `Dialog` — root context provider
- `DialogTrigger` — element that opens dialog
- `DialogContent` — modal panel with overlay and auto-focus trap
- `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter` — semantic sections
- `DialogClose` — accessible close button (sr-only "Close" label, 44×44 tap target)

```tsx
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

<Dialog>
  <DialogTrigger asChild>
    <Button>Open modal</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Title here</DialogTitle>
    </DialogHeader>
    {/* ... */}
    <DialogFooter>
      <Button>Confirm</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

---

## ErrorBoundary (`error-boundary.tsx`)

Class component that catches render errors + provides retry.

| Prop | Type | Description |
|------|------|-------------|
| `fallback` | `ReactNode` | Custom fallback UI (uses default ORAN panel if omitted) |

Default fallback:
- Amber warning icon
- "Something went wrong" heading
- "We couldn't load this section. Your data is safe."
- "Try again" button resets error state

Never exposes stack traces or PII in production.

```tsx
import { ErrorBoundary } from '@/components/ui/error-boundary';

<ErrorBoundary>
  <SomeRiskyComponent />
</ErrorBoundary>
```

---

## Accessibility checklist (DoD enforcement)

| Requirement | Status |
|-------------|--------|
| Min 44×44 px tap targets | ✅ |
| Color contrast ≥4.5:1 | ✅ |
| `prefers-reduced-motion` respected | ✅ |
| ARIA labels on interactive elements | ✅ |
| Focus rings on keyboard nav | ✅ |

---

## Adding new primitives

1. Place in `src/components/ui/<name>.tsx`
2. Export from file (no barrel)
3. Add section to this README with props table + example
4. Verify WCAG 2.1 AA compliance
5. Update `docs/UI_SURFACE_MAP.md` if primitive affects seeker flows
