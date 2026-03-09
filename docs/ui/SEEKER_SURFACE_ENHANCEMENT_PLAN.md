# ORAN Seeker Surface Enhancement Plan

This document explains how the seeker side of ORAN should evolve from its current implementation to the new shell contract without restarting or replacing what already works.

This is a refinement plan, not a rewrite plan.

## Executive Summary

The seeker surface already has meaningful infrastructure in place:

- a real route-group layout at `src/app/(seeker)/layout.tsx`
- a top bar and mobile bottom navigation
- a command palette hook
- shared `PageHeader` usage across seeker pages
- shared `ServiceCard` rendering
- separate seeker routes for chat, directory, map, saved, profile, notifications, appeal, and report
- tests for the shell and major seeker pages

That means the right move is not to replace the seeker side. The right move is to unify and strengthen it so the existing implementation behaves more like one polished seeker product.

## What Already Exists And Should Be Preserved

These parts are already aligned enough that they should be kept and improved, not discarded.

### Seeker layout shell

Current state:

- top bar exists
- bottom navigation exists for mobile
- saved-count badge exists
- command palette exists
- footer is already integrated into the vertical shell

Decision:

- keep it
- refine spacing, context, and shell behavior

### Shared page framing

Current state:

- `PageHeader` is already used by seeker pages
- page max-widths are already separated by route context in practice

Decision:

- keep `PageHeader`
- extend it with stronger shell context instead of replacing it

### Shared service rendering

Current state:

- `ServiceCard` already carries trust, match, taxonomy, contact, and eligibility context

Decision:

- keep `ServiceCard`
- make it more central to seeker consistency across chat, directory, map, saved, and detail

### Route inventory

Current state:

- seeker routes already map well to the shell spec

Decision:

- preserve route structure
- improve cross-route continuity and shell behavior

## Current Gaps Against The New Contract

The seeker side is good, but it still behaves more like a set of strong individual pages than one deeply unified seeker product.

## Gap 1: The shell is present, but context is still thin

What exists now:

- top nav
- bottom nav
- saved badge
- command palette hook

What is still missing:

- persistent seeker trust microcopy near discovery controls
- visible session context such as city or active filter summary
- stronger relationship between chat, directory, map, and saved states

Change to make:

- add a compact seeker context strip under the top bar on relevant pages
- show approximate city when available
- show quick links back to active search modes or saved items
- expose current trust/filter state more consistently

Why this matters:

- the product feels connected instead of page-switched
- seekers can orient themselves faster

## Gap 2: Chat, directory, and map still feel related, but not fully unified

What exists now:

- each page is individually strong
- each page links to the others

What is still missing:

- shared filter memory and visible continuity
- a stronger “you are still in the same search session” feel
- more consistent header and supporting actions across the three primary discovery modes

Change to make:

- introduce a shared seeker search-session model
- persist lightweight in-session state for:
  - query
  - selected trust filter
  - selected taxonomy filters
  - approximate location context
- surface this state in chat, directory, and map headers

Why this matters:

- switching from chat to directory should feel like changing lenses, not starting over
- switching from map to directory should preserve context where sensible

## Gap 3: Directory and map have rich controls, but shell-level filter behavior is not standardized

What exists now:

- directory has filters, sorting, taxonomy dialog, and chips
- map has taxonomy filters, confidence filters, and mobile list-map switching

What is still missing:

- one consistent filter control language
- one consistent advanced-filter placement pattern
- one consistent “active filters” summary pattern

Change to make:

- create a shared seeker filter bar component used by directory and map
- create a shared active-filter chip row
- create a shared advanced filter drawer or sheet pattern

Keep:

- existing filter logic
- existing taxonomy APIs

Refactor:

- only the presentation and shell framing

Why this matters:

- reduces repeated UI logic
- makes the seeker product easier to learn and easier to maintain

## Gap 4: Service detail is still page-local, not shell-native

What exists now:

- service detail uses a breadcrumb
- service detail reuses `ServiceCard`
- eligibility caution is present

What is still missing:

- stronger detail-page anatomy
- more explicit summary, trust, evidence, and next-action grouping
- clearer continuity with directory and saved flows

Change to make:

- restructure seeker service detail into a standard detail template:
  - summary header
  - trust and caution band
  - core record card
  - related actions row
  - provenance or verification summary section where appropriate
  - report and save actions grouped consistently

Why this matters:

- detail pages become stronger “decision pages,” not just a larger result card

## Gap 5: Profile is ambitious, but the shell relationship to discovery is still weaker than it should be

What exists now:

- profile is already rich and more advanced than a basic settings page
- preferences, privacy, and account areas exist

What is still missing:

- clearer connection between profile choices and seeker outcomes
- stronger shell-level preview of what profile context is influencing
- cleaner separation between profile management and discovery context

Change to make:

- add a lightweight “current seeker context” preview component reused in:
  - profile
  - chat
  - directory
  - map
- show what preferences are actively shaping results
- make privacy and consent state more visible at the shell level when relevant

Why this matters:

- the profile becomes operationally meaningful, not just informational
- users trust personalization more when they can see it

## Gap 6: The seeker shell has navigation, but not yet a full discovery operating frame

What exists now:

- static primary nav destinations

What is still missing:

- lightweight seeker command affordances
- clearer “continue where you left off” behavior
- stronger session-based continuity

Change to make:

- keep the command palette, but add seeker-relevant actions later such as:
  - jump to chat
  - open saved
  - return to map results
  - search a topic quickly
- add recent-path or current-context affordances where low-friction and privacy-safe

Why this matters:

- makes the seeker surface feel more modern without adding heavy enterprise chrome

## What I Would Change, In Order

## Phase 1: Strengthen the existing shell

These are shell-level refinements that build directly on what exists now.

### 1. Upgrade the seeker layout shell

Target file:

- `src/app/(seeker)/layout.tsx`

Changes:

- keep top bar and bottom nav
- add a seeker context strip below the top bar where useful
- standardize page spacing and width handoff across seeker routes
- make desktop state feel less like mobile-expanded nav and more like a coherent seeker shell

### 2. Standardize seeker page headers

Target file:

- `src/components/ui/PageHeader.tsx`

Changes:

- keep the component
- allow optional shell metadata rows such as filter summaries or context chips
- support more consistent action placement across seeker pages

### 3. Build shared filter presentation components

Target area:

- seeker route clients and shared seeker components

Changes:

- one shared quick-filter bar
- one shared active-filter summary row
- one shared advanced-filter sheet or panel pattern

## Phase 2: Unify discovery surfaces

### 4. Introduce a shared seeker session model

Target areas:

- chat
- directory
- map
- saved

Changes:

- preserve lightweight in-session discovery context
- make transitions between surfaces keep more state
- standardize seeker “escape hatches” into shell-native navigation instead of page-local links only

### 5. Upgrade service detail into a shell-native detail experience

Target file:

- `src/app/(seeker)/service/[id]/ServiceDetailClient.tsx`

Changes:

- keep `ServiceCard`
- wrap it in a stronger detail template
- standardize action grouping and trust framing

### 6. Add shared seeker context preview components

Target areas:

- profile
- chat
- directory
- map

Changes:

- show what location and preference context is currently shaping results
- reuse the same context component across pages

## Phase 3: Polish and optimize

### 7. Improve mobile-first interaction polish

Changes:

- cleaner sticky controls on directory and map
- better safe-area handling and spacing consistency
- smoother cross-page transitions within the seeker shell

### 8. Add stronger desktop enhancements without making the surface feel like admin UI

Changes:

- optional compact side context panel for chat
- optional sticky filter rail for directory
- optional split-pane improvement for map and results

### 9. Expand the seeker command model carefully

Changes:

- keep the existing command palette
- introduce seeker-safe shortcuts only when they simplify navigation

## What I Would Not Restart

I would explicitly not restart these parts.

- `src/app/(seeker)/layout.tsx`
- `src/components/ui/PageHeader.tsx`
- `src/components/directory/ServiceCard.tsx`
- the existing route structure under `src/app/(seeker)`
- the existing test coverage pattern for seeker pages
- the existing localStorage-based saved-state model unless a stronger product decision changes it

These are already useful assets.

## Practical Before And After

| Area | Current state | Enhancement direction |
| --- | --- | --- |
| Seeker layout | real shell with top bar, mobile nav, command palette | keep structure, add context strip and stronger continuity |
| Chat | good standalone primary flow | make it part of a shared discovery session |
| Directory | strong filterable page | standardize filter shell and active-context presentation |
| Map | strong map/list hybrid | unify controls and context with directory |
| Saved | useful isolated destination | make it feel like a continuation of discovery, not a dead-end list |
| Profile | rich and ambitious | connect profile state more clearly to discovery outcomes |
| Service detail | functional and trustworthy | elevate into a shell-native detail template |

## Net Effect On The Seeker Side

If this plan is followed, the seeker side changes in these ways:

- less page-by-page inconsistency
- stronger continuity between chat, directory, map, saved, and profile
- more visible trust and privacy context
- better desktop polish without losing mobile-first behavior
- more reuse of current infrastructure instead of more bespoke page work

The result is not a restart. It is a maturation of what already exists into a more unified and more enterprise-grade seeker product.

## Recommended Implementation Starting Point

If work starts on the seeker side first, the best order is:

1. refine `src/app/(seeker)/layout.tsx`
2. upgrade `src/components/ui/PageHeader.tsx` to support shell metadata
3. extract shared filter-shell components from directory and map
4. add shared seeker session and context preview patterns
5. upgrade service detail into the standard detail template

That sequence gives the highest visible UX improvement with the least architectural disruption.
