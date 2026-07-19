// Applies every repository migration to a fresh, disposable PostgreSQL database,
// then proves the greenfield result matches ORAN's production access model.
//
// This closes a long-standing gap: db/migrations/*.sql were previously executed
// for the first time against live Supabase via the manual db-migrate workflow, so
// a broken migration was discovered in a live environment rather than in a PR.
//
// ORAN's access model is NOT lakeandpine's: the backend login is intentionally
// BYPASSRLS and security rests on an explicit per-table GRANT manifest
// (0066/0067/...). The checks below assert that model, not an RLS model.
//
// This script refuses remote hosts and non-disposable database names, and never
// reads DATABASE_URL / .env.local.
//
// Usage:
//   MIGRATION_DATABASE_URL=postgresql://supabase_admin:pw@127.0.0.1:5432/oran_test \
//     node scripts/db/verify-migrations.mjs
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const BACKEND_ROLE = 'oran_backend_runtime';
const SAFE_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const SAFE_DATABASE_NAME = /(ci|test|proof|probe|disposable)/i;
const MIGRATION_FILENAME = /^[0-9]{4}_[a-z0-9_]+\.sql$/;
const ACCOUNT_ERASURE_GATE = '0072_account_erasure_index_gate.sql';

// The ledger in db-migrate.yml keys on FILENAME, so these two historical files
// both applied cleanly and renaming either one would corrupt the applied-state
// of every provisioned database. New duplicates are still rejected below.
const HISTORICAL_DUPLICATE_NUMBERS = new Set(['0002']);

// Migrations that assert on data loaded OUTSIDE the migration chain. Empty:
// 0065 previously belonged here and now no-ops on a greenfield database instead
// of aborting, so the whole committed chain replays. Every skip is printed;
// none of them are silent.
const DATA_DEPENDENT_MIGRATIONS = new Map();

// Tables the backend role is deliberately unable to touch. Each entry is a
// decision, not an oversight: a table only belongs here when no backend code
// path reads or writes it. When a feature first needs one, this check fails and
// forces the grant to land with the code -- which is the point.
const UNGRANTED_TABLE_EXCEPTIONS = new Set([
  // PostGIS-owned metadata; ORAN never reads it through the backend role.
  'public.spatial_ref_sys',

  // Private counters reached only through their SECURITY DEFINER functions
  // (0062 atomic chat usage controls, 0068 shared rate limiting). 0066 states
  // this directly: "Chat tables remain wholly private and are reachable only
  // through the three named functions". Direct grants would defeat that boundary.
  'oran_internal.chat_inflight_leases',
  'oran_internal.chat_rate_limit_windows',
  'oran_internal.chat_usage_events',
  'oran_internal.shared_rate_limit_windows',
  // Durable account erasure is reachable only through the fixed SECURITY
  // DEFINER API in 0071. Direct table access would expose live identifiers and
  // worker state to the application role.
  'oran_internal.account_erasure_identity_blocks',
  'oran_internal.account_erasure_requests',
  'oran_internal.account_erasure_release_gate',
  'oran_internal.account_erasure_steps',
  'public.chat_quota_windows',

  // Quarantine batching (0056/0057) is operated through SQL runbooks, not the
  // application; no backend code path references either table.
  'oran_internal.resource_quarantine_batches',
  'oran_internal.resource_quarantine_members',

  // Verified-hotline authority (0065) is applied and asserted entirely through
  // its SECURITY DEFINER functions; no backend code path reads these tables.
  'oran_internal.hotline_authority_added_contacts',
  'oran_internal.hotline_authority_batches',
  'oran_internal.hotline_authority_members',
  'oran_internal.hotline_quarantined_contacts',

  // Declared in the Drizzle schema but queried by nothing. Granting them now
  // would be a dead privilege; the check will demand a grant the day a real
  // read or write path appears.
  'public.dietary_options',      // EnrichedService.dietaryOptions is never populated
  'public.import_batches',       // CSV importer is validation-only (audit D7)
  'public.ingestion_sources',    // superseded by source_systems (0032)
  'public.org_service_scope',    // 0041; zero references anywhere in src
  'public.programs',             // EnrichedService.program is never populated
  'public.service_adaptations',  // vocabulary only (domain/taxonomy.ts)
  'public.staging_locations',    // CSV import staging; never read by the app
  'public.staging_organizations',
  'public.staging_services',
  'public.verification_evidence',       // legacy verification lane
  'public.verification_queue_archive',  // legacy archive
]);

// Enforced: a new table with no grant and no justified exception fails the build.
const ENFORCE_GRANT_COVERAGE = true;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function validateTarget(rawUrl) {
  invariant(
    rawUrl,
    'MIGRATION_DATABASE_URL is required and must point at a fresh, disposable database',
  );
  const target = new URL(rawUrl);
  invariant(
    target.protocol === 'postgres:' || target.protocol === 'postgresql:',
    'MIGRATION_DATABASE_URL must use postgres:// or postgresql://',
  );
  const hostname = target.hostname.replace(/^\[|\]$/g, '');
  invariant(
    SAFE_HOSTS.has(hostname),
    `Migration verification refuses the non-local database host ${hostname}`,
  );
  const database = decodeURIComponent(target.pathname.replace(/^\//, ''));
  invariant(
    database && SAFE_DATABASE_NAME.test(database),
    `Disposable database name must contain ci, test, proof, probe, or disposable (got ${database || 'none'})`,
  );
  return database;
}

/**
 * CREATE INDEX CONCURRENTLY cannot run inside a transaction block, and both the
 * production runner (psql -f, no --single-transaction) and this verifier only
 * keep it out of one while the file holds a single statement. Adding a second
 * statement -- or an explicit BEGIN -- silently converts the build into a
 * blocking one or fails outright, so the invariant is enforced here instead of
 * living in a comment nobody reads.
 */
function assertConcurrentlyIsolated(name, source) {
  const executable = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  if (!/\bCONCURRENTLY\b/i.test(executable)) return;

  invariant(
    !/\b(BEGIN|COMMIT)\s*;/i.test(executable),
    `Migration ${name} uses CONCURRENTLY inside an explicit transaction block`,
  );
  const statements = executable.split(';').filter((part) => part.trim().length > 0);
  invariant(
    statements.length === 1,
    `Migration ${name} uses CONCURRENTLY and must contain exactly one statement `
      + `(found ${statements.length}); split the rest into their own migration`,
  );
}

async function loadMigrations() {
  const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../../db/migrations');
  const entries = await readdir(directory);

  // .deprecated files are retired history and are never applied.
  const names = entries
    .filter((name) => name.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right, 'en'));
  invariant(names.length > 0, `No SQL migrations found in ${directory}`);

  const malformed = names.filter((name) => !MIGRATION_FILENAME.test(name));
  invariant(
    malformed.length === 0,
    `Migration filenames must match ${MIGRATION_FILENAME} (the ledger insert interpolates them): ${malformed.join(', ')}`,
  );

  const byNumber = new Map();
  for (const name of names) {
    const number = name.slice(0, 4);
    byNumber.set(number, [...(byNumber.get(number) || []), name]);
  }
  const duplicates = [...byNumber.entries()]
    .filter(([number, files]) => files.length > 1 && !HISTORICAL_DUPLICATE_NUMBERS.has(number));
  invariant(
    duplicates.length === 0,
    `Duplicate migration numbers: ${duplicates.map(([n, f]) => `${n} (${f.join(', ')})`).join('; ')}`,
  );

  return Promise.all(names.map(async (name) => {
    const source = (await readFile(resolve(directory, name), 'utf8')).replaceAll('\r\n', '\n');
    invariant(source.trim().length > 0, `Migration ${name} is empty`);
    assertConcurrentlyIsolated(name, source);
    return { name, source };
  }));
}

async function loadDisposableAccountErasureIndexes() {
  const source = await readFile(
    resolve(dirname(fileURLToPath(import.meta.url)), 'build-account-erasure-indexes.sql'),
    'utf8',
  );
  const statements = source.match(
    /CREATE INDEX CONCURRENTLY IF NOT EXISTS[\s\S]*?;\s*/gu,
  ) ?? [];
  invariant(
    statements.length === 128,
    `Expected 128 fixed account-erasure index definitions, found ${statements.length}`,
  );
  // Production uses the committed online builder. The verifier owns an empty,
  // disposable database, where a regular build is both faster and avoids
  // putting CONCURRENTLY into a multi-statement migration transaction.
  return statements.map((statement) => statement.replace('CONCURRENTLY ', ''));
}

async function applyMigrations(client, migrations, accountErasureIndexes) {
  const skipped = [];
  for (const migration of migrations) {
    const dataDependency = DATA_DEPENDENT_MIGRATIONS.get(migration.name);
    if (dataDependency) {
      skipped.push({ name: migration.name, reason: dataDependency });
      console.log(`  SKIPPED ${migration.name} (data-dependent)`);
      continue;
    }
    if (migration.name === ACCOUNT_ERASURE_GATE) {
      let gateFailedClosed = false;
      try {
        await client.query(migration.source);
      } catch (error) {
        gateFailedClosed = error.code === '55000'
          && error.message === 'account-erasure online index phase is incomplete';
        await client.query('ROLLBACK');
      }
      invariant(
        gateFailedClosed,
        `${ACCOUNT_ERASURE_GATE} must fail closed before its fixed indexes exist`,
      );
      console.log('  proved account-erasure gate fails before index preparation');
      console.log('  preparing fixed account-erasure indexes on disposable database');
      for (const statement of accountErasureIndexes) {
        await client.query(statement);
      }
    }
    try {
      await client.query(migration.source);
      console.log(`  applied ${migration.name}`);
    } catch (error) {
      throw new Error(`Migration ${migration.name} failed: ${error.message}`, { cause: error });
    }
  }
  return skipped;
}

/**
 * The backend login must exist with production's deliberate attributes:
 * BYPASSRLS is intentional here (RLS is not ORAN's access model), but the role
 * must never be a superuser and must keep its connection ceiling.
 */
async function inspectBackendRole(client) {
  const { rows } = await client.query(
    `SELECT rolsuper, rolbypassrls, rolcanlogin, rolcreatedb, rolcreaterole, rolconnlimit
       FROM pg_roles WHERE rolname = $1`,
    [BACKEND_ROLE],
  );
  const failures = [];
  const role = rows[0];
  if (!role) {
    failures.push(`${BACKEND_ROLE} was not created by the migrations`);
    return failures;
  }
  if (role.rolsuper) failures.push(`${BACKEND_ROLE} must not be a superuser`);
  if (role.rolcreatedb) failures.push(`${BACKEND_ROLE} must not have CREATEDB`);
  if (role.rolcreaterole) failures.push(`${BACKEND_ROLE} must not have CREATEROLE`);
  if (!role.rolcanlogin) failures.push(`${BACKEND_ROLE} must retain LOGIN`);
  if (!role.rolbypassrls) {
    failures.push(`${BACKEND_ROLE} must keep BYPASSRLS (ORAN's access model is the GRANT manifest)`);
  }
  if (role.rolconnlimit === -1) {
    failures.push(`${BACKEND_ROLE} must keep a connection limit (Supavisor pooling ceiling)`);
  }
  return failures;
}

/**
 * Every application table must be reachable by the backend role. A table created
 * without any matching grant passes the existing drift gate but fails at runtime
 * in production with a permission error -- the defect 0069 was written to fix.
 *
 * "Reachable" means ANY privilege, not SELECT: several tables are legitimately
 * write-only (source_record_taxonomy is insert-only by the 211 connector), and
 * demanding SELECT on those would report a gap that does not exist and invite an
 * over-grant that breaks least privilege.
 */
async function inspectGrantCoverage(client) {
  const { rows } = await client.query(
    `SELECT namespace.nspname || '.' || relation.relname AS qualified_name
       FROM pg_class relation
       JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname IN ('public', 'oran_internal')
        AND relation.relkind IN ('r', 'p')
        AND NOT (
          has_table_privilege($1, relation.oid, 'SELECT')
          OR has_table_privilege($1, relation.oid, 'INSERT')
          OR has_table_privilege($1, relation.oid, 'UPDATE')
          OR has_table_privilege($1, relation.oid, 'DELETE')
        )
      ORDER BY 1`,
    [BACKEND_ROLE],
  );
  return rows
    .map((row) => row.qualified_name)
    .filter((name) => !UNGRANTED_TABLE_EXCEPTIONS.has(name))
    .map((name) => `${name} is unreachable by the backend role (no privilege of any kind)`);
}

async function reportSurface(client) {
  const [{ rows: tables }, { rows: extensions }] = await Promise.all([
    client.query(
      `SELECT count(*)::int AS count FROM pg_class relation
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname IN ('public', 'oran_internal') AND relation.relkind IN ('r', 'p')`,
    ),
    client.query(`SELECT extname, extversion FROM pg_extension ORDER BY extname`),
  ]);
  console.log(`\ntables: ${tables[0].count}`);
  console.log(`extensions: ${extensions.map((e) => `${e.extname} ${e.extversion}`).join(', ')}`);
}

async function main() {
  const rawUrl = process.env.MIGRATION_DATABASE_URL;
  const database = validateTarget(rawUrl);
  const [migrations, accountErasureIndexes] = await Promise.all([
    loadMigrations(),
    loadDisposableAccountErasureIndexes(),
  ]);

  console.log(`verifying ${migrations.length} migrations against disposable database ${database}\n`);

  const client = new pg.Client({ connectionString: rawUrl });
  await client.connect();
  try {
    // The Supabase image ships PostgREST/pg_graphql DDL watch triggers that are
    // not part of ORAN's schema and break bulk DDL. ORAN keeps the Data API
    // closed (server-side pooled login only), so they are irrelevant here.
    await client.query(`
      DO $$
      DECLARE trigger_name text;
      BEGIN
        FOR trigger_name IN SELECT evtname FROM pg_event_trigger LOOP
          EXECUTE format('ALTER EVENT TRIGGER %I DISABLE', trigger_name);
        END LOOP;
      END $$;`);

    const skipped = await applyMigrations(client, migrations, accountErasureIndexes);

    const grantGaps = await inspectGrantCoverage(client);
    const failures = [
      ...(await inspectBackendRole(client)),
      ...(ENFORCE_GRANT_COVERAGE ? grantGaps : []),
    ];
    await reportSurface(client);

    if (grantGaps.length > 0 && !ENFORCE_GRANT_COVERAGE) {
      console.log(
        `\nopen finding — ${grantGaps.length} application table(s) the backend role cannot read `
          + `on a greenfield database (repair tracked as the 0066/0069 grant reconciliation):`,
      );
      for (const gap of grantGaps) console.log(`  - ${gap}`);
    }

    if (skipped.length > 0) {
      console.log(
        `\nnot covered by this run — a greenfield database is NOT bootstrappable from `
          + `migrations alone:`,
      );
      for (const skip of skipped) console.log(`  - ${skip.name}: ${skip.reason}`);
    }

    if (failures.length > 0) {
      console.error(`\n${failures.length} verification failure(s):`);
      for (const failure of failures) console.error(`  - ${failure}`);
      process.exitCode = 1;
      return;
    }
    console.log('\nfresh-database migration verification passed');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`\nmigration verification failed: ${error.message}`);
  process.exitCode = 1;
});
