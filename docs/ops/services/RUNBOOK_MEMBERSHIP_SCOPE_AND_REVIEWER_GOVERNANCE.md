# Runbook: Membership, Scope, And Reviewer Governance

## Metadata

- Runbook ID: `RUNBOOK_MEMBERSHIP_SCOPE_AND_REVIEWER_GOVERNANCE`
- Owner role: Governance Operations Lead
- Reviewers: Platform Security Lead, ORAN Operations Lead
- Last reviewed (UTC): 2026-03-16
- Next review due (UTC): 2026-06-16
- Severity scope: `SEV-2 | SEV-3 | SEV-4`

## Purpose And Scope

This runbook explains the governance and access-control operations that are actually implemented in ORAN today for host membership changes, scope grants, org-claim promotion, and reviewer silence handling. It also records the important gaps so operators do not assume first-class controls exist when they currently do not.

## Safety Constraints (Must Always Hold)

- No self-service registration may mint `host_admin`, `community_admin`, or `oran_admin` access.
- Host membership changes must not strand an organization without an active `host_admin`.
- Scope grants must preserve two-person separation between requester and approver.
- Silence handling must preserve seeker-visible integrity by reassigning dormant reviewer work and restricting silently orphaned live listings.

## Code-Backed Operations Available Today

### 1. Host member invite, role update, and removal

Implemented today:

- list organization members
- invite `host_member` or `host_admin`
- accept or decline invitations
- update member role between `host_member` and `host_admin`
- soft-delete a member by setting `status = 'deactivated'`
- block demotion or removal of the last active `host_admin`

Primary implementation:

- `src/app/api/host/admins/route.ts`
- `src/app/api/host/admins/[id]/route.ts`
- `src/app/api/host/admins/invites/route.ts`

### 2. Org-claim approval to host-admin promotion

Implemented today:

- ORAN-admin approval of an org claim inserts or reactivates `organization_members`
- the claimant is promoted to `host_admin` for that org
- lower existing roles are promoted up to `host_admin` where appropriate

Primary implementation:

- `src/app/api/admin/approvals/route.ts`

### 3. Scope grant request, decision, and revocation

Implemented today:

- ORAN-admin can request scope grants
- pending grants are listed excluding the requester’s own decisions
- approve or deny uses the two-person approval service
- revoke uses explicit revoke flow with reason

Primary implementation:

- `src/app/api/admin/scopes/grants/route.ts`
- `src/app/api/admin/scopes/grants/[id]/route.ts`
- `src/services/workflow/two-person.ts`

### 4. Silence and dormancy handling for reviewers and owner organizations

Implemented today:

- silent reviewers with stalled assignments are surfaced in ingestion operations
- the internal SLA job reassigns stalled reviewer work from silent reviewers
- silent owner organizations with active live listings trigger continuity alerts
- active services for silently orphaned owners can be placed on integrity hold

Primary implementation:

- `src/services/ingestion/workforceHealth.ts`
- `src/services/escalation/engine.ts`
- `src/app/api/admin/ingestion/overview/route.ts`

### 5. Membership deactivation during user data deletion

Implemented today:

- account deletion deactivates organization memberships rather than silently leaving active org access behind

Primary implementation:

- `src/app/api/user/data-delete/route.ts`

## Current Unsupported Or Partial Gaps

These are not first-class platform controls today:

- global user ban or suspension workflow across ORAN
- first-class organization suspension or platform-wide org removal workflow with staged approvals
- planned reviewer leave scheduling such as “pause me for two months and resume safely later”
- return-to-duty re-attestation flow for dormant reviewers or admins
- required MFA / 2SV for admin or host profiles
- agency-submitted listing removal request workflow as a dedicated product surface
- first-class “apply to join ORAN as an agency” onboarding workflow beyond org claim or self-created org records

Treat these as backlog items, not hidden features.

## Diagnosis Steps

1. For host-member removal or demotion failures, inspect whether the target is the last active `host_admin`.
2. For scope-grant disputes, confirm whether the requester and decider are the same person before assuming a service bug.
3. For reviewer dormancy concerns, inspect the ingestion overview and escalation output before manual reassignment.
4. For silent-owner continuity incidents, confirm whether services are already on integrity hold before making them seeker-visible again.

## Mitigation Guidance

1. Use the existing host-admin APIs for team offboarding; do not directly mutate `organization_members` unless recovering from a broken migration or incident.
2. Use the scope-grant APIs for delegated abilities; do not bypass the two-person flow for convenience.
3. If a reviewer is inactive unexpectedly, rely on SLA reassignment and ORAN-admin coverage rather than leaving assignments parked.
4. If an owner org becomes dormant, preserve seeker safety by keeping integrity holds until human ownership continuity is re-established.

## Validation Commands

Host team-management and scope-grant validation should use the existing focused route suites plus repository typecheck.

Suggested checks:

```bash
npx tsc --noEmit
```

If changing host-admin or scope-grant behavior, run the corresponding focused Vitest suites in that area before merge.

## References

- `docs/governance/ROLES_PERMISSIONS.md`
- `docs/contracts/AUTHZ_CONTRACT.md`
- `docs/DECISIONS/ADR-0011-ingestion-integrity-and-resilience-controls.md`
- `src/app/api/host/admins/route.ts`
- `src/app/api/host/admins/[id]/route.ts`
- `src/app/api/admin/scopes/grants/route.ts`
- `src/app/api/admin/scopes/grants/[id]/route.ts`
- `src/services/escalation/engine.ts`
