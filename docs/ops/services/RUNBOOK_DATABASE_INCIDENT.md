# Runbook: Database Incident Response

## Metadata

- Owner role: Data Platform Lead
- Reviewers: Platform On-Call Lead, Security Lead
- Last reviewed (UTC): 2026-03-06
- Next review due (UTC): 2026-06-06
- Severity scope: SEV-1 to SEV-3

## Purpose And Scope

This runbook covers PostgreSQL/PostGIS production incidents: connectivity failures, saturation, lock contention, runaway query latency, and migration-related instability.

## Safety Constraints (Must Always Hold)

- Do not bypass authz checks to compensate for DB issues.
- Do not disable crisis routing logic.
- Avoid ad-hoc writes that could corrupt service record integrity.
- Avoid querying or exporting sensitive data outside approved channels.

## Triggers

- API request failures with DB connection errors.
- Elevated p95/p99 latency for search/admin endpoints.
- Connection pool exhaustion.
- Lock contention/deadlock symptoms.
- Migration failure during deployment.

## Initial Diagnostics

1. Confirm app-level impact:
   - `GET /api/services` latency/error rate.
   - Admin route error rates.
2. Check app and function logs for DB exceptions.
3. Confirm DB service health in Azure portal.
4. Review recent deploy/migration timeline.

## SQL Diagnostics (Read-Only First)

```sql
-- Active connections by state
SELECT state, count(*)
FROM pg_stat_activity
GROUP BY state
ORDER BY count(*) DESC;
```

```sql
-- Long-running queries
SELECT pid, now() - query_start AS duration, state, wait_event_type, wait_event, query
FROM pg_stat_activity
WHERE state <> 'idle'
ORDER BY duration DESC
LIMIT 20;
```

```sql
-- Blocking and blocked queries
SELECT blocked.pid AS blocked_pid,
       blocker.pid AS blocker_pid,
       blocked.query AS blocked_query,
       blocker.query AS blocker_query
FROM pg_locks blocked_locks
JOIN pg_stat_activity blocked ON blocked.pid = blocked_locks.pid
JOIN pg_locks blocker_locks
  ON blocker_locks.locktype = blocked_locks.locktype
 AND blocker_locks.database IS NOT DISTINCT FROM blocked_locks.database
 AND blocker_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
 AND blocker_locks.page IS NOT DISTINCT FROM blocked_locks.page
 AND blocker_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
 AND blocker_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
 AND blocker_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
 AND blocker_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
 AND blocker_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
 AND blocker_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
 AND blocker_locks.pid <> blocked_locks.pid
JOIN pg_stat_activity blocker ON blocker.pid = blocker_locks.pid
WHERE NOT blocked_locks.granted;
```

## Mitigation Paths

### A. Connection Saturation

1. Reduce ingress pressure (temporary rate-limit tightening if required).
2. Restart affected application instance only if saturation is app-side leak related.
3. Verify pool settings and active query count stabilize.

### B. Lock Contention

1. Identify blocker query and owner session.
2. Coordinate safe cancellation (`pg_cancel_backend`) before force terminate.
3. If writes are blocked platform-wide, declare SEV-1/SEV-2 and execute controlled mitigation.

### C. Migration Failure

1. Stop further deploys.
2. Determine if migration is partially applied.
3. Execute rollback/forward-fix based on migration safety.
4. Use `docs/ops/core/RUNBOOK_DEPLOYMENT_ROLLBACK.md` for full release rollback decisions.

## Rollback Criteria

- Sustained 5xx and DB exceptions beyond 15 minutes.
- No safe mitigation path without code/data rollback.
- Safety-critical workflows blocked (admin routing, ingestion verification).

## Validation

1. Critical APIs recover to baseline latency and success rates.
2. Queue consumers resume healthy throughput.
3. No growing deadlock/long query pattern.
4. Incident channel confirms stabilized state.

## Post-Incident Actions

1. Add root cause + mitigation summary.
2. Add query tuning/index follow-up items if relevant.
3. Update this runbook with observed failure signature.
4. Record contract-impacting changes in `docs/ENGINEERING_LOG.md`.

## References

- `db/migrations/`
- `docs/DATA_MODEL.md`
- `docs/ops/monitoring/MONITORING_QUERIES.md`
- `docs/ops/core/RUNBOOK_DEPLOYMENT_ROLLBACK.md`
- `docs/SECURITY_PRIVACY.md`
