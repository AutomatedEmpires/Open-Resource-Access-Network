# ORAN Governance

## Branching expectations
- Use feature branches from `main`.
- Keep PRs small and focused.
- One concern per PR whenever possible.

## Labeling rules
Use labels to classify work clearly:
- `type:*` for work type (bug/spec/scaffold/data/security).
- `area:*` for product/technical area.
- `priority:*` for urgency.
- `risk:*` for safety or operational risk.

## What requires tests
- Behavior changes require tests (unit and/or integration).
- Data model, migrations, and API contract changes require targeted validation.
- Safety-critical changes require explicit test coverage.

## What requires an ADR/spec
Create a spec or ADR before implementation when changing:
- Safety constraints or confidence messaging
- Scoring rules or ranking behavior
- Crisis routing logic (911 / 988 / 211)
- Data model (HSDS/ORAN extensions)
- Search API contract (endpoints/DTOs/ServiceSearchEngine contract)

## Safety-critical norms
- Do not hallucinate services, addresses, hours, eligibility, or URLs.
- Do not make guaranteed eligibility claims.
- Preserve crisis routing expectations (911 / 988 / 211).
- Verify accessibility-first behavior (keyboard, screen reader support, mobile-first assumptions).

## Iterate openly
Contributors and agents are encouraged to propose improvements to governance/templates via focused PRs.
