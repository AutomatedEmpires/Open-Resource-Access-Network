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

## FormField (`form-field.tsx`)

Accessible label and message wrapper for a single form control.

What it standardizes:

- label to control wiring
- required-state copy for screen readers
- merged `aria-describedby` support so field-specific help is not lost
- inline hint and error messaging
- optional character counts

Use it for `input`, `textarea`, and `select` controls instead of hand-rolled labels.

Important for embedded editors:

- If a control belongs to a local draft flow inside a larger parent form, do not mark the raw draft input as `required` unless the parent submit should be blocked by browser validation.
- For editors like add-phone or add-evidence flows, keep validation local to the editor action until the user explicitly commits that nested item.

```tsx
import { FormField } from '@/components/ui/form-field';

<FormField

- label to control wiring
- required-state copy for screen readers
- merged `aria-describedby` support so field-specific help is not lost
- inline hint and error messaging
- optional character counts

>
  <textarea value={details} onChange={handleChange} />
</FormField>
```

- If a control belongs to a local draft flow inside a larger parent form, do not mark the raw draft input as `required` unless the parent submit should be blocked by browser validation.
- For editors like add-phone or add-evidence flows, keep validation local to the editor action until the user explicitly commits that nested item.

## FormAlert (`form-alert.tsx`)

Consistent inline message banner for forms.

Behavior:

- `error` and `warning` announce with assertive live regions
- `success` and `info` announce with polite live regions

```tsx
import { FormAlert } from '@/components/ui/form-alert';

<FormAlert variant="error" message="Please fix the highlighted fields." />
```

---

## FormSection (`form-section.tsx`)

Shared wrapper for grouping related fields under a labeled section with optional supporting copy and actions.

Use it to keep forms organized and predictable across seeker, host, and admin flows.

```tsx
import { FormSection } from '@/components/ui/form-section';

<FormSection
  title="Supporting evidence"
  description="Add documents or links that support this request."
  action={<Button type="button">Add evidence</Button>}
>
  {/* fields */}
</FormSection>
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
5. Update `docs/ui/UI_SURFACE_MAP.md` if primitive affects seeker flows
