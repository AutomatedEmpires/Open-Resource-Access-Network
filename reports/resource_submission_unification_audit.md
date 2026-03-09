# Resource Submission Unification Audit

## Objective

Review the current organization dashboard, listing creation flows, API routes, DB schemas, signup and role flows, scope behavior, and admin review surfaces, then define a unified resource submission system that:

- uses one visual card-based fillout experience for org submitters, non-org/public submitters, community admins, and ORAN admins
- stays aligned with the repo direction toward source -> canonical -> live unification
- preserves submitter, reviewer, timestamps, decision history, and reverification metadata
- maps cleanly onto ORAN's HSDS-aligned data model without inventing a fourth intake path

This audit focuses on the workflow and product layer. It does not propose a competing ingestion architecture.

---

## Executive Summary

The repo already has the right workflow spine for a unified submission system:

- `submissions`
- `submission_transitions`
- `form_instances`
- `form_templates`
- role and scope guards

But the actual product surface is fragmented:

- host org/service/location management still uses bespoke CRUD pages and modals
- org claims use a separate wizard
- public users can report a bad listing, but cannot submit a structured new resource through the same system
- community admins review submissions in a bespoke verification screen
- ORAN admins review org claims in another bespoke screen
- the generic forms workspace exists, but it is not the main resource submission experience

The cleanest direction is:

1. Keep `submissions + form_instances` as the workflow and draft system of record for manual human submissions.
2. Build one domain-specific `ResourceSubmissionShell` on top of that system.
3. Use the same cards in different modes: `submit`, `edit`, `review`, `approve`, `history`.
4. Route approved/manual submissions into the same downstream source/canonical/live pipeline the other agents are already building.

Do not keep extending the current host CRUD modals. They are the wrong center.

---

## Implementation Re-audit — 2026-03-08

The repo has now moved materially toward this target.

Implemented in this lane:

- a shared `ResourceSubmissionWorkspace` now powers host claim, public submit, community-admin review detail, and ORAN-admin approval detail
- `src/services/resourceSubmissions/service.ts` plus `/api/resource-submissions` now provide one submission-backed draft, save, submit, review, approve, and publish bridge for this workflow family
- host listing creation and edit entry points now route through `Resource Studio` instead of the old service modal path
- the host studio now has a real landing state with explicit start actions, submission history, and deterministic reopen links
- the public submit route now has an explicit start or continue flow instead of creating an anonymous draft on page load
- workspace URLs now normalize to `entryId` after draft creation so save, refresh, and review links are reproducible

What improved beyond the original audit:

- the highest-risk UX bug was removed: visiting the studio or public submit page no longer creates orphan drafts automatically
- host dashboard recent-submission rows now deep-link into the exact shared submission cards instead of dropping operators into a generic queue or legacy screen
- the services list is now clearly a published-record surface, with create and edit framed as studio actions rather than a second competing CRUD model

What is intentionally split versus fully shared:

- community-admin queue and ORAN approvals remain dedicated operator workbenches for scanning, claiming, filtering, bulk action, and quick-action triage
- both workbenches now hand detailed review into the shared submission renderer instead of maintaining a second bespoke approval editor
- the older generic `FormVaultWorkspace` currently has unrelated TypeScript syntax failures outside this resource-submission lane

So the center is now correct, and the remaining work is shell standardization around the queue surfaces rather than more retirement of legacy review detail editors.

---

## Production Readiness Checklist — 2026-03-09

This checklist is the current go or no-go snapshot for the resource-submission unification lane itself, not a blanket claim that the full repository is globally production-ready.

### Validation snapshot

- focused TypeScript validation: `npx tsc --noEmit` completed successfully in the workspace
- broader unified-surface validation: focused Vitest run passed `44/44` tests across host dashboard, resource studio, host org, host locations, host services, claim, public submit, public report, community verify, and ORAN approvals
- touched host shell validation: `portal-page-shells.test.tsx` remains green with `4/4` passing

### Checklist

| Area | Status | Evidence | Remaining gap |
| --- | --- | --- | --- |
| Shared submission center is the primary create and review surface | Pass | `ResourceSubmissionWorkspace` drives host claim, public submit, community verify detail, and ORAN approval detail | none at the workflow-center level |
| Host service creation and edit no longer depend on the legacy modal CRUD path | Pass | host services launches Resource Studio for create and edit; focused tests pass | archive remains intentionally on the published-record page |
| Host organization editing is folded into the Studio-first model | Pass | org page is now a published-record surface with Studio-only structured update actions and focused tests pass | none on the current host org surface |
| Host location editing is folded into the Studio-first model | Pass | locations page is now a published-record surface with Studio-only listing-bundle handoff and focused tests pass | none on the current host locations surface |
| Public structured submission uses the same product shell | Pass | submit-resource start or continue flow is on the shared submission workspace and tests pass | none on the main path |
| Community admin review detail uses the same renderer as submitters | Pass | verify detail path renders shared submission cards and focused tests pass | queue list remains an intentional operator workbench for triage, assignment, and bulk review |
| ORAN admin approval detail uses the same renderer as submitters | Pass | approvals detail path renders shared claim cards through a dedicated detail route and focused tests pass | approvals list remains an intentional operator workbench for queue scanning plus quick actions |
| URLs and re-entry behavior are deterministic | Pass | studio and public submit now normalize to stable `entryId` links; tests pass | none on the main path |
| Evidence and proof docs match the current implementation | Pass | audit, form-flow evidence map, and page-shell tests were updated to the Studio-first contract | keep synchronized as legacy pages are retired |
| Repo-wide production-ready claim is justified | Fail | the unified submission slice is green, but the repo still has broad unrelated diagnostics debt outside this lane | global lint and documentation debt still needs its own cleanup pass before a whole-repo green claim |

### Verdict

The resource-submission unification slice is operationally credible and internally coherent.

It is ready to be treated as the product center for host submission, public submission, and admin review detail.

The host org and host locations surfaces are now consistent with the Studio-first contract.

The remaining architectural boundary is now explicit: queue and approvals boards are intentional operator workbenches, while detailed review is unified on the shared submission workspace.

### Highest-priority remaining work

1. Standardize the queue-board shell language called for in `docs/ui/UI_SHELL_SPEC.md` so community and ORAN operator inboxes feel intentionally related, not historically adjacent.
2. Re-run the focused unified-surface test slice whenever queue or approval detail contracts change, since those remain the most sensitive shared-review seams.
3. Keep the evidence map synchronized whenever a host or admin surface regains or sheds a direct mutation path.

---

## Current State Audit

### 1. How organization users get in

Current auth and onboarding behavior:

- `src/app/auth/signin/SignInPageClient.tsx`
- `src/app/api/auth/register/route.ts`
- `src/services/auth/session.ts`
- `src/services/auth/guards.ts`

What exists now:

- Sign-in has three path intents: seeker, organization, admin.
- Registration always creates a `user_profiles` row with role `seeker`.
- A user does not become a host user at registration time.
- Host access is derived later from `organization_members` and/or explicit session role metadata.
- `session.ts` computes the effective role from the highest available privilege:
  - `seeker`
  - `host_member`
  - `host_admin`
  - `community_admin`
  - `oran_admin`

What this means:

- The current system is already set up for "anyone can start as a seeker, then graduate into org/admin access later."
- That is compatible with one shared resource submission UI.
- The unified submission system should not branch at registration. It should branch at permissions and routing.

### 2. Organization dashboard and host workspace

Current host entry surfaces:

- `src/app/(host)/host/HostDashboardPageClient.tsx`
- `src/app/api/host/dashboard/route.ts`
- `src/app/(host)/org/OrgPageClient.tsx`
- `src/app/(host)/claim/ClaimPageClient.tsx`
- `src/app/(host)/services/ServicesPageClient.tsx`
- `src/app/(host)/locations/LocationsPageClient.tsx`

What exists now:

- The dashboard is an operational overview with metrics and quick links.
- Organizations are managed in a list + edit modal.
- Claiming an organization uses a separate three-step wizard.
- Services are created and edited in a large modal form.
- Locations are created and edited in a separate large modal form.

Main issue:

- There is no single "resource listing studio" for hosts.
- Service and location intake are split apart even though a publishable listing usually needs both.
- Organization creation, organization claim, service create, service update, and location create all follow different workflow rules.

### 3. How a host creates a listing today

Current routes:

- `src/app/api/host/organizations/route.ts`
- `src/app/api/host/organizations/[id]/route.ts`
- `src/app/api/host/claim/route.ts`
- `src/app/api/host/services/route.ts`
- `src/app/api/host/services/[id]/route.ts`
- `src/app/api/host/locations/route.ts`
- `src/app/api/host/locations/[id]/route.ts`

Current behavior:

- `POST /api/host/organizations`
  - creates a live `organizations` row directly
  - auto-creates `organization_members` membership for the creator
  - records a host portal source assertion
  - does not go through review
- `POST /api/host/claim`
  - creates org + placeholder service
  - creates a `submissions` row with `submission_type='org_claim'`
  - enters review workflow
- `POST /api/host/services`
  - creates a live `services` row directly with `status='inactive'`
  - records source assertion
  - creates a `service_verification` submission
- `PUT /api/host/services/[id]`
  - if the service is active, changes are queued for review
  - otherwise some changes still save directly
- `POST /api/host/locations`
  - creates a live `locations` row directly
  - inserts address, phones, schedules directly
  - does not create a review submission
- `PUT /api/host/organizations/[id]`
  - writes directly to the live organization row
  - does not create a submission

This is the biggest current inconsistency.

The host can currently create a "listing" only by manually stitching together:

1. organization
2. service
3. location

across separate pages and different workflow rules.

### 4. Public or non-org submissions

Current public/community submission surface:

- `src/app/(seeker)/report/ReportPageClient.tsx`
- `src/app/api/submissions/report/route.ts`

What exists now:

- Public or authenticated seekers can report an existing listing.
- This creates a `community_report` submission.
- This is correction/quality reporting only.

What does not exist:

- A structured "submit a resource for review" flow for a non-org person suggesting a new service.
- A shared draft/save/review experience for public submitters.

So today the repo has:

- host creation flows
- claim flow
- report/correction flow

but not one unified resource submission product.

### 5. Community and ORAN admin review

Current review surfaces:

- `src/app/(community-admin)/verify/VerifyPageClient.tsx`
- `src/app/api/community/queue/route.ts`
- `src/app/api/community/queue/[id]/route.ts`
- `src/app/(oran-admin)/approvals/ApprovalsPageClient.tsx`
- `src/app/api/admin/approvals/route.ts`

What exists now:

- Community admins triage work from a dedicated queue board at `/queue`.
- Queue rows hand detailed review into `/verify?id=...`, which renders the shared submission workspace whenever a resource-submission packet exists.
- ORAN admins scan and quick-action claim approvals from `/approvals`.
- Deep claim review hands off into `/approvals/[id]`, which renders the shared submission workspace for the exact claim packet the submitter completed.

What this means:

- The list workbenches are now intentionally separate operator inboxes.
- The detail editor is unified where workflow accuracy matters most: the same submission-backed cards used by submitters and reviewers.

What this means:

- The data model is partially unified.
- The review UI is not.

### 6. Generic forms system already exists

Relevant files:

- `src/components/forms/FormVaultWorkspace.tsx`
- `src/app/api/forms/templates/route.ts`
- `src/app/api/forms/instances/route.ts`
- `src/app/api/forms/instances/[id]/route.ts`
- `src/services/forms/vault.ts`
- `src/domain/forms.ts`
- `src/db/schema.ts`

What exists now:

- templates
- instances
- drafts
- save
- submit
- start review
- approve
- deny
- return
- organization/community/platform storage scopes

This is already the closest thing in the repo to the system you want.

But it is still too generic:

- it renders fields, not a purpose-built listing/resource card experience
- it is not the main path for hosts creating resources
- it is not the same surface as community verify or ORAN approvals

### 7. Scope and role model

Current role/scope system is good enough to support a unified resource submission renderer.

Relevant files:

- `src/services/auth/session.ts`
- `src/services/auth/guards.ts`
- `src/services/community/scope.ts`
- `src/db/schema.ts`

What exists now:

- org access via `organization_members`
- platform admin bypass via `oran_admin`
- community review scope via `admin_review_profiles`, coverage zones, states, counties
- optional scope grants via `platform_scopes`, `role_scope_assignments`, `user_scope_grants`

This is strong enough to drive:

- who can edit which cards
- who can see review-only cards
- who can approve
- who can bulk approve
- who can see org-scoped vs public submissions

### 8. Data model support

The existing schema already gives most of the audit metadata you asked for.

Key tables:

- `submissions`
- `submission_transitions`
- `organization_members`
- `user_profiles`
- `form_templates`
- `form_instances`

These already support:

- submitter ID
- reviewer ID
- reviewer notes
- status timeline
- created/submitted/reviewed/resolved timestamps
- lock/assignment state
- SLA deadline
- organization ownership
- recipient role

The missing piece is not the workflow spine. The missing piece is the resource-specific payload model and the shared UI renderer.

---

## Key Findings

### Finding 1: There is no single listing creation path

A host does not create "a resource" in one place. They create:

- an organization on one page
- a service on another page
- a location on another page

This is structurally weak for trust, usability, and review.

### Finding 2: Workflow rules are inconsistent by entity type

Examples:

- org create is direct-to-live
- org claim is submission-backed
- service create is direct-to-live plus queued review
- active service update is review-backed
- location create is direct-to-live

This should be unified.

### Finding 3: The visual fillout experience is not modern or reusable

The current host pages are mostly:

- tables
- dialogs
- stacked fields

They do not support:

- card completion states
- checklist progression
- role-based reuse of the same shell for review
- structured diff review

### Finding 4: The forms system is underused

`FormVaultWorkspace` proves the repo already has a reusable draft/save/submit/review engine.

You should not build a brand-new workflow table set for resource submission.

You should build a resource-specific experience on top of this engine.

### Finding 5: Public submission is too narrow

The current public path only supports "report a bad listing."

It does not support:

- submit a new resource suggestion
- suggest an edit with structured fields
- attach richer evidence

### Finding 6: Review is not visually unified

Community admins, ORAN admins, hosts, and public submitters all see different shapes for the same underlying workflow idea.

That is a product and operations problem.

### Finding 7: Service taxonomy capture is already leaking

`ServicesPageClient.tsx` tracks `categories`, but the create/update service API schema does not accept categories. The UI implies taxonomy capture that never reaches the backend.

That is exactly the kind of drift a unified card/schema system should eliminate.

### Finding 8: Location is treated as a separate CRUD concern, not part of resource completeness

For many resources, the publishable unit is not just a service row. It is a service plus:

- contact
- location
- hours
- eligibility
- taxonomy

The product should reflect that.

---

## Recommended Target Architecture

## Core Principle

Use one shared `Resource Submission` product layer backed by:

- `form_templates`
- `form_instances`
- `submissions`
- `submission_transitions`

and project approved values into the downstream ORAN source/canonical/live pipeline.

Do not make host CRUD modals the center.

Do not make public report pages the center.

Do not make community verify the center.

Do not make the generic Form Vault UI the final end-user product.

### Recommended option

Recommended approach:

- keep the generic forms engine
- extend it with resource-specific metadata and rendering
- build a dedicated resource submission shell over it
- keep domain-specific workflow semantics visible

### Rejected option A: Keep current host CRUD and only redesign the front-end

Why reject it:

- does not unify workflow
- does not unify public submission
- does not unify admin review
- keeps entity-specific inconsistencies

### Rejected option B: Force everything into generic `managed_form` without domain semantics

Why reject it:

- reduces clarity in routing, SLA, triage, metrics, and approval policy
- makes org claims, service verification, public suggestions, and corrections harder to distinguish operationally

### Recommended option C: Shared resource shell over forms + submissions, with resource-specific workflow metadata

Why it wins:

- one renderer
- one draft model
- one approval timeline
- one permission model
- preserves domain-specific routing and reporting

---

## Proposed Product: Resource Submission Shell

Introduce a shared UI system:

- `ResourceSubmissionShell`
- `ResourceSubmissionCard`
- `ResourceSubmissionChecklist`
- `ResourceSubmissionActionBar`
- `ResourceSubmissionTimeline`
- `ResourceSubmissionDecisionDock`

This should replace bespoke fillout/review experiences for:

- host organization claim
- host resource create/edit
- public resource submission
- community admin review
- ORAN admin review/override

### Interaction model

Desktop:

- left rail: section checklist
- main column: expandable cards
- right rail: submission metadata, confidence/trust, review timeline, source/evidence, draft/save state
- sticky footer: save draft, submit, request info, approve, deny, edit and approve

Mobile:

- top progress strip
- stacked cards
- sticky bottom action tray

### Visual model

Each card is a "box element" with:

- title
- short explanation
- required field count
- completion chip
- green state when required fields are complete
- amber state when required fields are complete but recommended trust fields are missing
- red state when invalid

This directly matches your "card fillout process, fields/checkboxes/tag selections, green when complete" requirement.

---

## Proposed Card Set

### Card 1: Organization Identity

Fields:

- organization name
- description
- website
- email
- phone
- tax/legal metadata where relevant

Maps to:

- `organizations`
- `organization_members` only after approval

### Card 2: Listing Basics

Fields:

- service name
- alternate name
- short description
- long description / application process / fees / wait time
- delivery/access indicators

Maps to:

- `services`

### Card 3: Contact and Access

Fields:

- phones
- email
- site URL
- interpretation/language support
- contact preferences

Maps to:

- `phones`
- `services.email`
- `services.url`

### Card 4: Location and Service Area

Fields:

- physical or virtual
- one or more locations
- address
- coordinates if allowed
- transportation
- service area

Maps to:

- `locations`
- `addresses`
- `service_at_location`
- `service_areas`

### Card 5: Hours and Availability

Fields:

- hours by day
- holiday or seasonal notes
- appointment requirements

Maps to:

- `schedules`

### Card 6: Eligibility and Requirements

Fields:

- eligibility rules
- age/income/residency constraints
- documents required

Maps to:

- `eligibility`
- `required_documents`

### Card 7: Taxonomy and Tags

Fields:

- ORAN-facing need/category selections
- HSDS/211 taxonomy mapping or source taxonomy selection
- audience/program/access tags when relevant

Maps to:

- `service_taxonomy`
- ORAN tags / derived tags
- source taxonomy retention in the ingestion/source layer

This card must be deterministic. No more UI-only categories that silently disappear.

### Card 8: Evidence and Source

Fields:

- source URL
- source type
- proof notes
- attachments
- submitter relationship to the organization

Maps to:

- `submissions.payload`
- `submissions.evidence`
- source assertion creation

### Card 9: Review and Trust Metadata

Read-mostly fields:

- submitted by
- submitted at
- assigned reviewer
- reviewed at
- resolved at
- last verified
- reverify due
- current trust/confidence band
- anomaly flags
- transition history

Maps to:

- `submissions`
- `submission_transitions`
- review metadata / confidence / reverification read models

This card should not be raw editable form state. It should be a shared review metadata panel.

---

## Unified Modes

The same card system should render in five modes.

### 1. Submit mode

Used by:

- host org users
- non-org public submitters

Capabilities:

- edit fields
- save draft
- submit
- attach evidence

### 2. Edit mode

Used by:

- host users editing an existing record
- admins correcting before approval

Capabilities:

- show current live values vs proposed values
- allow inline edits where permitted

### 3. Review mode

Used by:

- community admins
- ORAN admins

Capabilities:

- same card layout
- field lock states
- reviewer comments
- decision controls
- request-more-info controls

### 4. Approve mode

Used by:

- community admins for scoped approvals
- ORAN admins for global/override approvals

Capabilities:

- approve
- deny
- return/request more info
- edit and approve
- bulk approve for lanes that policy allows

### 5. History mode

Used by:

- submitter viewing past submissions
- admins auditing a past decision

Capabilities:

- read-only card state
- timeline
- diff history

---

## Proposed Data Contract

## Recommendation

Keep `form_instances` for structured editable payloads, and keep `submissions` for workflow and audit metadata.

### `form_instances.form_data`

Store the resource draft shape here:

```json
{
  "resource": {
    "organization": {},
    "service": {},
    "locations": [],
    "eligibility": {},
    "taxonomy": {},
    "evidence": {}
  },
  "ui": {
    "completion": {},
    "card_order": []
  }
}
```

### `submissions.payload`

Store workflow metadata here:

- intake channel
- source type
- original entity IDs if editing existing records
- requested action
- review lane
- trust lane
- fast-track flags
- diff summary

### `submissions.evidence`

Store:

- uploaded evidence descriptors
- source URLs
- snapshots
- reviewer evidence notes

### `submission_transitions`

Remains the full audit timeline.

This is where submitter/verifier/timestamps already belong.

---

## Workflow Recommendation

## One shared resource workflow family

Recommended submission families:

- `org_claim`
- `resource_submission`
- `resource_update`
- `community_report`

Implementation note:

- these can still use `form_instances`
- but they should not all collapse into a single meaningless workflow type

The forms engine should support template-level workflow metadata such as:

- `workflow_submission_type`
- `projection_target`
- `default_review_role`
- `allow_anonymous_submitter`
- `completion_rules`

### Host org submission

When a host user creates or edits a listing:

- create/update a `form_instance`
- create/update a `submission`
- create a source assertion
- do not rely on direct live mutations as the long-term system center

### Non-org/public submission

When a non-org person suggests a resource:

- same shell
- narrower allowed fields
- community-admin default routing
- clear note that submission is a suggestion, not a self-managed listing

### Community admin review

Use the same cards in review mode:

- see structured values
- see evidence/source
- approve / deny / return / edit and approve

### ORAN admin review

Use the same shell for:

- org claims
- escalations
- cross-scope overrides
- template/policy exceptions

---

## Scope and Permission Matrix

### Seeker / anonymous submitter

Should be able to:

- submit a new resource suggestion
- report issues on existing listings
- optionally provide evidence and contact info

Should not be able to:

- publish
- directly edit live records
- see internal review metadata

### Host member

Should be able to:

- draft or update resources for owned orgs
- save draft
- submit for review

Should not be able to:

- manage org membership
- approve own submissions

### Host admin

Should be able to:

- do everything host member can do
- submit org claims
- manage org-scoped submission activity

### Community admin

Should be able to:

- review scoped submissions
- request more info
- approve/deny within policy lane
- bulk approve when policy permits

### ORAN admin

Should be able to:

- override scope
- approve escalations
- edit and approve
- manage templates and policy

---

## Specific Improvements Needed

### 1. Replace host CRUD modals with a submission studio

Priority target:

- `src/app/(host)/services/ServicesPageClient.tsx`
- `src/app/(host)/locations/LocationsPageClient.tsx`
- `src/app/(host)/org/OrgPageClient.tsx`

Why:

- these are the least durable surfaces in the current system
- they split resource completeness across pages
- they cannot serve admin review without duplication

### 2. Merge service + location into one publishable bundle flow

The submission UI should let the user build:

- service
- locations
- hours
- contact
- taxonomy

in one experience.

You can still persist to separate live tables later. The product surface should not force the user to think in relational fragments.

### 3. Move public submission beyond "report a listing"

Add a structured "Submit a Resource" path using the same shell.

Do not create another one-off public form.

### 4. Converge admin review onto the same renderer

Replace bespoke review pages over time:

- community verify
- ORAN approvals

They can keep their queue list pages, but the detail page should use the same card renderer.

### 5. Fix taxonomy capture at the UI/API boundary

Current issue:

- host service UI collects categories
- backend create/update schemas do not support those values

That exact mismatch must disappear in the new system.

### 6. Make completion and trust visible

Every card should show:

- complete / incomplete
- required / recommended
- trust impact

The entire submission should show:

- draft completeness
- minimum publishable readiness
- missing fields
- who reviews it next

### 7. Keep review metadata out of editable form payloads

Do not store reviewer identity or timeline inside the editable card payload.

Those belong to:

- `submissions`
- `submission_transitions`
- derived review metadata

---

## Recommended API Shape

Recommended long-term user-facing façade:

- `POST /api/resource-submissions`
- `GET /api/resource-submissions`
- `GET /api/resource-submissions/[id]`
- `PUT /api/resource-submissions/[id]`
- `POST /api/resource-submissions/[id]/submit`
- `POST /api/resource-submissions/[id]/decision`

These routes should wrap:

- `form_instances`
- `submissions`
- `submission_transitions`

Why a façade route is useful:

- keeps host/public/admin product code away from generic form mechanics
- preserves a domain-specific contract
- allows the forms engine to remain generic underneath

### Important boundary

Do not make this a new competing workflow system.

It should be an application layer over the existing universal workflow tables.

---

## Recommended Schema Extensions

You do not need a new workflow table family.

Recommended extensions:

### `form_templates`

Add resource-template metadata such as:

- `workflow_submission_type`
- `projection_target`
- `entity_kind`
- `completion_rules`
- `review_policy`
- `allow_anonymous_submitter`

### `form_instances`

Current table is sufficient for drafts, but you may want:

- optional `draft_version`
- optional `last_submitted_snapshot`

if diff/review history needs to be stronger

### `submissions.payload`

Standardize keys for:

- intake channel
- source provenance
- existing entity refs
- review lane
- fast-track status
- anomaly flags

### Not recommended

- do not create a separate bespoke `resource_submissions` table before exhausting the existing forms + submissions model

---

## Rollout Order

### Phase 1

Create the shared resource submission schema and renderer.

Output:

- card shell
- completion logic
- submit/review/approve modes

Status:

- complete

### Phase 2

Replace host service create/edit with the new shell.

Keep old routes working behind an adapter if needed.

Status:

- complete for primary create/edit entry
- legacy service archive remains on the published-record page by design

### Phase 3

Fold location and organization details into the same host submission studio.

Goal:

- one "Add resource" experience instead of separate service/location flows

Status:

- partially complete
- organization claim and listing organization fields are unified
- organization profile CRUD and location CRUD still retain legacy pages

### Phase 4

Launch public "Submit a Resource" on the same shell.

Status:

- complete

### Phase 5

Switch community admin review detail pages to the same renderer.

Status:

- complete for detail review

### Phase 6

Switch ORAN admin org claim/detail review to the same renderer.

Status:

- complete for detail review

### Phase 7

Retire duplicated CRUD/review pages once parity is proven.

Status:

- not complete
- legacy org and location CRUD remain
- legacy list workbenches remain for queue-style navigation

---

## Recommended Product Outcome

The final user experience should feel like:

- one modern resource submission studio
- one visual card language
- one consistent review experience
- one trustworthy audit trail

Hosts should feel like they are completing a resource packet, not filling random tables.

Public submitters should feel like they are contributing structured community knowledge, not sending a vague report.

Community and ORAN admins should feel like they are reviewing the same exact object the submitter built, with added evidence, diff, and decision tools.

---

## Final Recommendation

Build the unified resource submission experience on top of `form_instances + submissions`.

That is the most justifiable, least duplicative, and most future-proof path in this repo.

It lets you:

- keep one audit trail
- keep one draft/save/submit model
- keep one role/scope system
- unify org, public, and admin experiences
- stay aligned with the downstream source/canonical/live architecture already in motion

The next implementation slice should be:

1. define the resource template metadata contract
2. build the card renderer and completion model
3. replace host service create/edit first

That is the highest leverage place to start.
