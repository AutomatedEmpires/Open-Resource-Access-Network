# Ingestion Adversarial Scenarios IV

This fourth matrix expands the challenge library into overtly hostile territory: fake listings, compromised actors, review abuse, trust-tier tampering, bot floods, impersonation, and adversarial attempts to poison ORAN's integrity.

## Threat Families

- Automated fake-listing and review-spam campaigns
- Organization and reviewer account compromise
- Source trust and source-registry tampering
- Evidence forgery, mirror-site poisoning, and contact hijacking
- Coordinated flag abuse and suppression gaming
- Internal or semi-trusted actor abuse

## Control Direction

These scenarios assume ORAN keeps its current publication stack and adds the following hardening families:

1. Actor attestation and risk scoring for hosts, reviewers, feeds, and API callers
2. Tamper-evident review and audit trails for all high-risk actions
3. Two-person approval for trust changes, ownership transfer, suppression, and high-risk publish actions
4. Multi-signal fraud scoring before publish or reverification decisions
5. Quarantine-first behavior for suspicious evidence, suspicious sources, and suspicious mass changes

## Coverage Note

Scenarios 301-400 are intentionally more aggressive than the current 300-scenario proof harness. They define the next hardening backlog. They should not be counted as already solved until the matching controls exist in runtime and focused tests.

## Scenario Matrix

| # | Challenge | Resolution |
| --- | --- | --- |
| 301 | Bot swarm submits thousands of plausible but fake listings from rotating IPs. | Apply per-actor and per-network rate limits, velocity-based fraud scoring, CAPTCHA or proof-of-work gates for anonymous submitters, and quarantine suspicious bursts before review queues are polluted. |
| 302 | Attacker uses a homoglyph domain that visually matches a trusted provider URL. | Normalize and compare punycode, maintain a trusted-domain registry with homoglyph detection, and route lookalike domains to fraud review instead of allowlisted publication. |
| 303 | A parked or expired provider domain is re-registered by an attacker. | Decay domain trust over time, require recent corroboration before preserving high trust, and demote sources when certificate age, DNS history, or operator attestation changes unexpectedly. |
| 304 | A legitimate host user goes rogue and bulk edits many listings with malicious content. | Trigger bulk-change anomaly detection, require step-up authentication for large edits, and freeze publication when one actor changes too many services too quickly. |
| 305 | A host admin account is compromised and attempts to republish stale or harmful data. | Require recent sign-in, MFA freshness, and risk-based step-up auth before high-impact publish actions; suspicious sessions are forced into review-only mode. |
| 306 | Public submitter uploads forged PDFs that look official. | Hash and sandbox attachments, inspect metadata anomalies, require corroborating first-party URLs, and treat standalone uploaded documents as untrusted evidence. |
| 307 | Bot submits a real organization with a scam hotline number. | Cross-check new contacts against current known-good data, phone reputation, repeated-use patterns, and require reviewer confirmation before replacing intake numbers. |
| 308 | Organization renames a service to SEO bait while keeping the same core program. | Preserve canonical identity, separate display-name change from service continuity, and review manipulative naming patterns that inflate search capture. |
| 309 | Attacker makes tiny repeated edits to stay under drift thresholds. | Add cumulative-risk windows so many small suspicious changes trigger the same controls as one large suspicious change. |
| 310 | Coordinated users mass-flag a valid service to suppress it. | Weight flags by reporter trust, diversity, and history; one cluster of related accounts cannot auto-suppress a listing alone. |
| 311 | Reviewer repeatedly approves duplicates without reading evidence. | Monitor reviewer quality, duplicate-approval rate, and reversal rate; auto-route low-quality reviewer decisions to second review. |
| 312 | Reviewer colludes with an organization to approve a self-serving listing. | Enforce reviewer-service conflict checks, require second approval on self-affiliated orgs, and log reviewer-org relationships for audit. |
| 313 | Recently offboarded admin attempts last-minute mass suppression before account removal. | Revoke privileges immediately on offboarding, alert on privilege use near deactivation windows, and require dual approval for bulk suppression. |
| 314 | Trusted feed API key leaks and an attacker publishes synthetic feed data. | Bind feed trust to key rotation, signed source assertions, source metadata continuity, and anomaly detection on payload shape and volume before auto-publish. |
| 315 | Submission or webhook replay is used to repeat an old approved action. | Use idempotency keys, monotonic workflow versioning, nonce expiry, and replay detection before state transitions are accepted. |
| 316 | Crawler ingests a mirrored site that copied official content but added malicious calls to action. | Maintain first-party source registry precedence, detect mirrored or syndicated domains, and quarantine copied-content sites unless explicitly trusted. |
| 317 | Fake service clones a real organization's brand and taxonomy. | Compare ownership evidence, contact continuity, domain ownership, and location corroboration before treating same-brand listings as authentic. |
| 318 | Real organization changes phone to a lead-generation center that reroutes users. | Require higher scrutiny on contact replacements, use complaint feedback and call verification checks, and preserve prior verified contact until confirmed. |
| 319 | Host removes evidence links after publish to reduce auditability. | Treat evidence removal as a reviewable destructive change and retain prior evidence snapshots immutably even if the UI reference is removed. |
| 320 | Partner feed bug emits thousands of synthetic records with plausible fields. | Detect volume spikes, schema drift, identical-text clusters, and suspicious uniformity; circuit-break feed auto-publish and quarantine the batch. |
| 321 | Bot rotates emails and names to evade duplicate detection while keeping one scam number. | Cross-link on contact reuse, attachment reuse, textual similarity, and behavior history instead of trusting only names or emails. |
| 322 | Adversary uses multilingual variants to hide contradictory scam language. | Translate and compare key fields across locales, quarantine cross-locale contradictions, and prefer verified primary-language evidence. |
| 323 | Fake address is a mailbox store or virtual office. | Score address plausibility using commercial mailbox detection, geospatial consistency, and service-type fit before publication. |
| 324 | Disaster-time scam listings appear claiming emergency shelter or aid. | Raise fraud sensitivity during crisis periods, require stronger evidence for emergency categories, and block new high-risk listings from auto-publish. |
| 325 | Same fake listing is submitted across many counties to create legitimacy. | Detect cluster spread by shared phones, shared attachments, shared phrasing, and synchronized timing; collapse into one investigation entity. |
| 326 | Organization inflates eligibility claims to capture leads it cannot serve. | Preserve eligibility as review-sensitive, compare against historical service area and feedback outcomes, and downgrade trust on repeated over-claiming. |
| 327 | Organization hides fees in ORAN while charging after contact. | Track fee contradiction signals from reports and reverification, and prioritize hidden-fee allegations for operational review. |
| 328 | Reviewer notes are edited or deleted to conceal a bad decision trail. | Make review notes append-only or versioned, with actor/time stamps and explicit reason codes for edits. |
| 329 | Malicious actor swaps a PDF at the same trusted URL after approval. | Pin evidence by content hash, not URL alone, and treat content-hash changes as new evidence requiring re-verification. |
| 330 | Compromised source system marks all records verified in one batch. | Ignore upstream self-attestation as sole trust input, compare with ORAN-side verification history, and halt publication on abnormal verification spikes. |
| 331 | Attacker hides final destination behind URL shorteners. | Expand and canonicalize all redirects before trust evaluation, and disallow shorteners as canonical provider URLs. |
| 332 | Fake virtual-only service has no accountable operator but claims statewide coverage. | Require stronger operator identity, contact continuity, and evidence of actual service delivery before broad virtual listings are approved. |
| 333 | Malicious admin raises a source to allowlisted or trusted status without basis. | Put source-tier changes behind two-person approval, signed rationale, and audit alerting for trust escalations. |
| 334 | Host attempts to suppress a competitor using misleading evidence. | Separate competitive complaints from neutral verification, require independent corroboration, and avoid actor-initiated suppression without review. |
| 335 | Bot uses LLM-generated but plausible descriptions, hours, and requirements. | Detect templated synthetic text patterns, require corroborating primary evidence, and reduce trust on overly generic yet polished submissions. |
| 336 | Trusted feed silently begins serving from a different domain or ASN. | Bind feed trust to expected endpoint metadata and trigger manual re-validation when transport identity changes. |
| 337 | Host claims an umbrella organization to seize branch listings they do not control. | Distinguish org identity from branch ownership, require branch-specific attestation, and block implicit control inheritance across all child services. |
| 338 | Coordinated flagging plus one weak stale refresh drives an undeserved suppression. | Require suppression quorum from independent signals, not just stacked weak flags plus one degraded source refresh. |
| 339 | Hidden page text is injected to poison crawler extraction without affecting visible page. | Prefer visible-text and structural extraction over hidden DOM, and quarantine pages with suspicious hidden-text deltas. |
| 340 | Compromised partner account republishes old records as if new. | Preserve source snapshot lineage and reject freshness claims that contradict historic payload continuity. |
| 341 | Scam hotline uses premium-rate or rerouting numbers. | Add phone reputation and number-type checks, and treat premium or forwarding-heavy numbers as high-risk contacts. |
| 342 | Reviewer self-assigns most high-risk items to control outcomes. | Enforce assignment fairness, anti-hoarding limits, and audit reviewer self-assignment concentration. |
| 343 | Bot behaves normally for months to build reputation and then attacks. | Use rolling reputation with decay and anomaly weighting so old good behavior does not fully neutralize sudden harmful shifts. |
| 344 | Organization creates many near-identical service listings to dominate search. | Detect same-org clone proliferation, collapse near-duplicates, and require differentiation evidence for similar sibling services. |
| 345 | Missing or broken content hashes let duplicate evidence evade replay protection. | Fail closed on hash generation errors for publish-eligible evidence and queue integrity repair instead of trusting incomplete snapshots. |
| 346 | Reviewer exports sensitive evidence externally to support an attacker. | Log export access, watermark reviewer-visible artifacts, and restrict export privileges by role and risk tier. |
| 347 | Fake geocoded address lies within the right city but the unit or suite is fabricated. | Pair geospatial checks with address validation, business registry lookups, and historical occupancy plausibility for exact locations. |
| 348 | Public suggestion points to a hacked official site containing malicious updates. | Compare current fetch against prior known-good snapshots and origin integrity indicators before trusting abrupt site changes. |
| 349 | Attacker alternates between true and false updates to pollute confidence history. | Score source consistency over time and isolate outlier reversals instead of averaging them into false stability. |
| 350 | Malicious admin removes a source from allowlist during a community emergency. | Protect high-impact source-state changes with dual control, explicit incident reason codes, and break-glass review. |
| 351 | Fake closure notices are posted by a rival on unofficial channels. | Closure changes require stronger first-party evidence, multiple corroborating signals, or direct operator verification. |
| 352 | Forged certificates or licenses are submitted as proof of legitimacy. | Validate issuer patterns, dates, and consistency with public registries before elevating trust from attachments. |
| 353 | Organization replaces official URLs with affiliate links or monetized redirectors. | Enforce canonical URL role rules and block affiliate or referral URLs from serving as primary service endpoints. |
| 354 | Feed latency reintroduces harmful outdated content after a prior correction. | Freshness and source-authority logic must reject older snapshots even when they arrive late from a trusted pipeline. |
| 355 | One scam call center number appears across many unrelated services. | Detect many-to-many phone reuse across unrelated orgs and auto-escalate clusters for fraud investigation. |
| 356 | Host adds per-user tracking parameters or personalizing tokens to URLs. | Strip tracking and secret-bearing params before persistence, and reject links that embed user or session tokens. |
| 357 | Attacker uses a mirror of a retired government domain to appear official. | Distinguish current government domain ownership from archived or mirrored content and require current authoritative domain continuity. |
| 358 | Reviewer repeatedly overrides high-risk flags without explanation. | Force reasoned override fields, track override quality, and escalate repeated unexplained overrides for admin review. |
| 359 | Staff account hits APIs directly to bypass UI guardrails. | Move high-risk validation server-side so UI is never the sole enforcement layer for publish, trust, or suppression decisions. |
| 360 | Partial dependency outage increases manual fallback volume and attacker blends in. | Mark degraded-mode submissions with elevated risk, reduce auto-approve scope during incidents, and prioritize corroborated changes only. |
| 361 | Fake org clones a real legal name and EIN-like identifiers while using a different domain. | Require domain and operator continuity, public registry cross-checks, and secondary evidence before linking to a known organization identity. |
| 362 | Organization quietly stops serving a population but leaves listing active. | Silence-sensitive reverification and complaint-weighted review should detect service abandonment before long-term harm accumulates. |
| 363 | Fake accessibility claims target vulnerable seekers. | Treat accessibility and safety accommodations as high-sensitivity fields requiring stronger corroboration and post-publish feedback loops. |
| 364 | Reviewer flips denied work to approved without rationale or new evidence. | Require evidence delta or escalation note before reversal, and send high-risk reversals to second review. |
| 365 | Threat actor edits source-registry notes to mislead future reviewers. | Version source metadata and separate commentary from enforcement state so deceptive notes cannot silently change trust behavior. |
| 366 | CAPTCHA screenshots or generic portal screenshots are used as fake evidence. | Detect low-informational-value artifacts and require provider-specific data or stable URLs before publish eligibility increases. |
| 367 | Compromised admin exports submissions in bulk to train more targeted abuse. | Monitor bulk export patterns, restrict export scope, and require incident-level approval for large data pulls. |
| 368 | Fake branch addresses are placed just inside a valid coverage zone boundary. | Use service-area plausibility, location lineage, and branch attestation to distinguish true branches from border-hugging fraud. |
| 369 | Organization repeatedly pauses and resumes service to reset reverification pressure. | Base reverification on operational risk history, not only current status, and preserve abuse memory across lifecycle toggles. |
| 370 | Malicious actor marks valid community reports as spam to hide problems. | Protect report moderation with reviewer accountability, second review on high-signal reports, and reputation-weighted reporter history. |
| 371 | Feed emits reused identifiers that link one external record to multiple ORAN entities. | Detect identifier collisions at ingest and quarantine conflicting source assertions until resolved. |
| 372 | Organization rotates domains often to evade trust decay or sanctions. | Track domain lineage and trust continuity across migrations instead of resetting risk to zero at each new domain. |
| 373 | Bot submits conflicting contacts across many records to exhaust reviewers. | Cluster contradictory submissions, summarize conflict patterns, and collapse them into one fraud investigation queue. |
| 374 | Fake listing borrows real taxonomy and service language to blend in. | Evaluate taxonomy fit alongside operator identity, address plausibility, and contact uniqueness; good taxonomy alone cannot elevate trust. |
| 375 | Reviewer suppresses or resets accumulated risk markers manually. | Make risk-score resets explicit audited actions with supervisor review rather than ordinary reviewer edits. |
| 376 | Same evidence artifact is reused across many supposedly unrelated organizations. | Detect attachment and text reuse across submissions and route repeated artifacts to centralized fraud triage. |
| 377 | Compromised feed omits closure or warning fields on services that should be inactive. | Treat omission of safety-relevant fields as non-destructive and require corroboration before reactivating listings. |
| 378 | Rival organization floods ORAN with false negative feedback about a competitor. | Measure reporter concentration, affiliation hints, and pattern symmetry before allowing feedback volume to influence suppression. |
| 379 | Partner API begins returning unsigned or unauthenticated payloads after config drift. | Fail closed from auto-publish to review-only mode when source transport or signature expectations regress. |
| 380 | Hostile admin reassigns review zones to route items toward friendly reviewers. | Protect zone and scope changes with two-person approval, drift alerts, and post-change review of assignment impact. |
| 381 | Organization invents many alternate names to own search variants. | Preserve aliases but cap seeker-facing promotion value from alias stuffing and review suspicious alias proliferation. |
| 382 | Attacker exploits timezone parsing bugs to display false open hours. | Normalize timezones explicitly, validate impossible intervals, and test timezone-sensitive categories under replay. |
| 383 | Bot generates plausible but impossible service-area polygons or county mixes. | Validate service areas against known geography models and review impossible or overly broad shapes. |
| 384 | Fake remote service uses a coworking or mailbox address as physical proof. | Distinguish mailing presence from service delivery presence and require stronger delivery evidence for physical listings. |
| 385 | Browser extension or client-side malware alters reviewer UI controls. | Keep all enforcement server-side, use signed action payloads, and log impossible UI state transitions. |
| 386 | Organization appeals every denial automatically to create reviewer fatigue. | Throttle repetitive appeals, require new evidence for repeated appeals, and route abuse-pattern appellants to senior review. |
| 387 | Reviewer creates public access tokens or review links too broadly. | Scope public tokens narrowly, expire them aggressively, and audit unusual token creation or access patterns. |
| 388 | Translation layer is poisoned so non-English evidence gets misleading translations. | Preserve original text, compare multilingual evidence, and avoid auto-approve on machine-translated critical fields alone. |
| 389 | Fake provider uses a real front-desk number that cannot confirm service legitimacy. | Contact reachability is not enough; operator-role fit, domain continuity, and service-specific evidence still govern trust. |
| 390 | Malicious organization uploads malware-laced PDFs or external viewer exploits. | Scan and sandbox all attachments, block active content, and prevent attachment rendering from becoming an attack surface. |
| 391 | Partner feed schema change silently drops review flags or hazard indicators. | Contract-test required safety fields and demote trust or halt auto-publish when safety-relevant fields disappear unexpectedly. |
| 392 | Old approved submission IDs are replayed against state-change endpoints. | Tie approvals to current workflow version and current actor permissions so stale IDs cannot re-execute privileged actions. |
| 393 | Botnet uses residential proxies to bypass IP-only rate limiting. | Add device, actor, behavior, attachment, and graph-level abuse signals beyond raw IP throttling. |
| 394 | Malicious admin lowers publication thresholds globally to let bad data through. | Protect threshold changes behind ADR-level governance, dual approval, and automatic alerting with rollback. |
| 395 | Organization quietly swaps ownership contacts just before a claim or trust review. | Snapshot pre-review owner data and require explicit review of ownership contact changes that cluster around control changes. |
| 396 | Fake branch listing uses real headquarters info plus invented campus details. | Require branch-specific evidence and reject branch legitimacy by headquarters continuity alone. |
| 397 | Reviewer mass-approves items from a stale local queue snapshot after status drift. | Re-validate item version and risk state at action time, not only at queue-render time. |
| 398 | Attacker forges screenshots of official social posts announcing new services or closures. | Treat screenshots as weak evidence unless matched by live first-party URLs or verified archived references. |
| 399 | Adversary alternates between host, public, and candidate lanes to bypass one lane's controls. | Consolidate actor, source, and service risk across lanes so abuse memory follows the resource, not the intake channel. |
| 400 | Fake organization, colluding reviewers, flag brigades, stale feeds, and silent owners all converge on one resource. | ORAN should freeze automatic mutation, preserve the last known-good live state, escalate to multi-party review, and retain full forensic lineage rather than trusting any single compromised signal. |

## Recommended Enhancements

1. Add actor-risk scoring for hosts, reviewers, source systems, and anonymous submitters.
2. Add signed source assertions or equivalent transport attestation for trusted feeds.
3. Introduce append-only review-note and risk-override ledgers.
4. Add clustered fraud investigations that aggregate repeated phones, URLs, evidence files, and text patterns.
5. Require dual control for source trust, suppression, zone reassignment, and threshold changes.
