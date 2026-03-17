# ORAN Vision Execution Plan

Status: Draft for pre-execution review  
Last updated: 2026-03-17

## Purpose

This document turns the ORAN vision into a concrete execution plan.

It is not a branding memo and it is not a public roadmap. It is an internal build plan for moving ORAN from a strong retrieval-first resource platform into a guided survival, stabilization, and upward-mobility system that behaves like an AI case manager and real-world execution engine.

The plan is written against the current repository state, current contracts, and current seeker/admin/host surfaces.

## Non-Negotiables That Still Govern This Plan

These remain fixed and every phase below must preserve them:

- Retrieval-first: seeker-visible service facts come from stored records only.
- No hallucinated facts: ORAN must never invent services, hours, phone numbers, eligibility, addresses, URLs, or availability.
- Crisis hard gate: 911 / 988 / 211 routing preempts normal assistance flows.
- Eligibility caution: use may qualify / confirm with provider language.
- Privacy-first: approximate location by default, explicit consent before persistence.
- No LLM in retrieval or ranking.
- Any AI planning behavior must operate on retrieved records, structured user context, and deterministic rules or bounded post-retrieval summarization only.

## Executive Readout

ORAN already has meaningful infrastructure in place:

- A retrieval-first chat pipeline with crisis gating.
- Distinct seeker discovery surfaces across chat, directory, map, saved, profile, report, and notifications.
- Shared service cards, confidence surfacing, and privacy-forward local persistence.
- Early collection concepts for saved services.
- Admin and host surfaces for trust, verification, and supply-side operations.

What ORAN does not yet have is the product layer that turns discovery into guided execution over time.

The largest missing capability clusters are:

- Situation intake that produces a living plan instead of only a result set.
- A first-class plan/checklist/task model.
- Sequenced action guidance with deadlines, documents, what-to-say, and fallback logic.
- Operational reminders and task scheduling tied to seeker goals.
- Real route and time feasibility for action planning.
- A stronger command-center role for chat that can mutate plans and saved systems.
- A seeker command hub that feels like a recovery dashboard, not only preferences plus bookmarks.
- Trust signals that better support execution decisions, not only result evaluation.
- Metrics, rollout, and regression controls for a more agentic product surface.

The right approach is not to rewrite ORAN. The right approach is to layer these capabilities in phases while preserving the platform's existing safety contracts and discovery strengths.

## Current-State Assessment

## What Exists Today

### Discovery foundation

- Chat, directory, and map are implemented and share a common retrieval-first service-card model.
- Service detail already carries browse context across discovery surfaces.
- The seeker shell already has a context strip and cross-surface continuity primitives.
- Saved resources already support local persistence, optional sync, and collections.

### Trust and safety foundation

- Crisis handling is documented and enforced early in chat.
- Confidence/trust cues already exist in seeker surfaces.
- Verification, community admin review, and operator governance are implemented as separate verticals.

### Persistence foundation

- Local seeker context exists.
- Notification infrastructure exists for authenticated users.
- Saved-service and preference persistence patterns already exist.

### Operator foundation

- Host, community-admin, and ORAN-admin surfaces already exist.
- Workflow, verification, coverage, and audit concepts are already present in the repository.

## What Exists But Is Still Too Thin For The Vision

### Saved workspace

ORAN has saved resources and collections, but these still behave closer to organized bookmarks than a life logistics system.

Missing layers:

- time-based bundles such as Today, Tomorrow, This Week, Backup, Move Plan
- AI-assisted organization suggestions
- task conversion from saved services
- route sequencing and time feasibility from saved items
- progress state beyond saved / unsaved

### Seeker context

ORAN has profile context and a seeker context strip, but it does not yet behave like a dynamic recovery context.

Missing layers:

- current path / active objective
- explicit constraints driving prioritization
- visible rationale for sequencing
- progress and milestone tracking
- an operational summary of what matters now

### Notifications

ORAN has notifications, but not a task and reminder system.

Missing layers:

- reminder scheduling tied to tasks
- due dates and urgency states
- missed-step handling
- recurring follow-ups
- “leave now” and “closing soon” operational alerts

### Routing and logistics

ORAN already uses map and distance concepts, but not a full execution-aware routing layer.

Missing layers:

- walk / transit / drive feasibility by action
- opening-hours-aware sequencing
- stacked trip planning
- fallback routing when a location closes or fails
- route bundles for a day or week

## What Is Mostly Missing Today

### Plan engine

There is no clear first-class seeker plan object that can hold:

- active goals
- sequenced steps
- dependencies
- deadlines
- backups
- linked resources
- required documents
- reminders
- completion state

### Checklist engine

There is no seeker-facing task/checklist model equivalent to the vision.

Needed capabilities:

- AI-generated but user-editable tasks
- step metadata such as why it matters, when to do it, what to bring, what to ask, fallback options
- drag/reorder, snooze, remove, move between bundles
- grouped task sets by path such as food, housing, benefits, job path, move plan

### Chat as command center

Chat currently helps find services. It does not yet clearly function as a structured planner that can reliably interpret and apply commands like:

- add this to tomorrow
- group these under housing
- remind me at 8am
- what should I do first
- I cannot make that one
- find another option nearby
- move this to next week

### Path progression system

ORAN does not yet explicitly model progression from crisis to stabilization to mobility.

Needed capabilities:

- active path framework
- stage-based guidance
- milestone tracking
- next-best-step logic based on current blockers and achieved steps

## Gap Matrix By Product Domain

## 1. Entry And Orientation

Goal: a stressed user should know where they are, what ORAN can do, and what the next move is in less than 10 seconds.

Current strengths:

- clear public entry
- strong discovery routes
- trust posture is already visible

Gaps:

- insufficient framing around “tell me what is happening and I will build your plan”
- primary seeker entry still leans more toward search than guided triage
- weak “I do not know where to start” path

Required improvements:

- add a guided intake entry path alongside direct search
- add clearer “need right now” choices
- add visible “what happens next” expectations before asking for details

## 2. Situation Intake And Understanding

Goal: ORAN should gather enough structured context to build a situationally aware plan without overwhelming the user.

Current strengths:

- intent detection exists
- profile shaping exists
- clarification flow exists in chat

Gaps:

- intake is request-level, not case-level
- constraints are not explicitly modeled as plan inputs
- no durable active objective model for seekers

Required improvements:

- create a situation intake contract for active need, urgency, time horizon, transportation, documentation, household, injury/constraint, move status, and immediate deadlines
- add progressive disclosure intake UI in chat and seeker surfaces
- persist only consented structured context

## 3. Plan And Checklist System

Goal: ORAN should convert understanding into an actionable, living plan.

Current strengths:

- saved services and collections provide a partial foundation

Gaps:

- no seeker plan object
- no seeker task object
- no dependency-aware step sequencing
- no “why this comes first” reasoning layer

Required improvements:

- introduce plan, plan_step, plan_bundle, and task reminder concepts
- support AI-generated initial plans from retrieved records and user context
- allow user edit, reorder, remove, defer, regroup, and mark complete
- expose fallback and backup options per step

## 4. Saved Workspace And Bundles

Goal: saved items should become part of the user’s operating system, not a static favorites list.

Current strengths:

- saved page exists
- collections exist
- profile can summarize saved count

Gaps:

- no operational bundle templates
- no distinction between emergency backup and planned next step
- no route/day grouping
- no bundle intelligence suggestions

Required improvements:

- introduce default bundle templates: Today, Tomorrow, This Week, Emergency Backup, Housing, Food, Documents, Job Path, Medical, Utilities, Move Plan
- support custom bundle naming and route grouping
- allow converting any saved resource into a task or step

## 5. Chat Command Center

Goal: chat should be able to mutate the seeker’s plan and saved system, not only return service cards.

Current strengths:

- chat is already primary and retrieval-first
- chat already returns structured cards and maintains local session rails

Gaps:

- no structured action grammar for plan mutation
- weak plan-memory loop
- no direct command results for tasks, reminders, and bundles

Required improvements:

- add a command-intent layer for plan and task mutations
- add explicit chat response modes: retrieval result, plan update, reminder confirmation, route adjustment, fallback suggestion
- add user-visible auditability for chat actions taken on their behalf

## 6. Routing, Time, And Real-World Feasibility

Goal: ORAN should help users execute in real space and time.

Current strengths:

- map exists
- distance and walk-time cues already appear in places

Gaps:

- no opening-hours-aware prioritization engine
- no trip sequencing
- no missed-appointment or missed-closing fallback logic
- no route bundle artifact

Required improvements:

- compute real feasibility signals from hours, distance, and travel mode
- create trip/day planning views
- support fallback suggestions when the primary option is no longer feasible

## 7. Reminders And Follow-Through

Goal: ORAN should help the user not miss important steps.

Current strengths:

- notification system exists

Gaps:

- no seeker reminder system tied to tasks
- no due-date model
- no delayed or recurring follow-up logic

Required improvements:

- create reminder scheduling and delivery preferences for seeker tasks
- support “remind me tomorrow morning”, “remind me before closing”, and “follow up next week” actions
- connect reminders to plan-step state and completion

## 8. Profile As Recovery Dashboard

Goal: profile should feel like a personal command hub.

Current strengths:

- profile is richer than a basic settings page
- privacy posture is already explicit

Gaps:

- profile is still preference-heavy rather than action-heavy
- no milestones, active plan, or progress board
- no document readiness or application history view

Required improvements:

- turn profile into an action dashboard with plan summary, active bundles, due-soon tasks, reminders, milestones, and recent decisions
- separate low-level settings from mission-critical current-state panels

## 9. Trust, Verification, And Decision Confidence

Goal: trust cues should help the user decide what to do next, not only whether a card looks credible.

Current strengths:

- trust bands and confidence model already exist
- verification/admin surfaces already exist

Gaps:

- trust information is not yet framed around action reliability
- little guidance on when to call first or when a listing may be stale for execution-sensitive use
- no strong “best used as backup” versus “good first stop today” logic

Required improvements:

- add action-oriented trust messaging such as call first, likely reliable, verify today, backup option
- surface freshness windows and execution confidence more clearly
- feed operator freshness issues into seeker-facing caution states

## 10. Accessibility, Stress-Tolerance, And Low-Bandwidth Use

Goal: ORAN should remain usable under stress, on a phone, and with reduced cognitive bandwidth.

Current strengths:

- mobile-first patterns exist
- UI contract already enforces accessibility basics

Gaps:

- no explicit stress-mode patterns
- no low-friction guided checklist surface optimized for fast execution
- no dedicated reduced-choice flow for overwhelmed users

Required improvements:

- add a streamlined execution mode with fewer simultaneous decisions
- add stronger sticky next-action surfaces on mobile
- add more explicit reduced-bandwidth and reduced-copy handling for key flows

## 11. Supply, Coverage, And Operator Alignment

Goal: seeker planning quality must be backed by reliable supply, freshness, and category coverage.

Current strengths:

- strong operator/admin infrastructure exists

Gaps:

- no explicit alignment between seeker path demand and coverage gaps
- no direct operator view of which missing services break plan quality most severely

Required improvements:

- connect seeker demand patterns to coverage/freshness prioritization
- add “plan-breaking gaps” metrics to community-admin and ORAN-admin surfaces
- prioritize verification on high-dependency path nodes such as shelter, food today, ID recovery, rent assistance

## 12. Measurement, Rollout, And Regression Defense

Goal: make the more agentic product measurable and safe to ship.

Current strengths:

- tests, UI contracts, and governance already exist

Gaps:

- no seeker-plan success metrics
- no task completion funnel
- no explicit rollout plan for agentic capabilities

Required improvements:

- define plan creation, task completion, route completion, fallback recovery, and reminder engagement metrics
- feature-flag all plan and agentic layers
- create failure-mode instrumentation for plan generation and mutation flows

## Target End-State

When the core phases are complete, ORAN should support this canonical flow:

1. User says what is happening.
2. ORAN determines whether the situation is crisis, urgent, short-term, or stabilization-oriented.
3. ORAN retrieves stored records only.
4. ORAN builds a sequenced plan from those records and the user’s stated context.
5. The user can save the plan into bundles, tasks, routes, and reminders.
6. Chat can mutate that plan over time.
7. ORAN helps the user execute today, this week, and next.
8. Trust signals remain explicit at every decision point.

## Phased Delivery Plan

## Phase 0. Contracts, Data Shape, And Safety Guardrails

Purpose: define the architecture for plan-oriented behavior before building UI chrome.

Deliverables:

- ADR for seeker plan/checklist/reminder architecture.
- SSOT updates for seeker planning behavior, chat command-center boundaries, and data model impacts.
- Initial domain contracts for:
  - seeker situation context
  - seeker plan
  - seeker plan step
  - reminder
  - saved bundle template
  - chat plan mutation intents
- Feature flags for plan engine and reminder engine.
- Telemetry contract that excludes PII and raw sensitive chat content.

Likely touched areas:

- docs/CHAT_ARCHITECTURE.md
- docs/DATA_MODEL.md
- docs/ui/UI_UX_CONTRACT.md
- docs/DECISIONS/
- src/domain/
- src/services/chat/
- src/services/profile/
- src/services/saved/

Exit criteria:

- No unresolved ambiguity about where plan data lives.
- No ambiguity about what AI is allowed to generate.
- All new seeker-facing facts remain anchored to stored records or user-entered data.

## Phase 1. Guided Intake And Seeker Operating Frame

Purpose: shift ORAN’s primary experience from “search surfaces” to “understand my situation and guide me.”

Deliverables:

- guided intake flow for “what do you need right now?”
- active path selector for high-priority needs
- stronger orientation copy and current-context framing across chat, directory, map, saved, and profile
- stress-friendly “I do not know where to start” flow
- current objective, urgency, and constraint summary in seeker shell

UI outcomes:

- seeker shell feels like one operating environment
- entry surfaces surface plan-oriented guidance before detailed browsing

Back-end/service outcomes:

- structured intake contract persisted only with consent
- deterministic prioritization hints that inform later planning

Exit criteria:

- a first-time seeker can start from “food today” or “I do not know where to start” without feeling dumped into generic search
- discovery surfaces show clear current objective and context continuity

## Phase 2. Plan Engine And Task System

Purpose: turn retrieved results into a living plan.

Deliverables:

- seeker plan model
- plan generation service bounded to retrieved records and user context
- seeker task model with urgency, timing, why-it-matters, what-to-bring, what-to-ask, fallback
- task board and plan workspace
- conversion flows from service card -> save -> add to plan -> add reminder
- default bundle templates for common real-world paths

UI outcomes:

- a user can see Today, This Week, Backups, and next-best steps
- service detail becomes a decision page and plan-entry point

Back-end/service outcomes:

- APIs for plan create/read/update/reorder/complete
- local-first and authenticated persistence strategy defined

Exit criteria:

- a seeker can build, edit, and complete a multi-step plan without leaving ORAN
- ORAN can explain why certain steps are first and which are backups

## Phase 3. Chat As Command Center

Purpose: make chat operational, not only informational.

Deliverables:

- structured command intents for add, move, remove, remind, regroup, find alternate, and prioritize
- chat responses that confirm plan mutations explicitly
- chat memory limited to structured plan/context state, not unsafe implied autonomy
- user-visible action log for plan changes made via chat

Examples of supported commands:

- save this under housing
- move this to tomorrow
- remind me at 8am
- I cannot make this one
- find another option nearby
- what should I do first

Exit criteria:

- chat can reliably mutate plans with clear confirmations and reversible outcomes
- every plan mutation is auditable and user-visible

## Phase 4. Routing, Feasibility, And Reminder Engine

Purpose: help users execute in the real world.

Deliverables:

- travel mode and time feasibility heuristics
- opening-hours-aware step ordering
- route bundles for same-day and same-week planning
- reminders tied to due dates, closing windows, and follow-up intervals
- missed-step fallback logic

UI outcomes:

- ORAN can say go here first because it closes earlier
- ORAN can say if you miss this, try this next
- mobile flows support “leave now” or “save for tomorrow” decisions

Exit criteria:

- seeker can build a realistic same-day or same-week action route
- reminders connect to real task state and are dismissible or reschedulable

## Phase 5. Recovery Dashboard And Longitudinal Progress

Purpose: turn profile into a living command hub.

Deliverables:

- active plan dashboard
- milestones and progress summary
- due soon / overdue / blocked step panels
- application and follow-up history where supported by stored workflow data
- document readiness section for common path types
- current-stage framing: immediate survival, stabilization, or growth

Exit criteria:

- profile clearly answers: what matters now, what is next, what is saved, what is blocked, what changed recently

## Phase 6. Supply-Side And Trust Feedback Loop

Purpose: make operator systems explicitly support seeker plan quality.

Deliverables:

- operator metrics for plan-breaking data gaps
- freshness and coverage views tied to high-priority seeker paths
- trust-state outputs better translated into seeker action confidence cues
- verification prioritization rules informed by execution-critical demand

Exit criteria:

- operator prioritization is informed by which data defects most damage seeker execution outcomes

## Concrete Workstreams

## Workstream A. Domain And Data Model

Needs:

- plan entities
- task entities
- reminders
- bundle templates and assignments
- structured chat mutation events
- possibly milestone/progress entities

Risks:

- over-persisting sensitive context
- mixing transient session state with durable life data without clear consent
- introducing schema complexity before contracts are stable

Mitigation:

- local-first by default where appropriate
- explicit consent gates for durable profile/plan persistence
- staged migrations after ADR approval

## Workstream B. Seeker UX And Interaction Model

Needs:

- guided intake
- plan workspace
- task cards
- bundle system
- route planner views
- stress-tolerant mobile execution mode

Risks:

- overcrowding surfaces with enterprise complexity
- losing calm, clarity, and reduced cognitive load

Mitigation:

- progressive disclosure
- clear primary action hierarchy
- one dominant next step per screen where possible

## Workstream C. Chat Orchestration

Needs:

- command-intent grammar
- action confirmation UI
- bounded plan mutation orchestration
- fail-safe behavior when mutation cannot be completed

Risks:

- implied autonomy beyond what the system actually changed
- silent mutation failures
- ambiguous intent leading to destructive plan edits

Mitigation:

- explicit confirmations
- reversible actions
- user review on ambiguous multi-object changes

## Workstream D. Routing And Logistics

Needs:

- feasibility scoring
- hours-aware sequencing
- fallback routing
- trip grouping

Risks:

- overclaiming travel feasibility with weak routing data
- presenting time promises that may not hold

Mitigation:

- label travel and timing as estimates
- keep factual routing inputs grounded in available map/provider data
- fail gracefully when exact transit data is unavailable

## Workstream E. Notifications And Reminders

Needs:

- reminder model
- delivery preferences
- schedule editing
- due/missed/completed state transitions

Risks:

- notification spam
- unsafe reminders exposing sensitive context on shared devices

Mitigation:

- rate limits and batching
- privacy-safe reminder copy
- device/account preference controls

## Workstream F. Trust And Operations

Needs:

- action-oriented trust labels
- freshness impact signals
- plan-breaking coverage diagnostics

Risks:

- trust language drifting away from actual evidence
- operator dashboards not aligning with seeker outcomes

Mitigation:

- derive seeker trust framing directly from verified fields and freshness signals
- define shared metrics across seeker and operator views

## Recommended Order Of Execution

Do not start with reminders, route bundles, or chat mutation polish.

Start here:

1. Contracts and ADRs
2. Guided intake and seeker operating frame
3. Plan and task data model
4. Simple plan workspace
5. Chat mutation intents
6. Reminder engine
7. Route feasibility and fallback
8. Recovery dashboard
9. Operator gap feedback loop

Reasoning:

- If ORAN cannot represent a plan cleanly, chat cannot safely mutate it.
- If ORAN cannot represent tasks and bundles, reminders and routing will become brittle special cases.
- If ORAN does not first improve seeker orientation, advanced features will feel bolted on rather than core.

## Acceptance Criteria By Capability Cluster

## Plan system

- User can generate a plan from retrieved resources.
- User can edit, reorder, remove, and complete steps.
- Every step can show why it matters and what to do next.

## Chat command center

- User can mutate plan state from chat with clear confirmation.
- Ambiguous commands do not silently apply destructive changes.

## Routing and reminders

- User can schedule reminders against tasks.
- ORAN can recommend sequence based on hours and distance where data exists.
- ORAN provides fallback actions when a primary option is missed.

## Trust and operations

- Action-oriented trust cues remain grounded in stored evidence.
- Admin prioritization surfaces can identify plan-breaking data defects.

## Regression Risks To Actively Prevent

- Turning ORAN into a hallucinating planning assistant that invents details.
- Over-collecting or over-persisting sensitive life context.
- Creating a dense project-management UI instead of a calm assistance system.
- Letting chat mutate durable state without explicit user visibility.
- Building reminders before a real task model exists.
- Building route logic that overpromises feasibility or timeliness.
- Shipping plan generation without a rollback strategy or clear audit trail.

## Audit Pass 1

Question: Does the initial roadmap over-focus on UX and under-specify architecture, consent, and rollout?

Findings:

- A plan/checklist feature set without a data-lifecycle decision would create inconsistent persistence behavior.
- Chat mutation features are too risky without an explicit action log and reversibility model.
- Reminder and routing features can easily overpromise if introduced before feasibility disclaimers and privacy-safe delivery rules.
- The original phase ideas needed stronger operator and trust alignment so seeker planning quality does not drift away from data quality.

Adjustments applied:

- Added Phase 0 for contracts, flags, ADRs, and telemetry boundaries.
- Elevated action logging and explicit confirmation as mandatory for chat mutations.
- Added privacy-safe reminder requirements and estimate labeling for routing.
- Added a dedicated supply/trust feedback-loop phase.

## Audit Pass 2

Question: Could this plan still fail because it is too broad, too risky, or sequenced incorrectly?

Findings:

- Building a large autonomous planner too early would likely create regressions and trust risk.
- A profile/dashboard overhaul before the plan model exists would create shallow chrome without operational depth.
- Rich route planning before basic plan editing would create flashy behavior without stable underlying objects.
- The roadmap needed clearer advice on what not to build first.

Adjustments applied:

- Sequenced plan-model work ahead of routing/reminder sophistication.
- Delayed recovery dashboard expansion until after core plan and task systems exist.
- Explicitly stated that chat mutation, reminders, and routing should layer onto stable plan primitives.
- Added a recommended order-of-execution section to constrain scope.

## Pre-Execution Recommendation

Before any implementation begins, approve or revise these four architecture decisions:

1. Whether seeker plans are local-first, account-first, or hybrid by default.
2. What minimal durable entities are required for Phase 2.
3. What exact chat commands are in scope for the first mutation release.
4. What routing/time data quality threshold is required before feasibility guidance can be surfaced.

## Proposed First Build Slice

The first execution slice should be intentionally narrow:

- guided intake for top urgent paths
- a minimal seeker plan object
- add-to-plan from service cards and service detail
- basic task list with urgency and completion
- visible plan summary in seeker shell/profile
- no automated reminders yet
- no advanced route bundling yet
- no broad autonomous chat mutation yet beyond a tightly scoped command set

This first slice would move ORAN from discovery-only toward guided execution without overcommitting the platform to unproven agentic complexity.

## Definition Of Ready For Execution

This roadmap is ready to execute when:

- the architecture decisions above are accepted
- the first-slice scope is confirmed
- Phase 0 ADR/docs work is approved
- feature-flag and telemetry boundaries are agreed
- the team accepts that ORAN must progress by stable primitives first, not by surface-level polish alone

At that point, the next artifact should be a phase-by-phase implementation checklist broken into code, schema, tests, docs, and rollout tasks.