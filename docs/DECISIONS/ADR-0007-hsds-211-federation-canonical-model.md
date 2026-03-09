# ADR-0007: HSDS / 211 Federation Canonical Model

Status: Accepted

Timestamp: 2026-03-06T00:00:00Z

## Context

ORAN already has a stronger internal ingestion, verification, confidence, and publish pipeline than a plain standards-compliant directory. The goal is to integrate HSDS / 211 deeply enough that ORAN can:

- ingest HSDS-native and 211-adjacent structured data
- normalize non-HSDS sources into the same pipeline
- preserve ORAN trust, tagging, scoring, and moderation behavior
- export clean HSDS-compatible records and profile artifacts
- interoperate with HSDS-oriented validation and debugging tools

Without an explicit architecture decision, implementation risks splitting into separate code paths for HSDS imports, scraped sources, and user submissions, which would weaken provenance, trust consistency, and export coherence.

## Decision

1. ORAN is the operational system of record for trust, verification, scoring, moderation, provenance, and publish state.
2. HSDS is the exchange and interoperability contract for normalized resource structure and external ecosystem compatibility.
3. ORAN will support both strict/base HSDS compatibility and an ORAN HSDS Profile for ORAN-specific extensions.
4. Every intake path must enter the same source assertion model first.
5. Taxonomy normalization will use a mediated model:

`external taxonomy term -> ORAN canonical concept -> ORAN seeker tags and scoring signals`

1. Round-trip fidelity is required. Preserve source identifiers, taxonomy references, and field lineage wherever licensing permits.
2. No intake path may write directly to canonical entities or live ORAN service rows.

## Consequences

- ORAN can ingest HSDS / 211 material without weakening its internal trust controls.
- Scraped, partner, and user-submitted resources become exportable to HSDS through the same canonical layer.
- Taxonomy crosswalks become a first-class implementation concern.
- Source lineage and identifier preservation become persistence requirements, not optional metadata.
- HSDS tooling compatibility becomes testable and explicit.

## Alternatives considered

- Make HSDS the internal canonical model directly: rejected because it would collapse ORAN-specific trust, review, and scoring behavior into the exchange model.
- Keep HSDS support only as a one-way export adapter: rejected because imports, taxonomy fidelity, and tool interoperability would remain fragmented.
- Maintain separate pipelines for HSDS feeds versus scrape/manual intake: rejected because it would break provenance consistency and produce divergent review behavior.

## Rollout / verification plan

1. Implement the source assertion persistence layer for all intake paths.
2. Add canonical entities, external identifiers, and provenance tables.
3. Add taxonomy registries, canonical concepts, and crosswalk tables.
4. Route HSDS feeds, scrape sources, and user/admin submissions through the same normalization and review flow.
5. Add HSDS export generation plus ORAN HSDS Profile artifacts.
6. Add conformance and compatibility checks against HSDS-oriented validation/debugging toolchains.
