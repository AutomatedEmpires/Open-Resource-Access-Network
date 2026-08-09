# Runbook: Reviewer Routing, Capacity, Coverage, And SLA

## Metadata

- Owner role: ORAN Operations Lead
- Reviewers: Ingestion Operations Lead, Platform On-Call Lead
- Operational status: active
- Last reviewed (UTC): 2026-07-14
- Next review due (UTC): 2026-10-14
- Severity scope: SEV-2 to SEV-4
- Review validation: current code and focused automated tests; active end-to-end assignment drill not executed

## Purpose And Scope

Use this runbook when candidates are not reaching an appropriate human reviewer,
reviewer capacity is exhausted, geographic coverage is missing, or review SLAs
are breached. This is the active Vercel/Supabase operating path.

## Safety Constraints

- Never publish merely to clear a review backlog.
- Do not bypass role, jurisdiction, capacity, two-person, provenance, or
  publication gates.
- Do not directly insert or edit assignment/profile rows during routine
  operations. Use reviewed application workflows; reserve database repair for a
  declared incident with an audited change plan.
- Preserve existing assignments, outcomes, audit history, and notification
  idempotency while diagnosing.
- If no qualified reviewer is available, hold the record for ORAN-admin review
  or pause its source feed rather than widening access silently.

## Implemented Active Controls

- `GET /api/admin/capacity` returns the authenticated community admin's current
  pending/in-review load, effective limits, performance, coverage, and accepting
  status. It is role-checked, rate-limited, and private/no-store.
- `GET /api/internal/coverage-gaps` runs from Vercel Cron at 08:30 UTC daily. It
  finds candidates without a nonterminal admin assignment after 24 hours and
  sends idempotent alerts to ORAN admins. Authenticated `POST` accepts a bounded
  custom threshold for operator diagnosis.
- `GET /api/internal/sla-check` runs at 07:15 UTC daily. It sends warnings, marks
  breaches, and executes tiered escalation/reassignment behavior. Authenticated
  `POST` provides an operator trigger.
- `/api/admin/ingestion/overview` surfaces pending/in-review candidates, breached
  submissions, silent reviewers, stalled assignments, and recent reclamation.
- Ranking, capacity calculation, assignment lifecycle, and PostgreSQL stores are
  implemented under `src/agents/ingestion/`.

## Known Active-Path Gap

The reviewed Vercel source-feed service normalizes and marks records
`pending_review`, and the active system can detect unrouted records. However, no
active Vercel orchestration was found that selects reviewers and creates initial
`candidate_admin_assignments` for each newly normalized candidate.

Therefore, unit-tested ranking/stores and coverage alerts are not evidence that
new candidates are automatically routed in production.

**Production gate:** unattended ingestion-to-review routing must not be declared
production-ready until a target-stack handler creates the initial assignment and
an end-to-end drill proves normalization → assignment → acceptance → decision →
publication. Seeker launch may proceed only with feed polling disabled or with a
Release Manager-approved, capacity-bounded manual review plan that cannot
auto-publish unrouted content.

## Triggers And Severity

- `SEV-2`: publication integrity is at risk, the review queue is broadly
  unrouted, or operators cannot keep unreviewed content from going live.
- `SEV-3`: one region/source has sustained coverage or SLA failures with safe
  holds intact.
- `SEV-4`: isolated capacity warning or newly detected unrouted record with no
  seeker-visible impact.

Trigger on any of:

- coverage-gap response reports `unroutedCount > 0`
- pending candidates increase without corresponding assignments
- SLA warnings/breaches or silent-reviewer reclamations increase unexpectedly
- an active reviewer returns 404 from `/api/admin/capacity` because no profile exists
- all relevant profiles are inactive, not accepting new work, or at capacity
- `pending_review` content is published without the required human decision

## Diagnosis

1. Open an incident timeline and record the Vercel release, feed/source, affected
   geography, candidate count, oldest age, and whether anything became public.
2. Inspect the ORAN ingestion overview and the affected reviewer's authenticated
   capacity response.
3. Run the internal checks with an approved operator credential:

   ```bash
   curl -X POST "https://<production-host>/api/internal/coverage-gaps" \
     -H "x-oran-internal-key: <operator-key>" \
     -H "Content-Type: application/json" \
     -d '{"thresholdHours":24}'

   curl -X POST "https://<production-host>/api/internal/sla-check" \
     -H "x-oran-internal-key: <operator-key>"
   ```

4. Correlate Sentry/Vercel errors with the scheduled routes, database access,
   notification failures, and the latest deployment.
5. Distinguish the failure class:
   - no initial assignment exists
   - assigned reviewer is inactive/silent/over capacity
   - coverage profile excludes the candidate geography
   - assignment exists but its lifecycle or SLA transition is stuck
   - data quality or missing location makes routing unsafe
6. If any unreviewed record became public, switch to
   `RUNBOOK_DATA_QUALITY_INCIDENT.md` and contain publication first.

## Containment And Mitigation

1. Pause the affected source feed (`state.emergencyPause=true`) or globally
   disable source polling when new work would deepen the unsafe backlog.
2. Keep affected canonical records in `canonical_only` or `pending_review`;
   confirm auto-publish is not widening the incident.
3. Restore eligible reviewer coverage through governed admin/profile workflows.
   Do not expand jurisdiction or capacity without an accountable operator.
4. Run the SLA check once after fixing reviewer state so implemented escalation
   and silent-reviewer reclamation can act idempotently.
5. For records that still have no initial assignment, use the approved ORAN-admin
   review surface/manual incident plan. Do not fabricate an assignment with ad
   hoc SQL. Track each record until the target-stack orchestration gap is fixed.
6. If a deployment caused the failure, follow
   `RUNBOOK_DEPLOYMENT_ROLLBACK.md` after checking database compatibility.

## Recovery Validation

The incident is not resolved until operators demonstrate:

- one newly normalized candidate receives a qualified initial assignment
- capacity and geographic rules used for that choice are recorded
- the reviewer can accept and complete the assignment
- SLA/coverage checks no longer report that candidate as orphaned
- a second reviewer or ORAN admin handles the fallback path when the first is unavailable
- publication remains gated until the required review decision
- alerts are idempotent and no duplicate active assignments were created

Capture IDs and timestamps without including seeker PII. A green unit suite alone
does not satisfy this end-to-end exit gate.

## Validation Commands

```bash
npx vitest run src/agents/ingestion/__tests__/adminAssignments.test.ts src/agents/ingestion/__tests__/routing.test.ts src/agents/ingestion/persistence/__tests__/adminRoutingStore.test.ts src/agents/ingestion/persistence/__tests__/adminAssignmentStore.test.ts src/app/api/admin/capacity/__tests__/route.test.ts src/app/api/internal/coverage-gaps/__tests__/route.test.ts src/app/api/internal/sla-check/__tests__/route.test.ts src/services/workflow/__tests__/engine.test.ts
npm run typecheck
```

## References

- `vercel.json`
- `src/app/api/admin/capacity/route.ts`
- `src/app/api/admin/ingestion/overview/route.ts`
- `src/app/api/internal/coverage-gaps/route.ts`
- `src/app/api/internal/sla-check/route.ts`
- `src/services/coverage/gaps.ts`
- `src/services/escalation/engine.ts`
- `src/agents/ingestion/routing.ts`
- `src/agents/ingestion/adminAssignments.ts`
- `src/agents/ingestion/persistence/adminAssignmentStore.ts`
- `docs/ops/services/RUNBOOK_211_API_INGESTION.md`
- `docs/ops/services/RUNBOOK_DATA_QUALITY_INCIDENT.md`
