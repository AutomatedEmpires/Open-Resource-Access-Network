# ORAN Decisions (ADRs)

This folder holds Architecture Decision Records (ADRs) for safety-critical or contract-level decisions.

## When an ADR is required

Create an ADR before implementing changes to:

- safety constraints (no hallucinations, crisis routing, privacy)
- scoring contract or ranking behavior
- schema shape or persistence rules
- auth/roles/permissions enforcement
- any LLM usage (even summarization)

## ADR Index

| ID | Title | Status |
|----|-------|--------|
| ADR-0001 | [SSOT Hierarchy and Truthful Documentation](ADR-0001-ssot-and-truthfulness.md) | Accepted |
| ADR-0002 | [UI/UX Contract + Vertical Shells](ADR-0002-ui-ux-contract-and-vertical-shells.md) | Accepted |
| ADR-0002 | [Azure-Native Integration Maximization Plan](ADR-0002-azure-native-integration-plan.md) | Accepted |
| ADR-0003 | [Defer Dark Mode](ADR-0003-defer-dark-mode.md) | Accepted |
| ADR-0004 | [Crisis-First Chat Gate + Retry-After Rate Limit Contract](ADR-0004-crisis-first-chat-and-retry-after.md) | Accepted |
| ADR-0005 | [Content Security Policy (CSP)](ADR-0005-content-security-policy.md) | Accepted |
| ADR-0006 | [Opt-In Device Geolocation (Seeker)](ADR-0006-opt-in-device-geolocation.md) | Accepted |
| ADR-0007 | [HSDS / 211 Federation Canonical Model](ADR-0007-hsds-211-federation-canonical-model.md) | Accepted |
| ADR-0008 | [Chat Profile Hydration and Deterministic Retrieval Shaping](ADR-0008-chat-profile-hydration-and-deterministic-retrieval-shaping.md) | Accepted |
| ADR-0009 | [Platform Pillars and Subsystem Boundaries](ADR-0009-platform-pillars-and-subsystem-boundaries.md) | Accepted |
| ADR-0010 | [Source-Aware Agentic Publication Policy](ADR-0010-source-aware-agentic-publication-policy.md) | Accepted |
| ADR-0011 | [Ingestion Integrity and Resilience Controls](ADR-0011-ingestion-integrity-and-resilience-controls.md) | Accepted |
| ADR-0012 | [Accept Username Enumeration Risk](ADR-0012-accept-username-enumeration-risk.md) | Accepted |
| ADR-0013 | [Seeker Execution Local-First Plan Foundation](ADR-0013-seeker-execution-local-first-plan-foundation.md) | Accepted |

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
