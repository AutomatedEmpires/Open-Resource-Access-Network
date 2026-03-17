# ADR-0013: Seeker Execution Local-First Plan Foundation

Status: Accepted

Date: 2026-03-17

## Context

ORAN needs a first execution-layer substrate so seekers can turn verified service discovery into concrete next steps without weakening the platform's retrieval-first, crisis-first, privacy-first safety contract.

The first slice must not introduce hidden AI autonomy, must not invent provider facts, and must not quietly expand durable server-side seeker storage before consent and retention rules are ready.

## Decision

The initial seeker execution foundation will ship as a local-first plan workspace with the following rules:

- Plans and plan items are stored on-device by default.
- Linked service items may only point to stored ORAN service records.
- Provider facts shown inside a plan item remain limited to captured service snapshots and links back to the canonical service detail page.
- Manual plan items are explicitly user-authored.
- Chat and directory surfaces may add services into a plan, but may not mutate provider facts.
- Crisis routing remains fully separate and preemptive.

## Consequences

Positive:

- ORAN gains a real execution object model without waiting for synced persistence.
- Seekers can start sequencing next actions immediately from saved, directory, and chat surfaces.
- The first slice stays testable and inspectable because plan mutation is deterministic and local.

Tradeoffs:

- Cross-device continuity is deferred.
- Reminder delivery and route feasibility remain later-phase work.
- Service snapshots inside plans may become stale, so the product must keep linking back to the current canonical service detail page.

## Guardrails

- No LLM may retrieve, rank, or mutate execution objects in this slice.
- Eligibility remains conditional and provider-confirmed.
- Plan items must distinguish linked-service records from manual user tasks.
- Future synced execution state must not ship without explicit consent, export, deletion, and retention coverage.
