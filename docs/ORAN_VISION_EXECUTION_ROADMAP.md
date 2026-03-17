# ORAN Vision Execution Roadmap

Updated: 2026-03-17

## Purpose

This document translates the ORAN vision into an execution-grade roadmap for product, UX, data model, APIs, operations, safety, and rollout.

It is not a brand manifesto. It is a concrete plan for moving ORAN from a high-quality discovery product into a guided survival, stabilization, and upward-mobility platform while preserving the repo's non-negotiables:

- retrieval-first truthfulness
- no hallucinated service facts
- crisis hard gate before normal assistance
- eligibility caution
- privacy-first defaults
- no LLM in retrieval or ranking

This roadmap is written to be implemented in phases, audited before execution, and revised whenever the safety contract, data model, or system boundaries change.

## Non-Negotiable Execution Invariants

The execution layer may never weaken the current ORAN safety contract.

The following rules are binding for every phase in this roadmap:

1. Crisis routing must preempt plans, reminders, saved flows, and chat mutations.
2. Execution objects may reference stored provider facts, but may not invent provider facts.
3. Any ORAN-generated guidance must be clearly distinguishable from provider-supplied facts.
4. Eligibility must remain conditional everywhere: may qualify, confirm with provider.
5. Durable execution state must remain local-first by default unless the user explicitly opts into sync.
6. Feature flags for seeker execution must default to off and may never gate crisis protections.

## Determinism Definition

For this roadmap, deterministic means:

- behavior is produced by explicit, inspectable rules
- branching is traceable to input facts, stored schema, user-confirmed state, or user-authored edits
- the same inputs produce the same structured outputs
- no LLM is used to retrieve, rank, choose, or mutate execution objects

Deterministic does not mean:

- merely consistent-looking output
- hidden heuristics without a written contract
- freeform AI generation framed as a recommendation engine

Any future optional summarization must summarize already-grounded execution objects only and must not add facts, requirements, deadlines, or provider instructions.

## Executive Summary

ORAN already has a serious foundation:

- retrieval-first chat
- strong directory and map discovery
- saved services with collection support
- seeker profile shaping with privacy controls
- trust scoring and verification workflows
- admin and community surfaces that protect catalog quality

What ORAN does not yet have is the full execution layer that makes the product feel like an AI case manager and real-world navigation system.

The biggest missing leap is this:

- today ORAN is strong at finding, comparing, saving, and trusting services
- target ORAN must also plan, sequence, remind, adapt, track progress, and help the user execute over time

That means the next era of ORAN is not a cosmetic redesign. It is the addition of first-class product objects and workflows:

- plans
- action items
- checklists
- reminders
- route bundles
- progress timelines
- seeker-visible trust explanations
- closed-loop updates
- deterministic next-step orchestration

The correct implementation strategy is not to force all of that into chat at once. The correct strategy is to build a layered execution system around the existing retrieval-first core.

## Product North Star

ORAN should behave like:

- an AI case manager for planning and prioritization
- a real-world execution engine for what to do, where to go, when to go, what to bring, and what to do next
- a living support system that remembers the user's path with explicit consent

ORAN should not behave like:

- a generic search box
- an undifferentiated directory
- a map with pins and little operational guidance
- a passive bookmark list

The target user feeling is:

- I am understood
- I know what to do first
- I know what matters today
- I have a real plan
- I have backups if something fails
- this system is helping me move forward without overwhelming me

## Current State Assessment

### Strong Today

- Retrieval-first chat pipeline with crisis-first gating and deterministic retrieval.
- Directory and map surfaces with trust filters, search state, and strong service rendering.
- Saved services with local-first privacy posture and optional sync.
- Saved collections that already hint at bundle-oriented behavior.
- Seeker profile shaping with explicit consent boundaries.
- Confidence scoring and verification posture that support trust.
- Community-admin, host, and ORAN-admin workflows that improve catalog integrity.
- Notifications and notification preferences infrastructure.

### Present But Underpowered

- Chat carries discovery context but is not yet the command center for plans, tasks, timelines, and reminders.
- Saved collections exist but are not yet operational bundles with deadlines, route feasibility, or next-step semantics.
- Profile shaping improves retrieval, but the seeker cannot clearly see how profile context is changing outcomes.
- Notifications exist, but seeker-facing event coverage is too thin for execution-oriented workflows.
- Trust signals exist, but the seeker experience still needs clearer plain-language explanations, freshness cues, and follow-through.

### Missing Or Mostly Missing

- First-class plans.
- First-class tasks or checklist items.
- Reminders and follow-up flows.
- Progress tracking and timelines.
- Deterministic next-step orchestration.
- Seeker-visible application or outreach history.
- Cross-session execution continuity with explicit consent.
- Route feasibility and stacked action planning.
- Seeker-facing fallback logic when a recommended path fails.
- Closed-loop notifications when services change, reports are resolved, or plans need adaptation.

## Capability Gap Matrix

### 1. Product Model Gap

Target:

- ORAN organizes the user's life around needs, constraints, time, and execution.

Current gap:

- The product still centers mostly on discovery surfaces plus saved state.

Required lift:

- Add a guidance layer that turns retrieved records into structured, editable, user-controlled execution objects.

### 2. Chat Gap

Target:

- Chat is the strategic command center.

Current gap:

- Chat can find services and save them, but cannot yet reliably create or manage plans, tasks, reminders, bundles, or schedule changes.

Required lift:

- Introduce deterministic chat actions for plan management without allowing chat to invent service facts.

### 3. Execution Object Gap

Target:

- Plans, tasks, reminders, route bundles, and timelines are first-class product objects.

Current gap:

- These objects are not yet modeled as seeker-facing entities.

Required lift:

- Add schema, services, APIs, UI contracts, and notifications for execution objects.

### 4. Trust Transparency Gap

Target:

- Users understand what is verified, what may be stale, how reliable a recommendation is, and what to do if something fails.

Current gap:

- Trust exists technically, but not yet at the full emotional and operational level required by the vision.

Required lift:

- Add clearer trust explanations, freshness messaging, fallback recommendations, and closed-loop follow-up.

### 5. Continuity Gap

Target:

- ORAN remembers the user's path over time with consent.

Current gap:

- Discovery continuity is partially present, but execution continuity is not.

Required lift:

- Add durable, consented continuity for plans and reminders before adding broader memory features.

### 6. Routing And Real-World Logistics Gap

Target:

- ORAN helps users decide where to go first, what they can make in time, and what the fallback is if timing fails.

Current gap:

- Map and detail pages show place context, but route feasibility and stacked action planning are not first-class behaviors.

Required lift:

- Add time-aware, constraint-aware, and fallback-aware execution guidance grounded only in stored records and deterministic rules.

## Guiding Build Principles

1. Build execution around retrieval, not instead of retrieval.
2. Keep all user-visible service facts grounded in stored records only.
3. Treat plans and tasks as user-controlled objects, not opaque AI output.
4. Favor deterministic orchestration before optional LLM summarization.
5. Ship continuity only behind clear consent and retention rules.
6. Make trust and fallback visible wherever execution decisions are made.
7. Sequence the roadmap so safety and truth contracts get stronger, not weaker, as intelligence increases.
8. Require explicit data-lineage rules for any task field that might otherwise invite hallucination.

## Required Phase 0 Outputs

Phase 0 is not complete until it produces enforceable artifacts, not just intent.

Required outputs:

- ADR for seeker execution layer determinism and safety boundary.
- Written chat mutation contract with payload schemas and resolution rules.
- Proposed migrations for seeker execution objects.
- Feature-flag matrix with names, owners, defaults, and dependencies.
- Initial determinism and crisis-preemption test suites.
- Security and privacy updates for consent, retention, export, and deletion.

## Phased Execution Plan

## Phase 0. Contract Hardening And Design Baseline

Objective:

- Establish the contracts that make the rest of the roadmap safe to build.

Deliverables:

- Add an ADR for the seeker execution layer boundary.
- Extend SSOT docs for new seeker execution objects and chat mutation rules.
- Define a product contract for deterministic plan generation, task creation, reminder scheduling, and fallback logic.
- Define privacy and retention constraints for any new durable seeker state.
- Define feature flags for major seeker execution capabilities.
- Define which execution fields are provider-grounded, ORAN-derived, or user-authored.
- Define crisis-preemption test requirements for all execution-aware chat flows.

Required ADR scope:

- define deterministic behavior precisely
- restate that crisis routing preempts all execution flows
- define what chat may mutate and what it must refuse
- define the boundary between provider facts, ORAN guidance, and user-authored data

Required feature-flag contract:

- `seeker_plans_enabled`: default off
- `seeker_reminders_enabled`: default off, dependent on plans
- `seeker_route_feasibility_enabled`: default off, independent rollout later
- `seeker_execution_dashboard_enabled`: default off

All execution flags must live under the typed flags service and may never control crisis detection or crisis routing behavior.

Feature-flag dependency graph:

- `seeker_plans_enabled`: foundational
- `seeker_reminders_enabled`: requires `seeker_plans_enabled`
- `seeker_route_feasibility_enabled`: can roll out independently after plan foundations exist
- `seeker_execution_dashboard_enabled`: requires plans and reminders

Invalid combinations must fail safe and degrade to the lower-risk state.

Required privacy contract:

- plans default to local-only storage
- reminders default to local-only until sync is explicitly enabled
- synced execution objects must be included in data export
- synced execution objects must be covered by deletion and retention policies
- retention windows must be documented before server persistence ships

Required docs:

- docs/CHAT_ARCHITECTURE.md
- docs/DATA_MODEL.md
- docs/SECURITY_PRIVACY.md
- docs/ui/UI_UX_CONTRACT.md
- docs/ui/UI_SURFACE_MAP.md
- docs/DECISIONS/

Exit criteria:

- ADR is merged and references crisis preemption explicitly.
- Determinism and mutation contracts are written and reviewed.
- Proposed migrations exist for execution objects.
- Security and privacy docs are updated for durable execution state.
- Determinism tests and crisis-preemption regression tests exist.
- The new execution layer has explicit non-hallucination, privacy, and retention rules.
- SSOT alignment mapping is updated for execution-layer touch points.

## Phase 1. Seeker Execution Foundation

Objective:

- Introduce first-class execution objects without overloading chat.

Deliverables:

- Create a new data model for seeker plans, plan steps, reminders, and progress events.
- Add APIs for creating, reading, updating, reordering, and archiving plan objects.
- Add a lightweight plan workspace in the seeker surface.
- Allow a saved service to be added to a plan as an action candidate, not just as a bookmark.
- Allow a task to store:
  - linked service
  - why it matters
  - urgency
  - target timing
  - what to ask
  - what to bring
  - fallback if missed

Data-lineage rules:

- `linked service` must resolve to a stored service record or remain empty.
- `why it matters` must be user-authored or ORAN-derived from explicit deterministic templates.
- `what to ask` may only use stored provider process text when available; otherwise it stays blank or user-authored.
- `what to bring` may only use stored provider requirements or explicit ORAN rule outputs tied to schema-backed facts.
- `fallback if missed` must be user-selected in Phase 1 and may not be auto-generated yet.
- any user-authored or ORAN-derived task field must be visibly labeled as such in the product contract.

Suggested product objects:

- seeker_plans
- seeker_plan_items
- seeker_plan_item_links
- seeker_reminders
- seeker_progress_events

Minimum viable plan definition:

- a plan must have a title
- a plan must contain an ordered list of items
- a plan item must support:
  - description
  - status
  - optional linked service
  - optional target date
  - visible trust and freshness context when linked to a service

If a Phase 1 implementation cannot support those fields, it is not a true plan MVP.

Design rules:

- Every execution object must be user-editable.
- Every AI-created suggestion must be reviewable before commit.
- Every execution object must point back to grounded source records when service facts are shown.
- Every plan item with eligibility context must carry an eligibility snapshot or link back to current eligibility messaging.
- Plans must remain distinct from saved collections in schema, API, and UX semantics.

Stale-risk visibility rules:

- plan items should show a stale-risk warning when the linked service has materially aged beyond freshness thresholds, changed trust state significantly, or moved into a held or unavailable state
- Phase 1 only requires visibility, not auto-replanning
- later phases may add re-evaluation and notification behavior

Exit criteria:

- A seeker can create and manage a real plan, even if chat is not yet deeply integrated.
- Saved stops being a dead-end list and becomes an input into action planning.
- The product can show whether a task field is grounded, derived, or user-authored.
- Export and deletion handling for any synced plan objects is validated before Phase 1 ships broadly.
- Phase 2 may not begin rollout until Phase 1 behavior is validated in production behind flags.

## Phase 2. Chat As Command Center

Objective:

- Make chat capable of managing execution objects through deterministic intents.

Deliverables:

- Add a chat action grammar for:
  - save this
  - add this to my plan
  - make this tomorrow
  - mark this urgent
  - move this to next week
  - remove this task
  - group these under housing
  - what should I do first
- Add server-side intent handlers for plan mutation, reminder mutation, and bundle organization.
- Add chat response components that can render:
  - proposed task cards
  - plan diffs
  - reminder confirmations
  - fallback options
- Add user confirmation for destructive or ambiguous mutations.

Reminder timing note:

- Phase 2 reminder creation may ship with local-only reminder confirmations first.
- Broader reminder notification delivery should not ship until notification taxonomy, consent, and deduplication rules are ready.

Chat mutation resolution rules:

- `save this` and `add this to my plan` require a resolvable reference from current results, recent results, or an explicit service identifier.
- vague commands such as "add housing help" must trigger clarification, not synthesis.
- bulk mutations must return a proposed diff before commit.
- destructive mutations must require explicit confirmation.

Guardrails:

- Chat mutation intents must be deterministic and schema-backed.
- Chat may not synthesize unsupported deadlines, addresses, hours, or eligibility facts.
- Chat must disclose when a plan step is inferred from deterministic rules rather than explicit provider instructions.
- Crisis detection must still run before plan loading, plan mutation, or reminder evaluation.

Concurrency rules:

- if chat and UI edits conflict, the system must prefer explicit conflict handling over silent last-write-wins behavior
- bulk or concurrent edits should return a refresh-and-confirm flow instead of silently merging divergent plan state

Exit criteria:

- Chat can actually manage the user's plan, not just answer questions and return listings.
- A crisis message during an active planning session routes immediately without execution-layer delay.
- Phase 2 rollout cannot begin until Phase 1 is live, stable, and signed off as the source of truth for execution objects.

## Phase 3. Route Feasibility And Real-World Logistics

Objective:

- Move ORAN from static discovery into operational navigation.

Deliverables:

- Add route-aware action framing to plan items and service detail.
- Add deterministic feasibility signals such as:
  - closes soon
  - good first stop today
  - combine with nearby stop
  - keep as backup if missed
- Add stacked-day planning for multiple services in one trip.
- Add fallback logic for missed windows and closure timing.
- Add a route bundle concept for grouped actions.

Constraints:

- Any routing estimate must remain clearly labeled as approximate.
- Timing guidance must fail safe when hours or route data are incomplete.
- If the system cannot determine feasibility honestly, it must say so.
- Timing labels must be suppressed when hours freshness or location quality is too weak.
- Auto-generated fallback ranking remains out of scope for this phase.

Data-quality dependency rules:

- `closes soon` requires hours data that is recent enough and explicit closing time presence.
- `good first stop today` requires trustworthy timing inputs and location presence.
- `combine with nearby stop` requires deterministic distance logic and conservative proximity thresholds.
- if those inputs are missing or stale, the UI must degrade to call-ahead or manual-planning guidance.

Exit criteria:

- The seeker can understand not just what exists, but what is realistic to do now, next, and later.

## Phase 4. Trust, Freshness, And Closed-Loop Support

Objective:

- Make trust visible at the level required for high-stakes execution.

Deliverables:

- Add plain-language trust explanations to seeker cards and detail views.
- Add freshness labels and stale-data warnings where appropriate.
- Add seeker-visible outcomes for reports and corrections when permitted by policy.
- Add notifications for:
  - service changed
  - saved service may be stale
  - report resolved
  - reminder due
  - plan milestone reached
- Add plan-level fallback suggestions when a service degrades in trust.

Notification policy rules:

- seeker execution notifications must only monitor services the seeker explicitly saved, planned, or asked to follow.
- execution notifications must be deduplicated and coalesced.
- reminder notifications must be opt-in and scoped to user-created reminders.
- low-confidence service-change events should bias toward digesting rather than interruptive alerts.

Exit criteria:

- The user can see what confidence to have in a recommendation and what to do if trust is limited.

## Phase 5. Progress, Milestones, And Life Navigation Center

Objective:

- Turn profile into a true recovery and navigation dashboard.

Deliverables:

- Add a seeker dashboard view that reflects:
  - active path
  - current plan
  - urgent tasks
  - reminders
  - saved bundles
  - progress milestones
  - recent service changes
- Add milestone semantics such as:
  - immediate survival
  - stabilization
  - documentation
  - benefits
  - employment preparation
  - long-term stability
- Add user notes and progress journaling only if privacy rules and storage discipline are explicitly defined.

Exit criteria:

- The seeker can tell where they are, what changed, and what to do next from one place.

## Phase 6. Advanced Adaptation And Optional Intelligence

Objective:

- Improve guidance quality without weakening safety or truthfulness.

Deliverables:

- Add deterministic next-step recommendation rules that sequence actions by urgency, timing, constraints, and trust.
- Add curated operator-authored path templates and emergency kits.
- Optionally add limited summarization to explain already-grounded plans more clearly.

Non-goals for this phase:

- No LLM-based retrieval.
- No autonomous action taking.
- No hidden reasoning that mutates user plans without a visible audit trail.

Exit criteria:

- ORAN feels more intelligent, but still behaves like a disciplined, inspectable system.

## Cross-Functional Workstreams

### A. Product And UX

- Define plan UX, task UX, reminder UX, fallback UX, and dashboard UX.
- Introduce a calm, execution-first information hierarchy.
- Standardize the Surface -> Expand -> Act pattern across chat, cards, detail, saved, and plan surfaces.
- Reduce cognitive load by limiting simultaneous options and emphasizing recommended next actions.

### B. Data Model And Persistence

- Introduce seeker execution tables behind migrations.
- Define archival and deletion semantics.
- Preserve current privacy-first local mode while adding opt-in sync for plans.
- Ensure schema clearly distinguishes:
  - stored provider facts
  - derived execution metadata
  - user-authored notes or statuses

### C. API Layer

- Add plan CRUD APIs.
- Add reminder APIs.
- Add mutation-safe chat action endpoints or orchestrator extensions.
- Add notification event expansion for seeker execution use cases.

### D. Search And Chat Services

- Add deterministic plan orchestration services that consume retrieved records without modifying retrieval ranking.
- Add intent handling for plan and reminder commands.
- Add strict guards for unsupported commands and ambiguous mutations.

### E. Map And Routing

- Extend map and service detail with feasibility and fallback framing.
- Introduce approximate route bundles only when supported by available data.
- Keep route guidance clearly labeled and privacy-safe.

### F. Trust And Governance

- Increase plain-language trust messaging.
- Add closed-loop resolution signaling where policy allows.
- Ensure integrity holds and stale-risk states are meaningfully visible to seekers.

### G. Notifications And Follow-Through

- Expand event taxonomy for seeker execution.
- Add reminder due flows.
- Add service-change digests for relevant saved or planned services.
- Add milestone progress notifications conservatively to avoid alert fatigue.

### H. Testing And Reliability

- Add focused tests for plan mutations, reminder scheduling, and fallback generation.
- Add contract tests for non-hallucination across plan creation.
- Add UI tests for plan editing and chat command flows.
- Add regression tests that ensure no plan-generation path can invent provider facts.

## Dependency Order

This order matters.

1. Contracts, safety rules, and privacy rules.
2. Data model for execution objects.
3. Basic plan workspace outside chat.
4. Chat mutation grammar and plan integration.
5. Reminder and notification expansion.
6. Route feasibility and fallback logic.
7. Dashboard-level continuity and progress views.
8. Optional advanced intelligence.

Do not invert this order. If chat becomes "smart" before execution objects exist, the product will become inconsistent, hard to test, and vulnerable to regressions.

## Key Failure Modes To Design Against

### Failure Mode 1. Plan Hallucination

Risk:

- The system invents instructions, deadlines, requirements, or provider-specific process steps.

Prevention:

- Distinguish provider facts from ORAN guidance in both schema and UI.
- Allow only deterministic guidance templates tied to stored facts and user context.
- Add tests that fail when unsupported claims are rendered.

### Failure Mode 2. Chat Becomes An Unsafe Mutation Layer

Risk:

- Natural-language commands mutate plans unpredictably or destructively.

Prevention:

- Use schema-backed intents.
- Require confirmation for ambiguous, destructive, or bulk changes.
- Return structured diffs before commit where appropriate.

### Failure Mode 3. Privacy Drift

Risk:

- New execution features silently store more seeker state than intended.

Prevention:

- Keep local-first defaults.
- Add explicit sync consent for new durable objects.
- Define retention and deletion up front.

### Failure Mode 4. Alert Fatigue

Risk:

- Reminders and updates become noisy, causing users to ignore the system.

Prevention:

- Add event deduplication.
- Batch low-priority updates.
- Default to meaningful reminders only.

### Failure Mode 5. False Precision In Routing

Risk:

- The product implies route or timing certainty it does not actually have.

Prevention:

- Mark route guidance as approximate.
- Fail safe when hours or transport inputs are weak.
- Always offer a truthful fallback when certainty is low.

### Failure Mode 6. Execution Surfaces Drift From Trust Model

Risk:

- Plans and tasks become detached from current service freshness, verification status, or integrity holds.

Prevention:

- Link plan items to trust state.
- Trigger re-evaluation when linked services change materially.
- Surface stale-risk or unavailable status in the plan workspace.

## Rollout Strategy

### Milestone A. Foundation Release

- Plan objects exist.
- Users can manually build and edit plans.
- No deep chat mutation yet.

### Milestone B. Command Release

- Chat can create and manage plan items with deterministic commands.
- Reminders and notifications begin shipping behind flags.

### Milestone C. Logistics Release

- Route feasibility, fallback logic, and stacked-day planning become visible.

### Milestone D. Continuity Release

- Dashboard-level continuity, milestones, and closed-loop support are live.

Each milestone should ship behind explicit feature flags and measured rollout.

Suggested rollout gates:

- internal-only validation first
- small canary rollout second
- progressive rollout only after safety, latency, and hallucination checks remain within thresholds
- kill switches documented for every high-risk execution flag
- rollback behavior documented for persisted execution objects when a feature flag is disabled mid-rollout

## Metrics And Validation

### Product Metrics

- plan creation rate
- plan completion rate
- reminder completion rate
- saved-to-plan conversion rate
- report resolution follow-through rate
- seeker return rate after first successful plan

### Trust Metrics

- stale-service exposure rate
- plan items linked to degraded trust state
- seeker report-to-resolution visibility rate
- rate of fallback usage after first recommendation fails

### Safety Metrics

- crisis-routing preemption integrity
- crisis-routing latency delta versus current baseline
- hallucination test pass rate for plan-generation flows
- mutation confirmation coverage for risky chat commands
- deletion and data-export correctness for new seeker objects
- consent acceptance and decline rates for new synced execution objects

Suggested crisis latency target:

- execution-layer work must not materially change crisis routing responsiveness
- Phase 0 should capture the current baseline
- later phases should use a strict allowed latency delta and block rollout if exceeded

## Documentation Changes Required On Touch

When this roadmap begins execution, update these docs as each area changes:

- docs/CHAT_ARCHITECTURE.md
- docs/DATA_MODEL.md
- docs/SECURITY_PRIVACY.md
- docs/ui/UI_UX_CONTRACT.md
- docs/ui/UI_SURFACE_MAP.md
- src/services/chat/README.md
- src/services/search/README.md when discovery continuity affects search contracts
- src/app/(seeker)/README.md
- docs/ENGINEERING_LOG.md for contract-level changes

## Self-Audit Pass 1: Sequencing And Scope Review

Assessment:

- The roadmap originally risked over-centering chat before execution objects existed.
- It also risked treating route guidance as a feature flourish rather than a data-quality-sensitive system.

Corrections applied:

- Basic plan workspace now precedes deep chat command support.
- Route feasibility is deferred until after foundational execution objects exist.
- Optional intelligence is explicitly late-phase, not foundational.

Residual concern:

- Even with this sequencing, the team could still try to overload saved collections instead of adding true plan objects.

Mitigation:

- Saved collections should remain organizational tools.
- Plans must be modeled separately, with explicit timing, urgency, fallback, and progress semantics.

## Self-Audit Pass 2: Safety, Privacy, And Regression Review

Assessment:

- The biggest risk area is not UI complexity. It is contract drift: new plan and reminder features could quietly weaken the truth model or privacy posture.

Corrections applied:

- The roadmap now distinguishes provider facts from ORAN-derived guidance.
- Consent and retention are explicitly required before durable continuity expands.
- Chat mutation behavior is constrained to deterministic, inspectable intents.
- Trust-state linkage is called out so plans cannot silently outlive service reliability.

Residual concern:

- Notification expansion can create noisy, low-trust behavior if shipped without event deduplication and severity rules.

Mitigation:

- Add notification coalescing and importance tiers before broad seeker reminder rollout.

## Self-Audit Pass 3: Crisis Preemption And Mutation Safety

Assessment:

- The execution roadmap only works if an active plan, pending reminder, or chat mutation never delays crisis handling.
- The next highest-risk area is vague chat mutation language such as "add this" or "move that" when the reference is not resolvable.

Corrections applied:

- crisis routing is now explicitly defined as preempting all execution behavior
- chat mutation resolution rules now require resolvable references or clarification
- destructive or ambiguous changes now require explicit confirmation or a structured diff

Residual concern:

- Teams may still try to auto-generate fallback alternatives too early because it feels productively helpful.

Mitigation:

- Keep auto-ranked fallback selection out of early phases until trust-state linkage, data-quality thresholds, and deterministic ranking rules are all formally specified and tested.

## Final Recommendation Before Execution

Do not begin by redesigning the chat UI or adding AI-heavy behavior.

Begin with:

1. the contract and ADR work
2. the seeker execution data model
3. a lightweight plan workspace outside chat
4. strict tests for deterministic plan generation and mutation

If those pieces are built correctly, ORAN can evolve into the envisioned case-manager product without sacrificing truth, safety, privacy, or testability.

If those pieces are skipped, later UX work will look impressive but will regress into a brittle, inconsistent system that feels smarter than it actually is.
