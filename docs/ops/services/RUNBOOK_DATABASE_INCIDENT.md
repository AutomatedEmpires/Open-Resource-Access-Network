# Runbook: Database Incident Response

## Metadata

- Owner role: Data Platform Lead
- Reviewers: Platform On-Call Lead, Security Lead
- Operational status: active
- Last reviewed (UTC): 2026-07-13
- Next review due (UTC): 2026-10-13
- Severity scope: SEV-1 to SEV-3

## Purpose And Scope

Handle Supabase PostgreSQL/PostGIS incidents: connectivity failures, Supavisor
pool saturation, lock contention, runaway latency, migration instability, and
integrity-control failures.

## Safety Constraints

- Do not bypass authorization, publication, crisis, or usage-accounting controls
  to compensate for database failure.
- Start with read-only diagnostics through the dedicated ORAN project.
- Do not export personal or seeker-entered data into tickets, chat, or telemetry.
- Never replay the full migration directory over an imported schema.
- Emergency writes, cancellations, and terminations require an identified owner,
  reason, affected scope, and audit note.

## Triggers

- `/api/health` reports the database unconfigured or unreachable.
- API failures contain connection, pool, timeout, deadlock, or serialization errors.
- Search/chat/admin latency rises with database wait time.
- Supabase reports service degradation or connection pressure.
- A migration partially applies or a required `oran_internal` function/grant is missing.
- Resource publication, freshness holds, or chat quota finalization cannot be
  trusted because a transaction failed.

## Initial Diagnosis

1. Determine whether failures affect direct migration connections, pooled Vercel
   runtime connections, or both.
2. Check the dedicated Supabase project and Vercel release/runtime logs.
3. Confirm `DATABASE_URL` is present in the correct Vercel environment without
   printing it. Production pools default to two connections per instance and
   `DATABASE_POOL_MAX` must remain between 1 and 20.
4. Review the latest deployment and `schema_migrations` entries.
5. Run only bounded read-only diagnostics using an approved operator role.

```sql
SELECT state, count(*)
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY state
ORDER BY count(*) DESC;
```

```sql
SELECT pid, now() - query_start AS duration, state, wait_event_type, wait_event
FROM pg_stat_activity
WHERE datname = current_database()
  AND state <> 'idle'
ORDER BY duration DESC
LIMIT 20;
```

```sql
SELECT blocked.pid AS blocked_pid, blocker.pid AS blocker_pid,
       blocked.wait_event_type, blocked.wait_event
FROM pg_locks blocked_locks
JOIN pg_stat_activity blocked ON blocked.pid = blocked_locks.pid
JOIN pg_locks blocker_locks
  ON blocker_locks.locktype = blocked_locks.locktype
 AND blocker_locks.database IS NOT DISTINCT FROM blocked_locks.database
 AND blocker_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
 AND blocker_locks.page IS NOT DISTINCT FROM blocked_locks.page
 AND blocker_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
 AND blocker_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
 AND blocker_locks.pid <> blocked_locks.pid
JOIN pg_stat_activity blocker ON blocker.pid = blocker_locks.pid
WHERE NOT blocked_locks.granted
LIMIT 20;
```

## Mitigation

### Connection saturation

1. Reduce optional job pressure and confirm no release raised the per-instance
   pool unexpectedly.
2. Roll back connection-leaking code before raising pool size.
3. Coordinate any Supabase capacity change with the number of horizontally
   scaled Vercel instances.

### Lock contention

1. Identify the owning operation and blast radius.
2. Prefer `pg_cancel_backend` after owner approval; use termination only when a
   platform-wide write block outweighs rollback risk.
3. Verify the affected transaction was rolled back before retrying it.

### Migration failure

1. Stop further promotion.
2. Determine the exact last successful statement and migration-history state.
3. Use a reviewed forward fix for non-reversible data changes; use application
   rollback only when schema compatibility is established.
4. Preserve the migration baseline guard in `.github/workflows/db-migrate.yml`.

## Validation

```bash
npx vitest run src/services/db/__tests__/postgres.test.ts src/app/api/health/__tests__/route.test.ts
```

- `/api/health` is ready and connected.
- Connection, lock, and latency signals return to baseline.
- Chat reservation/finalization and publication integrity checks succeed when
  those transactions were in scope.
- `schema_migrations` contains each applied migration exactly once.
- No temporary privilege or direct-data workaround remains.

## References

- `src/services/db/postgres.ts`
- `src/app/api/health/route.ts`
- `.github/workflows/db-migrate.yml`
- `db/migrations/`
- `docs/platform/STACK_MIGRATION.md`
- `docs/ops/core/RUNBOOK_DEPLOYMENT_ROLLBACK.md`
