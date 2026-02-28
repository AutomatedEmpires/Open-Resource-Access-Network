# Chat Service (src/services/chat)

## Contract

- Crisis routing is **stage 1** and must short-circuit the pipeline.
- Retrieval is injected and must be **DB-only** (no external sources, no LLM).
- Eligibility disclaimer must be present on all service recommendations.
- LLM is allowed only as **post-retrieval summarization**, gated behind `llm_summarize`, and must not add facts.

Primary entry points:

- src/services/chat/orchestrator.ts
- src/app/api/chat/route.ts

## Tests

- `src/services/chat/__tests__/intent-schema.test.ts`

## Update-on-touch

If you change crisis detection, quota/rate limiting, response templates, or any LLM gate behavior:

- Update docs/CHAT_ARCHITECTURE.md
- Update docs/SECURITY_PRIVACY.md if rate limit/quota behavior changes
- Update tests in `src/services/chat/__tests__`
