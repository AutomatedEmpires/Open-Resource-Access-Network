# Ingestion Complex Scenarios III

This third matrix extends the prior 200 scenarios into more complex cases involving adversarial data, multilingual drift, upstream schema instability, temporal ambiguity, and operational replay pressure.

## Control Model

These scenarios are considered solved when the pipeline applies the same control stack already enforced in code:

1. Deterministic live identity convergence
2. Transaction-scoped advisory locking for concurrent publication
3. Source-authority ranking before overwrite
4. Non-destructive field preservation on updates
5. Review fallback for unresolved semantic ambiguity
6. Provenance, lifecycle, and linkage recording even when overwrite is suppressed

## Scenario Matrix

| # | Challenge | Resolution |
| --- | --- | --- |
| 201 | Two hosts from partner orgs each claim authority over the same shared service. | Preserve one live identity and route ownership conflict to review rather than splitting the listing. |
| 202 | Feed partner republishes a service under a new external ID but same URL and name. | Reuse live identity and record the new upstream identifier as provenance, not a new service. |
| 203 | Candidate scrape discovers a franchised location with the same service name as the parent org. | Same-name identity remains org-scoped so the franchise is not merged into the parent accidentally. |
| 204 | A multilingual site serves different content per locale for the same URL. | URL identity remains stable, but conflicting locale payloads require corroboration before overwrite. |
| 205 | Public reviewer approves a translated submission that omits a critical exclusion clause. | Weaker or lossy text cannot erase stronger current guidance; review preserves caveats. |
| 206 | A host operator copies old description text from a legacy site during a refresh. | Non-destructive updates prevent blank loss, and provenance plus review can catch semantic regression. |
| 207 | Feed partner switches field names and `fees` begins arriving under `cost_notes`. | Contract validation fails closed to review until mapping is corrected. |
| 208 | Candidate parser reads a closed branch announcement as a system-wide closure. | Branch-level evidence should not overwrite service-wide lifecycle without corroboration. |
| 209 | One location uses PO Box in the address field while another uses physical address. | Address plausibility logic keeps mailing and visit locations from being falsely merged. |
| 210 | Service pages rotate dynamic banners that look like emergency closure notices. | Transient unverified banners reduce confidence and route to review rather than auto-close listings. |
| 211 | Feed adds a new taxonomy code with no crosswalk yet. | Unknown taxonomy remains unpublished or review-gated instead of mapped blindly. |
| 212 | Candidate page uses image-only contact info and OCR returns low-confidence phone digits. | Low-confidence OCR contacts cannot overwrite verified phone data. |
| 213 | Provider embeds a Google Map pin for administrative headquarters but service is virtual. | Delivery-mode evidence prevents false physical localization. |
| 214 | Host submission intentionally removes a service URL because intake moved to phone-only. | Removal is non-destructive by default and should be reviewable before seeker-visible URL removal. |
| 215 | Feed republishes old accreditation data during a partial upstream rollback. | Older weaker data cannot erase newer verified current fields. |
| 216 | Public submission attaches an article about the provider instead of provider-owned evidence. | Third-party evidence lowers confidence and remains review-gated. |
| 217 | Candidate scrape sees both adult and youth subprograms on one page and blends them. | Semantic blending routes to review or service splitting, not automatic overwrite. |
| 218 | A host-admin typo swaps opening and closing times. | Schedule plausibility and review prompts catch implausible intervals before publication. |
| 219 | Feed partner emits duplicate services with the same URL but different descriptions due to shard lag. | Live identity converges, and stronger/fresher snapshot rules prevent oscillation. |
| 220 | Candidate crawler reads a sitewide footer address as the service address. | Address extraction confidence and evidence locality prevent site chrome from winning. |
| 221 | Host claim arrives for a nonprofit that dissolved and was succeeded by a new legal entity. | Review validates successor mapping; no automatic org takeover occurs. |
| 222 | Feed indicates one location is active while host indicates seasonal closure only for winter. | Temporal nuance blocks simplistic active/closed flattening without corroboration. |
| 223 | Community reviewer approves a service that should remain private to a specific audience. | Policy gating must prevent seeker-visible publication of restricted services. |
| 224 | Provider page publishes a call center number that routes nowhere after hours. | Contact validation and hours-aware evidence reduce confidence before overwrite. |
| 225 | Feed partner changes state abbreviations from full names to postal abbreviations. | Geographic normalization collapses cosmetic address differences without identity churn. |
| 226 | Candidate scrape picks one campus and implies the service area is only that zip code. | Service-area evidence must remain broader when stronger signals indicate multi-region coverage. |
| 227 | Host operator updates one translated field while leaving the primary language blank. | Blank updates do not erase established primary-language values. |
| 228 | Feed partner duplicates a location because suite numbers moved between address lines. | Address normalization preserves one location identity until true distinction is proven. |
| 229 | Candidate parser mistakes `TTY available` for the primary voice number. | Contact modality classification prevents wrong channel publication. |
| 230 | Public submission cites a service page cached by a search engine after provider deletion. | Cached or mirror evidence lowers freshness and cannot outrank official current data. |
| 231 | A provider reuses a retired hotline number for a new department. | Review is required when phone identity continuity conflicts with service continuity. |
| 232 | Feed and host disagree on whether referral is required. | Contradictory intake rules require review before seeker-facing overwrite. |
| 233 | Candidate scrape sees a temporary disaster-response popup on an otherwise evergreen service page. | Temporary event text should not overwrite evergreen service identity without time-bound handling. |
| 234 | Host and feed use different spellings for a tribal or non-English organization name. | Alias handling and normalized identity preserve one org row while retaining provenance. |
| 235 | Feed partner returns HTML in text fields after an upstream sanitizer failure. | Payload validation should scrub or reject malformed rich-text drift. |
| 236 | Community reviewer approves a valid correction for one field but not the rest of the submission. | Review tooling should allow selective adoption without replacing stronger unaffected fields. |
| 237 | Candidate scrape sees a discontinued PDF linked from an active page. | Evidence freshness ranking prevents stale attachment dominance. |
| 238 | Provider serves different hours on mobile and desktop due to caching lag. | Cross-fetch disagreement reduces confidence and routes schedule changes to review. |
| 239 | Feed partner emits `null` for required docs after one ETL failure. | Non-destructive updates preserve current requirements instead of blanking them out. |
| 240 | Host adds a second campus but forgets to copy accessibility notes. | Existing known accessibility fields stay intact where the new submission is silent. |
| 241 | Candidate page contains contradictory fees statements in FAQ and summary card. | Cross-block contradiction lowers confidence and prevents auto-overwrite. |
| 242 | A public suggestion uses the right org name but wrong service URL from a sibling service. | Same-org ambiguity routes to review rather than attaching to the wrong service. |
| 243 | Feed partner renames a service category in a way that broadens seeker results. | Material taxonomy broadening should be review-visible before publication. |
| 244 | Host submission bundles a deactivated location with an active one by mistake. | Location-level intent needs review; the service row remains singular. |
| 245 | Candidate parser extracts `fax` into `voice` because type label is missing. | Conservative phone typing avoids seeker-facing misclassification. |
| 246 | Provider page mixes hours for intake office and hours for in-person service. | Separate semantic slots prevent flattened schedule confusion. |
| 247 | Feed partner drops diacritics from service names only in one region. | Normalized matching preserves identity continuity without creating duplicates. |
| 248 | Community reviewer approves a new service that later proves to be a duplicate campus alias. | Existing identity can absorb the record on later convergence without creating a second live row. |
| 249 | Candidate scrape sees “visit our new location soon” and treats it as active today. | Future-tense location evidence should not publish as current availability. |
| 250 | Host operator edits organization phone while a lower lane republishes with blank phone. | Non-destructive overwrite keeps known-good phone data. |
| 251 | Feed partner sends alternate names as primary names for one batch. | Alias drift should not rename the canonical live identity without corroboration. |
| 252 | Provider splits one service into two subservices but keeps a shared landing page. | Shared URL alone cannot collapse distinct seeker services without access/taxonomy confirmation. |
| 253 | Candidate page lists an embedded scheduler URL instead of provider homepage. | Scheduler links should not replace the canonical provider URL automatically. |
| 254 | Feed partner publishes a future effective date for a service closure. | Temporal lifecycle changes should be scheduled, not immediately published as current closure. |
| 255 | Public submitter reports a service in a neighboring county due to border confusion. | Geospatial confidence and coverage checks reduce false location shifts. |
| 256 | OCR reads address suite `B` as `8`, creating a false second location. | Address normalization and geocoding disagreement route to review. |
| 257 | Candidate scrape captures a volunteer phone instead of client intake line. | Role-based contact heuristics prevent seeker misrouting. |
| 258 | Feed partner backfills old records with current timestamps, masking staleness. | Content provenance and source history should prevent false freshness assumptions. |
| 259 | Host creates a new service with same name and same URL slug but different access rules. | Review or stronger distinguishing fields prevent accidental service collapse. |
| 260 | Candidate page shows third-party ad content mentioning unrelated services. | Evidence locality should ignore non-provider ad text. |
| 261 | Feed emits one service per county while host treats it as one statewide virtual service. | Identity resolution should preserve one core service when counties are service areas, not distinct services. |
| 262 | Public reviewer approves updated fees but leaves old application process untouched. | Selective review adoption should not force full-row replacement. |
| 263 | Provider changes website CMS and old route redirects to a generic org page. | Redirect-canonicalization should not make every service look identical. |
| 264 | Candidate scrape sees “appointments recommended” and interprets it as “appointments required.” | Contradictory or modal-language extraction requires review. |
| 265 | Feed partner strips `TTY` metadata from phone records. | Missing weaker fields must not erase accessibility-related contact modality. |
| 266 | Host operator deprecates a service but keeps the page live for archive reasons. | Lifecycle decisions should require explicit operational evidence, not page existence alone. |
| 267 | Candidate parser attaches wrong taxonomy due to keyword collision in testimonials. | Evidence segmentation should avoid testimonial text driving service taxonomy. |
| 268 | Community suggestion includes a better description but an outdated address. | Review can selectively adopt the improved field while preserving current location data. |
| 269 | Feed partner publishes contact emails using mixed case and display names. | Email normalization should preserve identity without creating false changes. |
| 270 | Candidate scrape sees one-time event registration and treats it as permanent service intake. | Event-versus-service classification should block durable overwrite. |
| 271 | Host updates one location’s hours, but bundle projection accidentally touches all linked locations. | Non-destructive and intent-aware location updates reduce collateral mutation. |
| 272 | Feed partner deletes one field due to permission scope regression. | Missing-source regression should degrade confidence, not blank seeker data. |
| 273 | Provider site adds a chatbot phone proxy instead of real intake line. | Contact verification should distinguish bot relay from true provider intake. |
| 274 | Public suggestion duplicates a service but adds a missing alternate name. | Identity reuse plus alias capture prevents duplicate live publication. |
| 275 | Candidate scraper sees outdated archived hours in a PDF linked near the top of page. | Fresh HTML evidence should outrank stale attachment data unless verified otherwise. |
| 276 | Feed partner publishes county-wide service area while host specifies zip exclusions. | Stronger recent access constraints should survive over broader generic feed claims. |
| 277 | Host admin typo drops one digit from phone while rest of data is correct. | Plausibility checks and review prompts should catch short-number anomalies. |
| 278 | Candidate parser sees contact form URL and mistakes it for direct intake URL. | URL role classification prevents form and marketing links from overwriting official service URLs. |
| 279 | Feed partner recycles an external identifier after internal cleanup. | ORAN identity remains anchored in canonical/live matching, not blind external ID trust. |
| 280 | Community reviewer approves a branch location under the wrong service family. | Review tooling should attach branch to the right service or keep it pending. |
| 281 | Provider’s page template changes and parser starts reading sidebar county list as categories. | Structural drift detection should lower confidence and surface parser regression. |
| 282 | Host merges two language-specific service pages into one combined listing. | Alias and language metadata should converge without losing distinct language support. |
| 283 | Feed partner submits location coordinates in EPSG variant or swapped lat/lon order. | Coordinate validation should reject or quarantine impossible geospatial payloads. |
| 284 | Candidate scrape captures hidden accessibility notes meant for staff only. | Publication policy should block non-public evidence from seeker-visible output. |
| 285 | Public suggestion includes screenshots with contradictory visible text and typed fields. | Reviewer and evidence comparison should prefer explicit verified text over untrusted manual transcription. |
| 286 | Feed partner localizes category labels per locale, fragmenting taxonomy. | Crosswalk normalization keeps one ORAN taxonomy model with locale-aware synonyms. |
| 287 | Host operator updates service name while canonical feed still uses old legal program title. | Stronger current authority plus alias capture preserve continuity without churn. |
| 288 | Candidate page uses different URLs per region for the same virtual service. | Service identity should be keyed by org plus semantic service continuity, not region-only URL drift. |
| 289 | Feed partner publishes all locations as active after a batch restore, including archived ones. | Lifecycle and freshness checks should stop archive resurrection without review. |
| 290 | Community reviewer approves a correction that conflicts with another pending correction. | Pending correction conflicts should reconcile before seeker-visible overwrite. |
| 291 | Candidate scrape finds a syndication partner page with copied provider text. | Source registry and provenance should keep copied third-party mirrors from outranking first-party evidence. |
| 292 | Host admin removes a required document because intake changed but feed still shows old list. | Stronger host current data persists until corroborated otherwise. |
| 293 | Feed partner expands service area from city to entire state after one mapping bug. | Material reach expansion should be review-visible and confidence-weighted. |
| 294 | Provider page shows one hotline for crisis and another for general intake, but parser merges them. | Contact-role classification preserves separate channels and prevents seeker confusion. |
| 295 | Candidate OCR extracts translated disclaimer text as service description. | Low-confidence translated OCR text should not replace established descriptions. |
| 296 | Host operator edits taxonomy terms using a local synonym not yet in crosswalk. | Custom term can exist, but seeker-facing category broadening should remain reviewable. |
| 297 | Feed partner republishes one service with outdated pre-pandemic hours from cold storage. | Drift and freshness checks prevent stale rollback from winning over current live data. |
| 298 | Public suggestion correctly identifies a missing second location under an existing service. | Existing service identity is reused and distinct location can be added under review. |
| 299 | Candidate and feed both partially describe the same new service, each missing different critical fields. | No lane should publish beyond its confidence; review can fuse corroborated fields deliberately. |
| 300 | Adversarial or accidental upstream churn causes repeated aliases, blanks, stale attachments, and conflicting service areas on one listing. | ORAN preserves one live identity, blocks destructive weaker overwrites, preserves current known-good data, and routes unresolved conflicts to review rather than seeker-visible confusion. |

## Coverage Note

Scenarios 201-300 are handled by the same unified publication stack now in place: identity convergence, advisory locking, authority ranking, and non-destructive updates. Where those controls are insufficient on their own, the expected safe outcome remains review fallback rather than autonomous publication.
