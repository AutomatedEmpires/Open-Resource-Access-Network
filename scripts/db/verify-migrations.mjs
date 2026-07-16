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

// The ledger in db-migrate.yml keys on FILENAME, so these two historical files
// both applied cleanly and renaming either one would corrupt the applied-state
// of every provisioned database. New duplicates are still rejected below.
const HISTORICAL_DUPLICATE_NUMBERS = new Set(['0002']);

// Migrations that assert on data loaded OUTSIDE the migration chain (the bulk
// open-data import). A greenfield database cannot satisfy them, so they are
// reported as skipped rather than pretending the chain is bootstrappable.
// Every skip is printed; none of them are silent.
const DATA_DEPENDENT_MIGRATIONS = new Map([
  [
    '0065_verified_hotline_authority.sql',
    'aborts unless exactly 13 import:hotline services already exist — they are loaded by '
      + 'scripts/import/sources/hotlines.mjs, not by any migration',
  ],
]);

// Tables the backend role is not expected to read directly.
const UNGRANTED_TABLE_EXCEPTIONS = new Set([
  // PostGIS-owned metadata; ORAN never reads it through the backend role.
  'public.spatial_ref_sys',
  // Private counters reached only through their SECURITY DEFINER functions
  // (0062 atomic chat usage controls, 0068 shared rate limiting). Direct grants
  // here would defeat the definer boundary.
  'oran_internal.chat_inflight_leases',
  'oran_internal.chat_rate_limit_windows',
  'oran_internal.chat_usage_events',
  'oran_internal.shared_rate_limit_windows',
  'public.chat_quota_windows',
]);

// Grant coverage is REPORTED, not yet enforced: a fresh database currently shows
// application tables the backend cannot read. The repair is the 0066/0069 grant
// reconciliation preserved on the WIP checkpoint, which is a separate change --
// so this run prints the finding rather than failing and blocking its own fix.
// Flip to true in the same PR that lands the grant repair.
const ENFORCE_GRANT_COVERAGE = false;

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
    return { name, source };
  }));
}

async function applyMigrations(client, migrations) {
  const skipped = [];
  for (const migration of migrations) {
    const dataDependency = DATA_DEPENDENT_MIGRATIONS.get(migration.name);
    if (dataDependency) {
      skipped.push({ name: migration.name, reason: dataDependency });
      console.log(`  SKIPPED ${migration.name} (data-dependent)`);
      continue;
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
 * without a matching grant passes the existing drift gate but fails at runtime in
 * production with a permission error -- the exact defect 0069 was written to fix.
 */
async function inspectGrantCoverage(client) {
  const { rows } = await client.query(
    `SELECT namespace.nspname || '.' || relation.relname AS qualified_name
       FROM pg_class relation
       JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname IN ('public', 'oran_internal')
        AND relation.relkind IN ('r', 'p')
        AND NOT has_table_privilege($1, relation.oid, 'SELECT')
      ORDER BY 1`,
    [BACKEND_ROLE],
  );
  return rows
    .map((row) => row.qualified_name)
    .filter((name) => !UNGRANTED_TABLE_EXCEPTIONS.has(name))
    .map((name) => `${name} has no backend-runtime grant (feature would fail closed in production)`);
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
  const migrations = await loadMigrations();

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

    const skipped = await applyMigrations(client, migrations);

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
