# Chat Contract

## Scope

Defines chat request handling, crisis routing priority, and response safety guarantees.

## Inputs

- User message text
- Optional location context
- Session context

## Required Guarantees

- Crisis hard gate must run first for imminent risk.
- Retrieval-first behavior: no fabricated service facts.
- No LLM-based retrieval or ranking.
- If summarization is enabled, summary must only use retrieved records.

## Failure Modes

- Missing retrieval records -> return safe fallback with no invented facts.
- Crisis indicators detected -> immediate 911/988/211 response path.

## Validation

- Unit/integration tests covering crisis precedence and retrieval-only outputs.
- Manual spot-check for factual grounding against stored records.

## References

- `docs/CHAT_ARCHITECTURE.md`
- `docs/SECURITY_PRIVACY.md`
- `src/services/chat/**`
