# ADR-0001: SSOT Hierarchy and Truthful Documentation

Status: Accepted

Timestamp: 2026-02-28T00:00:00Z

## Context

ORAN is safety-critical. The repository currently contains documents that describe behaviors that are not yet implemented (e.g., role enforcement, security headers, endpoint rate limits, import staging). In a trust-centric system, inaccurate documentation is a safety risk.

## Decision

1. Adopt an explicit SSOT hierarchy (docs/SSOT.md).
2. Require that any doc that describes planned behavior must label it clearly as **Planned** and point to the tracking issue/ADR.
3. Require “update-on-touch” documentation for each domain area (area README + SSOT docs + focused tests).

## Consequences

- Documentation becomes a trustworthy operational contract.
- Agents and contributors have a clear map of what must be updated.
- The repository reduces wasted runtime by encouraging targeted tests.

## Alternatives considered

- Treat all docs as aspirational: rejected (creates false confidence).
- Enforce via code-only: rejected (humans still need operating context).

## Rollout / verification plan

- Add CI review checklist enforcement via PR template.
- Require reviewers to verify docs’ “Implementation status” sections match the current code.
