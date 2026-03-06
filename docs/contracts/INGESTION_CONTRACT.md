# Ingestion Contract

## Scope

Defines the intake pipeline from source submission through verification and admin routing.

## Inputs

- Source URLs or source-driven ingestion events
- Parsing/extraction outputs
- Verification and routing metadata

## Required Guarantees

- Intake pipeline preserves record provenance and reviewability.
- Unverified data is not published as trusted service content.
- Routing/escalation respects SLA and role boundaries.

## Failure Modes

- Queue backlog or poison growth -> operational runbook escalation.
- External dependency degradation (LLM, queue, auth) -> degraded mode with safety constraints preserved.

## Validation

- Pipeline stage health checks and queue monitoring.
- SLA breach escalation tests and operational drills.

## References

- `docs/solutions/IMPORT_PIPELINE.md`
- `docs/ops/services/RUNBOOK_INGESTION.md`
- `docs/ops/services/RUNBOOK_ADMIN_ROUTING.md`
- `functions/**`
