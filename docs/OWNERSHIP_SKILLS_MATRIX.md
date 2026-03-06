# ORAN Ownership And Skills Matrix

This page answers four questions for a new contributor:

1. What part of the repository does this team own?
2. What skills fit that area best?
3. Which docs govern the work?
4. Which operational or architectural constraints matter most?

## Ownership Model

| Workstream | Repository Areas | Best-Fit Skills | Read First | Operating Constraints |
| --- | --- | --- | --- | --- |
| Seeker experience | `src/app/(seeker)/**`, `src/components/**`, `src/app/(public)/**` | React, Next.js, accessibility, UX writing, maps | [src/app/(seeker)/README.md](../src/app/(seeker)/README.md), [docs/ui/UI_UX_TOKENS.md](ui/UI_UX_TOKENS.md) | crisis language must remain prominent; do not add unsafe or misleading service claims |
| Host experience | `src/app/(host)/**`, `src/app/api/**`, `src/services/organizations/**` | full-stack product engineering, form flows, auth-aware UI | [src/app/(host)/README.md](../src/app/(host)/README.md), [docs/SECURITY_PRIVACY.md](SECURITY_PRIVACY.md) | org membership and role enforcement must remain intact |
| ORAN admin and triage | `src/app/(oran-admin)/**`, `src/app/api/admin/**`, `src/services/triage/**`, `src/services/workflow/**` | operations tooling, workflow design, queue/state systems | [src/app/(oran-admin)/README.md](../src/app/(oran-admin)/README.md), [docs/ops/README.md](ops/README.md) | moderation, assignment, and approval paths need auditability |
| Community admin operations | `src/app/(community-admin)/**`, `src/services/community/**` | moderation UX, evidence review, operational workflow design | [src/app/(community-admin)/README.md](../src/app/(community-admin)/README.md), [docs/ops/services/RUNBOOK_ADMIN_ROUTING.md](ops/services/RUNBOOK_ADMIN_ROUTING.md) | verification and coverage workflows must preserve human review |
| Chat, search, scoring | `src/services/chat/**`, `src/services/search/**`, `src/services/scoring/**` | backend, retrieval systems, deterministic ranking, prompt restraint | [docs/CHAT_ARCHITECTURE.md](CHAT_ARCHITECTURE.md), [docs/contracts/README.md](contracts/README.md), [src/services/README.md](../src/services/README.md) | no LLM in retrieval/ranking; no hallucinated facts; crisis hard gate always wins |
| Auth and security | `src/lib/auth.ts`, `src/services/auth/**`, `src/services/security/**`, `src/middleware.ts`, `src/proxy.ts` | identity, RBAC, session handling, security review | [src/services/auth/README.md](../src/services/auth/README.md), [docs/SECURITY_PRIVACY.md](SECURITY_PRIVACY.md) | least privilege, no PII leakage, enforce route gating |
| Ingestion agents | `src/agents/ingestion/**`, `functions/**`, `src/services/ingestion/**`, `src/services/regression/**` | AI pipeline engineering, queues, extraction, verification systems | [docs/agents/AGENTS_OVERVIEW.md](agents/AGENTS_OVERVIEW.md), [docs/agents/AGENTS_INGESTION_PIPELINE.md](agents/AGENTS_INGESTION_PIPELINE.md) | agent outputs are unverified until human approval; publish path must stay gated |
| Data model and storage | `db/**`, `src/db/**`, `src/domain/**`, `src/services/db/**` | Postgres, migrations, Drizzle, schema design, data quality | [docs/DATA_MODEL.md](DATA_MODEL.md), [docs/DECISIONS/](DECISIONS/README.md) | migration safety, timestamps, provenance, and auditability matter |
| Platform and Azure | `.github/workflows/**`, `infra/**`, `docs/platform/**`, `docs/ops/**` | CI/CD, Azure App Service, Functions, Key Vault, observability | [docs/platform/DEPLOYMENT_AZURE.md](platform/DEPLOYMENT_AZURE.md), [docs/ops/README.md](ops/README.md) | protect deploy reliability, secrets flow, rollback readiness, and runbook accuracy |
| Documentation and governance | `README.md`, `START_HERE.md`, `docs/**`, `.github/**` | technical writing, systems thinking, information architecture | [docs/README.md](README.md), [docs/governance/OPERATING_MODEL.md](governance/OPERATING_MODEL.md) | docs are part of the product; update-on-touch rules apply |

## Best Team Assignments For A Hackathon

| Team Name | Recommended Mix | Best Repo Areas |
| --- | --- | --- |
| Trust and onboarding | technical writer + product engineer + design-minded frontend engineer | `README.md`, `START_HERE.md`, `docs/**`, `src/app/(public)/**` |
| Search and service quality | backend engineer + applied AI engineer | `src/services/chat/**`, `src/services/search/**`, `src/services/scoring/**` |
| Verification ops | workflow engineer + data engineer + admin UX engineer | `src/agents/ingestion/**`, `functions/**`, `src/app/(oran-admin)/**` |
| Host and seeker experience | frontend engineer + full-stack engineer + accessibility reviewer | `src/app/(seeker)/**`, `src/app/(host)/**`, `src/components/**` |
| Platform and release | DevOps engineer + security reviewer | `.github/workflows/**`, `infra/**`, `docs/ops/**` |

## Skills That Travel Well Across The Repo

- Strong React and Next.js contributors are most useful in `src/app/**` and `src/components/**`.
- Backend contributors with SQL and API design experience are most useful in `src/app/api/**`, `src/services/**`, `db/**`, and `src/db/**`.
- Applied AI contributors belong in ingestion and summarization support, not retrieval or ranking logic.
- Security-minded contributors should review auth, secrets, telemetry, and PII handling paths before release.
- Technical writers and product leads should stay close to `README.md`, `START_HERE.md`, `docs/contracts/**`, and `docs/ops/**`.

## Copilot Chatmode Mapping

| Chatmode | Best Use |
| --- | --- |
| `ORAN_omega_seeker_ui` | seeker and public experience changes |
| `ORAN_apex_admin_portals` | host, community-admin, and ORAN-admin portal work |
| `ORAN_sigma_api_security` | API routes, auth, route protection, and security-sensitive changes |
| `ORAN_delta_data_layer` | migrations, data model, DB access, ingestion persistence |
| `ORAN_actions_ci_maintainer` | GitHub Actions, CI/CD, workflow hygiene |
| `ORAN_ssot_docs_editor` | SSOT docs, README, runbooks, ADRs, onboarding docs |
| `ORAN_triage_boardkeeper` | triage workflows, moderation operations, SLA and routing support |
| `Azure_function_codegen_and_deployment` | Azure Functions implementation and deploy workflow work |

## Hand-Off Expectations

When one team hands work to another, include:

- the repo area changed,
- the governing docs reviewed,
- the tests run,
- the operational risk or rollback note,
- the follow-on owner if the work crosses boundaries.
