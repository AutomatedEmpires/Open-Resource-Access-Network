Status: Accepted

Timestamp: 2026-03-16T05:10:00Z

## Context

ORAN's publication hardening work already converges duplicate identities, serializes concurrent writes, ranks source authority, preserves stronger current fields, and falls back to review for ambiguity.

That is necessary but not sufficient.

The next major risk class is broader than duplicate publication:

- fake listings and bot floods
- compromised host, reviewer, or admin actors
- coordinated flag abuse and review manipulation
- silent providers and silent admins
- failing or degraded dependencies that silently weaken verification
- missed scans, replay drift, and incomplete operational recovery

If ORAN does not address these failure modes explicitly, it can remain correct on data-model convergence while still failing on resource integrity, operational resilience, or trust governance.

## Decision

1. ORAN will treat ingestion integrity and operational resilience as first-class controls around the existing publication stack.
2. High-risk mutations must not rely on one actor alone. Source trust changes, suppression, threshold changes, zone reassignment, and ownership transfer require stronger control, including two-person review where appropriate.
3. ORAN will formalize silence and dormancy handling for organizations, host owners, reviewers, and sources rather than treating silence as neutral forever.
4. Dependency failure will narrow automation. ORAN should degrade safely instead of pretending verification quality is unchanged during outages.
5. Suspicious submissions, suspicious reviewers, suspicious feeds, and suspicious clusters of related resources should be investigated as campaigns, not only as isolated records.
6. Recovery paths must be replay-safe and version-aware so infra repair cannot silently outrank newer human decisions.

## Consequences

- More decisions become explicitly auditable and more sensitive changes gain stronger approval requirements.
- Some auto-publish behavior will narrow under degraded-mode or elevated-risk conditions.
- ORAN will need new operational states and monitors for silence, queue health, dependency health, and integrity hold conditions.
- Fraud and abuse handling becomes a cross-lane concern tied to the resource and the actor, not only to the intake channel.

## Alternatives Considered

1. Keep the current duplicate/authority controls only:
   rejected because they do not address compromised actors, bot campaigns, silence, or degraded dependencies adequately.
2. Force all high-risk paths back to universal manual gating:
   rejected because it would undo useful source-aware automation and overload review queues.
3. Rely on UI-only warnings and operator vigilance:
   rejected because high-risk controls must be server-enforced and replay-safe.

## Rollout Notes

1. Start with dual control for trust and suppression changes plus silent-owner and silent-reviewer detection.
2. Add degraded-mode policy switches for the most important dependencies: feed trust, geocoding, translation, and safety classification.
3. Add cluster-level fraud investigation tooling for repeated phones, attachments, domains, and submission patterns.
4. Extend the executable scenario harness only after the corresponding runtime controls are implemented.
