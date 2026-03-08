# ADR-0008 — Chat Profile Hydration And Deterministic Retrieval Shaping

## Status

Accepted

## Context

The documented chat architecture already included a profile-hydration stage, but the live orchestrator only carried `userId` forward for authenticated users. The chat API also accepted a `ChatContext` in retrieval but ignored it when building the SQL search query.

This left seeker profile data persisted but operationally disconnected from the retrieval pipeline.

At the same time, ORAN has hard constraints:

- retrieval must remain database-backed and deterministic
- trust signaling must remain grounded in verification confidence
- profile data must not be used via opaque heuristics or free-text inference
- chat must fail open if profile hydration is unavailable

## Decision

1. Add a server-side chat hydration step that loads only authenticated, actor-scoped profile data from `user_profiles` and `seeker_profiles`.

2. Hydrate only fields that are explicitly represented in the chat context contract and have clear downstream use:
   - approximate city
   - service interests
   - accessibility needs
   - self-identifiers
   - current services
   - age group
   - household type
   - housing situation

3. Keep hydration fail-open. If the profile query fails or returns no rows, chat proceeds with the base request context.

4. Use hydrated context in retrieval only through deterministic, schema-backed shaping:
   - approximate city becomes `cityBias`
  - request locale remains authoritative for the live chat turn; saved locale is a UI-default concern
  - `general` intents may append up to three normalized `serviceInterests` hints to the text query
   - exact profile-to-taxonomy mappings may generate `profileSignals` for `service_attributes` dimensions only
  - personalized chat retrieval skips the shared search cache

5. Keep trust primary in ranking. Retrieval order becomes:
   - verification confidence DESC
   - profile match DESC
   - stored score DESC
   - distance ASC

6. Exclude free-text seeker context and unsupported metadata from retrieval until the live search engine can query those dimensions directly.

7. Keep explicit user-selected directory/map/search filters authoritative. Profile hydration is allowed to tailor chat ordering, but not to block review of other verified listings.

## Consequences

- Authenticated chat becomes meaningfully personalized without introducing new data sources or LLM ranking.
- Retrieval behavior is easier to audit because every profile-derived signal maps to canonical tags or existing query features.
- Some seeker profile fields remain hydrated but non-operative for retrieval until richer service metadata is exposed in search.
- Documentation and tests must track the exact mappings so the feature does not drift into implicit heuristics.

## Alternatives considered

- Hydrate from the seeker UI only.
  - Rejected: breaks server-side integrity and makes chat behavior depend on client state.

- Use free-text `additionalContext` in retrieval.
  - Rejected: too easy to leak sensitive context into ranking and too hard to audit deterministically.

- Convert profile fields into hard search filters.
  - Rejected: overly brittle and likely to suppress helpful results when service metadata is incomplete.

## Rollout / verification plan

- Add targeted unit coverage for hydration and profile-aware query building.
- Run `npx tsc --noEmit`.
- Run chat and search targeted test suites.
- Verify authenticated chat search uses `cityBias` and profile signals while anonymous chat remains unchanged.

## Timestamp

2026-03-07T06:34:10Z
