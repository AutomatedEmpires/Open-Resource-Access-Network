# ORAN Agents Overview (Dev Guide)

This doc explains where agent code lives, how it is developed independently from seeker-facing ORAN surfaces, and how it aligns with SSOT.

## Where agent code lives

- Ingestion/verification agent primitives and contracts:
  - `src/agents/ingestion/**`

## SSOT documents

- Ingestion pipeline spec: `docs/AGENTS_INGESTION_PIPELINE.md`
- Source Registry spec: `docs/AGENTS_SOURCE_REGISTRY.md`
- Scoring SSOT: `docs/SCORING_MODEL.md`
- Safety contract: `docs/SSOT.md`

## Safety boundaries

- Agents may write only to **staging + audit** tables until a human approves publish.
- Seekers only see **stored verified records**.
- If an LLM is used, it may only assist with extraction/summarization and must be treated as unverified.

## How other workstreams integrate

- SQL agent:
  - implements staging/audit/source-registry schemas to match `src/agents/ingestion/contracts.ts` + SSOT docs
- UI/UX agent:
  - builds admin queues (`Needs Verification`, `In Progress`, `Upcoming Re-Verifications`) and guided field completion flows

## Testing

- Agent contracts and helpers must have unit tests in `src/agents/ingestion/__tests__/`.
- Integration tests (later): queue → worker → DB staging writes → audit events.
