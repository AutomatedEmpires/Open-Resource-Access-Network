# ADR-0009: Platform Pillars and Subsystem Boundaries

- Status: Accepted
- Timestamp: 2026-03-13T06:15:00Z

## Context

ORAN has evolved beyond a seeker app into a multi-surface platform that includes canonical resource data, ingestion/federation, governance workflows, host operations, forms, notifications, and Azure-backed delivery infrastructure. The repository already contains those subsystems, but the top-level architectural description has lagged behind the codebase. That gap creates architectural drift risk: teams can add features without understanding which platform pillar they strengthen, and parallel systems can emerge around ingestion, governance, or distribution.

## Decision

ORAN will be governed as a platform with six canonical pillars:

1. Resource Data Graph
2. Ingestion and Federation
3. Trust and Governance
4. Discovery and Navigation
5. Participation and Operations
6. Platform Delivery and Integrations

Subsystem boundaries are defined as follows:

- Source data enters through the ingestion and federation layer first.
- `src/agents/ingestion/**` is the canonical ingestion domain; Functions are execution adapters and `src/services/ingestion/**` is a thin helper layer.
- Canonical resource entities remain the shared substrate for discovery, governance, and operator workflows.
- Universal submissions and transitions are the canonical governance workflow, replacing ad hoc queue-specific lifecycle models.
- Seeker retrieval remains stored-record-only and trust-first.
- Public resource distribution is tiered: `/api/search` for seeker discovery, `/api/services` for published ID lookup, and `/api/hsds/**` for standards-oriented ecosystem distribution.
- Optional AI or vector capabilities are support layers only; they must not replace canonical retrieval, scoring, or publication controls.

The authoritative architectural description for these boundaries lives in `docs/platform/PLATFORM_ARCHITECTURE.md` and must be updated whenever subsystem scope or platform pillars materially change.

## Consequences

- New work must map cleanly to a platform pillar.
- Architectural reviews can reject changes that introduce feature sprawl without strengthening a pillar.
- Documentation and repo maps must reflect the actual platform, not only the seeker experience.
- Legacy compatibility layers should be treated as migration scaffolding with explicit retirement plans, not permanent parallel architecture.

## Alternatives Considered

### Keep the existing app-centric documentation

Rejected. It no longer matches the repository and encourages local optimization around isolated features.

### Split the repository into multiple top-level products now

Rejected for this phase. The current priority is to clarify and unify the architecture inside the existing platform boundary before introducing repo-level decomposition.

## Rollout and Verification Plan

- Add and maintain `docs/platform/PLATFORM_ARCHITECTURE.md` as the top-level architecture map.
- Update `docs/REPO_MAP.md` and `docs/SSOT.md` to reference the platform architecture.
- Align ingestion workflow docs with the universal submissions model.
- Define and maintain the public resource-distribution contract across `/api/search`, `/api/services`, and `/api/hsds/**`.
- Use future ADRs when changing canonical subsystem boundaries or adding new platform pillars.
