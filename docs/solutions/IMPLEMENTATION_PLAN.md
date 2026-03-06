# ORAN Platform — Gap Resolution Implementation Plan

**Created**: 2026-03-05
**Source**: [PLATFORM_CAPABILITIES_AUDIT.md](./PLATFORM_CAPABILITIES_AUDIT.md)
**Status**: Phase 2 Complete

---

## Phase 1 — Critical + High Priority (Immediate)

Addresses 3 CRITICAL and 3 HIGH gaps that directly impact service reliability.

### 1A. Escalation Constants & Types

**Files**: `src/domain/constants.ts`, `src/domain/types.ts`

- Add `ESCALATION_TIERS` constant defining the tiered auto-escalation cadence:
  - T+0h: SLA breach → notify assignee (existing)
  - T+12h: Re-notify assignee + notify org's host_admin
  - T+24h: Auto-reassign to next available admin
  - T+48h: Escalate to ORAN admin queue
- Add `submission_escalation_warning` notification event type
- Add `EscalationTier` and `EscalationAction` types
- Add `DEFAULT_ADMIN_NOTIFICATION_EVENTS` const for auto-preference provisioning
- Add `SLA_WARNING_THRESHOLD` constant (0.75 — fires at 75% of SLA duration)

### 1B. Escalation Engine Service

**New file**: `src/services/escalation/engine.ts`

A standalone service encapsulating all escalation logic:

- `checkSlaWarnings()` — finds submissions approaching SLA (≥75% elapsed, not yet warned) and fires `submission_sla_warning` notifications
- `escalateBreachedSubmissions()` — implements the tiered escalation cadence (re-notify → reassign → ORAN admin)
- `findNextAvailableAdmin()` — queries admin profiles with capacity, excluding current assignee
- `findOranAdmins()` — queries all active ORAN admin profiles for final escalation
- `ensureDefaultNotificationPreferences()` — auto-creates enabled preference rows for critical admin event types

Pure SQL queries through `executeQuery` / `withTransaction` — no LLM involvement.

### 1C. Fallback Routing in `routeToAdmin`

**File**: `functions/routeToAdmin/index.ts`

When `assignmentsCreated === 0` after the routing attempt:

1. Query `admin_review_profiles` for any ORAN admin with capacity (role = 'oran_admin', `is_active = true`, `is_accepting_new = true`, pending < max)
2. Create fallback assignment with 48-hour SLA
3. Send `submission_assigned` notification to the ORAN admin
4. Fire `submission_status_changed` notification to the submitter with message: "Your submission is being reviewed. Coverage in your area is limited — we're assigning a platform reviewer."
5. Log audit event with `routingFallback: true`

If no ORAN admins have capacity either, write an `unrouted_candidate` system alert.

### 1D. SLA Warning + Re-notification

**Integration into**: `src/services/workflow/engine.ts`

- Add `checkSlaWarnings()` to detect submissions at ≥75% of SLA window
- Wire `escalateBreachedSubmissions()` into the existing `checkSlaBreaches()` flow
- The existing hourly timer function calls the internal API endpoint, which will now invoke both warning and escalation checks

### 1E. Default Admin Notification Preferences

**Integration into**: `src/services/escalation/engine.ts`

- `ensureDefaultNotificationPreferences(userId)` creates enabled rows for:
  - `submission_assigned` × `in_app`
  - `submission_sla_warning` × `in_app`
  - `submission_sla_breach` × `in_app`
- Called when admin profile is first created or can be run retroactively
- Uses `ON CONFLICT DO NOTHING` for idempotency

### 1F. Full Test Suites

- `src/services/escalation/__tests__/engine.test.ts` — escalation engine
- Additional tests in `functions/routeToAdmin/__tests__/index.test.ts` — fallback routing
- Additional tests in `src/services/workflow/__tests__/engine.test.ts` — SLA warning

### 1G. Documentation Updates

- Update `docs/solutions/PLATFORM_CAPABILITIES_AUDIT.md` gap table status
- Append entries to `docs/ENGINEERING_LOG.md`
- Update `docs/CHAT_ARCHITECTURE.md` if pipeline changes

---

## Phase 2 — High + Medium Priority ✅ COMPLETE

- ✅ Wire service_attributes to search API (`GET /api/search` attribute filters) — Gap C3
- ✅ Scope-differentiated capacity limits (ORAN admin: 50/20, community: 10/5, host: 5/3) — Gap M1
- ✅ Auto-pause at capacity (`is_accepting_new = false` when at limit) — Gap M3
- ✅ Submitter routing notification (fire `submission_status_changed` to submitter on fallback) — Gap H5
- ✅ Service type faceted filter in Directory UI (delivery/cost/access dimension chips) — Gap H3
- Admin capacity dashboard widget — deferred to Phase 3

## Phase 3 — Medium + Low Priority ✅ COMPLETE

- ✅ Composite search presets ("Low Cost Dental") — `src/services/search/presets.ts`, `GET /api/search?preset=`
- ✅ Auto-capacity scaling based on `avgReviewHours` — `computeEffectiveMaxPending()` in routing.ts
- ✅ Organization service caps — `src/services/organizations/serviceCaps.ts`
- ✅ Geographic gap alerting scheduled function — `functions/alertCoverageGaps/` (daily 8 AM UTC)
- ✅ Coverage gap dashboard API — `POST /api/internal/coverage-gaps`, `src/services/coverage/gaps.ts`
- ✅ Admin capacity dashboard — `GET /api/admin/capacity` (returns scaling-aware capacity status)

---

## Execution Protocol

1. Every change must pass `npx tsc --noEmit` (zero errors)
2. Every new function gets unit tests with the existing vitest pattern
3. No stubs, TODOs, or placeholder code
4. All idempotency keys use deterministic formats for ON CONFLICT safety
5. Documentation updated synchronously with code changes
