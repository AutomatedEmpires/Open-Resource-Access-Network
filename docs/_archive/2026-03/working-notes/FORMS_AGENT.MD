Copilot Prompt: ORAN Forms + Workflow + Permissions “Scope Center” Specification (Deep)

You are the Owner + Lead Developer + Security Architect + Investor + Seeker + Admin + Organization Admin for ORAN. Your job is to produce a complete, exhaustive system design for ORAN’s forms, workflows, verification, and role-based access control (RBAC) / scopes that is “Google-level” (central scope admin, delegation, audit trails, least-privilege).

Core Objective

I need to confirm ORAN has every form and workflow needed for every actor, and that:

Every form field maps to a retained DB column (or JSONB schema with strong validation).

Every form submission goes through a defined pipeline with statuses, owners, permissions, and notifications.

There is a definitive storage location for every form and every artifact (submission record, evidence, attachments, audit logs).

There is a global scope center where super-admins manage platform-wide scopes, and a separate organization scope center where org admins manage scopes inside their org.

There are “button/tag/autofill” flows (mobile-first) rather than verbose text walls.

1) Enumerate ALL Actors (Personas) + Their Dashboards

Create a list of personas and for each:

what they can do

what they need to see

what forms they can submit

what notifications they receive

what pipelines they participate in

Personas (minimum):

Public visitor

Seeker (logged-in)

Seeker with profile (eligibility-driven)

Organization (public profile page)

Organization Admin

Organization Verifier (delegate role)

Platform Admin (moderation + ops)

Platform Super Admin (scope authority)

Data Ingestion Agent (automated)

Verification Agent (automated)

Appeals/Disputes reviewer

Partner/Integrator (API client)

Deliverable: Role → capabilities matrix and page/dash surface map.

2) The “Forms Universe” Inventory

Produce a definitive catalog of every form ORAN should support. For each form define:

Form name

Who can submit it

Required fields (with validation rules)

Optional fields

Attachments/evidence

Output DB tables/columns (or schema)

Workflow pipeline (statuses)

Notifications triggered

SLA/timeline expectations

Audit logging requirements

Minimum forms required:

Seeker-facing

Account creation + identity verification (if any)

Profile builder (eligibility, household, location, transportation, income bands, dependents, veteran status, disability indicators—careful w/ privacy)

Resource request / help request (to orgs)

Listing feedback (incorrect info, closed, moved, fraud)

Claim benefit / application help request

Save/favorite + notes

Report abuse

Appeal decision (if their request/listing was denied)

Organization-facing

Create organization profile

Request organization verification

Create resource listing (service)

Edit listing

Upload proof (documents, screenshots, official letter, licensing)

Respond to community requests (optional opt-in)

Assign verifications to org verifiers

Manage team members (org-scoped RBAC)

Manage service coverage area

Accept/deny inbound seeker requests

Close / deprecate a listing

Platform admin-facing

Review queue (new orgs)

Review queue (new listings)

Review queue (edits)

Review queue (flagged listings)

Review queue (fraud / spam)

Approve / deny / request more info

Merge duplicates (org merge, listing merge)

Bulk actions + batch triage

Dispute resolution pipeline

Trust scoring overrides

Add/remove admin / manage platform scopes

System settings (taxonomy, categories, required fields by category, form templates, retention rules)

3) Define the Universal Pipeline Engine (Status Machine)

Design a standard workflow engine used by ALL submissions.

Define:

Universal submission object

Required states (example):

Draft

Submitted

Auto-validated

Needs human review

Request more info

Under review

Approved

Denied

Published (if applicable)

Revisions requested

Escalated

Appealed

Archived

State transitions (who can move what state)

“Gate” rules (what conditions must be met before advancing)

Timers / SLA (e.g., org verification must be reviewed within X days)

Locking rules (what edits are allowed while under review)

Deliverable: State transition table + permission checks per transition.

4) “Google-Level Scope Center” (Platform RBAC / Scopes)

I need a global “Scope Center” where super admins can:

Create roles

Assign scopes

Gate actions behind scopes

Add/remove platform admins

Require approvals for sensitive scope grants

Provide audit logs of scope changes

Have emergency break-glass access policy

Define:

scope naming convention (platform:*, org:*, listing:*, review:*, verification:*, etc.)

default roles (viewer, triager, reviewer, approver, super admin)

separation of duties (triage vs approval)

how new admins are authorized

“two-person rule” for high-risk scope grants (optional but ideal)

Deliverable:

Scopes list (minimum 50+ scopes)

Role templates

Admin grant/revoke flow

Audit log schema

5) Organization Scope Center (Org RBAC)

Organizations need a simpler scope center:

Org Admin can invite users to org

Assign roles: editor, verifier, request-handler, billing (later), readonly

Control whether org participates in “community verification”

Control whether org accepts inbound seeker requests

Assign verification tasks to individual verifiers

Each verifier gets notifications + a timeline + due dates

Deliverable:

Org roles/scopes

Invite flow + confirmation + revocation

Task assignment flow

Notifications + timeline UX

6) Verification System (Org + Listing Trust)

Define how ORAN verifies:

A) Organization verification

How an org requests verification

What is required (e.g., domain email confirmation, phone verification, EIN lookup, nonprofit registry match, government registry match, official document uploads, address match)

Evidence types (documents/screenshots/links)

Verification scoring model

Who reviews (platform admin vs partner vs automated)

Outcomes: Verified / Not Verified / Needs Info / Denied

Re-verification schedule (every X months)

B) Listing verification

Verified by the org itself (owner attestation)

Verified by platform

Verified by community (if enabled)

“Last verified” timestamp + verification method displayed

How disputes are handled (someone claims listing is wrong)

Deliverable:

Verification requirements checklist

Evidence schema

Trust score formula

UI states + badges

7) Form UX Requirements (Fast, Click-Based, Mobile-First)

The system must favor:

structured inputs (toggles, tags, dropdowns)

step-by-step wizards

progressive disclosure

minimal free-text (only when necessary)

templates + autofill from known data

Deliverable:

form patterns library

recommended field types per data category

examples for 3 most important forms:

Create listing

Request org verification

Report incorrect listing

8) Database Retention Proof (No orphan fields)

For EACH form:

list every field

show exactly where it is stored

show constraints + validation (Zod / DB constraints)

show how it appears in admin tools

show exportability (for audits)

Deliverable:

ERD or schema map (tables and relationships)

“Field → Column” mapping table (must be complete)

9) Notifications + Audit Logging

Define:

notification events (created, assigned, needs info, approved, denied, due soon, overdue)

channels (in-app, email, SMS later)

preferences per user/org

audit log events (scope grants, state changes, edits, merges, verification actions)

Deliverable:

notification event catalog

audit log schema

sample timeline for a verification task

10) Output Format Required

Return a structured spec with:

Persona matrix

Forms catalog (as a table-like structure)

Workflow engine state machine

Platform RBAC scopes + role templates

Org RBAC scopes + delegation flows

Verification system requirements

DB schema + field retention mapping approach

Notification + audit design

“Gaps” checklist: what we are missing today, and what must be built next

Be exhaustive. Assume I will build exactly what you specify.

Extra instruction: be honest about missing items

If anything is undefined or ambiguous, propose defaults and mark them as assumptions. The goal is completeness and implementability.
