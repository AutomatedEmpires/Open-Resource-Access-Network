# ADR-0004 — Crisis-First Chat Gate + Retry-After Rate Limit Contract

## Status

Accepted

## Context

ORAN’s chat pipeline is safety-critical. Per SSOT and the documented chat architecture, crisis routing must execute before any other gating (quota, rate limiting, retrieval, summarization).

During review of `/api/chat`, the request handler performed rate limiting before invoking the chat orchestrator. Although the orchestrator itself ran crisis detection first, the overall system behavior could still block crisis routing with a `429` response.

Separately, the shared rate limiter returned `429` without a `Retry-After` hint in many endpoints. For safe clients and predictable behavior, rate-limited responses should include `Retry-After`.

## Decision

1. Enforce crisis-first behavior end-to-end by moving the chat rate-limit check into the orchestrator and placing it after:
   - Stage 1: crisis detection
   - Stage 2: quota check

2. Standardize the rate-limit contract by extending the shared in-memory rate limiter to compute and return `retryAfterSeconds`, and include `Retry-After` on `429` responses.

3. Do not trust client-supplied `userId` for chat:
   - Derive the effective user identity from the server-side session when present.
   - Use server-derived identity for rate limit keys and telemetry.

## Consequences

- `/api/chat` will not return `429` before crisis routing executes.
- Clients receive `Retry-After` on `429` and can back off deterministically.
- The chat orchestrator’s signature includes a `rateLimitKey` provided by the API boundary (derived server-side).
- Tests must reset rate limit state between runs to avoid cross-test interference.

## Alternatives considered

- Keep rate limiting in the API handler and perform crisis detection in the handler first.
  - Rejected: duplicates crisis logic across layers and risks future drift.

- Make rate limiting the very first stage globally.
  - Rejected: violates safety requirement that crisis routing must take priority.

- Add `Retry-After` only at select endpoints.
  - Rejected: inconsistent client behavior and increases implementation risk.

## Rollout / verification plan

- Run `npx tsc --noEmit`.
- Run `npm run test`.
- Confirm `429` responses include `Retry-After`.
- Monitor for increased chat throughput from crisis requests (expected, desired) and ensure no PII is emitted in telemetry.

## Timestamp

2026-03-03T00:00:00Z
