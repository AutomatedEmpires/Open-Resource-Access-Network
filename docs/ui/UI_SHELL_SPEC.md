# ORAN UI Shell Specification

This document defines the concrete shell architecture for ORAN's primary product verticals.

It turns the broader design direction into implementable layout rules for:

- seeker surfaces
- host surfaces
- community admin surfaces
- ORAN admin surfaces

This spec is not about individual components in isolation. It is about the page chrome, navigation, information hierarchy, action placement, and persistent context that should make ORAN feel like one mature product instead of several disconnected applications.

If a page-level implementation conflicts with this spec, either update this spec and the UI docs together or change the page.

## Purpose

The shell is the product's operating frame.

Done well, it should:

- reduce cognitive load
- make role transitions predictable
- keep trust and safety context visible
- keep actions easy to find
- support mobile seekers and desktop operators equally well

## Product Shell Principles

### 1. One product, multiple verticals

ORAN is one system with multiple roles. The shell must preserve a single product identity while letting each role operate with the density and tools it needs.

### 2. Mobile-first for seekers, desktop-first for operators

Seekers should get low-friction, high-clarity, touch-friendly flows.

Operators should get denser workbench layouts with persistent context, evidence, and actions.

### 3. Trust context is structural, not decorative

Confidence bands, eligibility caution, safety messaging, and verification state should be part of the shell language, not one-off embellishments.

### 4. Persistent context beats modal hunting

As ORAN matures, users should not need to open and close many dialogs just to understand state. Important context should remain visible in rails, drawers, status bars, and page headers.

### 5. Shared primitives, role-specific assembly

The same shell primitives should be reused across verticals even when the layout differs.

## Shared Shell Primitives

### Global top bar

Always contains:

- ORAN wordmark or logo
- current vertical label when authenticated
- account entry point or session menu
- help or support entry point

May contain:

- environment badge for non-production
- system status badge
- command palette trigger

### Command palette

The command palette should become a first-class navigation and action layer.

Use cases:

- go to route
- find organizations, services, or queues
- trigger common operator actions
- jump to evidence or history views

Behavior:

- available on desktop for all authenticated verticals
- optional simplified version for seekers later
- opened by keyboard shortcut and explicit button

### Page header frame

Every page should use the same header anatomy.

Header zones:

- title and short purpose statement
- primary status badge or trust badge where relevant
- primary action area on the right
- optional secondary actions below or adjacent

### Status and trust band row

Pages that work with records, queues, or service detail should have a compact, consistent band for:

- status
- trust band
- review state
- freshness or last verified date
- assignment state

### Right-side context drawer or rail

For complex verticals, persistent right-side context is preferred over repeated modal use.

Typical contents:

- evidence summary
- recent activity
- related entities
- warnings or blockers
- next recommended action

### Timeline rail

Where workflows exist, timelines should become a standard primitive.

Used for:

- submission history
- verification changes
- service edits
- review decisions
- notifications or escalations

## Breakpoint And Density Model

### Seeker density

- mobile: primary layout target
- tablet: stacked content with stronger filtering affordances
- desktop: two-panel or split-pane only when it improves scanning

### Operator density

- desktop: primary layout target
- tablet: workable but simplified
- mobile: read-oriented, not full-production workflow for the densest admin actions

### Recommended shell widths

- seeker conversational pages: `max-w-2xl`
- seeker browse and map pages: `max-w-6xl`
- host pages: `max-w-7xl`
- community admin and ORAN admin workbenches: `max-w-7xl` with denser grids and rails

## Vertical 1: Seeker Shell

### Seeker purpose

Help people move quickly from uncertainty to trustworthy next steps.

### Seeker emotional goal

- calm
- fast
- modern
- non-bureaucratic

### Seeker shell anatomy

Desktop:

- top bar
- main content column
- optional compact side panel on pages that benefit from persistent filters or saved context

Mobile:

- top bar
- main content area
- bottom navigation

### Seeker primary destinations

- Find
- Directory
- Map
- Saved
- Profile

### Seeker navigation model

Mobile:

- bottom navigation with 3 to 5 destinations
- active state must be highly visible

Desktop:

- top navigation or segmented navigation inside the seeker shell
- avoid left-side dense sidebars for general seeker use

### Seeker persistent shell elements

- safety and trust microcopy near discovery entry points
- account state indicator
- optional session location summary
- optional saved-services quick access

### Seeker page templates

#### A. Conversational discovery template

Used by:

- chat

Layout:

- top bar
- conversation container
- persistent eligibility caution
- crisis banner slot at top of conversation stack
- input dock anchored at bottom

Optional desktop enhancement:

- side context panel showing saved services, current filters, or location summary

#### B. Browse-and-filter template

Used by:

- directory
- saved

Layout:

- page header
- search row
- filter chips row
- collapsible advanced filters
- result grid or list
- empty, loading, and error states in-place

Desktop enhancement:

- sticky filter side panel when filter complexity grows

#### C. Geo-browse template

Used by:

- map

Layout:

- map canvas
- top search row
- floating search-this-area control
- results strip or compact list

Desktop enhancement:

- split pane with resizable results list and map

#### D. Preference and privacy template

Used by:

- profile
- notifications

Layout:

- page header
- grouped cards for preferences, privacy, and account controls
- destructive actions isolated at the bottom

Behavior rules:

- profile personalization is local-first by default
- cross-device persistence requires an explicit sync toggle before `/api/profile` or `/api/saved` writes begin
- account-scoped actions such as notification preferences, password change, export, and delete remain explicit server-backed actions
- copy must explain whether a control affects only this device or the signed-in account
- seeker shell context must update in the same tab when saved-state, profile preferences, or seeker-context changes occur; users should not need a route change to see current saved count, city, personalization state, or sync state
- seeker shell context should expose sync state in plain language such as `Local-only` or `Sync on`

### Seeker shell anti-patterns

- no dense left navigation rail
- no enterprise dashboard chrome
- no verbose admin language
- no hiding key navigation behind menus on mobile

## Vertical 2: Host Shell

### Host purpose

Help organizations manage listings and updates without needing enterprise software training.

### Host emotional goal

- capable
- clear
- responsible
- efficient

### Host shell anatomy

Desktop:

- top bar
- left navigation rail
- page content region
- optional right-side context drawer for details or review state

Mobile and tablet:

- top bar
- collapsible navigation drawer
- content stacked vertically

### Host primary destinations

- Overview
- Organizations
- Resource Studio
- Services
- Locations
- Team
- Claims or access requests

### Host navigation model

- left rail for desktop
- route-group-based navigation with role filtering
- active organization context visible when relevant

### Host persistent shell elements

- current organization context
- pending review count where relevant
- draft or published state summary
- quick create action in header area

### Host page templates

#### A. Collection management template

Used by:

- organizations
- services
- locations

Layout:

- page header
- search and filter row
- status summary chips
- primary table or card grid
- bulk or page actions in header

Desktop enhancement:

- sticky right-side detail drawer when selecting an item from a list

#### B. Create and edit detail template

Used by:

- resource studio listing workflow
- resource studio claim workflow
- exceptional direct edit flows that have not yet been retired

Layout:

- page header with submission or record state
- left completion rail when the workflow is multi-card
- main card or form column
- right context rail with guidance, trust implications, and review notes

Use sections for:

- organization identity
- delivery and access details
- contact information
- schedule and availability
- taxonomy, evidence, and review or publish implications

#### C. Team and membership template

Used by:

- organization members
- invitations

Layout:

- page header
- member list
- role badge column
- invite actions in header

### Host shell anti-patterns

- no consumer-style bottom navigation on desktop
- no burying review state inside forms
- no status changes without visible workflow implications
- no creating drafts implicitly just because a user landed on a page

## Vertical 3: Community Admin Shell

### Community admin purpose

Help local reviewers verify, route, and maintain trustworthy records quickly.

### Community admin emotional goal

- focused
- evidence-driven
- audit-friendly
- queue-efficient

### Community admin shell anatomy

Desktop:

- top bar
- left navigation rail
- main workbench area
- persistent right evidence rail

Mobile:

- read-oriented simplified layout
- not the primary mode for deep queue work

### Community admin primary destinations

- Queue
- Coverage
- Reviews
- Escalations
- Activity

### Community admin persistent shell elements

- queue counts by state
- assignment state
- SLA warning badge
- coverage area context

### Community admin page templates

#### A. Queue workbench template

Used by:

- verification queue

Layout:

- page header with counts and SLA summary
- left or top filter controls
- primary work list
- selected-record detail view
- evidence rail

Recommended desktop pattern:

- three-pane layout
  - queue list
  - record detail
  - evidence and history rail

#### B. Coverage operations template

Used by:

- coverage zones
- area workload views

Layout:

- page header
- summary cards
- map or area list
- assignment table

#### C. Review dossier template

Used by:

- detailed verification review
- shared submission-backed resource review

Layout:

- record summary header
- field diff or detail sections in main column
- evidence rail
- timeline rail
- decision action bar pinned near bottom or top-right

Rule:

- if a submission-backed resource packet exists, the reviewer should inspect the same card structure the submitter completed instead of a separate bespoke detail form

### Community admin shell anti-patterns

- no hiding evidence behind secondary clicks when decisions depend on it
- no queue layout that forces full-page navigation for every item
- no ambiguous action labels for approve, return, escalate, or deny

## Vertical 4: ORAN Admin Shell

### ORAN admin purpose

Help platform operators govern the whole system: approvals, flags, audits, source policy, and platform posture.

### ORAN admin emotional goal

- authoritative
- controlled
- transparent
- system-aware

### ORAN admin shell anatomy

Desktop:

- top bar
- left governance rail
- main content workbench
- optional right-side system context rail

### ORAN admin primary destinations

- Approvals
- Sources
- Policies and flags
- Audit and activity
- Platform health
- Users and roles

### ORAN admin persistent shell elements

- environment and release status
- active alerts or policy violations
- quick access to logs, evidence, and recent changes

### ORAN admin page templates

#### A. Governance board template

Used by:

- approvals
- policy changes
- source management

Layout:

- page header
- summary cards or counts row
- main table or work list
- inspector panel for selected item

Rule:

- approval boards may stay optimized for queue scanning, but resource or claim detail should hand off into the shared submission review shell rather than inventing a second approval editor

#### B. Audit and history template

Used by:

- audit logs
- activity streams
- release and policy history

Layout:

- filter header
- event timeline or table
- inspector panel with structured metadata

#### C. Platform posture template

Used by:

- health and integrations
- feature flags
- source quality

Layout:

- page header
- KPI summary row
- tabbed or sectioned panels
- links to deeper operational dashboards or docs

### ORAN admin shell anti-patterns

- no consumer-facing chrome patterns
- no unstructured admin pages with bespoke action placement
- no mixing critical destructive actions into ordinary button groups without hierarchy

## Cross-Vertical Standards

### Action hierarchy

Every page should clearly distinguish:

- primary action
- secondary action
- destructive action
- workflow decision action

### Record detail anatomy

Wherever a record detail page exists, keep this order unless there is a strong reason not to:

1. Summary
2. Status and trust
3. Core details
4. Related entities
5. Evidence or provenance
6. Activity history
7. Next actions

### Badges and states

State badges should use a shared vocabulary across verticals.

Minimum common states:

- draft
- submitted
- under review
- approved
- published
- returned
- escalated
- stale
- defunct

### Notifications

Notifications should follow one shell language:

- toast for immediate local action result
- inbox or activity panel for durable workflow updates
- banner only for high-importance or system-wide issues

### Empty states

Every empty state should include:

- what is empty
- why it may be empty
- the next best action

### Search and filter placement

- search should live high in the page, directly under the page header when relevant
- fast filters should be chips or segmented controls
- advanced filters should be collapsible or rail-based, not always-on clutter

## Implementation Guidance

### Recommended layout components to standardize

- `TopBar`
- `VerticalNav`
- `BottomNav`
- `PageHeader`
- `StatusBand`
- `SummaryCardRow`
- `InspectorPanel`
- `EvidenceRail`
- `TimelineRail`
- `CommandPalette`
- `EmptyState`
- `LoadingState`
- `ErrorState`

### Route-group ownership

These layouts should eventually be standardized through route-group layouts:

- `src/app/(seeker)/layout.tsx`
- `src/app/(host)/layout.tsx`
- `src/app/(community-admin)/layout.tsx`
- `src/app/(oran-admin)/layout.tsx`

### Migration priority

1. Seeker shell alignment across chat, directory, map, saved, and profile
2. Host shell alignment across orgs, services, and locations
3. Community admin queue workbench shell
4. ORAN admin governance shell
5. Shared command palette and timeline and evidence primitives

## Definition Of Success

The shell is working when:

- a user can switch between ORAN pages without relearning navigation
- operators can see status, evidence, and next actions without hunting
- seekers can move between chat, directory, and map without feeling they entered different products
- new pages can be built from shell patterns instead of bespoke layouts
- the product looks more mature because the information architecture is disciplined, not because it has more decoration

## Bottom Line

ORAN should not design each role surface as a separate app. It should build one shell system with role-specific density and navigation.

That means:

- seekers get a calm, mobile-first discovery shell
- hosts get a capable management shell
- community admins get an evidence-first review workbench
- ORAN admins get a governance and platform operations shell

If ORAN follows this spec, the application will feel more modern, more unified, easier to extend, and much more enterprise-grade over time.
