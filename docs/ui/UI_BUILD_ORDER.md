# ORAN UI Build Order (Most → Least Important)

Status: **Accepted** (per ADR-0002)

This is the build queue we use to implement and test **one page at a time** while maintaining coherence.

Rule: We do not start a lower-priority page until the earlier pages satisfy docs/PAGE_DEFINITION_OF_DONE.md.

---

## Phase 0 — Foundations (required for coherence) ✅ COMPLETE

Completed: 2026-03-02

1. Vertical shells (layouts) + navigation
   - `src/app/(seeker)/layout.tsx` ✅
   - `src/app/(host)/layout.tsx` ✅
   - `src/app/(community-admin)/layout.tsx` ✅
   - `src/app/(oran-admin)/layout.tsx` ✅

2. Home/entry page → routes into seeker discovery ✅
   - Replaced starter home with ORAN entry that routes to `/chat` as primary.

Acceptance criteria:

- Mobile nav works (seeker). ✅
- No admin links appear to seekers. ✅
- Each role has an isolated layout shell. ✅

---

## Phase 1 — Seeker discovery (highest user impact) ✅ COMPLETE

Completed: 2026-03-02

1. `/chat` polish ✅
   - Empty state guidance and "what to verify" tip implemented.
   - Crisis banner + eligibility disclaimer consistent.

2. `/directory` (search + filters) ✅
   - Full list experience using `ServiceCard` with confidence filter panel.
   - Confidence filter includes disclaimer: "does not imply certainty".

3. `/map` (interactive map) ✅
   - Azure Maps SDK integrated via server-side token broker.
   - "Search this area" bbox-on-pan with 600ms debounce.

Acceptance criteria:

- Chat/Directory/Map share the same service card contract. ✅
- Loading/empty/error states exist. ✅

---

## Phase 2 — Seeker retention + consent ✅ COMPLETE

Completed: 2026-03-02

1. `/saved` ✅ — localStorage-only bookmarks with remove/clear-all, privacy note.
2. `/profile` ✅ — Approximate city input (device-only), privacy checklist, data deletion with confirm step, Entra ID sign-in placeholder.

Acceptance criteria:

- Explicit consent before saving. ✅ (localStorage opt-in, no server sync)
- Location remains approximate by default. ✅ (no automatic geolocation; device geolocation only on explicit user action)
- Clear data deletion path. ✅ (confirm/cancel flow on profile page)

---

## Phase 3 — Host workflows (supply-side enablement)

1. `/claim`
2. `/org`
3. `/services`
4. `/locations`
5. `/admins`

Acceptance criteria:

- Status visibility: claim status and verification status per service.
- No PII leaks.

---

## Phase 4 — Community admin verification (trust engine)

1. `/queue`
2. `/verify`
3. `/coverage`

Acceptance criteria:

- Decisions are auditable (contracted; storage implementation may follow).
- Reject path produces actionable change requests.

---

## Phase 5 — ORAN admin governance

1. `/approvals`
2. `/rules`
3. `/audit`
4. `/zone-management`

Acceptance criteria:

- High-risk changes feature-flagged.
- Admin action visibility.
