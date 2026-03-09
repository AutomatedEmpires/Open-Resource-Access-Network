# ORAN Governance

## Branching expectations

- Use feature branches from `main`.
- Keep PRs small and focused.
- One concern per PR whenever possible.

## Labeling rules

Use labels to classify work clearly:

- `type:*` for work type (bug/spec/scaffold/data/security).
- `area:*` for product/technical area.
- `priority:*` for urgency.
- `risk:*` for safety or operational risk.

### Current label set (repo)

These are the currently defined labels in GitHub for this repository. **Do not invent new labels** in issues/PRs or agent output; use these exact labels.

- **Area**: `area:chat`, `area:ci`, `area:db`, `area:docs`, `area:import`, `area:map`, `area:scoring`, `area:search`, `area:security`, `area:ui`
- **Priority**: `priority:P0`, `priority:P1`
- **Risk**: `risk:data-integrity`, `risk:privacy`, `risk:safety-critical`
- **Size**: `size:S`, `size:M`, `size:L`, `size:XL`
- **Status**: `status:blocked`, `status:in-progress`, `status:needs-info`, `status:needs-review`, `status:ready`
- **Type**: `type:adr`, `type:scaffold`, `type:spec`
- **Needs**: `needs:decision`, `needs:docs`, `needs:tests`
- **General**: `bug`, `dependencies`, `documentation`, `duplicate`, `enhancement`, `github_actions`, `good first issue`, `good-first-task`, `help wanted`, `invalid`, `javascript`, `question`, `wontfix`

### Project board automation

The ORAN Roadmap Project is label-driven:

- `area:*`, `priority:*`, `risk:*`, `size:*` map to Project fields of the same names.
- `status:*` labels influence the Project **Status** column (Todo/In Progress/Done).
- Closed items are set to **Done**.

Implementation lives in `.github/workflows/project-sync.yml`.

## What requires tests

- Behavior changes require tests (unit and/or integration).
- Data model, migrations, and API contract changes require targeted validation.
- Safety-critical changes require explicit test coverage.
- Template-only PRs: CI may not execute meaningful checks; review file contents manually.

## What requires an ADR/spec

Create a spec or ADR before implementation when changing:

- Safety constraints or confidence messaging
- Scoring rules or ranking behavior
- Crisis routing logic (911 / 988 / 211)
- Data model (HSDS/ORAN extensions)
- Search API contract (endpoints/DTOs/ServiceSearchEngine contract)

## Safety-critical norms

- Do not hallucinate services, addresses, hours, eligibility, or URLs.
- Do not make guaranteed eligibility claims.
- Preserve crisis routing expectations (911 / 988 / 211).
- Verify accessibility-first behavior (keyboard, screen reader support, mobile-first assumptions).

## Iterate openly

Contributors and agents are encouraged to propose improvements to governance/templates via focused PRs.

---

## Ingestion & Approval Workflow

### Ingestion pipeline gate

All records discovered by the ingestion agent must pass through the full
pipeline before human review:
`SourceCheck → FetchPage → ExtractHtml → LlmExtract → LlmCategorize →
Verify → Score → BuildCandidate → RouteToAdmin`

No record may be published to seeker-facing search without explicit human approval.
The LLM may only assist with extraction and categorization — it never ranks,
retrieves, or publishes.

### Human approval requirements

- Community admins review `candidate_assignments` routed to their coverage zone.
- ORAN admins handle escalated candidates and override decisions.
- A candidate may be published, rejected with notes, or escalated.
- Rejection notes are required and visible to the submitting host.

### Two-person rule for scope grants

Scope grant requests (platform_scopes / scope_grants) enforce a **two-person
approval constraint**: the user who requested a grant cannot be the same user
who approves it. This is enforced at the API layer in
`src/app/api/admin/scopes/`.

### SLA tiers

| Tier | Assignment target | Escalation trigger |
|---|---|---|
| P0 (crisis-related service) | 4 hours | 8 hours unreviewed |
| P1 (standard) | 24 hours | 72 hours unreviewed |
| P2 (low-confidence / low-traffic area) | 72 hours | 7 days unreviewed |

`checkSlaBreaches` Azure Function runs on a timer and flags overdue assignments.

### Escalation chain

1. Community admin assigned → reviews within SLA window
2. If SLA breached → auto-escalate to ORAN admin queue
3. ORAN admin resolves or re-routes to another community admin
4. Persistent failures → alert to platform operators via Application Insights
