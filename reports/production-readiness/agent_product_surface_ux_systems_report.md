# Agent Product Surface And UX Systems Report

Date: 2026-03-13 UTC
Scope: seeker-facing chat, directory, map, shared seeker shell, result-card density, and current UX-system simplification work.
Auditor mode: active remediation with verification pending full cross-lane validation.

## Domain Inventory

Primary product-surface areas represented in the current working tree:

- `src/app/(seeker)/layout.tsx`
- `src/app/(seeker)/chat/ChatPageClient.tsx`
- `src/app/(seeker)/directory/DirectoryPageClient.tsx`
- `src/app/(seeker)/map/MapPageClient.tsx`
- `src/components/chat/ChatWindow.tsx`
- `src/components/directory/ServiceCard.tsx`
- `src/components/seeker/SeekerContextStrip.tsx`
- `src/components/seeker/DiscoverySurfaceTabs.tsx`
- `src/components/ui/PageHeader.tsx`

Shared responsibility areas:

- backend data/state contracts surfaced through seeker discovery pages
- auth/session behavior affecting seeker and operator layouts
- deployment/runtime conditions that affect seeker surfaces

## Current Production Readiness Score

Current domain score: 78 / 100

Status: yellow

Rationale:

- The active seeker UI direction is materially calmer, more unified, and less cluttered than the previous state.
- The current work removes high-noise right rails, reduces chrome, introduces shared surface tabs, and shifts advanced controls behind progressive disclosure.
- Full verification for the updated UX lane has not yet been rerun in this report cycle, so the score remains below readiness.

## Detected Issues

### UX-001 — Seeker chat, directory, and map surfaces were visually overloaded and repetitive

- Severity: P1
- Status: in_progress
- Files: seeker layout and discovery surfaces listed above
- Affected surface and user role: seeker-facing primary discovery experience
- Why it matters: the primary seeker journey felt crowded, overly instructive, and visually noisy, increasing cognitive load and reducing task focus.
- Root cause: repeated context strips, guidance panels, dense headers, visible advanced filters by default, and over-detailed result cards.
- Proposed fix: simplify shared chrome, center each surface on one primary task, hide secondary controls until requested, and unify visual language across discovery surfaces.
- Verification method: component and journey tests plus direct render inspection after all related updates settle.

### UX-002 — Result cards attempted to show too much information by default

- Severity: P2
- Status: in_progress
- Files: `src/components/directory/ServiceCard.tsx`
- Affected surface and user role: seeker directory and map list users
- Why it matters: excessive default detail makes scanability worse and undermines calm browsing.
- Root cause: too many secondary details shown in the default expanded card view.
- Proposed fix: show essential information first and gate extended details behind an explicit “More details” control.
- Verification method: component test updates and manual review of list density.

### UX-003 — Shared seeker shell signaled too many states at once

- Severity: P2
- Status: in_progress
- Files: `src/app/(seeker)/layout.tsx`, `src/components/seeker/SeekerContextStrip.tsx`, `src/components/ui/PageHeader.tsx`
- Affected surface and user role: all seeker users
- Why it matters: top-level chrome competes with the actual search task and makes the app feel more like an operations dashboard than a calm guide.
- Root cause: persistent context chips, badge density, and high-contrast warm gradients applied simultaneously across multiple layers.
- Proposed fix: simplify the shell, reduce default context chips, tone down badges, and unify the visual hierarchy.
- Verification method: render inspection and updated seeker component/journey tests.

## Severity Table

| Issue ID | Severity | Status |
| --- | --- | --- |
| UX-001 | P1 | In progress |
| UX-002 | P2 | In progress |
| UX-003 | P2 | In progress |

## Concrete Remediation Tasks

### TASK-UX-001

- Associated finding IDs: UX-001, UX-003
- Exact change to make: reduce visual clutter in the seeker shell and primary discovery pages; introduce shared surface tabs and quieter headers.
- Owner agent: Product Surface and UX Systems
- Supporting agents: Backend/Data Integrity, Security, Platform
- Preconditions: preserve retrieval-first, privacy-first, and crisis UX constraints.
- Validation steps: targeted component tests and seeker journey checks.
- Exit criteria: chat, directory, and map each present one dominant task area with reduced default chrome.

### TASK-UX-002

- Associated finding IDs: UX-002
- Exact change to make: move extended service metadata behind progressive disclosure.
- Owner agent: Product Surface and UX Systems
- Supporting agents: Backend/Data Integrity
- Preconditions: preserve required compliance messaging and saved-state behavior.
- Validation steps: card-level component checks and seeker journey inspection.
- Exit criteria: result cards are easier to scan without losing access to secondary details.

## Fixes Applied

Observed in the current working tree:

- Shared seeker chrome has been toned down.
- Chat, directory, and map now use a common discovery-surface tab pattern.
- Right-rail guidance blocks were removed from the primary seeker surfaces.
- Advanced filters are increasingly hidden behind explicit “Refine” controls.
- Service cards now support progressive disclosure for extended details.

## Verification Performed

Verification still required for this lane:

- targeted seeker component tests
- affected page/client tests
- relevant e2e seeker flow checks

This report exists to complete four-lane coordination and capture the active UX cleanup scope; it should be updated after the UX lane finishes its verification pass.

## Open Dependencies On Other Agents

- Platform: rerun full validation after the cross-lane changes stabilize.
- Backend/Data Integrity: confirm that hidden or deferred UI sections still match the backend contract and error states.
- Security and Compliance: confirm that calmer UI treatment does not hide required privacy or crisis messaging in unsafe ways.

## Resolved Dependencies From Other Agents

- Security lane’s Maps and auth hardening can now be reflected in calmer seeker flows without reintroducing exposed secrets or misleading sign-in options.

## Re-audit Notes

- The UX lane report was missing and is now created.
- The current working tree indicates active UX simplification work rather than a completed, fully verified UX cycle.

## Final Domain Status

Current status: not production-ready yet

What is improved:

- calmer seeker hierarchy
- more unified discovery switching
- reduced default cognitive load

What remains:

- run and record validation for the affected seeker/UI test surfaces
- reconcile any UX regressions surfaced by tests
- update the report after verification is complete
