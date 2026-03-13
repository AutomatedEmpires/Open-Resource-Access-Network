# ORAN Resource Distribution API Contract

This document defines the public resource-distribution surfaces exposed by ORAN.

All public resource APIs must satisfy the same non-negotiables:

- return stored records only
- expose only approved/published resource data
- never expose raw source assertions or extracted candidates
- preserve trust-first semantics for seeker-facing discovery

## Distribution Tiers

| Surface | Primary Consumer | Purpose | Canonical Contract |
| --- | --- | --- | --- |
| `/api/search` | seeker UI, discovery clients | query-driven discovery over published services | seeker retrieval surface |
| `/api/services` | seeker UI, trusted app clients | point lookup of already-known published service IDs | published record lookup surface |
| `/api/hsds/**` | ecosystem integrators, validators, partner systems | standards-oriented publication and interoperability | HSDS distribution surface |

## `/api/search`

- Purpose: seeker-facing resource discovery by text, geo, taxonomy, and structured filters
- Data source: published services plus related organization/location/address/confidence data
- Ranking: deterministic, trust-first, retrieval-first
- Shape: ORAN seeker-optimized search response, not HSDS
- Auth: public
- Caching: allowed for non-personalized queries only
- Public callers cannot override publication status; this surface always targets published active records
- Public callers use `minConfidenceScore` for trust-floor filtering; retired legacy aliases are not part of this contract
- Must not expose raw provenance or unapproved records

## `/api/services`

- Purpose: fetch already-known published services by ID for saved items, deep links, and trusted clients
- Data source: published services only
- Ranking: none beyond deterministic batch lookup ordering
- Shape: ORAN app-optimized service lookup response
- Auth: public
- Typical caller already has IDs from ORAN surfaces or trusted integration state
- Must not become a second query surface that duplicates `/api/search`

## `/api/hsds/**`

- Purpose: expose published ORAN data through HSDS-compatible list/detail/profile endpoints
- Data source: canonical approved records mapped to the HSDS-oriented publication surface
- Ranking: none; this is a publication/interoperability surface, not seeker ranking logic
- Shape: HSDS-compatible or ORAN-HSDS-profile-compatible payloads
- Auth: public unless a future partner-specific surface is added separately
- Must remain standards-oriented and stable for ecosystem consumers

## Shared Publication Rules

All three surfaces must:

1. operate only on published records
2. fail closed when the database/runtime contract is unavailable
3. avoid leaking moderation, review, source assertion, or candidate-only fields
4. preserve the ORAN trust model even when the response shape differs
5. share common published-record primitives so publication filters do not drift by route

## Non-goals

- No raw source record API under these public surfaces
- No candidate review API under these public surfaces
- No ingestion diagnostics mixed into seeker or HSDS contracts

## Update-on-touch

If you change `/api/search`, `/api/services`, or `/api/hsds/**` behavior:

- update this document
- update `src/app/api/README.md`
- update `docs/platform/PLATFORM_ARCHITECTURE.md` if the tier boundaries change
- append `docs/ENGINEERING_LOG.md` for contract-level changes
