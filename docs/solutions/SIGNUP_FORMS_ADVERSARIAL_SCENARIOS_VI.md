# Signup And Managed-Form Adversarial Scenarios VI

This matrix extends the resilience backlog with 200 additional scenarios focused on public registration abuse and managed-form draft or submit abuse. The scenarios are additive design pressure, not claims that every case is fully automated today.

## Signup Scenarios 501-600

| ID | Scenario | Expected control |
| --- | --- | --- |
| 501 | Bot fills hidden signup fields to test form scraping. | Treat non-user-facing honeypot fields as suspicious and do not create an account. |
| 502 | Signup payload is valid JSON except for a trailing partial chunk from a flaky client. | Fail with a 400 parse error instead of surfacing a server error. |
| 503 | User enters a whitespace-only display name. | Trim before validation and reject empty identity labels. |
| 504 | Username is padded with leading and trailing spaces to evade uniqueness. | Normalize before duplicate checks and persistence. |
| 505 | Email casing is changed to evade uniqueness checks. | Lowercase before duplicate checks and persistence. |
| 506 | Phone formatting changes from `(555) 123-4567` to `5551234567`. | Normalize before duplicate checks and persistence. |
| 507 | Password is exactly the username plus a year suffix. | Reject passwords derived from account identity. |
| 508 | Password is the email local-part plus punctuation. | Reject passwords derived from the email local-part. |
| 509 | Password embeds the display name token. | Reject passwords containing identity tokens. |
| 510 | Password is a common weak secret from public breach lists. | Reject high-frequency weak passwords. |
| 511 | Password uses only lowercase letters and digits. | Require basic class diversity. |
| 512 | Password uses only uppercase letters and digits. | Require mixed case plus digits. |
| 513 | Display name contains unexpected internal control characters. | Trim or reject malformed control-heavy values before persistence. |
| 514 | Client retries the same signup after a network timeout. | Preserve duplicate detection and avoid account cloning. |
| 515 | IP-based spray attempts rotate usernames for the same mailbox. | Keep rate limiting at the route edge and rely on mailbox uniqueness. |
| 516 | IP-based spray attempts rotate emails for the same username. | Keep route rate limiting and username uniqueness. |
| 517 | Signup body includes unrecognized fields intended to probe the parser. | Ignore unknown fields and validate only the supported contract. |
| 518 | Client sends `null` for phone. | Normalize optional phone handling without crashing validation. |
| 519 | Client sends blank phone with surrounding tabs and spaces. | Trim and persist `null` rather than a misleading empty value. |
| 520 | User copies a password with a newline suffix from a password manager. | Preserve exact password semantics but reject malformed identity-derived or weak values. |
| 521 | Mass bot traffic reuses one IP with varied emails. | Enforce shared per-IP rate limits. |
| 522 | Mass bot traffic reuses one email with varied usernames. | Enforce duplicate email rejection. |
| 523 | Bot attempts to enumerate existing accounts via timing variations. | Keep duplicate responses uniform and avoid leaking internal details. |
| 524 | Request omits a body and sends an empty stream. | Fail cleanly with 400 instead of 500. |
| 525 | Request body is valid but missing username. | Reject with schema validation. |
| 526 | Request body is valid but missing email. | Reject with schema validation. |
| 527 | Request body is valid but missing password. | Reject with schema validation. |
| 528 | Request body is valid but missing display name. | Reject with schema validation. |
| 529 | Username includes unsupported Unicode punctuation lookalikes. | Reject usernames outside the allowed ASCII-safe set. |
| 530 | Username includes slashes to mimic path traversal probes. | Reject disallowed characters. |
| 531 | Username is shorter than the platform minimum. | Reject undersized usernames. |
| 532 | Username exceeds the platform maximum. | Reject oversized usernames. |
| 533 | Email exceeds the platform maximum length. | Reject oversized emails. |
| 534 | Display name exceeds the platform maximum length. | Reject oversized display names. |
| 535 | Phone exceeds the platform maximum length. | Reject oversized phone values. |
| 536 | Password exceeds the platform maximum length. | Reject oversized passwords before hashing. |
| 537 | Password contains only spaces. | Reject at validation rather than hashing meaningless secrets. |
| 538 | Password repeats one character class in a trivial pattern. | Reject when it fails diversity checks. |
| 539 | Database is unavailable during registration. | Return 503 and avoid partial account state. |
| 540 | Credentials auth is disabled in production. | Fail closed with 403. |
| 541 | Duplicate email exists with different casing. | Detect as duplicate. |
| 542 | Duplicate username exists with different casing. | Detect as duplicate. |
| 543 | Duplicate phone exists with different formatting. | Detect as duplicate. |
| 544 | User supplies both phone and honeypot field. | Treat as bot traffic and do not create an account. |
| 545 | Bot replays a honeypot-filled request expecting a different response shape. | Return a generic success response to avoid training the bot. |
| 546 | Password includes the first three letters of the display name and otherwise looks strong. | Reject identity-derived passwords. |
| 547 | Password includes the full username in mixed case. | Compare case-insensitively and reject. |
| 548 | Password includes the email local-part with separators removed. | Reject identity-derived passwords. |
| 549 | Signups arrive in bursts near the rate-limit boundary. | Apply consistent retry windows. |
| 550 | Upstream proxy omits `x-forwarded-for`. | Fall back to a stable `unknown` bucket without crashing. |
| 551 | User retries after a successful create but before the client sees the response. | Duplicate checks stop account duplication. |
| 552 | User submits with mixed-case email and later signs in lowercase. | Persist normalized email for stable lookup. |
| 553 | User submits with mixed-case username and later signs in lowercase. | Persist normalized username for stable lookup. |
| 554 | Malicious client probes whether phone is optional by sending garbage punctuation. | Normalize and reject unusable phone payloads. |
| 555 | Password reuses the organization or service name from the display name. | Reject identity-derived passwords when tokens are long enough. |
| 556 | Invalid email includes whitespace padding around a bad address. | Trim then validate address syntax. |
| 557 | Client sends arrays for scalar fields. | Reject with schema validation. |
| 558 | Client sends objects for scalar fields. | Reject with schema validation. |
| 559 | Bot alternates IPs but reuses the same honeypot behavior. | Honeypot still prevents account creation. |
| 560 | Two requests race to claim the same username. | Database-backed duplicate checks prevent stable duplicates. |
| 561 | Two requests race to claim the same email. | Database-backed duplicate checks prevent stable duplicates. |
| 562 | Two requests race to claim the same phone. | Database-backed duplicate checks prevent stable duplicates. |
| 563 | Signup body contains HTML in display name. | Store as plain text only after trimming; do not trust it as markup. |
| 564 | Signup body contains SQL-looking characters in username. | Reject disallowed username syntax and rely on parameterized queries. |
| 565 | Signup body contains emojis in username. | Reject unsupported username characters. |
| 566 | Signup body contains emojis in display name. | Accept only if the display-name contract allows it after trimming and size limits. |
| 567 | Signup body contains excessive internal spacing in display name. | Preserve human-readable content after trimming the edges. |
| 568 | Signup uses a local-part like `admin` with strong random suffix password. | Allow if it passes uniqueness and policy; do not overfit on names alone. |
| 569 | Signup uses a plus-address email variant. | Treat the full normalized email string as the account identifier. |
| 570 | Signup attempts to register the same email with a different plus tag. | Treat each full normalized email literally unless product policy says otherwise. |
| 571 | Signup request is replayed from browser back-forward cache. | Duplicate checks stop cloned identities. |
| 572 | Signup request arrives with a 10 MB JSON body. | Parser and schema should reject unsupported payloads without deep processing. |
| 573 | Client intentionally omits optional phone to avoid duplicate phone detection. | Accept if other identity fields are unique. |
| 574 | Client submits a display name matching an existing user. | Allow because display names are not uniqueness keys. |
| 575 | Client submits a username containing only dots and dashes. | Reject if it fails minimum/format policy after trimming. |
| 576 | Client sends Unicode whitespace around username. | Trim before validation. |
| 577 | Signup retries from mobile offline queue after account already exists. | Duplicate checks return deterministic 409s. |
| 578 | Signup request reaches the server after credentials auth was disabled. | Fail closed immediately. |
| 579 | Bot rotates user-agent strings to evade IP-only detection. | Honeypot and duplicate checks still apply. |
| 580 | Bot uses valid-looking human names with common weak passwords. | Reject weak passwords even when profile data looks plausible. |
| 581 | User enters the phone number with a leading plus sign and spaces. | Normalize to canonical numeric form. |
| 582 | User enters only punctuation in the phone field. | Collapse to null instead of storing garbage. |
| 583 | Bot submits a hidden website field with a single space. | Trim and ignore only if empty after trim; otherwise treat as suspicious. |
| 584 | Malformed client repeats the username field twice with conflicting values. | JSON parser keeps the final value; validation still applies to the resulting payload. |
| 585 | Client sends leading spaces inside email local-part. | Trim before validation and persistence. |
| 586 | Client sends trailing spaces inside email domain. | Trim before validation and persistence. |
| 587 | Password is long but fully predictable from display name and year. | Reject identity-derived passwords. |
| 588 | Client sends a newline in display name. | Trim edges and rely on size rules to avoid storage abuse. |
| 589 | Signup uses a username already taken by a deactivated account. | Preserve uniqueness unless an explicit reclaim policy exists. |
| 590 | Signup includes a phone number already bound to another auth provider. | Preserve uniqueness across credentials identities. |
| 591 | Signup occurs during partial database latency spikes. | Avoid partial writes; either create once or fail. |
| 592 | Signup attempts continue while Sentry is unavailable. | Registration should continue without telemetry dependency. |
| 593 | Client sends a number for `displayName`. | Reject with schema validation. |
| 594 | Client sends a boolean for `phone`. | Reject with schema validation. |
| 595 | Client sends a stringified object for `username`. | Validate literal string against username policy. |
| 596 | Client uses a username that matches a system route segment. | Treat usernames as data only; do not grant path semantics. |
| 597 | User registers successfully after previous invalid attempts. | Rate limiting should allow recovery once within budget. |
| 598 | Client probes different invalid bodies to infer Zod ordering. | Return first validation failure without exposing internals beyond the contract. |
| 599 | Client triggers unexpected DB errors after validation. | Return 500 and log server-side only. |
| 600 | Registration path is hammered during a wider auth outage. | Preserve fail-closed behavior and bounded resource usage. |

## Managed-Form Scenarios 601-700

| ID | Scenario | Expected control |
| --- | --- | --- |
| 601 | Caller creates a draft with attachments for a template that disables them. | Reject at create time instead of waiting for later edits. |
| 602 | Caller submits more attachments than the template maximum. | Reject at create or save time before persistence. |
| 603 | Caller uploads a disallowed MIME type in the manifest. | Reject before draft creation. |
| 604 | Caller routes to a specific reviewer user without specifying a role. | Reject ambiguous routing. |
| 605 | Caller routes to a recipient organization without specifying a role. | Reject ambiguous routing. |
| 606 | Caller sends a 60 KB JSON form payload as a draft. | Reject oversized payloads before persistence. |
| 607 | Caller sends a massive attachment manifest to exhaust parser memory. | Reject oversized manifests before persistence. |
| 608 | Caller omits org anchor for organization-scoped template. | Reject before draft creation. |
| 609 | Caller omits zone anchor for community-scoped template. | Reject before draft creation. |
| 610 | Caller uses an inactive coverage zone for a community-scoped template. | Reject with not-found semantics. |
| 611 | Caller tries to create a draft against a template outside visible audience. | Reject with template not found. |
| 612 | Caller uses a recipient organization outside their accessible org scope. | Reject access to recipient scope unless ORAN-admin. |
| 613 | Caller uses an owning organization outside their accessible org scope. | Reject access to org scope. |
| 614 | Caller sends malformed JSON in the create body. | Return 400 parse error. |
| 615 | Caller sends a non-UUID template id. | Reject with schema validation. |
| 616 | Caller sends a non-UUID organization id. | Reject with schema validation. |
| 617 | Caller sends a non-UUID coverage zone id. | Reject with schema validation. |
| 618 | Caller sends a non-UUID recipient organization id. | Reject with schema validation. |
| 619 | Caller sends a too-long title. | Reject with schema validation. |
| 620 | Caller sends a too-long note body. | Reject with schema validation. |
| 621 | Caller sends arrays nested deeply into `formData` to stress validation. | Enforce bounded payload size and field validation only on defined fields. |
| 622 | Caller sends formData for hidden fields only. | Preserve schema-based visibility rules during submit validation. |
| 623 | Caller creates an incomplete draft with required fields missing. | Allow draft creation but surface validation warnings if applicable. |
| 624 | Caller tries to bypass attachment policy by omitting MIME type. | Manifest validation should reject unsupported or malformed file entries when policy requires known MIME. |
| 625 | Caller supplies attachment metadata with unexpected extra keys. | Treat extra keys as opaque metadata only if the manifest remains structurally safe. |
| 626 | Caller uses title whitespace padding to create visually duplicated drafts. | Trim before persistence. |
| 627 | Caller uses notes whitespace padding to hide empty comments. | Trim before persistence and collapse empty notes to null. |
| 628 | Caller explicitly routes to the same default reviewer role the template already provides. | Allow and keep deterministic routing. |
| 629 | Caller overrides the template default role with another valid role. | Accept only if the role is declared in the contract. |
| 630 | Caller attempts draft creation without authentication. | Reject with 401. |
| 631 | Caller attempts draft creation below `host_member`. | Reject with 403. |
| 632 | Caller hits the write route above rate limit. | Reject with 429 and retry guidance. |
| 633 | Database is unavailable during draft creation. | Return 503 and do not create a partial draft. |
| 634 | Template is unpublished and caller is not ORAN-admin. | Hide it as not found. |
| 635 | ORAN-admin creates from an unpublished template for staging. | Allow when explicitly permitted. |
| 636 | Caller chooses a valid recipient role but leaves user and org unset. | Fall back to role-based routing only. |
| 637 | Caller chooses a recipient user and matching role. | Allow deterministic direct assignment. |
| 638 | Caller chooses a recipient org and matching role. | Allow deterministic org-targeted routing. |
| 639 | Caller chooses both recipient user and recipient org. | Preserve explicit routing only if policy allows both; otherwise tighten later. |
| 640 | Caller replays the same create request after a client timeout. | Avoid malformed duplicates via future idempotency or duplicate-draft policy. |
| 641 | Caller creates drafts rapidly to flood reviewer queues. | Rate limiting contains edge abuse; queue logic remains submission-backed. |
| 642 | Caller uses a community template with an org anchor instead of a zone anchor. | Reject because the storage scope contract is authoritative. |
| 643 | Caller uses an org template with a zone anchor only. | Reject because the org anchor is still required. |
| 644 | Caller creates a draft with a recipient role outside the enum. | Reject with schema validation. |
| 645 | Caller sends `null` formData. | Reject because formData must be an object. |
| 646 | Caller sends `null` attachmentManifest. | Reject because the manifest must be an array. |
| 647 | Caller sends attachment manifest entries as strings. | Treat as malformed and reject when policy checks fail. |
| 648 | Caller uses a template with `attachmentsEnabled=true` but no allowed MIME list. | Fall back to the template defaults safely. |
| 649 | Caller uses a template with a very small `maxAttachments`. | Respect the template-specific cap. |
| 650 | Caller creates a draft with 1,000 sparse fields. | Reject once payload size exceeds the bounded contract. |
| 651 | Caller attempts to create drafts against templates they can no longer access. | Reject using current audience visibility, not stale client state. |
| 652 | Caller tampers with recipient org to point at another tenant. | Block via org access guard. |
| 653 | Caller tampers with owner org to point at another tenant. | Block via org access guard. |
| 654 | Caller submits a PDF manifest entry with image MIME type to trick downstream UI. | Rely on trusted upload pipeline later; keep manifest MIME allow-list strict. |
| 655 | Caller stores draft data with high-entropy junk to bloat the database. | Enforce payload caps at the route edge. |
| 656 | Caller stores notes with repeated whitespace and newlines only. | Trim and collapse empty notes. |
| 657 | Caller stores title with repeated whitespace only. | Normalize to empty and fall back to template title when persisted. |
| 658 | Caller creates a community-scoped draft while the coverage zone is soft-deactivated mid-request. | Reject once the active-zone lookup fails. |
| 659 | Caller tries to submit routing data shaped like SQL fragments. | Keep parameterized persistence and enum validation. |
| 660 | Caller uses a valid role but a blank recipient user id. | Reject at schema validation. |
| 661 | Caller uses a valid role but a recipient user id longer than the contract. | Reject at schema validation. |
| 662 | Caller tries to create against a template missing schema fields. | Allow draft creation if the template itself is valid and field derivation resolves safely. |
| 663 | Caller targets a recipient org while operating as ORAN-admin across tenants. | Allow only when authorized by role. |
| 664 | Caller creates draft while telemetry capture fails. | Continue without making Sentry a dependency. |
| 665 | Caller creates draft with unknown top-level body keys. | Ignore unsupported keys and validate the canonical contract only. |
| 666 | Caller uses malformed UTF-8 inside JSON strings. | Let parsing fail with 400 instead of persisting corruption. |
| 667 | Caller attempts to create drafts in bulk from automation. | Edge rate limits should slow abuse and protect queue capacity. |
| 668 | Caller creates a draft with attachment count exactly equal to max. | Allow boundary-valid requests. |
| 669 | Caller creates a draft with attachment count one above max. | Reject boundary-invalid requests. |
| 670 | Caller uses a disallowed office-document MIME type on an image-only template. | Reject at create time. |
| 671 | Caller uses a valid allowed MIME type with extra metadata. | Allow if size and MIME policy still pass. |
| 672 | Caller tries to use an unpublished template id from stale UI cache. | Reject as not found unless ORAN-admin override applies. |
| 673 | Caller uses a shared template but supplies an inaccessible org anchor. | Reject org access even when audience is shared. |
| 674 | Caller uses organization scope with a valid org but invalid recipient org. | Reject recipient scope independently. |
| 675 | Caller passes a primitive string for `formData.summary` where the field is text. | Allow if the schema field type supports it. |
| 676 | Caller passes an object for a text field. | Surface validation warnings for draft and hard-fail on submit. |
| 677 | Caller creates a draft with required fields missing and expects immediate submit. | Draft may exist, but submit must still fail until fields validate. |
| 678 | Caller creates a draft with attachment manifest exceeding both count and size. | Reject at the first deterministic contract failure. |
| 679 | Caller submits a routing override intended to bypass template default role. | Allow only if the override is valid and authorized by contract. |
| 680 | Caller creates a draft with a large but valid note under the limit. | Allow boundary-valid notes. |
| 681 | Caller creates a draft with a large but valid title under the limit. | Allow boundary-valid titles. |
| 682 | Caller sends `recipientRole=null` and `recipientUserId` set. | Reject ambiguous routing. |
| 683 | Caller sends `recipientRole=null` and `recipientOrganizationId` set. | Reject ambiguous routing. |
| 684 | Caller sends both recipient overrides as null. | Allow template defaults to resolve. |
| 685 | Caller creates draft from a template whose routing enables attachments but MIME list is empty. | Treat attachment policy conservatively and allow only if the template explicitly intends that open set. |
| 686 | Caller retries after a 400 attachment-policy error. | Do not create a draft until the manifest is corrected. |
| 687 | Caller retries after a 400 oversized-payload error. | Do not create a draft until payload size is corrected. |
| 688 | Caller attempts to enumerate active coverage zones via draft creation errors. | Return minimal inactive-or-not-found messaging. |
| 689 | Caller creates a draft with stale org membership after access was revoked. | Enforce current auth context and org access. |
| 690 | Caller creates a draft with stale community reviewer assumptions. | Use current template routing, not client assumptions. |
| 691 | Caller opens many browser tabs and launches the same template repeatedly. | Allow draft creation today but treat idempotency/dedupe as a future hardening lane. |
| 692 | Caller creates a draft and immediately loses connectivity before response read. | Server-side validation and persistence must remain atomic. |
| 693 | Caller tries to bypass audience limits by editing the template id client-side. | Template visibility lookup remains authoritative. |
| 694 | Caller stores attachment manifests with external URLs from untrusted domains. | Treat the manifest as metadata only; upload or retrieval trust must be enforced elsewhere. |
| 695 | Caller stores embedded HTML in notes. | Persist as data only and leave rendering layers to escape it. |
| 696 | Caller stores embedded HTML in title. | Persist as data only and leave rendering layers to escape it. |
| 697 | Caller attempts create during database latency spike. | Use one transactional write path and fail atomically. |
| 698 | Caller attempts create when Sentry capture throws. | Do not fail business logic because telemetry failed. |
| 699 | Caller uses a valid template but malformed role casing like `Community_Admin`. | Reject because enum values are exact. |
| 700 | Caller floods the create route with mixed valid and invalid bodies. | Keep bounded parsing, rate limits, and contract validation at the edge. |
