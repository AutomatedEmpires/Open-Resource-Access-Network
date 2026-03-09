# Chat Service (src/services/chat)

## Contract

- Crisis routing is **stage 1** and must short-circuit the pipeline.
- Retrieval is injected and must be **DB-only** (no external sources, no LLM).
- Authenticated context hydration is server-side and must fail open.
- Authenticated requests may disable saved profile shaping with `profileMode='ignore'`; explicit browse filters must still survive that override.
- Request-time locale is authoritative for the active turn.
- Eligibility disclaimer must be present on all service recommendations.
- LLM is allowed only as **post-retrieval summarization**, gated behind `llm_summarize`, and must not add facts.
- Optional contextual links may be included, but must be selected deterministically from stored URLs only (no invented links).
- Chat responses must disclose retrieval outcome via `retrievalStatus` and the normalized turn framing via `searchInterpretation`.

Authenticated chat may shape retrieval with deterministic profile signals, but only through schema-backed mappings and only as a secondary ordering hint after trust.

Current schema-backed Phase 1 seeker constraints also include transportation barriers, preferred delivery modes, same-day / next-day urgency, documentation barriers, and digital-access barriers. These must remain deterministic and taxonomy-backed.

Current client-visible retrieval outcomes:

- `results`
- `no_match`
- `catalog_empty_for_scope`
- `temporarily_unavailable`
- `out_of_scope`

Primary entry points:

- src/services/chat/orchestrator.ts
- src/app/api/chat/route.ts
- src/services/chat/links.ts

## Tests

- `src/services/chat/__tests__/intent-schema.test.ts`

## Update-on-touch

If you change crisis detection, quota/rate limiting, response templates, link selection behavior, or any LLM gate behavior:

- Update docs/CHAT_ARCHITECTURE.md
- Update docs/SCORING_MODEL.md if retrieval ordering semantics change
- Update docs/SECURITY_PRIVACY.md if rate limit/quota behavior changes
- Update tests in `src/services/chat/__tests__`
