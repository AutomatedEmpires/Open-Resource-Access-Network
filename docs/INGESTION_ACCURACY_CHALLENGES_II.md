# Ingestion Accuracy Challenges II

This second matrix focuses less on raw duplicate races and more on publication inaccuracies, semantic confusion, stale authority, and verification blind spots that can still leak incorrect seeker-visible data if not controlled.

## Solution Families

- Deterministic identity matching before publish
- Source-authority ranking before overwrite
- Review fallback for ambiguity or weak corroboration
- Better verification signals for address, taxonomy, hours, and eligibility
- Monitoring and replay for drift detection

## Scenario Matrix

| # | Challenge | Resolution |
| --- | --- | --- |
| 101 | A provider renames a service but keeps the same URL and org. | Reuse the service identity and treat the rename as an in-place refresh. |
| 102 | A provider reuses a URL for a materially different service. | Route to review when semantic drift exceeds deterministic identity confidence. |
| 103 | An org homepage lists multiple services but the crawler collapses them into one. | Keep one org identity but require service-level disambiguation before auto-publish. |
| 104 | Feed payload uses generic organization description as service description. | Lower confidence and prefer existing stronger service description unless corroborated. |
| 105 | Host edits hours while feed republishes stale hours. | Stronger host authority prevents stale feed overwrite. |
| 106 | A public submitter copies a provider description verbatim from an outdated PDF. | Review gate plus stronger current authority suppresses overwrite until verified. |
| 107 | Candidate page omits fees while current host row includes fees. | Missing weaker-lane fields must not blank out current stronger data. |
| 108 | Feed clears service email because upstream field is null for one refresh. | Null weaker refreshes should not erase stronger current fields without corroboration. |
| 109 | Crawler sees temporary banner text and mistakes it for eligibility rules. | Verification scoring should down-rank transient banner-derived fields. |
| 110 | HSDS payload swaps organization phone and service phone. | Schema validation plus contact-type checks fail closed to review. |
| 111 | Upstream feed normalizes all-caps county names differently across refreshes. | Canonical normalization should collapse cosmetic geography differences. |
| 112 | A provider's wait time changes hourly on a live queue page. | Drift detection lowers confidence and routes unstable fields for review. |
| 113 | Feed publishes two services with same name but different eligibility. | Distinguish by org + taxonomy + access constraints before live merge. |
| 114 | Host submission omits languages already present on a reviewed public row. | Omission alone should not erase established values on overwrite. |
| 115 | Candidate parser extracts `24/7` as both hours and service area. | Field-level validation should quarantine cross-field parse anomalies. |
| 116 | Feed partner changes taxonomy mapping for the same external code. | Crosswalk drift should be reviewable before seeker-visible taxonomy changes. |
| 117 | Crawler discovers a translated page with stale auto-translated service names. | Prefer canonical source language or stronger current authority over weaker translation artifacts. |
| 118 | Public suggestion gives a correct service URL but wrong city. | Same service identity can be linked, but conflicting location data routes to review. |
| 119 | Feed uses mailing address as service location. | Address plausibility and service-area checks should reduce publish confidence. |
| 120 | A provider moves but leaves old address on one subpage. | Cross-source disagreement should block blind overwrite of current location. |
| 121 | Candidate page includes a tracking phone number not meant for public intake. | Contact validation and cross-source checks should flag mismatched intake paths. |
| 122 | Host edits org legal status while stale feed retains old nonprofit status. | Host-controlled org metadata remains authoritative. |
| 123 | Feed reports the service as active while host marks it paused temporarily. | Stronger host authority or manual review should prevent false active exposure. |
| 124 | Community reviewer approves a submission that conflicts with existing host snapshot. | Approval can link to existing record but should not outrank host authority automatically. |
| 125 | Candidate picks up embedded map coordinates that differ from human-entered address. | Geospatial conflict reduces confidence and prefers review. |
| 126 | Service page shows seasonal hours only in winter. | Snapshot metadata should record seasonality rather than flattening to evergreen hours. |
| 127 | Public submission includes a working phone but wrong organization name. | Identity resolution binds to the service only if corroboration is sufficient; else review. |
| 128 | Feed partner sends duplicated taxonomy entries with conflicting confidence. | Deduplicate tags and keep strongest corroborated assignment. |
| 129 | Provider lists intake process separately for veterans and non-veterans. | Preserve nuanced access notes; do not collapse conflicting subrules into one generic string. |
| 130 | Candidate parser mistakes “call before visiting” as a phone number. | Contact format and semantic validation should block publication. |
| 131 | Feed sends a generic `open weekdays` string with no times. | Lower verification confidence and keep existing precise hours where stronger. |
| 132 | Host removes a location that still appears in older feed snapshots. | Stronger host row should keep the removal until corroborated otherwise. |
| 133 | A service is statewide but crawler binds it to the headquarters city only. | Delivery-mode and service-area logic must avoid over-localizing statewide services. |
| 134 | Feed omits remote availability while candidate scrape finds telehealth text. | Combine stronger corroborated signals instead of replacing with one-lane silence. |
| 135 | Provider webpage has duplicate sections and parser inflates required documents. | Deduplicate repeated evidence blocks before publication. |
| 136 | Taxonomy term changes from `food` to `food pantry` in one source only. | Prefer review for material taxonomy narrowing or broadening. |
| 137 | A PDF brochure lists an expired seasonal hotline. | Evidence age and reverification cadence should down-rank stale contacts. |
| 138 | Community submission uses nickname for organization while feed uses legal name. | Keep a single org identity with alias handling, not separate org rows. |
| 139 | Host edits service name to add a marketing tagline. | Cosmetic rename is allowed in-place but should not distort canonical identity matching. |
| 140 | Feed truncates long descriptions causing loss of caveats. | Stronger richer snapshot should survive over lossy refreshes. |
| 141 | Candidate page contains multiple campuses with one phone number each. | Location-level phones should stay attached to the right location, not collapse to the service. |
| 142 | Feed supplies duplicated locations with slightly different postal codes. | Treat as ambiguous until address validation resolves which location is correct. |
| 143 | Provider deprecates a service but leaves landing page live. | Lifecycle status should require corroboration, not homepage presence alone. |
| 144 | Host submission intentionally creates a new service with same name but different audience. | Same-name services may coexist if access or taxonomy differ materially. |
| 145 | Feed sends organization-wide holiday closure as permanent closure. | Temporal signals should prevent permanent closure inference from temporary notices. |
| 146 | Candidate parser captures breadcrumb text as service area. | Geography normalization should reject non-area artifacts. |
| 147 | Service has multiple intake URLs and only one is current. | Verification should favor the one corroborated by stronger or fresher evidence. |
| 148 | Provider uses URL shortener for hotline campaign page. | Canonical URL expansion should reduce false new-service identities. |
| 149 | Feed provides county name abbreviation while host uses full county list. | Normalize regional aliases before conflict scoring. |
| 150 | Crawler picks up “closed on holidays” as fully closed. | Schedule parser needs exception-aware logic before overwriting normal hours. |
| 151 | Community suggestion adds a social media page instead of official URL. | Low-trust URL should not replace verified official provider URL. |
| 152 | Feed partner changes org homepage domain after a rebrand. | Domain migration should reuse org identity via name and corroborated service continuity. |
| 153 | Host claim targets a merged organization after provider consolidation. | Review should verify successor identity before membership transfer. |
| 154 | Candidate page lists both main line and donation line; parser picks wrong one. | Contact-role classification should separate intake from admin/fundraising numbers. |
| 155 | Feed updates taxonomy faster than host operators review content changes. | Taxonomy shifts should be observable and optionally review-gated when they materially alter seeker routing. |
| 156 | Service serves multiple languages, but one source only lists English. | Missing weaker-lane language lists should not erase known multilingual support. |
| 157 | Address line contains suite and floor text in inconsistent order. | Address normalization should avoid false location splits on suite formatting. |
| 158 | Feed adds an accreditation that expired last year. | Accreditation freshness should be date-sensitive, not accepted blindly. |
| 159 | A host-admin typo changes age minimum from 18 to 8. | Outlier validation and review prompts should catch implausible access changes. |
| 160 | Candidate scrape misreads OCR and changes postal code by one digit. | Geocode mismatch should reduce confidence and prevent auto-overwrite. |
| 161 | Feed lists one service twice under two program wrappers. | Canonical service dedupe should collapse wrappers before publication. |
| 162 | Provider website uses accordion content hidden from the first scrape. | Incomplete extraction should not outrank fuller corroborated host or feed data. |
| 163 | Public submission merges two related services into one narrative. | Review should split services instead of creating a blended listing. |
| 164 | Feed gives generic statewide service area while host provides county-specific rollout. | Stronger recent operational data should win where it narrows availability. |
| 165 | Candidate page uses old brand logo and old service name after rebrand. | Drift handling should prefer fresher corroborated identity evidence. |
| 166 | Host updates organization URL but service URL still points to legacy domain. | Org and service identity should be updated independently without row duplication. |
| 167 | Feed marks a service active again after a short outage but current row is paused. | Recovery should require corroboration, not one-source optimism. |
| 168 | Parser converts “No walk-ins” into `Walk in during open hours.` | Contradictory intake process extraction must fail closed. |
| 169 | Provider uses a common service name shared by multiple organizations. | Same-name cross-org matching must remain conservative and reviewable. |
| 170 | Candidate scrape picks up call center hours instead of service hours. | Contact-hours and service-hours need separate extraction semantics. |
| 171 | Feed omits accessibility data after one malformed batch. | Missing batch data should not erase established accessibility support. |
| 172 | Host creates a temporary pop-up location for a recurring event. | Temporal location semantics should prevent permanent seeker confusion. |
| 173 | Feed rotates contact emails between aliases. | Alias churn should not imply service identity churn. |
| 174 | Public reviewer approves a duplicate of a service that already changed names. | Identity reuse plus authority policy should prevent a second live row. |
| 175 | OCR reads `l` as `1` in hotline number. | Phone normalization and plausibility checks should catch low-confidence OCR numbers. |
| 176 | Candidate page includes an outdated county list copied from a sidebar template. | Service-area confidence should favor service-specific evidence over site chrome. |
| 177 | Feed partner strips diacritics from organization names. | Name normalization should preserve identity continuity. |
| 178 | Host operator accidentally removes application process text. | Strong host authority still applies, but blanking sensitive fields should be surfaced for review or undo. |
| 179 | Candidate scrape combines two consecutive weekday schedules into one malformed range. | Schedule parser should reject malformed intervals rather than publish nonsense. |
| 180 | Feed sends old coordinates with new address after relocation. | Address/coordinate disagreement should trigger review. |
| 181 | Service offers both virtual and in-person delivery but one source mentions only one. | Delivery tags should merge conservatively, not oscillate between modes. |
| 182 | Provider page has archived PDF and current HTML with different fees. | Evidence freshness and source ranking should prefer current corroborated content. |
| 183 | Public submitter copies a referral agency summary that oversimplifies eligibility. | Review should preserve caveats and avoid seeker-facing overclaiming. |
| 184 | Feed uses organization legal entity name while host uses public-facing brand. | Org aliases should remain one identity with better display-name governance. |
| 185 | Candidate scrape sees one campus page and assumes service is local-only. | Service-area and remote-delivery evidence should prevent over-narrow publication. |
| 186 | Host moves a service from one organization to another after partnership change. | Review should validate true ownership transfer before live reassignment. |
| 187 | Feed lists a shared hotline for multiple services. | Shared contact data should not collapse distinct service identities. |
| 188 | Candidate parser interprets “free parking” as a fee field. | Field typing checks should quarantine semantic mismatches. |
| 189 | Provider page uses toggled age bands by service subtype. | Access rules should remain subtype-aware or review-gated, not flattened incorrectly. |
| 190 | Feed maps multiple external categories into one ORAN taxonomy term. | Lower confidence for coarse mappings and retain provenance for review. |
| 191 | Crawler discovers a mirrored site with stale content. | Domain allowlist and source registry should reduce mirror-induced overwrite risk. |
| 192 | Host edits only one location but submission bundle resends all locations. | Bundle projection should not accidentally erase untouched valid locations without intent. |
| 193 | Feed marks a location active after host has permanently closed it. | Authority ranking should keep host closure unless corroborated by stronger evidence. |
| 194 | Community reviewer approves a valid new location under an existing service. | Existing service identity is reused; distinct location is added with review provenance. |
| 195 | Provider lists a fax line only; parser turns it into voice. | Phone-type classification should preserve contact modality. |
| 196 | Feed republishes a service after a taxonomy crosswalk bug is fixed. | Republish should update in place with auditable taxonomy drift history. |
| 197 | Candidate scraper sees `Call 211` and mistakes it for provider phone. | Source-specific call-to-action filtering should prevent false provider contacts. |
| 198 | Host operator merges two services operationally but feed still lists both. | Review should handle merger semantics before seeker-facing collapse. |
| 199 | Feed continues to publish a duplicate service after ORAN already merged identities. | Canonical/linkage metadata should steer repeats back to the adopted live identity. |
| 200 | A future combination of stale, partial, aliased, and competing source updates targets one published listing. | ORAN should preserve one live identity, suppress weaker overwrites, and route unresolved semantic conflicts to review rather than publishing confusion. |

## Recommended Tool Stack

1. Azure Maps geocoding + address confidence:
   use for address canonicalization, postal/city mismatch detection, and location-confidence scoring.
2. Azure AI Search or pgvector duplicate surfacing:
   use embeddings and semantic similarity only for operator-facing duplicate suggestions, never as autonomous publish authority.
3. Azure Application Insights + KQL dashboards:
   track overwrite-suppressed events, authority collisions, and drift-triggered review routing by lane.
4. Azure Functions scheduled replay jobs:
   replay the 200 scenario matrices against staging fixtures nightly to validate idempotence and authority behavior.
5. GitHub Actions regression matrix:
   run focused publication suites plus deterministic scenario replay on PRs touching ingestion, submissions, or publication helpers.
6. HSDS and 211 contract validators:
   validate inbound payload structure and source-specific required fields before federation or publication eligibility scoring.
