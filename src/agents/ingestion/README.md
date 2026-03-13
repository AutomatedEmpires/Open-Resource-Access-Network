# Ingestion Agent

Canonical ingestion and federation runtime for ORAN.

This folder is the primary home for source assertion intake, normalization, canonical federation,
crosswalk resolution, publication preparation, and ingestion workflow orchestration. Treat
`src/agents/ingestion/**` as the platform's canonical ingestion domain.

## Runtime Boundary

The ingestion system spans three implementation layers with distinct roles:

- `src/agents/ingestion/**` — canonical ingestion domain logic, stores, orchestration, normalization, crosswalks, federation, publish rules, and feed connectors
- `functions/**` — execution adapters for timer/background/event-driven workloads that call into canonical ingestion contracts or adjacent internal APIs
- `src/services/ingestion/**` — thin shared helpers used by routes or legacy call sites; not the canonical home of ingestion orchestration

If behavior spans those layers, the rule is:

1. define the domain behavior here
2. use Functions as execution environments
3. keep service-layer ingestion helpers narrow and reusable

## What Lives Here

- Source registry, feeds, jobs, stores, and persistence bridges
- Pipeline stages for fetch, extraction, verification, routing, materialization, and publish preparation
- HSDS and partner-feed connectors including 211/NDP ingestion
- Canonical federation support: source records, identifiers, crosswalks, canonical entities, export snapshots
- Human-governed publication support, confidence scoring, and audit-linked lifecycle operations

## What Must Not Happen Here

- No seeker-visible retrieval or ranking
- No direct publication of unreviewed extracted candidates
- No parallel queue lifecycle outside the canonical submissions/workflow model

## Related Docs

- `docs/agents/AGENTS_INGESTION_PIPELINE.md`
- `docs/platform/PLATFORM_ARCHITECTURE.md`
- `docs/DECISIONS/ADR-0007-hsds-211-federation-canonical-model.md`
