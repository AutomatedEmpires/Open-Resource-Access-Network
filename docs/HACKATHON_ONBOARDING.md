# ORAN Hackathon Onboarding

This guide is the command center for onboarding developers quickly without losing architectural clarity or safety discipline.

## Outcome

By the end of the first 30 minutes, every contributor should know:

- what ORAN is trying to accomplish,
- which area of the repository they own for the event,
- which docs and runbooks govern that area,
- which quality gates they must respect before handing work off.

## First 30 Minutes

1. Read [README.md](../README.md) for mission, status, and repo-level orientation.
2. Read [START_HERE.md](../START_HERE.md) for role-based entry paths.
3. Read [docs/OWNERSHIP_SKILLS_MATRIX.md](OWNERSHIP_SKILLS_MATRIX.md) to choose a workstream.
4. Read [docs/REPO_MAP.md](REPO_MAP.md) to understand where your changes belong.
5. Read [docs/DEVELOPER_GOLDEN_PATH.md](DEVELOPER_GOLDEN_PATH.md) and get local dev running.
6. Read the area README under `src/app/**`, `src/services/**`, `functions/**`, or `docs/**` before making changes.

## Team Formation Model

Use these lanes so contributors self-organize cleanly.

| Lane | Focus | Best Fit |
| --- | --- | --- |
| Product UI | seeker flows, host workflows, public trust pages, accessibility | frontend, product, design systems |
| Retrieval + scoring | search, chat orchestration, ranking, deterministic behavior | backend, applied AI, search engineers |
| Ingestion + verification | source intake, extraction, verification, routing, queues | workflow, data, AI pipeline engineers |
| Platform + reliability | CI/CD, Azure infra, secrets, deploys, observability | DevOps, platform, security engineers |
| Data + contracts | migrations, types, contracts, evidence models | backend, data model, systems engineers |
| Docs + governance | SSOT, onboarding, ADRs, runbooks, contributor guidance | technical writers, staff engineers, leads |

## Rules For Every Team

- Read the governing contract or SSOT doc before editing behavior.
- Keep changes inside one workstream unless coordination is explicit.
- Update touched docs when behavior or operations change.
- Never relax crisis routing, privacy, or retrieval-first constraints.
- Keep commit history grouped by category or workstream.

## Area-Specific Reading List

| If you are working on | Read first |
| --- | --- |
| seeker or public UX | [docs/ui/UI_UX_TOKENS.md](ui/UI_UX_TOKENS.md), [src/app/(seeker)/README.md](../src/app/(seeker)/README.md) |
| host workflows | [src/app/(host)/README.md](../src/app/(host)/README.md), [docs/REPO_MAP.md](REPO_MAP.md) |
| ORAN admin | [src/app/(oran-admin)/README.md](../src/app/(oran-admin)/README.md), [docs/ops/README.md](ops/README.md) |
| APIs and auth | [src/app/api/README.md](../src/app/api/README.md), [docs/SECURITY_PRIVACY.md](SECURITY_PRIVACY.md), [docs/contracts/AUTHZ_CONTRACT.md](contracts/AUTHZ_CONTRACT.md) |
| search, chat, scoring | [docs/CHAT_ARCHITECTURE.md](CHAT_ARCHITECTURE.md), [docs/SCORING_MODEL.md](SCORING_MODEL.md), [src/services/README.md](../src/services/README.md) |
| ingestion agents | [docs/agents/AGENTS_OVERVIEW.md](agents/AGENTS_OVERVIEW.md), [docs/agents/AGENTS_INGESTION_PIPELINE.md](agents/AGENTS_INGESTION_PIPELINE.md) |
| deploy, infra, incident readiness | [docs/platform/DEPLOYMENT_AZURE.md](platform/DEPLOYMENT_AZURE.md), [docs/ops/README.md](ops/README.md) |

## Daily Operating Rhythm For The Event

1. Start with a 10-minute lane sync.
2. Assign one owner per workstream.
3. Require each owner to identify the relevant contract, tests, and rollback path.
4. Keep feature work and documentation updates in the same branch/commit set.
5. End with a short demo plus a checklist review against runbooks, docs, and quality gates.

## Done Means

A change is not finished until all of the following are true:

- the repo area owner can explain the change in one sentence,
- the governing doc or contract is still accurate,
- the change has the smallest relevant test coverage,
- the rollback or operational implication is clear,
- the commit history is understandable without opening every file.

## Fast Links

- [README.md](../README.md)
- [START_HERE.md](../START_HERE.md)
- [docs/OWNERSHIP_SKILLS_MATRIX.md](OWNERSHIP_SKILLS_MATRIX.md)
- [docs/REPO_MAP.md](REPO_MAP.md)
- [docs/ops/README.md](ops/README.md)
- [docs/contracts/README.md](contracts/README.md)
