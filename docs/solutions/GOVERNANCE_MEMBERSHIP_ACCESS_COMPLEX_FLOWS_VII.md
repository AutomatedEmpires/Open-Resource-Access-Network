# Governance, Membership, And Access Complex Flows VII

This matrix adds 200 additional complex governance and admin-operation flows. It is intentionally explicit about current repo state so the document can drive planning without overstating implementation.

State labels:

- `implemented`: code-backed flow exists today
- `partial`: some guardrails exist, but there is no complete first-class workflow
- `gap`: not implemented as a first-class ORAN flow today

## Identity Enforcement And User Suspension 701-725

1. `701` Global ban of a seeker account after confirmed harassment report. Desired control: platform-wide user suspension with appeal and audit trail. State: `gap`.
2. `702` Suspend a host_member across every organization they belong to after abuse finding. Desired control: cross-org suspension with scoped rollback. State: `gap`.
3. `703` Freeze an oran_admin account immediately during suspected compromise. Desired control: emergency admin lockout with dual control. State: `gap`.
4. `704` Put a user into read-only mode while investigation is open. Desired control: temporary restricted mode instead of full deletion. State: `gap`.
5. `705` Ban a user but preserve their historical submissions for audit. Desired control: access revocation without audit loss. State: `gap`.
6. `706` Ban only one org membership while keeping the same user active elsewhere. Desired control: membership-scoped suspension. State: `partial`.
7. `707` Re-enable an account after wrongful suspension. Desired control: reversible suspension with approver trace. State: `gap`.
8. `708` Suspend a community_admin from verification while preserving dashboard read access for review. Desired control: duty suspension with least privilege fallback. State: `gap`.
9. `709` Force sign-out of all sessions for a compromised account. Desired control: token/session revocation. State: `gap`.
10. `710` Prevent a suspended user from being re-invited into an organization. Desired control: suspension-aware invite checks. State: `gap`.
11. `711` Mark a user as under fraud review and block new host claims. Desired control: investigation hold on sensitive flows. State: `gap`.
12. `712` Ban a user because they are automating signup attempts. Desired control: account flagging plus registration abuse intelligence. State: `gap`.
13. `713` Ban a dormant compromised account without deleting profile data. Desired control: non-destructive access revocation. State: `gap`.
14. `714` Suspend a user from notifications but not from core access. Desired control: channel-scoped controls. State: `gap`.
15. `715` Freeze a user after repeated failed reviewer actions in conflicting jurisdictions. Desired control: anomaly-triggered risk hold. State: `gap`.
16. `716` Move a user from `oran_admin` down to `community_admin` after role reduction. Desired control: privileged-role demotion workflow. State: `gap`.
17. `717` Prevent a deactivated user from retaining active org roles. Desired control: membership deactivation on account closure. State: `implemented`.
18. `718` Notify all affected org owners when a shared admin account is suspended. Desired control: dependency-aware communications. State: `gap`.
19. `719` Block a user from submitting new managed forms while leaving existing drafts visible. Desired control: submission-creation freeze. State: `gap`.
20. `720` Lock a user out of host surfaces but leave seeker access intact. Desired control: surface-specific access withdrawal. State: `gap`.
21. `721` Pause a user while waiting for identity verification evidence. Desired control: temporary trust state. State: `gap`.
22. `722` Deactivate a user and automatically reassign their active verification work. Desired control: deactivation-driven work handoff. State: `partial`.
23. `723` Require two ORAN admins to suspend another ORAN admin. Desired control: peer-level dual control for high-risk access changes. State: `gap`.
24. `724` Restore access after a security incident only if required controls are re-met. Desired control: gated reinstatement checklist. State: `gap`.
25. `725` Ban a user from ORAN while preserving export/delete privacy rights. Desired control: suspension-aware privacy workflow. State: `gap`.

## Organization Membership And Admin Lifecycle 726-750

1. `726` Remove a host_member from an organization. Desired control: scoped soft-delete. State: `implemented`.
2. `727` Remove a host_admin from an organization only when another active host_admin remains. Desired control: last-admin guard. State: `implemented`.
3. `728` Demote a host_admin to host_member with protection against orphaning the org. Desired control: safe demotion. State: `implemented`.
4. `729` Restore a previously deactivated membership without creating a duplicate row. Desired control: reactivation path. State: `partial`.
5. `730` Transfer primary operational ownership from one host_admin to another. Desired control: explicit owner handoff flow. State: `gap`.
6. `731` Remove a pending invite before the user accepts it. Desired control: invite cancellation. State: `partial`.
7. `732` Prevent self-removal of the last host_admin through the UI and API. Desired control: self-lockout guard. State: `implemented`.
8. `733` Let ORAN revoke all memberships for an organization under fraud investigation. Desired control: org-wide membership quarantine. State: `gap`.
9. `734` Detect when an org has only dormant admins left. Desired control: owner dormancy detection. State: `implemented`.
10. `735` Notify backup operators when an org loses its last active admin. Desired control: continuity alerting. State: `partial`.
11. `736` Allow an org to rotate staff after layoffs without risking listing control loss. Desired control: safe membership churn workflow. State: `partial`.
12. `737` Merge duplicate memberships for the same user and org. Desired control: dedupe membership records. State: `partial`.
13. `738` Prevent invitation of a user who already has active membership in the org. Desired control: duplicate invite suppression. State: `implemented`.
14. `739` Let ORAN inspect member history for a disputed removal. Desired control: membership audit timeline. State: `partial`.
15. `740` Bulk remove many volunteers at once after a program ends. Desired control: batch membership offboarding. State: `gap`.
16. `741` Add a member with a future activation date. Desired control: scheduled activation. State: `gap`.
17. `742` Time-box temporary host_admin elevation for a contractor. Desired control: expiring org role grant. State: `gap`.
18. `743` Prevent role changes while the organization itself is under governance hold. Desired control: org-level mutation freeze. State: `gap`.
19. `744` Recover an org after an accidental last-admin removal through direct DB edits. Desired control: supported recovery procedure. State: `partial`.
20. `745` Show each org exactly who can edit which listings. Desired control: listing-to-member responsibility view. State: `gap`.
21. `746` Allow an org to define service-line coordinators without full host_admin power. Desired control: fine-grained org roles. State: `gap`.
22. `747` Let a user decline one org invite without affecting others. Desired control: invite-scoped response. State: `implemented`.
23. `748` Auto-deactivate memberships when a user deletes their ORAN account. Desired control: privacy-safe membership cleanup. State: `implemented`.
24. `749` Require justification when removing another admin. Desired control: accountable admin removal. State: `gap`.
25. `750` Notify listing reviewers when a key org admin leaves. Desired control: reviewer continuity signaling. State: `gap`.

## Scope Grants And Delegated Abilities 751-775

1. `751` Request a temporary scope grant for a user. Desired control: scope request API. State: `implemented`.
2. `752` Approve a pending scope grant with a different user than the requester. Desired control: two-person decision. State: `implemented`.
3. `753` Deny a scope grant with reason. Desired control: explicit denial path. State: `implemented`.
4. `754` Revoke an active scope grant with reason. Desired control: explicit revoke path. State: `implemented`.
5. `755` Prevent a requester from approving their own grant. Desired control: separation of duties. State: `implemented`.
6. `756` Expire a temporary grant automatically after its window. Desired control: grant TTL enforcement. State: `partial`.
7. `757` Show a user all active direct and role-based scopes. Desired control: self-visibility into access. State: `implemented`.
8. `758` Request multiple scoped abilities for one incident. Desired control: bundle request workflow. State: `gap`.
9. `759` Restrict a grant to a single organization. Desired control: org-bounded scope grant. State: `implemented`.
10. `760` Restrict a grant to a geographic review area. Desired control: zone-bounded delegated ability. State: `partial`.
11. `761` Require approver justification distinct from requester justification. Desired control: dual rationale audit. State: `partial`.
12. `762` Pause a grant temporarily without revoking it. Desired control: suspended grant state. State: `gap`.
13. `763` Detect duplicated grant requests for the same user and scope. Desired control: duplicate request suppression. State: `implemented`.
14. `764` Reissue an expired grant from history without retyping justification. Desired control: renewal workflow. State: `gap`.
15. `765` Prevent grant creation when the target user is deactivated or suspended. Desired control: subject-state validation. State: `gap`.
16. `766` Require dual approval for especially risky scopes. Desired control: risk-tiered approval depth. State: `gap`.
17. `767` Provide a dry-run view of what a requested scope would allow. Desired control: impact preview. State: `gap`.
18. `768` Let ORAN grant emergency read-only audit access during incidents. Desired control: emergency access workflow. State: `partial`.
19. `769` Revoke all delegated abilities during a security incident. Desired control: bulk revoke. State: `gap`.
20. `770` Display grants sorted by expiry and risk. Desired control: operational grant dashboard. State: `gap`.
21. `771` Require peer review before granting cross-region moderation power. Desired control: high-risk grant governance. State: `gap`.
22. `772` Allow a grant request to specify on-call coverage hours only. Desired control: time-windowed operational scope. State: `gap`.
23. `773` Auto-notify resource owners when a high-risk scope is granted on their records. Desired control: stakeholder awareness. State: `gap`.
24. `774` Preserve revoked-grant audit history without letting it reactivate silently. Desired control: explicit regrant semantics. State: `partial`.
25. `775` Show exactly why a user has a given ability. Desired control: explainable access lineage. State: `implemented`.

## Reviewer Leave, Silence, And Return-To-Duty 776-800

1. `776` Detect a reviewer who has gone silent with stalled assignments. Desired control: workforce health detection. State: `implemented`.
2. `777` Reassign stalled work away from a silent reviewer automatically. Desired control: automated reassignment. State: `implemented`.
3. `778` Alert ORAN when a whole owner organization goes silent. Desired control: continuity alerting. State: `implemented`.
4. `779` Put silent-owner live listings on integrity hold. Desired control: continuity hold. State: `implemented`.
5. `780` Let a reviewer schedule a planned two-month leave. Desired control: planned unavailability workflow. State: `gap`.
6. `781` Drain a reviewer’s queue before leave starts. Desired control: pre-leave workload redistribution. State: `gap`.
7. `782` Prevent new assignments during declared leave. Desired control: leave-aware routing. State: `gap`.
8. `783` Notify affected jurisdictions when a reviewer becomes unavailable. Desired control: area continuity signaling. State: `gap`.
9. `784` Let ORAN set a reviewer as backup-only during recovery. Desired control: reduced-capacity mode. State: `gap`.
10. `785` Require a returning reviewer to acknowledge policy changes before new assignments. Desired control: return-to-duty attestation. State: `gap`.
11. `786` Require a returning reviewer to prove account security posture before resuming work. Desired control: security revalidation. State: `gap`.
12. `787` Restore previously paused coverage scope after leave ends. Desired control: scope resume workflow. State: `gap`.
13. `788` Keep a returning reviewer from reclaiming stale assignments automatically. Desired control: controlled re-entry. State: `gap`.
14. `789` Reopen an integrity-held owner org only after verified owner continuity. Desired control: explicit continuity restore. State: `partial`.
15. `790` Escalate to ORAN when no community reviewer is left in a region. Desired control: fallback routing. State: `partial`.
16. `791` Let a reviewer pause only intake but keep read-only analytics access. Desired control: split-duty availability. State: `gap`.
17. `792` Mark a reviewer as inactive if they stop responding for a threshold. Desired control: dormancy state. State: `partial`.
18. `793` Show operators who was auto-reassigned because of silence. Desired control: intervention visibility. State: `implemented`.
19. `794` Audit whether reassignment happened before SLA breach or after. Desired control: timing visibility. State: `partial`.
20. `795` Let ORAN manually override a silence-based reassignment. Desired control: manual continuity override. State: `partial`.
21. `796` Distinguish vacation from compromise or abandonment. Desired control: explicit unavailable reason. State: `gap`.
22. `797` Preserve accountability notes when work is reassigned. Desired control: assignment provenance. State: `partial`.
23. `798` Require a supervisor to approve leave for high-volume reviewers. Desired control: reviewer leave governance. State: `gap`.
24. `799` Notify hosts when their review contact changes because of staff absence. Desired control: stakeholder awareness. State: `gap`.
25. `800` Rebalance reviewer capacity after several staff return at once. Desired control: capacity re-entry orchestration. State: `gap`.

## Multi-Listing And Regional Organization Operations 801-825

1. `801` Let an org manage many listings under one ownership umbrella. Desired control: org-scoped listing management. State: `implemented`.
2. `802` Limit org edits to only its own services and locations. Desired control: own-org authorization. State: `implemented`.
3. `803` Show a host admin all listings tied to their org. Desired control: org listing visibility. State: `implemented`.
4. `804` Bulk update many listings for one org through a controlled workflow. Desired control: bulk update pipeline. State: `partial`.
5. `805` Coordinate multi-location listing updates across a metro area. Desired control: grouped submission workflow. State: `partial`.
6. `806` Delegate one regional service cluster to one staff member. Desired control: listing-cluster delegation. State: `gap`.
7. `807` Restrict one admin to only a subset of an org’s listings. Desired control: sub-org listing permissions. State: `gap`.
8. `808` Transfer all listings from one org to another after merger. Desired control: verified ownership transfer. State: `partial`.
9. `809` Freeze one org’s listings without deleting the org. Desired control: org-level publication hold. State: `gap`.
10. `810` Put only selected listings on hold while others stay visible. Desired control: listing-level integrity controls. State: `partial`.
11. `811` Let a host admin control listings across several counties. Desired control: multi-area org operations. State: `implemented`.
12. `812` Prevent one org from claiming listings already controlled elsewhere. Desired control: ownership conflict review. State: `partial`.
13. `813` Show which listings are nearing reverification by area. Desired control: org operations dashboard. State: `partial`.
14. `814` Allow one org to nominate another internal reviewer for a large area. Desired control: internal delegation workflow. State: `gap`.
15. `815` Track which staff member last changed each listing. Desired control: listing change audit. State: `partial`.
16. `816` Pause all listings for an org during emergency closure but preserve recovery path. Desired control: org emergency pause. State: `gap`.
17. `817` Reopen listings gradually after a disaster recovery phase. Desired control: phased org resume. State: `gap`.
18. `818` Mark some listings as seasonal while others remain year-round. Desired control: listing-level temporal governance. State: `implemented`.
19. `819` Let ORAN inspect listing coverage gaps for a large org footprint. Desired control: coverage reporting. State: `partial`.
20. `820` Keep listing controls available when one host admin is dormant but another remains active. Desired control: continuity with redundant admins. State: `implemented`.
21. `821` Take integrity action only when every host admin for an org is silent. Desired control: fully-silent-owner logic. State: `implemented`.
22. `822` Give orgs a map of operational ownership across all listings. Desired control: listing stewardship map. State: `gap`.
23. `823` Support large agencies with hundreds of listings and separate regional managers. Desired control: multi-tier org RBAC. State: `gap`.
24. `824` Let ORAN cap how many new listings one org can launch at once. Desired control: org-level throughput control. State: `partial`.
25. `825` Require additional scrutiny when one org modifies a high volume of listings rapidly. Desired control: anomaly-triggered review. State: `gap`.

## Listing Removal, Suppression, And Agency Requests 826-850

1. `826` Agency asks ORAN to remove one listing entirely. Desired control: first-class agency removal intake. State: `gap`.
2. `827` Agency asks ORAN to remove a listing temporarily during renovation. Desired control: temporary suppression workflow. State: `gap`.
3. `828` Provider reports a listing is wrong but not malicious. Desired control: structured correction request. State: `partial`.
4. `829` Community member reports suspected fraud. Desired control: high-priority report intake. State: `implemented`.
5. `830` Host asks to withdraw its own pending update. Desired control: withdraw before terminal review. State: `implemented`.
6. `831` ORAN removes a listing because evidence expired and owner continuity failed. Desired control: integrity hold and removal path. State: `partial`.
7. `832` Agency asks to remove all listings for one closed program. Desired control: bulk removal workflow. State: `gap`.
8. `833` Remove a listing but preserve a non-public tombstone for audit. Desired control: archival remove semantics. State: `partial`.
9. `834` Distinguish “temporarily unavailable” from “permanently closed.” Desired control: temporal closure governance. State: `partial`.
10. `835` Remove a listing because it violates ORAN participation policy. Desired control: policy enforcement workflow. State: `gap`.
11. `836` Let a community reviewer recommend removal but require ORAN approval. Desired control: multi-step removal governance. State: `gap`.
12. `837` Let an agency upload documentary evidence for removal. Desired control: evidence-backed removal intake. State: `gap`.
13. `838` Prevent removed listings from reappearing via stale ingestion feed. Desired control: suppression memory. State: `partial`.
14. `839` Allow a removed listing to be reintroduced only after explicit re-verification. Desired control: controlled reinstatement. State: `gap`.
15. `840` Agency requests removal because the service moved. Desired control: relocation workflow, not blind delete. State: `gap`.
16. `841` ORAN removes a listing but keeps org membership intact. Desired control: listing-only governance action. State: `partial`.
17. `842` Host disputes a removal decision and appeals it. Desired control: appeal path for removal outcomes. State: `partial`.
18. `843` Remove a listing from seeker search while leaving it in host workspace. Desired control: publication-only suppression. State: `partial`.
19. `844` Hide a listing while investigation is pending. Desired control: investigation hold. State: `partial`.
20. `845` Accept a listing-removal report from a public user without allowing policy abuse. Desired control: authenticated or anonymous report intake with validation. State: `implemented`.
21. `846` Escalate urgent removal requests from government agencies. Desired control: priority routing. State: `gap`.
22. `847` Keep a full audit of who requested and approved a removal. Desired control: removal audit trail. State: `partial`.
23. `848` Allow ORAN to restore an accidentally removed listing from prior state. Desired control: reversible removal workflow. State: `gap`.
24. `849` Prevent soft-removed listings from being embedded or reindexed. Desired control: publication and embedding suppression. State: `partial`.
25. `850` Let an org request to delist itself from ORAN while preserving historical records. Desired control: org offboarding flow. State: `gap`.

## ORAN Participation And Organization Signup 851-875

1. `851` New agency wants to join ORAN as a provider organization. Desired control: first-class ORAN organization onboarding. State: `partial`.
2. `852` Individual user signs up and later claims an organization. Desired control: seeker-to-host progression. State: `implemented`.
3. `853` Provider creates an org shell and becomes its first host_admin. Desired control: authenticated org create path. State: `implemented`.
4. `854` Provider submits a formal organization claim for an existing listing. Desired control: claim workflow. State: `implemented`.
5. `855` ORAN reviews and approves an org claim into host_admin membership. Desired control: claim approval flow. State: `implemented`.
6. `856` Agency wants a guided “apply to join ORAN” surface separate from raw org creation. Desired control: structured onboarding intake. State: `gap`.
7. `857` Provider wants to register multiple related agencies together. Desired control: multi-org onboarding packet. State: `gap`.
8. `858` Agency wants to onboard but cannot yet prove legal ownership. Desired control: provisional onboarding state. State: `gap`.
9. `859` ORAN wants to pause onboarding for one high-risk sector. Desired control: sector-specific intake hold. State: `gap`.
10. `860` Agency onboarding should collect coverage area and languages before approval. Desired control: structured participation intake. State: `gap`.
11. `861` Provider wants to invite colleagues during onboarding. Desired control: staged member onboarding. State: `partial`.
12. `862` Organization signup should warn that admin roles are not self-service. Desired control: truthful auth UX. State: `implemented`.
13. `863` Agency wants ORAN to migrate many existing listings into its control. Desired control: bulk claim onboarding. State: `gap`.
14. `864` Onboarding should include policy attestation. Desired control: participation acceptance workflow. State: `gap`.
15. `865` Onboarding should include security-contact capture for incidents. Desired control: operational contact collection. State: `gap`.
16. `866` ORAN should reject onboarding when the applicant duplicates an already active org. Desired control: duplicate-org review. State: `partial`.
17. `867` Agency wants to onboard with multiple service sites in different counties. Desired control: multi-site onboarding. State: `partial`.
18. `868` ORAN should request more evidence instead of denying outright. Desired control: return-for-more-information path. State: `partial`.
19. `869` Provider wants to start with one listing then expand after approval. Desired control: staged participation growth. State: `implemented`.
20. `870` Agency wants to onboard through a managed form instead of a claim. Desired control: dedicated onboarding form template. State: `gap`.
21. `871` ORAN should differentiate community-based groups from official agencies during onboarding. Desired control: applicant-type branching. State: `gap`.
22. `872` Onboarding should verify that the requestor can administer all submitted listings. Desired control: authority validation. State: `partial`.
23. `873` Provider wants to abandon onboarding midway and return later. Desired control: resumable onboarding draft. State: `partial`.
24. `874` ORAN wants to measure onboarding conversion and drop-off. Desired control: onboarding analytics. State: `gap`.
25. `875` Agency wants a published checklist of what ORAN requires before signup approval. Desired control: participation readiness guidance. State: `gap`.

## MFA, 2SV, And Security Posture 876-900

1. `876` Ask whether 2SV is available for ORAN admin accounts. Desired control: documented MFA support. State: `gap`.
2. `877` Require MFA for every `oran_admin`. Desired control: mandatory admin MFA enforcement. State: `gap`.
3. `878` Require MFA for every `community_admin`. Desired control: mandatory reviewer MFA. State: `gap`.
4. `879` Require MFA for every `host_admin`. Desired control: mandatory org-admin MFA. State: `gap`.
5. `880` Let seekers opt into MFA voluntarily. Desired control: optional account MFA. State: `gap`.
6. `881` Block privileged sign-in when MFA is not enrolled. Desired control: step-up auth gate. State: `gap`.
7. `882` Record who last passed MFA and when. Desired control: MFA audit trail. State: `gap`.
8. `883` Require MFA again before high-risk actions like removing admins. Desired control: action-level step-up auth. State: `gap`.
9. `884` Allow backup codes for locked-out admins. Desired control: recovery codes. State: `gap`.
10. `885` Allow ORAN to reset MFA only under dual control. Desired control: governed MFA reset. State: `gap`.
11. `886` Show host admins whether MFA is enabled for their team. Desired control: org security dashboard. State: `gap`.
12. `887` Prevent role promotion if MFA is missing. Desired control: privilege-gating by security posture. State: `gap`.
13. `888` Enforce stronger sign-in rules for accounts with scope grants. Desired control: grant-aware auth hardening. State: `gap`.
14. `889` Re-check MFA after long inactivity before resuming reviewer work. Desired control: return-to-duty step-up auth. State: `gap`.
15. `890` Require phishing-resistant MFA for ORAN platform governors. Desired control: high-assurance auth. State: `gap`.
16. `891` Track which auth providers can satisfy admin MFA requirements. Desired control: provider capability matrix. State: `gap`.
17. `892` Require MFA before revoking another admin’s access. Desired control: high-risk destructive action protection. State: `gap`.
18. `893` Force password reset plus MFA enrollment after compromise. Desired control: post-incident recovery path. State: `gap`.
19. `894` Let ORAN monitor MFA enrollment coverage across admin roles. Desired control: security coverage reporting. State: `gap`.
20. `895` Prevent a banned or suspended user from using stale remembered MFA state. Desired control: revocation-aware MFA session invalidation. State: `gap`.
21. `896` Support multiple MFA methods for accessibility needs. Desired control: flexible MFA enrollment. State: `gap`.
22. `897` Require MFA proof before restoring an account from suspension. Desired control: secure reinstatement. State: `gap`.
23. `898` Make MFA status visible in incident response tooling. Desired control: auth posture visibility. State: `gap`.
24. `899` Escalate if an ORAN admin account remains privileged without MFA after deadline. Desired control: overdue MFA enforcement. State: `gap`.
25. `900` Document whether ORAN today supports, encourages, or requires MFA by role. Desired control: truthful security contract. State: `gap`.
