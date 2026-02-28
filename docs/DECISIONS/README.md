# ORAN Decisions (ADRs)

This folder holds Architecture Decision Records (ADRs) for safety-critical or contract-level decisions.

## When an ADR is required

Create an ADR before implementing changes to:

- safety constraints (no hallucinations, crisis routing, privacy)
- scoring contract or ranking behavior
- schema shape or persistence rules
- auth/roles/permissions enforcement
- any LLM usage (even summarization)

## File naming

Use:

- `ADR-0001-<short-title>.md`

## ADR template

- Title
- Status (Proposed / Accepted / Superseded)
- Context
- Decision
- Consequences
- Alternatives considered
- Rollout/verification plan (tests + monitoring)
- Timestamp (ISO 8601)
