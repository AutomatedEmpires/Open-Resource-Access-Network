Status: Accepted

Timestamp: 2026-03-16T00:00:00Z

## Context

ORAN's current publication model is too uniform for a national-scale, agent-assisted resource platform. It assumes manual review for most inbound listing changes, even when the source is trusted, machine-validated, or owner-authenticated.

The platform already contains source trust tiers, publication modes, confidence thresholds, host ownership, and reverification timers. What is missing is a source-aware publication policy that uses those signals to reduce manual intervention without weakening provenance, auditability, or safety controls.

## Decision

1. Publication policy will be source-aware rather than universally human-gated.
2. 211 / HSDS and other approved high-trust feeds may auto-publish after source assertion, canonical federation, confidence evaluation, and policy checks.
3. Community-submitted resources remain review-required.
4. Authenticated host-managed listing submissions may auto-publish through the managed org workflow.
5. Crawler-discovered listings may auto-publish only when confidence and policy thresholds pass and no review flags are raised.
6. Every published listing must carry deterministic reverification timers and remain subject to later review, suppression, or unpublish.

## Consequences

- Manual review becomes exception-based instead of default for trusted and owner-controlled sources.
- Publication safety moves into policy gates, provenance preservation, confidence thresholds, and reverification rather than universal queueing.
- Submission and ingestion paths must converge on consistent collision resolution, ownership rules, and reverification scheduling.
- Admin review capacity can focus on ambiguous, low-confidence, or policy-violating records.

## Rollout Notes

1. Start with host-managed listing auto-publication and the existing feed auto-publish hooks.
2. Keep community and claim workflows review-required unless separately approved.
3. Expand crawler auto-publish only after stronger ownership and duplicate safeguards are in place.
