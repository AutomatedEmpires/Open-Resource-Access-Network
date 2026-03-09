# ORAN Platform Capabilities Audit

**Date**: 2026-03-05
**Scope**: Filters, tagging pipeline, verification routing, escalation, admin capacity
**Status**: Comprehensive audit with gap analysis and recommendations

---

## Table of Contents

1. [Service Filters & Tag Search](#1-service-filters--tag-search)
2. [Tagging Pipeline: LLM vs SQL](#2-tagging-pipeline-llm-vs-sql)
3. [Verification Routing: No Nearby Admin](#3-verification-routing-when-no-nearby-admin-exists)
4. [Escalation & Re-notification](#4-escalation--re-notification-of-unverified-listings)
5. [Admin Capacity Limits & Scope Control](#5-admin-capacity-limits--scope-control)
6. [Gap Summary & Implementation Roadmap](#6-gap-summary--implementation-roadmap)

---

## 1. Service Filters & Tag Search

### What Exists (Proven by Code)

ORAN has a **two-tier tag system** and a fully functional filter pipeline.

#### Tier 1: HSDS-Compliant Taxonomy (`taxonomy_terms` + `service_taxonomy`)

- Hierarchical free-form classification inherited from the Human Services Data Specification.
- Stored in `taxonomy_terms` (term, description, parent_id) with a `service_taxonomy` junction table.
- The Directory and search API accept `taxonomyIds` (comma-separated UUIDs) to filter results.

#### Tier 2: ORAN Service Attributes (6 Dimensions, 100+ Tags)

Defined in `src/domain/taxonomy.ts` as the **single source of truth**. Each dimension has a structured set of validated tags:

| Dimension | # Tags | Examples relevant to "sliding scale medical" / "low cost dental" |
|-----------|--------|------------------------------------------------------------------|
| **cost** | 25 | `free`, `sliding_scale`, `medicaid`, `medicare`, `no_insurance_required`, `ebt_snap`, `pay_what_you_can`, `free_for_veterans`, `free_for_seniors`, `income_verified` |
| **delivery** | 24 | `in_person`, `virtual`, `phone`, `mobile_outreach`, `hospital_based` |
| **access** | 32 | `walk_in`, `appointment_required`, `no_id_required`, `same_day`, `weekend_hours` |
| **culture** | 33 | `lgbtq_affirming`, `trauma_informed`, `harm_reduction`, `peer_support`, `bilingual_services` |
| **population** | 15+ | `veteran`, `reentry`, `dv_survivor`, `refugee`, `foster_youth` |
| **situation** | 12+ | `no_fixed_address`, `legal_crisis`, `substance_use_active` |

Additional tagged dimensions:

- **Adaptations** (4 types): disability, health_condition, age_group, learning
- **Dietary options**: halal, kosher, vegetarian, gluten_free, etc.
- **Location accessibility**: wheelchair, elevator, accessible_restroom, etc.
- **Transit access**: bus_stop_nearby, metro_station, free_parking, etc.
- **Capacity status**: available, limited, waitlist, closed

#### Can a Seeker Search for "Sliding Scale Medical" or "Low Cost Dental"?

**Yes, partially.** Here's how the current system handles it:

1. **Full-text search** (`q=sliding scale dental`) — PostgreSQL `plainto_tsquery` matches against service name and description. This finds listings that *mention* those words.

2. **Tag-based filtering** — The `cost:sliding_scale` tag exists and is applied via the LLM tagging pipeline during ingestion. If a service was tagged with `sliding_scale`, it shows up when that tag is selected.

3. **Directory UI** (`/directory`):
   - Search box → full-text query
   - 10 category chips for broad filtering
   - Tag multi-select dialog → filters by `taxonomyIds`
   - Confidence/trust slider → filters by trust band (HIGH/LIKELY/POSSIBLE)
   - Sort options: relevance, trust, name

**Files**: `src/app/(seeker)/directory/DirectoryPageClient.tsx`, `src/app/api/search/route.ts`, `src/services/search/engine.ts`

### Gaps Identified

| Gap | Impact | Priority |
|-----|--------|----------|
| **No "service type" filter** (medical, dental, legal, food) in the Directory UI — only taxonomy chips | Seekers can't easily narrow to "dental" services | HIGH |
| **No composite filter shortcuts** ("low cost dental" = `cost:sliding_scale` + category:dental) | Requires manual multi-select | MEDIUM |
| **Service attributes (Tier 2) not yet wired to search API** — search only filters by `taxonomyIds` (Tier 1) | The 100+ rich tags exist in taxonomy.ts and DB but aren't queryable via the API | HIGH |
| **No "near me" one-click** — requires manual lat/lng or map interaction | UX barrier for mobile users | MEDIUM |
| **Chat pipeline can find services via full-text** but doesn't expose tag filters to seekers | Chat is natural language only; no structured filter pass-through | LOW |

### Recommendations

1. **Wire service_attributes to search API**: Add optional `attributeFilters` param (e.g., `cost=sliding_scale,free&access=walk_in`) to `GET /api/search`. Modify `buildFiltersWhereClause()` in `engine.ts` to JOIN against `service_attributes`.

2. **Add service type faceted filter**: Use the 22 LLM-categorized service types (from `LlmCategorizeStage`) as a primary filter dimension. These categories include `healthcare`, `dental`, `behavioral_health`, `food`, `housing`, `legal`, etc.

3. **Composite search presets**: Create preset filter combos like "Low Cost Dental" = `{serviceType: 'dental', cost: ['sliding_scale', 'free', 'medicaid']}` for the most common seeker queries.

---

## 2. Tagging Pipeline: LLM vs SQL

### How Complex Listings Get Tagged

ORAN uses a **hybrid approach**: LLM for initial extraction, deterministic validation for enforcement, human admin for confirmation.

#### The 9-Stage Ingestion Pipeline

Defined in `src/agents/ingestion/pipeline/stages.ts`, orchestrated by `src/agents/ingestion/pipeline/orchestrator.ts`:

| Stage | Name | LLM? | Purpose |
|-------|------|------|---------|
| 1 | **SourceCheckStage** | No | Verify URL against source registry (gov/vetted/quarantine) |
| 2 | **FetchStage** | No | Download page, compute SHA256 hash |
| 3 | **ExtractTextStage** | No | Strip HTML → clean text (cheerio + main content detection) |
| 4 | **DiscoverLinksStage** | No | Find contact/apply/eligibility/hours URLs |
| 5 | **LlmExtractStage** | **Yes** | Structured field extraction with per-field confidence (0–100) |
| 6 | **LlmCategorizeStage** | **Yes** | Categorize into 22 service types |
| 7 | **VerifyStage** | No | 6 domain checks (contact validity, hours stability, cross-agreement, location plausibility, description completeness, domain allowlist) |
| 8 | **ScoreStage** | No | Compute confidence tier (green/yellow/orange/red) + sub-scores |
| 9 | **BuildCandidateStage** | No | Generate IDs, persist to staging table |

**Key principle**: Only stages 5 and 6 involve an LLM. Everything else is deterministic SQL/TypeScript.

#### LLM Tagging Prompt (Stage 5)

**File**: `src/services/ingestion/tagging-prompt.ts`
**Model**: `gpt-4o-mini` (Azure OpenAI / Foundry)

The prompt includes these critical constraints:

```
1. ONLY output tags from the valid taxonomy lists below — never invent tags
2. Be CONSERVATIVE — only tag what is explicitly stated or strongly implied
3. Distinguish between SERVICE adaptations vs LOCATION accessibility
4. If uncertain, note it in the warnings array
```

The LLM receives the full taxonomy reference (all valid tags from `src/domain/taxonomy.ts`) and must output a structured JSON with:

- 6 service attribute dimensions (delivery, cost, access, culture, population, situation)
- Adaptations, dietary options, location info
- Eligibility criteria (income %, age range, household size)
- Languages (ISO 639-1)
- An overall **confidence score** (0–100)
- A **warnings** array for uncertain extractions

#### How Confidence Scores Are Applied

**File**: `src/domain/confidence.ts`

After the LLM extracts tags, every tag suggestion gets a confidence score. The system maps scores to **4 color-coded tiers**:

| Tier | Score Range | Color | SLA for Review | Meaning |
|------|------------|-------|----------------|---------|
| **Green** | 80–100 | 🟢 Green | 72 hours | High confidence — may auto-approve |
| **Yellow** | 60–79 | 🟡 Yellow | 48 hours | Needs human review |
| **Orange** | 40–59 | 🟠 Orange | 24 hours | Attention needed — likely needs modification |
| **Red** | 0–39 | 🔴 Red | 12 hours | Insufficient — probably needs rejection or major edits |

**Tier calculation** (`src/domain/confidence.ts`):

```typescript
if (score >= 80) return 'green';
if (score >= 60) return 'yellow';
if (score >= 40) return 'orange';
return 'red';
```

**SLA scales with confidence** (`src/agents/ingestion/adminAssignments.ts`):

- Lower confidence → shorter SLA → faster human review required
- This ensures dubious tags don't sit unchecked

#### Are Tags Color-Coded by Confidence?

**Yes.** The system has:

1. **`tag_confirmations` table** — Stores each uncertain tag with its `confidence_tier` (a computed column based on `agent_confidence`). Tags below green go into the admin confirmation queue.

2. **`v_pending_tags_by_color` view** — SQL view that groups pending tags by their color tier, giving admins a dashboard of what needs attention first.

3. **Admin UI**: The verify page (`/verify`) shows confidence score meters for verification, eligibility, and constraint scores. The tag confirmation queue is color-coded by tier.

#### Post-LLM Validation (Deterministic)

**File**: `src/services/ingestion/tagging-prompt.ts` → `validateAndFilterTags()`

After LLM extraction, every tag is validated against the canonical taxonomy:

- Invalid tags are **removed** and logged as warnings
- Only tags that exist in `src/domain/taxonomy.ts` survive
- This prevents the LLM from inventing categories

#### SearchRetrieval: No LLM

The **search engine** (`src/services/search/engine.ts`) is pure SQL:

- PostgreSQL full-text search (`plainto_tsquery`)
- PostGIS geo-queries (`ST_DWithin`, `ST_MakeEnvelope`)
- Deterministic scoring (confidence weights: 45% verification + 40% eligibility + 15% constraint)
- **No LLM participates in retrieval or ranking**

The optional `llm_summarize` feature flag allows an LLM to summarize *already-retrieved* results but it **cannot add facts**.

### Summary

```
Ingestion:  LLM extracts → Validated against taxonomy → Scored → Color-coded → Admin queue
Search:     Pure SQL + PostGIS → Deterministic scoring → No LLM
Chat:       Retrieval-first → Optional LLM summary of existing records only
```

---

## 3. Verification Routing: When No Nearby Admin Exists

### Current Routing Logic

**File**: `functions/routeToAdmin/index.ts`

When a listing is ingested and scored, it enters the `ingestion-route` queue. The `routeToAdmin` Azure Function:

1. Loads the candidate from the staging table
2. Extracts jurisdiction: `stateProvince` + `countyOrRegion`
3. Queries `admin_routing_rules` for the best geographic match (country → state → county, most specific wins)
4. If a rule matches → resolves the `assignedUserId` → creates a `candidate_admin_assignments` entry with a 72-hour SLA
5. Writes an audit event (`review.assigned`)

### The Geographic Routing System

**SQL function**: `find_nearest_admins()` (migration 0018)

```sql
-- Uses PostGIS ST_Distance for meter-based proximity
-- Filters: active, accepting_new=true, pending_count < max_pending
-- Orders by: expertise match DESC → distance ASC → capacity DESC
-- Returns up to N nearest admins
```

**Coverage zones** (migration 0005): PostGIS polygon geometries assigned to community admins, indexed for spatial queries.

### What Happens When No Admin Exists Within Range

**Current behavior (proven by code in `routeToAdmin/index.ts` lines 99–106)**:

```typescript
} else {
  console.warn(
    `[routeToAdmin] No routing rule matched for candidate ` +
    `${message.candidateId} ` +
    `(state=${stateProvince ?? 'any'}, county=${countyOrRegion ?? 'any'})`
  );
}

// Audit event still written with assignmentsCreated: 0
```

**The candidate remains UNASSIGNED.** It:

- Sits in the staging table with no `candidate_admin_assignments` entry
- Has an audit record tracking `assignmentsCreated: 0`
- Is visible in telemetry/logging as an unrouted candidate
- **Is NOT automatically escalated to an ORAN admin**
- **No notification is sent to anyone**

### Gap: No Fallback Routing

This is a **critical gap**. If someone submits a listing for verification in an area with no community admin coverage (rural areas, new states, underserved regions):

1. The listing effectively enters a black hole
2. No human is notified
3. No escalation timer starts
4. The submitter gets no status update
5. The only visibility is in telemetry logs

### Recommendations

1. **Implement fallback-to-ORAN-admin**: When `assignmentsCreated === 0`, automatically:
   - Create assignment to the nearest ORAN admin (they have national scope)
   - Or route to a dedicated "unassigned" queue visible to all ORAN admins
   - Fire `submission_assigned` notification to the ORAN admin

2. **Geographic gap alerting**: Create a scheduled function that:
   - Identifies geographic areas with no admin coverage
   - Reports unassigned candidates older than 24 hours
   - Sends `system_alert` notification to ORAN admins

3. **Submitter feedback**: When routing fails, send a status notification to the submitter: "Your submission is being reviewed. Coverage in your area is limited — we're working to assign a reviewer."

4. **Coverage gap dashboard**: Add a view in the ORAN admin portal showing states/counties with no coverage zones defined, alongside pending unrouted candidates.

---

## 4. Escalation & Re-notification of Unverified Listings

### What Exists

#### SLA Breach Detection

**File**: `functions/checkSlaBreaches/index.ts`

An Azure Functions **timer trigger** runs **every hour** (`0 0 * * * *`):

1. Calls `POST /api/internal/sla-check` (authenticated with `INTERNAL_API_KEY`)
2. The endpoint finds all submissions where `sla_deadline < NOW()` and `sla_breached = false`
3. Marks them `sla_breached = true`
4. Fires `submission_sla_breach` notification to the assignee (fallback: submitter)
5. Returns count of breached submissions

#### SLA Durations (Vary by Confidence)

| Confidence Tier | SLA Duration | Meaning |
|----------------|-------------|---------|
| Green (80–100) | 72 hours | High confidence, routine review |
| Yellow (60–79) | 48 hours | Needs attention |
| Orange (40–59) | 24 hours | Urgently needs review |
| Red (0–39) | 12 hours | Critical — probably wrong data |

#### Notification System

**File**: `src/services/notifications/service.ts`

| Trigger | Event Type | Recipient | Via |
|---------|-----------|-----------|-----|
| Status change | `submission_status_changed` | Submitter | `fireStatusChangeNotification()` |
| Escalation | `two_person_approval_needed` | All community_admin + oran_admin (except actor) | `broadcast()` |
| SLA breach | `submission_sla_breach` | Assignee (fallback: submitter) | `checkSlaBreaches()` |
| Terminal status + contact email | External email | contact_email | Azure Communication Services |

**Channels**: `in_app` and `email` (via Azure Communication Services)

**Notification preferences** (per user): Users must explicitly opt-in to each event type × channel combination. **Default is DISABLED** — notifications are dropped if no preference row exists.

#### Workflow State Machine

```
draft → submitted → auto_checking → needs_review → under_review
  → {approved, denied, escalated, returned, pending_second_approval}
```

**Escalation paths**:

- Community admin can manually escalate (`under_review → escalated`)
- Escalated items become visible to ORAN admins
- `org_claim` and `removal_request` types require two-person approval (`pending_second_approval`)

### Gaps Identified

| Gap | Impact | Priority |
|-----|--------|----------|
| **No automatic escalation after SLA breach** — breach is flagged but listing stays with same admin | Stale listings accumulate if admin is unresponsive | CRITICAL |
| **No re-notification cadence** — SLA breach notification fires once, then nothing | Admin may miss the single notification | HIGH |
| **No escalation from community-admin to ORAN-admin after sustained inaction** | Listings can sit indefinitely with a breached SLA | CRITICAL |
| **Default notification preference is DISABLED** — new admins receive nothing until they opt in | Admins may never know they have assignments | HIGH |
| **No "reminder" notification type** — system can only fire breach, not periodic reminders | No nagging mechanism | MEDIUM |
| **No count-based escalation** — if N listings are pending in an admin's queue beyond SLA, no bulk escalation | Overloaded admins not automatically relieved | MEDIUM |

### Recommendations

1. **Tiered automatic escalation**:

   ```
   SLA breach (T+0):     Notify assignee
   T + 12 hours:         Re-notify assignee + notify their org's host_admin
   T + 24 hours:         Auto-reassign to next nearest admin with capacity
   T + 48 hours:         Escalate to ORAN admin, remove from original admin's queue
   ```

2. **Default notification preferences to ENABLED**: When an admin profile is created, auto-create preference rows with `in_app = true, email = true` for `submission_assigned`, `submission_sla_warning`, `submission_sla_breach`.

3. **Periodic reminder function**: Add a second timer function (daily) that:
   - Finds all `sla_breached = true` submissions still unresolved
   - Sends reminder notifications with escalating urgency
   - After 3 reminders, auto-escalate

4. **SLA warning (pre-breach)**: Fire `submission_sla_warning` at 75% of SLA duration (e.g., 36 hours into a 48-hour SLA) to give admins a heads-up before breach.

---

## 5. Admin Capacity Limits & Scope Control

### Role Hierarchy

**File**: `src/domain/constants.ts`

```
seeker (0) < host_member (1) < host_admin (2) < community_admin (3) < oran_admin (4)
```

### Capacity Limits

**File**: `src/agents/ingestion/routing.ts` → `AdminCapacitySchema`

| Setting | Default | Purpose |
|---------|---------|---------|
| `maxPending` | **10** | Hard limit on pending assignments before new ones stop |
| `maxInReview` | **5** | Concurrent review limit |
| `pendingCount` | 0 (tracked) | Current pending count |
| `inReviewCount` | 0 (tracked) | Current in-review count |

Capacity is enforced by `canAcceptAssignment()`:

```typescript
return admin.isActive && admin.isAcceptingNew && admin.pendingCount < admin.maxPending;
```

Queue counts are maintained by **database triggers** — they auto-update when `candidate_admin_assignments` status changes.

### Is the Limit Separate Per Scope?

**Current state**: The `maxPending = 10` and `maxInReview = 5` are **flat limits on the admin_review_profiles / AdminCapacity table**. They are **not differentiated by scope** (org vs community vs ORAN).

Every admin gets the same default limits regardless of role level. There is no schema column for `scope` or `role_level` on the capacity table.

### How is Control of a Listing Determined?

Listing ownership/control flows through multiple mechanisms:

1. **Assignment**: `candidate_admin_assignments` table links a candidate to an admin profile with status (`pending` → `claimed` → `approved/denied/escalated/withdrawn/expired`)

2. **Lock mechanism**: `is_locked` flag on submissions prevents concurrent edits. Only the lock holder (or an ORAN admin) can transition state. Functions: `acquireLock()` / `releaseLock()`

3. **Organization membership**: `organization_members` table (org_id, user_id, role, status). A `host_admin` can manage all services under their org.

4. **Coverage zones**: PostGIS polygons assigned to community admins. Admin sees listings within their geographic zone.

5. **Platform scopes** (migration 0022): `platform_scopes` + `user_scope_grants` + `pending_scope_grants`. Grants are subject to two-person approval and cannot be self-approved.

### Gaps Identified

| Gap | Impact | Priority |
|-----|--------|----------|
| **No per-scope capacity limits** — ORAN admins get same `maxPending=10` as community admins | ORAN admins should handle more (they're the escalation point) | MEDIUM |
| **No auto-adjustment of capacity** based on historical performance | Fast reviewers get same limits as slow ones | LOW |
| **No listing count limit per org** — an org could claim unlimited services | No protection against data quality dilution | MEDIUM |
| **No admin dashboard showing their own capacity utilization** | Admins can't see how close to limits they are | MEDIUM |
| **`is_accepting_new` is manual only** — no automatic vacation mode when at capacity | Overloaded admins still get assignments until they manually toggle | MEDIUM |

### Recommendations

1. **Scope-differentiated capacity**:

   ```
   community_admin: maxPending = 10, maxInReview = 5
   oran_admin: maxPending = 50, maxInReview = 20
   host_admin: maxPending = 5, maxInReview = 3 (their own org only)
   ```

2. **Auto-capacity scaling**: Track `avgReviewHours` (already in schema) and adjust `maxPending` dynamically. Fast reviewers get more capacity.

3. **Organization service cap**: Add `max_services` to `organizations` table. Default 100. Configurable by ORAN admin. Prevents unbounded growth.

4. **Admin capacity dashboard widget**: Show pending/max, in-review/max, SLA breach count, average review time on the community admin home page.

5. **Auto-pause at capacity**: When `pendingCount >= maxPending`, automatically set `is_accepting_new = false`. Re-enable when count drops below 80% of max.

---

## 6. Gap Summary & Implementation Roadmap

### Critical Gaps (Must Fix)

| # | Gap | Current State | Required |
|---|-----|--------------|----------|
| C1 | ~~**No fallback routing when no admin exists**~~ | ✅ RESOLVED | `functions/routeToAdmin/index.ts` — falls back to ORAN admins; fires `system_alert` when no admins available |
| C2 | ~~**No automatic escalation after SLA breach**~~ | ✅ RESOLVED | `src/services/escalation/engine.ts` — 4-tier cadence (T+0/12/24/48h): notify → renotify+alert org → reassign → escalate to ORAN |
| C3 | ~~**Service attributes not queryable via search API**~~ | ✅ RESOLVED | `attributeFilters` in `SearchFiltersSchema` + per-taxonomy EXISTS subquery in `buildFiltersWhereClause()` |

### High Priority Gaps

| # | Gap | Current State | Required |
|---|-----|--------------|----------|
| H1 | ~~**No re-notification cadence**~~ | ✅ RESOLVED | `src/services/escalation/engine.ts` — T+12h renotify assignee + alert org host_admins |
| H2 | ~~**Default notifications DISABLED for new admins**~~ | ✅ RESOLVED | `ensureDefaultNotificationPreferences()` + `backfillAdminNotificationPreferences()` in escalation engine |
| H3 | ~~**No service type filter in Directory UI**~~ | ✅ RESOLVED | Collapsible attribute dimension filter in `DirectoryPageClient.tsx` with delivery/cost/access tag chips |
| H4 | ~~**No SLA pre-warning**~~ | ✅ RESOLVED | `checkSlaWarnings()` fires at 75% of SLA window |
| H5 | ~~**Submitter not notified when routing fails**~~ | ✅ RESOLVED | `submittedByUserId` on `RouteQueueMessage` fires `submission_status_changed` notification in fallback block |

### Medium Priority Gaps

| # | Gap | Current State | Required |
|---|-----|--------------|----------|
| M1 | ~~**No per-scope capacity limits**~~ | ✅ RESOLVED | `ROLE_CAPACITY_DEFAULTS` (oran: 50/20, community: 10/5, host: 5/3) in `routing.ts` |
| M2 | ~~**No composite search presets**~~ | ✅ RESOLVED | 8 presets in `src/services/search/presets.ts`; `preset` query param on `GET /api/search` |
| M3 | ~~**No auto-pause at capacity**~~ | ✅ RESOLVED | `shouldToggleAcceptingNew()` with AUTO_RESUME_THRESHOLD=0.8 in `routing.ts` |
| M4 | ~~**No coverage gap dashboard**~~ | ✅ RESOLVED | `src/services/coverage/gaps.ts` + `POST /api/internal/coverage-gaps` + `GET /api/admin/capacity` + `alertCoverageGaps` Azure Function |
| M5 | ~~**No org service cap**~~ | ✅ RESOLVED | `organization_settings.max_services` (default 100) + `src/services/organizations/serviceCaps.ts` |

### What Already Works Well

- ✅ **LLM tagging pipeline** — 9 stages, structured JSON extraction, validated against canonical taxonomy, confidence scoring, color-coded tiers
- ✅ **Deterministic search** — Pure SQL, no LLM in retrieval, PostGIS geo-queries
- ✅ **Scoring model** — 3 sub-scores (verification/eligibility/constraint), transparent weights, trust bands
- ✅ **Hourly SLA enforcement** — Timer function catches breaches
- ✅ **Two-person approval** — For org claims and removal requests
- ✅ **Capacity-limited routing** — PostGIS proximity + capacity checks
- ✅ **Full audit trail** — Every state transition, assignment, and decision logged
- ✅ **Notification infrastructure** — In-app + email (ACS), per-user preferences, idempotency keys
- ✅ **Taxonomy SSOT** — 100+ validated tags across 6 dimensions, centralized in `src/domain/taxonomy.ts`
- ✅ **Tag validation** — LLM output validated against taxonomy; invalid tags rejected before storage
- ✅ **Privacy-first** — No PII in logs/telemetry, approximate location, consent-gated

---

## Appendix A: Key Source Files

| Area | File | Purpose |
|------|------|---------|
| Taxonomy SSOT | `src/domain/taxonomy.ts` | All valid tags (500+ lines) |
| Confidence tiers | `src/domain/confidence.ts` | Tier calculation, normalization |
| Search engine | `src/services/search/engine.ts` | SQL query builder, filters |
| Search API | `src/app/api/search/route.ts` | Public search endpoint |
| Scoring model | `src/services/scoring/scorer.ts` | Deterministic scoring |
| Scoring spec | `docs/SCORING_MODEL.md` | Scoring contract |
| Tagging prompt | `src/services/ingestion/tagging-prompt.ts` | LLM prompt + validation |
| Pipeline stages | `src/agents/ingestion/pipeline/stages.ts` | 9-stage pipeline |
| Pipeline orchestrator | `src/agents/ingestion/pipeline/orchestrator.ts` | Stage execution |
| Escalation engine | `src/services/escalation/engine.ts` | Tiered auto-escalation + SLA warnings |
| Route to admin | `functions/routeToAdmin/index.ts` | Geographic routing + ORAN fallback |
| Admin routing | `src/agents/ingestion/routing.ts` | Capacity + assignment logic |
| Admin assignments | `src/agents/ingestion/adminAssignments.ts` | SLA calculation |
| Tag confirmations | `src/agents/ingestion/tagConfirmations.ts` | Color-coded tag queue |
| Confirmations (publish) | `src/agents/ingestion/confirmations.ts` | Publish gate |
| SLA breach checker | `functions/checkSlaBreaches/index.ts` | Hourly SLA enforcement |
| Notifications | `src/services/notifications/service.ts` | Send/broadcast/preferences |
| Workflow engine | `src/services/workflow/engine.ts` | State machine + gates |
| Verify candidate | `functions/verifyCandidate/index.ts` | LLM discrepancy check |
| Directory UI | `src/app/(seeker)/directory/DirectoryPageClient.tsx` | Seeker search + filters |
| Verify UI | `src/app/(community-admin)/verify/VerifyPageClient.tsx` | Admin review interface |
| Role constants | `src/domain/constants.ts` | Roles, weights, notification events |
| DB schema | `src/db/schema.ts` | Drizzle ORM schema |

## Appendix B: Database Tables Involved

| Table | Migration | Purpose |
|-------|-----------|---------|
| `taxonomy_terms` | 0000 | HSDS taxonomy hierarchy |
| `service_taxonomy` | 0000 | Service ↔ taxonomy junction |
| `service_attributes` | 0012 | 6-dimension tag storage (UNIQUE on service_id + taxonomy + tag) |
| `confidence_scores` | 0000 | Per-service 3-sub-score breakdown |
| `extracted_candidates` | varies | Ingestion staging with computed `confidence_tier` |
| `resource_tags` | varies | Polymorphic tags with confidence |
| `tag_confirmations` | varies | Admin confirmation queue, color-coded |
| `admin_review_profiles` | 0018 | Capacity, location, coverage, expertise |
| `candidate_admin_assignments` | 0018 | Routing assignments with SLA |
| `coverage_zones` | 0005 | PostGIS polygons for admin territories |
| `admin_routing_rules` | varies | Geographic routing rules |
| `submissions` | 0022 | Universal submission pipeline |
| `submission_transitions` | 0022 | Audit trail for state changes |
| `notifications` | 0022 | In-app notification storage |
| `notification_preferences` | 0022 | Per-user channel preferences |
| `organization_members` | 0006 | Org ↔ user membership |
| `user_profiles` | 0006 | Privacy-first user profiles |
| `platform_scopes` | 0022 | Named permission scopes |
| `user_scope_grants` | 0022 | Direct scope grants |
| `pending_scope_grants` | 0022 | Two-person approval queue |

## Appendix C: LLM Tagging Prompt (Full Reference)

The prompt sent to `gpt-4o-mini` is generated by `generateTaggingPrompt()` in `src/services/ingestion/tagging-prompt.ts`. It:

1. Sets system context: "You are an expert data tagger for ORAN"
2. Provides 4 critical rules (no invented tags, be conservative, distinguish service vs location, note uncertainty)
3. Injects the raw service description text
4. Provides the complete valid taxonomy reference (auto-generated from `src/domain/taxonomy.ts`)
5. Specifies the exact JSON output schema with examples
6. Requires a 0–100 `confidence` score and a `warnings` array

The response is then:

- Parsed from JSON (handles markdown code fences)
- Every tag validated against `src/domain/taxonomy.ts` via `validateAndFilterTags()`
- Invalid tags removed with warnings logged
- Result stored in staging tables
- Tags below green confidence threshold enter `tag_confirmations` queue for human review
