# ORAN UI Build Order (Most → Least Important)

Status: **Accepted** (per ADR-0002)

This is the build queue we use to implement and test **one page at a time** while maintaining coherence.

Rule: We do not start a lower-priority page until the earlier pages satisfy docs/PAGE_DEFINITION_OF_DONE.md.

---

## Phase 0 — Foundations (required for coherence)

1. Vertical shells (layouts) + navigation
   - `src/app/(seeker)/layout.tsx`
   - `src/app/(host)/layout.tsx`
   - `src/app/(community-admin)/layout.tsx`
   - `src/app/(oran-admin)/layout.tsx`

2. Home/entry page → routes into seeker discovery
   - Replace starter home with an ORAN entry that routes to `/chat` as primary.

Acceptance criteria:

- Mobile nav works (seeker).
- No admin links appear to seekers.
- Each role has an isolated layout shell.

---

## Phase 1 — Seeker discovery (highest user impact)

1. `/chat` polish (already functional)
   - Improve empty state guidance and “what to verify” guidance.
   - Ensure crisis banner behavior and eligibility disclaimer remain consistent.

2. `/directory` (search + filters)
   - First-class list experience using `ServiceCard`.
   - Filters must not imply certainty (confidence messaging stays consistent).

3. `/map` (interactive map)
   - Replace placeholder `MapContainer` once the map library decision is made.

Acceptance criteria:

- Chat/Directory/Map share the same service card contract.
- Loading/empty/error states exist.

---

## Phase 2 — Seeker retention + consent

1. `/saved`
2. `/profile` (consent-first, approximate location)

Acceptance criteria:

- Explicit consent before saving.
- No precise GPS.
- Clear data deletion path.

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
