# Runbook: Disaster Recovery, Backup, And Restore Validation

## Metadata

- Owner role: Data Platform Lead
- Reviewers: Platform On-Call Lead, Release Manager
- Operational status: active
- Last reviewed (UTC): 2026-07-29
- Next review due (UTC): 2026-08-12
- Severity scope: SEV-1 to SEV-2
- Restore validation: not executed; RTO and RPO are unmeasured
- Pre-launch blocker owner: Data Platform Lead
- Release gate owner: Release Manager

## Current Readiness Decision

This runbook was reviewed against the Vercel, Supabase, Clerk, Sentry, Resend,
and DNS target stack on 2026-07-14. That was a content review, not a recovery
drill. No evidence in this repository demonstrates a Supabase restore into an
isolated target, and no measured RTO or RPO is recorded.

**Pre-launch blocker:** ORAN must not be declared disaster-recovery ready for
public production launch until the Data Platform Lead completes one isolated
Supabase restore, records measured RTO/RPO, and the Release Manager accepts the
critical-journey evidence. The short review date keeps this blocker visible; it
does not imply the drill passed.

2026-07-29 review note: the blocker STANDS — no isolated restore drill has been
performed and no RTO/RPO evidence exists in this repository. The release
manifest this runbook depends on has advanced to 77 migration files through
`0078_candidate_revision_activation.sql` (see
`docs/ops/core/DATABASE_MIGRATION_BASELINE.md`); any restore acceptance must
verify against that ledger state, not the previously documented 76.

## Purpose And Scope

Use this procedure for loss or corruption of the production Supabase database,
loss of the Vercel production deployment, critical configuration corruption, or
a provider incident requiring recovery into a clean target. Normal bad-release
rollback belongs in `RUNBOOK_DEPLOYMENT_ROLLBACK.md`.

## Safety Constraints

- Never test a restore destructively against production.
- Restore only into an access-restricted, isolated Supabase project first.
- Disable outbound email, webhooks, cron, and other side effects in the recovery
  target until operators explicitly approve them.
- Preserve audit, provenance, publication, membership, and reviewer records.
- Do not copy secrets into tickets, logs, screenshots, or the repository.
- Validate crisis routing, retrieval-first behavior, privacy boundaries, and
  database-owned authorization before directing users to the recovered stack.

## Recovery Objectives

Targets have not yet been approved or measured. The first drill must establish
a baseline; the Release Manager then records approved objectives here.

| Metric | Approved target | Last measured | Status |
| --- | --- | --- | --- |
| RTO | Not set | Not measured | Launch blocker |
| RPO | Not set | Not measured | Launch blocker |

RTO starts when the incident or drill is declared and ends when the recovery
target passes the critical-journey gate. RPO is the difference between the last
committed production record available before the event and the newest record
present in the validated restore.

## Preparedness Check

Before a drill or incident:

1. Confirm the actual production Supabase backup/PITR capability, retention,
   region, and restore method in the project settings. Do not infer capability
   from a plan name or this document.
2. Confirm a second, isolated recovery project can be provisioned and that the
   Data Platform Lead has the required restore access.
3. Record the deployed Vercel commit and aliases, applied database migration,
   Clerk instance/configuration, and names of required runtime variables.
4. Confirm a credential inventory exists in the approved secret manager for
   Vercel, Supabase, Clerk, Sentry, Resend, maps, and scheduled-job credentials.
5. Freeze nonessential writes and capture all timestamps in UTC if an incident
   is already active.

If backup capability or restore access cannot be confirmed, declare the DR path
unavailable and escalate to the Release Manager; do not improvise in production.

## Isolated Restore Procedure

1. Assign Incident Commander, Recovery Driver, Data Validator, and Security
   Reviewer. Record incident/drill start time.
2. Select the newest approved recovery point that predates confirmed corruption.
   Record the source backup timestamp and expected data-loss window.
3. Restore through the production project's supported Supabase restore method
   into an isolated recovery project. Keep its application endpoints private.
4. Compare migration history and schema with the application commit intended for
   recovery. Stop if schema/application compatibility is uncertain.
5. Configure a non-production Vercel deployment to use the isolated database and
   non-production Clerk/Resend settings. Keep cron and external notifications off.
6. Validate database integrity with read-only checks first:
   - row counts and newest timestamps for organizations, services, locations,
     source feeds, provenance, submissions, assignments, profiles, and audit logs
   - primary/foreign-key and uniqueness expectations
   - published-resource provenance and visibility eligibility
   - frozen account, membership, scope-grant, and reviewer-assignment state
7. Run the critical-journey gate against the isolated Vercel deployment:
   - `/api/health` and database reachability
   - seeker browse, search, map, service detail, and chat retrieval
   - crisis routing for 911, 988, and 211 prompts
   - Clerk sign-in plus onboarding/profile mapping
   - ORAN admin authorization and a non-destructive review/routing read path
   - scheduled-route authentication without enabling the schedules
8. Have the Security Reviewer confirm no production PII was exposed outside the
   recovery boundary and no outbound side effect ran.
9. Record recovery-ready time, newest restored record timestamp, calculated RTO
   and RPO, failures, screenshots/log references, and reviewer sign-off.

## Promotion Or Failback

Promotion requires joint approval from the Incident Commander, Data Platform
Lead, Security Reviewer, and Release Manager. Before changing production aliases
or DNS:

- rotate any credential suspected of compromise
- confirm Clerk redirect/origin settings for the destination domain
- enable scheduled jobs one at a time after application validation
- preserve the failed environment and logs for investigation
- publish an operator update with the recovery point and known data-loss window

If the isolated restore does not pass, keep public traffic on the last safe
degraded experience, stop writes where integrity cannot be guaranteed, and
continue under `RUNBOOK_INCIDENT_TRIAGE.md`.

## Drill Evidence Required To Clear The Blocker

- source recovery-point timestamp and restore destination
- UTC start, database-restored, journey-ready, and decision timestamps
- measured RTO and RPO with calculation notes
- migration/schema compatibility result
- critical-journey results, including auth and safety routing
- security/privacy review and side-effect check
- named owner and deadline for every failure
- Release Manager go/no-go decision

Only an executed restore can change the current status from unmeasured.

## References

- `docs/ops/core/RUNBOOK_INCIDENT_TRIAGE.md`
- `docs/ops/core/RUNBOOK_DEPLOYMENT_ROLLBACK.md`
- `docs/ops/core/RUNBOOK_CHANGE_FREEZE_GO_NO_GO.md`
- `docs/ops/services/RUNBOOK_DATABASE_INCIDENT.md`
- `docs/ops/services/RUNBOOK_AUTH_OUTAGE.md`
- `docs/ops/core/OPERATIONS_READINESS.md`
- `docs/platform/STACK_MIGRATION.md`
