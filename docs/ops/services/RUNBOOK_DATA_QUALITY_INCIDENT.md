# Runbook: Resource Data Quality Incident

## Metadata

- Owner role: Data Platform Lead
- Reviewers: Ingestion Operations Lead, Security Lead
- Operational status: active
- Last reviewed (UTC): 2026-07-13
- Next review due (UTC): 2026-10-13
- Severity scope: SEV-2 to SEV-3

## Purpose And Scope

Respond when staged or published government/community resource records are
incorrect, duplicated, expired, unsupported by provenance, or drawn from a
supporting-reference source such as a benefit retailer directory.

## Safety Constraints

- Do not publish or retain seeker visibility for a record whose purpose,
  provenance, or current availability cannot be trusted.
- Preserve source assertions, canonical history, audit records, and reversibility.
- Do not turn a confidence score into an eligibility or availability guarantee.
- Never bypass a quarantine, integrity hold, publication boundary, or human
  verification requirement to reduce backlog.
- Corrective matching must not infer sensitive seeker attributes or fabricate facts.

## Triggers

- Supporting-reference/retailer records appear in chat, map, scroll, search, or
  service detail results.
- Resource expiry, stale-source, or reverification findings rise unexpectedly.
- Community reports identify wrong contact, hours, location, eligibility, or closure.
- Duplicate canonical resources fragment evidence or seeker actions.
- Source-purpose classification, publication status, or integrity holds regress.
- A source import produces abnormal record volume or geographic/category drift.

## Diagnosis

1. Identify the source system/feed, source purpose, affected canonical records,
   and every public retrieval path.
2. Determine whether the issue is source data, normalization, dedupe, taxonomy,
   publication policy, freshness, or cache behavior.
3. Query counts and identifiers first. Do not export full descriptions, seeker
   interactions, or unrelated records.
4. Check source assertions and audit history before changing canonical data.
5. Reproduce publication filtering through shared search/publication primitives,
   not a one-off page query.

## Mitigation

1. Pause or quarantine the affected source/feed.
2. Apply an integrity hold to affected live services through the reviewed
   mechanism; do not delete evidence under incident pressure.
3. Route affected resources to service verification or community/admin review.
4. Correct deterministic source-purpose, normalization, dedupe, or publication
   rules and add a regression fixture.
5. Reprocess in bounded batches with before/after counts and an auditable rollback.

## Validation

- All public retrieval surfaces exclude quarantined, inactive, non-publishable,
  and supporting-reference records.
- Corrected records retain provenance and audit history.
- Freshness findings are idempotent and clear only after the exact approved fix.
- Dedupe does not merge distinct providers or locations.
- A bounded sample receives human verification before broad re-publication.

Run the focused publication/search, source-purpose, and freshness suites involved
in the incident, followed by typecheck. Do not use a production write as a test.

## References

- `docs/ops/data/RUNBOOK_RESOURCE_FRESHNESS_REVIEW.md`
- `docs/ops/services/RUNBOOK_211_API_INGESTION.md`
- `docs/ops/services/RUNBOOK_ADMIN_ROUTING.md`
- `src/services/search/publication.ts`
- `src/services/freshness/resourceFreshness.ts`
- `db/migrations/0060_source_purpose_fail_closed.sql`
- `db/migrations/0063_resource_freshness_review_lane.sql`
