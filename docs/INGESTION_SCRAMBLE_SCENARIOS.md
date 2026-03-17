# Ingestion Scramble Scenarios

This matrix pressure-tests ORAN's ingestion system against concurrent, conflicting, and low-quality intake events across four lanes:

- Host-controlled structured submissions
- Community/public submissions
- Allowlisted crawler or manual candidate discovery
- Trusted feed and canonical federation publication

Current hardening invariants:

- All live publication lanes must normalize identity the same way before materializing rows.
- All live publication lanes must take the same transaction-scoped advisory lock before resolving org/service ownership.
- Matching active live organization, service, and location rows must be reused instead of duplicated.
- Host-controlled submissions may refresh an existing listing they control, but non-host lanes must not silently seize ownership.
- Low-confidence, ambiguous, or policy-failed records still route to review instead of auto-publishing.

## Review Summary

The first 100 scenarios now collapse onto five solution primitives that are implemented in the live publication layer:

1. Identity convergence:
   `liveEntityMerge` normalizes org, service, and location identity and reuses existing active rows.
2. Race control:
   a transaction-scoped advisory lock serializes concurrent publication attempts for the same normalized org/service pair.
3. Authority protection:
   `liveAuthority` prevents weaker lanes from overwriting stronger current snapshots after a match.
4. Workflow gating:
   host, public, candidate, and canonical lanes still respect their review or policy gates before they reach publication.
5. Backfill continuity:
   when canonical or submission lanes adopt an existing live record, they backfill linkage metadata instead of cloning the listing.

Coverage map for the first 100 scenarios:

- Scenarios 1-40: solved primarily by identity convergence + race control.
- Scenarios 41-80: solved primarily by authority protection + bundle refresh semantics.
- Scenarios 81-100: solved primarily by workflow gating + canonical/live linkage backfill.

Known strategic follow-ons:

- Add cross-org ambiguity scoring so same-service-name/different-org collisions surface earlier for review.
- Add fuzzy-similarity duplicate suggestions before approval, not just deterministic live-row adoption at publish time.
- Add scenario replay automation against staging snapshots so these matrices become executable governance tests.

## Scenario Matrix

| # | Scramble | Expected outcome |
| --- | --- | --- |
| 1 | Community user submits only `www.resource1.com`; host org already controls listing; crawler discovers same page; HSDS feed delivers same service. | One live service survives. Community submission links to existing service for review. Host/feed/crawler reuse the live row. |
| 2 | Host submits a new listing while curated feed publishes the same service URL milliseconds later. | Advisory lock serializes publication. One org/service row is reused. |
| 3 | Feed refresh republishes a service already published from canonical data. | Republish updates the existing live service and snapshot instead of inserting a duplicate. |
| 4 | Candidate publish runs twice for the same candidate after a worker retry. | Second run reuses the existing live org/service/location rows. |
| 5 | Host edits a listing while a crawler republishes stale content for the same URL. | One service row remains. Host-owned live row is refreshed, not duplicated. |
| 6 | Public submission suggests a service already active under the same org and URL. | Submission resolves to the existing org/service identity and routes to review. |
| 7 | Two host admins submit the same service from the same organization at once. | Advisory lock plus live identity resolution converge on one service row. |
| 8 | Two different feeds publish the same service URL under the same org. | Canonical resolution and live merge converge on one canonical service and one live service. |
| 9 | Host claim approval lands while feed promotion targets the same organization homepage. | Organization row is reused; claim grants membership without duplicating the org. |
| 10 | Candidate publish restarts after creating the org but before creating the service. | Retry reuses the org row and creates or updates only the missing service row. |
| 11 | Community submission uses HTTP; host listing uses HTTPS for the same org and service. | URL normalization strips protocol differences and reuses the same live identity. |
| 12 | One source includes a trailing slash; another omits it. | URL normalization prevents duplicate org/service rows. |
| 13 | Organization name differs only by punctuation. | Normalized-name matching reuses the existing active organization. |
| 14 | Service name differs only by punctuation and casing within the same org. | Normalized-name matching reuses the existing active service. |
| 15 | Candidate has org URL but blank service URL; host submission has both. | Org resolution converges first; service resolution falls back to normalized name within org. |
| 16 | Feed service URL is blank but service name and org name match an existing row. | Name-based fallback reuses the existing org/service. |
| 17 | Host listing uses homepage URL for org and detail URL for service; feed uses the same pair. | Lock fingerprint plus URL matching converge on one org/service pair. |
| 18 | Public submission provides only organization name and service name. | No auto-publish. Review path can still resolve to existing org/service without new live rows. |
| 19 | Crawler extracts a normalized URL with `www`; feed omits `www`. | If canonical/live URL strings normalize to the same stored value, reuse occurs; otherwise route remains single-row at the review layer until confirmed. |
| 20 | A retry changes only whitespace in organization/service names. | Lock key and matching remain stable; no duplicate row is created. |
| 21 | Host-controlled listing exists; public submission attempts to claim it indirectly by editing service fields. | Submission binds to existing service for review but does not transfer ownership automatically. |
| 22 | Feed republishes a host-controlled listing with stale phone data. | Existing service is reused; source refresh updates publication artifacts without a duplicate. |
| 23 | Host submits org claim for an org that already has active members. | Claim resolves to existing organization and updates membership state only after approval. |
| 24 | Community submission mentions an org already controlled by host but proposes a new service. | Existing org is reused; new service remains review-gated until approved. |
| 25 | Host submits a new service under an existing org with blank org metadata. | Existing org is reused; service publish does not create a second org. |
| 26 | Feed promotion matches existing service but canonical org has not yet stored `publishedOrganizationId`. | Promotion adopts the live org and backfills canonical published IDs. |
| 27 | Feed promotion matches existing service but canonical service has no `publishedServiceId` yet. | Promotion adopts the live service and marks canonical as published against it. |
| 28 | Candidate publish matches existing location by address. | Existing active location is reused rather than duplicated. |
| 29 | Candidate publish matches location by name when address is missing. | Existing active location is reused by normalized name. |
| 30 | Host re-approval replaces service locations. | The service row is reused; service bundle refresh stays within one service identity. |
| 31 | Host, crawler, and feed all target the same org and service with one transaction blocked on the lock. | Waiting transactions reuse the rows created by the winner instead of inserting new ones. |
| 32 | Two workers promote the same canonical service concurrently. | Advisory lock and canonical published IDs collapse the race to one live service. |
| 33 | Two workers approve the same host submission concurrently. | One projection wins; the second sees existing org/service IDs and reuses them. |
| 34 | Candidate publish and canonical promote for the same service overlap. | Shared live identity matching produces one org/service row and one latest snapshot. |
| 35 | Community review approval overlaps with host auto-publish for the same service. | Shared live identity matching reuses the service row; approval state differs, not identity. |
| 36 | Feed promotion overlaps with claim approval for the same organization. | Shared org matching reuses the organization and prevents duplicate membership targets. |
| 37 | Candidate publish crashes after location insert but before lifecycle event. | Retry reuses org/service/location and finishes metadata writes without extra rows. |
| 38 | Feed republish crashes after service update but before canonical backfill. | Retry reuses adopted live IDs and completes the backfill. |
| 39 | Host submission crashes after org update but before service update. | Retry reuses the org row and projects into the same service identity. |
| 40 | Public submission save and submit requests race. | Submission workflow state may race, but live publication still resolves through one identity on approval. |
| 41 | Candidate has high confidence but missing address; feed has full address. | Candidate may publish without a location; later feed refresh reuses org/service and can add location data. |
| 42 | Feed has full address; host submission omits location but edits service description. | Service row remains singular; missing host location data does not create a parallel listing. |
| 43 | Host submission includes one location; crawler finds the same service with another location. | One service row persists. Distinct locations may coexist under that service. |
| 44 | Candidate publish finds a service with an existing active location and slightly different geocode. | Existing location is reused and updated. |
| 45 | Feed promotion updates an existing location address formatting only. | Existing location row is reused; address snapshot is refreshed. |
| 46 | Public submission proposes a service with no org name but a matching service URL under an existing org. | Review path can bind to the existing service after identity resolution; no duplicate live row. |
| 47 | Host listing changes organization phone while feed changes service phone. | One org and one service remain. Later refreshes update associated data without duplicate identities. |
| 48 | Candidate publish and host approval both attach the same phone. | Duplicate phone identity is scrubbed before insert in the candidate lane. |
| 49 | Two feeds produce the same location address with slightly different capitalization. | Location matching reuses the existing active location. |
| 50 | Same service appears with no location in one lane and with a named location in another. | Service identity remains singular; location is added or reused without duplicating the service. |
| 51 | Community submission is low quality and below confidence threshold. | It remains review-gated and cannot create a live duplicate. |
| 52 | Candidate is flagged by policy despite high confidence. | It routes to review and cannot auto-publish a duplicate. |
| 53 | Feed trust tier is not eligible for auto-publish. | Canonical row may exist, but live publication does not occur automatically. |
| 54 | Host submission is incomplete and fails workflow approval. | It falls back to review, preserving one pending submission record. |
| 55 | Approved public submission targets an existing service but reviewer decides it is a duplicate suggestion. | Review can deny without live row creation. |
| 56 | Claim submission targets a blocked or inactive org row. | No automatic live mutation occurs; review handles remediation. |
| 57 | Feed promotion sees canonical lifecycle `retired`. | Promotion is rejected; no duplicate or stale live row is created. |
| 58 | Candidate publish sees missing candidate record on retry. | Publish fails fast; no partial duplicate is emitted. |
| 59 | Canonical promotion lacks winning source system. | Auto-publish skips cleanly; live identity is untouched. |
| 60 | Community submission references a provider outside allowlist and no trusted feed corroborates it. | It remains in review and cannot auto-publish. |
| 61 | Host submits a listing with the same service URL but a changed display name. | Existing service is reused and updated rather than cloned. |
| 62 | Feed publishes the same service with a changed description only. | Existing service is republished in place. |
| 63 | Candidate publish raises geocoder failure while matching an existing service. | Publish still reuses the service and updates non-geo fields. |
| 64 | Feed republishes while taxonomy terms differ from host submission. | One service identity remains; taxonomy metadata updates can be reviewed separately. |
| 65 | Public approval adds a service under an existing org where a host later claims ownership. | Existing org/service survive; ownership changes via membership/approval, not duplicate rows. |
| 66 | Host claim arrives for an org already linked to the submitter. | Membership upsert is idempotent. |
| 67 | Candidate publish creates a service that later canonical promotion adopts. | Canonical published IDs backfill to the preexisting live service. |
| 68 | Host auto-publish creates a service that later canonical promotion adopts. | Canonical published IDs backfill to the host-created live service. |
| 69 | Canonical promotion creates a service that later host approval edits. | Host approval reuses the canonical-backed live service. |
| 70 | Public approval creates a service that later candidate publish encounters. | Candidate publish reuses the existing live row and republish metadata. |
| 71 | Duplicate community submissions for the same service are approved hours apart. | Second approval reuses the existing org/service identity. |
| 72 | Duplicate host submissions for the same service are approved on different days. | Later approval reuses the existing service and updates the bundle. |
| 73 | Feed republish for same service happens after manual DB cleanup removed old snapshot but not service row. | Service row is reused and a fresh snapshot is written. |
| 74 | Candidate publish sees an existing service but no snapshot row. | Existing service is reused and current snapshot is re-established. |
| 75 | Canonical promotion sees an existing org but no service match. | Org is reused; only the service is inserted. |
| 76 | Canonical promotion sees an existing service and existing location but no org backfill. | Org/service/location are reused and canonical IDs are backfilled. |
| 77 | Candidate publish sees existing org and service but no location match. | Org/service are reused; a new location is added only if distinct. |
| 78 | Host approval edits an existing service but leaves URL blank. | Name-based same-org match still reuses the existing service. |
| 79 | Public approval edits an existing service with blank org URL and matching names. | Existing org/service are reused after review. |
| 80 | Feed promotion of an already-published service changes only phone formatting. | Existing service is reused; related phone data refresh does not create a second service. |
| 81 | Host and feed submit different organization descriptions for the same org. | Shared org identity remains singular; last successful publication updates metadata. |
| 82 | Host and candidate submit different service descriptions for the same service. | Shared service identity remains singular; last successful publication updates metadata. |
| 83 | Community submission proposes a renamed service under an existing org. | Review can map it to the existing service or create a distinct service intentionally, but not accidentally through race. |
| 84 | Candidate publish sees same org name but different service URL under same org. | Existing org is reused; distinct service row may be created if the service identity is genuinely different. |
| 85 | Feed promotion sees same service name under different org names. | Without same-org match it remains a separate service; no false merge is forced. |
| 86 | Public approval sees same service URL under a different organization. | Review surface resolves ambiguity; automatic live identity reuse stays same-org scoped. |
| 87 | Candidate publish sees same org URL but different service names. | Existing org is reused; service matching decides whether to reuse or create within that org. |
| 88 | Host creates a second legitimate service under the same org homepage domain. | Existing org is reused while service identity remains distinct if URL/name differ enough. |
| 89 | Feed canonicalization collapses two source records into one canonical service after one already published live. | Republish updates the same live service and preserves seeker continuity. |
| 90 | Candidate materialization dedupes source snapshot but publication is retried separately. | Publication still reuses the same live identity. |
| 91 | Host approval uses existing service ID explicitly. | Projector updates that exact service row and bypasses duplicate lookup drift. |
| 92 | Host approval uses existing org ID explicitly with no service ID. | Projector reuses the org and resolves service identity within it. |
| 93 | Claim approval targets an org matched by homepage URL rather than stored owner ID. | Existing org is reused and membership is granted against it. |
| 94 | Candidate publish encounters an org matched by normalized name only. | Existing org is reused if active; duplicate org rows are avoided. |
| 95 | Canonical promotion encounters a service matched by normalized name only within adopted org. | Existing service is reused and canonical published ID is backfilled. |
| 96 | Candidate publish updates a service previously published from public review. | Existing service row is reused and republished in place. |
| 97 | Public review approves a submission for a service previously published from candidate auto-publish. | Existing service row is reused and enriched in place. |
| 98 | Feed promotion refreshes a service previously created by host auto-publish and later edited by review. | Shared live identity persists across all lanes. |
| 99 | Three identical publish attempts arrive after a queue replay. | Advisory lock serializes all three and only one live identity survives. |
| 100 | Any mix of host, public, crawler, and feed inputs target the same normalized org/service pair over time. | ORAN keeps one active live org/service identity, reuses it across publish lanes, and routes ambiguity to review rather than multiplying live rows. |

## Tooling Priorities

Useful Azure, Microsoft, GitHub, and standards-aligned additions for the next hardening wave:

1. Azure Maps:
   canonicalize and score address confidence beyond exact address-string matching to reduce location drift and false splits.
2. Azure AI Search or a pgvector-backed duplicate index:
   surface near-duplicate org/service candidates before publish when deterministic URL/name checks are insufficient.
3. Azure Application Insights:
   publish lane dashboards for `linked_existing`, `republished`, `published`, and overwrite-suppressed events by source kind.
4. Azure Functions timer or queue replay harness:
   run scheduled scenario replays against staging to prove idempotence and authority protection under concurrency.
5. GitHub Actions nightly ingestion matrix run:
   execute focused replay tests and open issues automatically when a scenario regresses.
6. HSDS and 211 schema validation tooling:
   validate incoming partner payloads before federation so malformed partner refreshes fail closed to review.
