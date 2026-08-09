# ORAN Repository Map

A task-oriented map of the platform as it exists today.

## Platform Structure

| Layer | Primary Areas | What Lives There |
| --- | --- | --- |
| Product surfaces | `src/app/**` | Seeker, host, community-admin, ORAN-admin, and public pages |
| API boundaries | `src/app/api/**` | Seeker retrieval APIs, operator control APIs, HSDS distribution, internal jobs |
| Business services | `src/services/**` | Search, chat, scoring, workflow, auth, privacy/erasure, notifications, forms, queueing, telemetry |
| Ingestion and federation | `src/agents/ingestion/**`, `src/services/ingestion/**`, `src/app/api/internal/ingestion/**` | Connectors, normalization, crosswalks, governed polling, ingestion controls |
| Data model and persistence | `src/db/**`, `db/migrations/**`, `src/domain/**` | Schema, queries, domain types, constants, canonical entity contracts |
| Platform operations | `.github/workflows/**`, `scripts/**`, `vercel.json`, `docs/ops/**` | Vercel deploy/runtime contracts, CI/CD, cron, and runbooks |

## Route Groups

| Surface | Primary Paths | Role |
| --- | --- | --- |
| Seeker | `src/app/(seeker)/**` | Resource discovery, chat, map, saved services, profile, reports |
| Host | `src/app/(host)/**` | Organization participation, listings, admins, claims, forms, resource studio |
| Community admin | `src/app/(community-admin)/**` | Local queue management, verification, coverage, community forms |
| ORAN admin | `src/app/(oran-admin)/**` | Global governance, approvals, scopes, zones, ingestion, triage, templates, audit |
| Public | `src/app/(public)/**` | Public-facing trust, policy, status, and partnership pages |

## Where To Change X

| Goal | Primary Files | Supporting Docs |
| --- | --- | --- |
| Change chat behavior | `src/services/chat/**`, `src/app/api/chat/**` | `docs/CHAT_ARCHITECTURE.md` |
| Change search/retrieval | `src/services/search/**`, `src/app/api/search/**`, `src/app/api/services/**`, `src/app/api/hsds/**` | `docs/SCORING_MODEL.md`, `docs/platform/PLATFORM_ARCHITECTURE.md` |
| Change scoring/confidence | `src/services/scoring/**`, `src/services/regression/**` | `docs/SCORING_MODEL.md` |
| Change schema/data model | `db/migrations/**`, `src/db/**`, `src/domain/**` | `docs/DATA_MODEL.md` |
| Change ingestion/federation | `src/agents/ingestion/**`, `src/services/ingestion/**`, `src/app/api/internal/ingestion/**`, `src/app/api/admin/ingestion/**` | `docs/agents/AGENTS_INGESTION_PIPELINE.md`, `docs/platform/PLATFORM_ARCHITECTURE.md` |
| Change workflow/governance | `src/services/workflow/**`, `src/services/community/**`, `src/services/triage/**`, `src/app/api/admin/**`, `src/app/api/community/**` | `docs/platform/PLATFORM_ARCHITECTURE.md`, `docs/SECURITY_PRIVACY.md` |
| Change host/operator participation | `src/app/(host)/**`, `src/services/forms/**`, `src/services/organizations/**`, `src/services/resourceSubmissions/**` | `docs/platform/PLATFORM_ARCHITECTURE.md` |
| Change auth/roles/security | `src/services/auth/**`, `src/services/security/**`, `src/proxy.ts` | `docs/SECURITY_PRIVACY.md`, `docs/governance/ROLES_PERMISSIONS.md` |
| Change account erasure | `src/services/privacy/**`, `src/app/api/user/data-delete/**`, `src/app/api/internal/account-erasure/**`, `db/migrations/0071*`, `db/migrations/0072*` | `docs/SECURITY_PRIVACY.md`, `docs/ops/services/RUNBOOK_ACCOUNT_ERASURE.md` |
| Change deploy/ops | `.github/workflows/**`, `scripts/**`, `vercel.json`, `docs/ops/**` | `docs/platform/STACK_MIGRATION.md`, `docs/platform/INTEGRATIONS.md` |

## Architectural Notes

- The canonical data path is: source assertions -> normalization/federation -> published entities -> seeker/operator distribution.
- The canonical workflow path is universal submissions + transitions, not legacy per-feature queues.
- Seeker-visible retrieval must remain stored-record-only and trust-first.
- Governed ingestion runs through application services and authenticated Vercel job routes; provider-specific worker hosts are not part of the system.

## Top Entry Points

- New to repo: `START_HERE.md`
- Platform architecture: `docs/platform/PLATFORM_ARCHITECTURE.md`
- System docs index: `docs/README.md`
- Contracts index: `docs/contracts/README.md`
- Ops command center: `docs/ops/README.md`
