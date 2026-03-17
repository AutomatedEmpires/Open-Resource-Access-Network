# Chat Service (src/services/chat)

## Contract

- Crisis routing is **stage 1** and must short-circuit the pipeline.
- Retrieval is injected and must be **DB-only** (no external sources, no LLM).
- Authenticated context hydration is server-side and must fail open.
- Authenticated requests may disable saved profile shaping with `profileMode='ignore'`; explicit browse filters must still survive that override.
- Requests may carry `sessionContext` for lightweight structured chat memory. This is session-scoped only and must never become raw transcript memory.
- The seeker chat client may intercept explicit local execution commands against the most recent result set using deterministic ordinals only (`first result`, `second result`, and equivalent forms). These commands must require explicit confirmation and may only write local plan/reminder state.
- Request-time locale is authoritative for the active turn.
- Eligibility disclaimer must be present on all service recommendations.
- LLM is allowed only as **post-retrieval summarization**, gated behind `llm_summarize`, and must not add facts.
- Optional contextual links may be included, but must be selected deterministically from stored URLs only (no invented links).
- Weak queries must clarify before retrieval rather than pretending to search with insufficient scope.
- Third-party or informational crisis language must return immediate safety guidance without falsely triggering the self-harm crisis hard gate.
- Chat responses must disclose retrieval outcome via `retrievalStatus`, inherited-scope use via `activeContextUsed` + `sessionContext`, the normalized turn framing via `searchInterpretation`, and deterministic post-ranking guidance via `resultSummary` + `followUpSuggestions`.
- Post-ranking diversification may vary the final visible set across organizations, but it must remain deterministic and must not bypass trust-first ordering.
- Out-of-scope handling must state the ORAN mission boundary plainly: verified service discovery only, using stored ORAN records only, with refusal for unrelated or inappropriate requests.
- Local execution commands must never invent provider facts or mutate canonical service records. They may only create or adjust seeker-owned execution objects that still point back to stored ORAN records.

Authenticated chat may shape retrieval with deterministic profile signals, but only through schema-backed mappings and only as a secondary ordering hint after trust.

Current schema-backed Phase 1 seeker constraints also include transportation barriers, preferred delivery modes, same-day / next-day urgency, documentation barriers, and digital-access barriers. These must remain deterministic and taxonomy-backed.

Current client-visible retrieval outcomes:

- `results`
- `no_match`
- `catalog_empty_for_scope`
- `temporarily_unavailable`
- `clarification_required`
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
