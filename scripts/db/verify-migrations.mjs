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
import { randomBytes } from 'node:crypto';
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
  // Candidate repair fairness is advanced only through the bounded SECURITY
  // DEFINER selector and cleared by the database-owned assignment routine.
  // Direct access would expose candidate identities and let callers bypass the
  // retry lease that prevents a permanently failing prefix from starving work.
  'oran_internal.candidate_reviewer_routing_state',
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
      if (migration.name === '0078_candidate_revision_activation.sql') {
        await proveCandidateLineageActivationRequiresReviewers(
          client,
          migration.source,
        );
        await prepareCandidateLineageActivationPrerequisites(client);
        await proveCandidateLineageActivationRequiresReviewers(
          client,
          migration.source,
        );
        console.log('  proved ORAN oversight does not satisfy the two-community-reviewer gate');
        await addSecondCommunityReviewerForActivation(client);
        await proveCandidateLineageActivationFailsClosed(client, migration.source);
        await seedCandidateLineageActivationBackfill(client);
      }
      await client.query(migration.source);
      console.log(`  applied ${migration.name}`);
      if (migration.name === '0077_candidate_revision_lineage.sql') {
        await exerciseCandidateLineageExpandPhase(client);
      }
      if (migration.name === '0078_candidate_revision_activation.sql') {
        await proveCandidateLineageActivationBackfill(client);
      }
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

async function expectDatabaseError(client, query, params, expected) {
  await client.query('SAVEPOINT expected_failure');
  let received;
  try {
    await client.query(query, params);
  } catch (error) {
    received = error;
  }
  await client.query('ROLLBACK TO SAVEPOINT expected_failure');
  await client.query('RELEASE SAVEPOINT expected_failure');
  invariant(received, `Expected database rejection: ${expected}`);
  invariant(
    received.code === expected || received.message.includes(expected),
    `Expected database rejection ${expected}, received ${received.code}: ${received.message}`,
  );
}

async function exerciseCandidateLineageExpandPhase(client) {
  console.log('  exercising dark candidate-lineage expand phase');
  await client.query('BEGIN');
  try {
    const state = await client.query(
      `SELECT
         (SELECT attnotnull
            FROM pg_catalog.pg_attribute
           WHERE attrelid = 'public.extracted_candidates'::pg_catalog.regclass
             AND attname = 'lineage_root_candidate_id'
             AND NOT attisdropped) AS root_not_null,
         EXISTS (
           SELECT 1
           FROM pg_catalog.pg_trigger
           WHERE tgrelid = 'public.candidate_admin_assignments'::pg_catalog.regclass
             AND tgname = 'trg_protect_completed_candidate_approval'
             AND NOT tgisinternal
         ) AS approval_active,
         pg_catalog.has_function_privilege(
           'oran_backend_runtime',
           'oran_internal.assign_candidate_reviewers(text,integer)',
           'EXECUTE'
         ) AS reviewer_routing_active,
         pg_catalog.has_function_privilege(
           'oran_backend_runtime',
           'oran_internal.list_undercovered_candidate_reviews(integer,integer)',
           'EXECUTE'
         ) AS reviewer_reroute_active,
         pg_catalog.to_regclass(
           'oran_internal.candidate_reviewer_routing_state'
         ) IS NOT NULL AS routing_state_exists,
         (SELECT relation.relrowsecurity
            FROM pg_catalog.pg_class relation
           WHERE relation.oid = pg_catalog.to_regclass(
             'oran_internal.candidate_reviewer_routing_state'
           )) AS routing_state_rls,
         (SELECT function_row.prosecdef
            FROM pg_catalog.pg_proc function_row
           WHERE function_row.oid =
             'oran_internal.list_undercovered_candidate_reviews(integer,integer)'::pg_catalog.regprocedure
         ) AS selector_security_definer,
         (SELECT function_row.provolatile
            FROM pg_catalog.pg_proc function_row
           WHERE function_row.oid =
             'oran_internal.list_undercovered_candidate_reviews(integer,integer)'::pg_catalog.regprocedure
         ) AS selector_volatility,
         (
           pg_catalog.has_table_privilege(
             'oran_backend_runtime',
             'oran_internal.candidate_reviewer_routing_state',
             'SELECT'
           ) OR pg_catalog.has_table_privilege(
             'oran_backend_runtime',
             'oran_internal.candidate_reviewer_routing_state',
             'INSERT'
           ) OR pg_catalog.has_table_privilege(
             'oran_backend_runtime',
             'oran_internal.candidate_reviewer_routing_state',
             'UPDATE'
           ) OR pg_catalog.has_table_privilege(
             'oran_backend_runtime',
             'oran_internal.candidate_reviewer_routing_state',
             'DELETE'
           )
         ) AS backend_routing_state_access`,
    );
    invariant(!state.rows[0].root_not_null, '0077 made lineage root NOT NULL');
    invariant(!state.rows[0].approval_active, '0077 activated approval protection');
    invariant(
      !state.rows[0].reviewer_routing_active
        && !state.rows[0].reviewer_reroute_active,
      '0077 exposed reviewer routing before activation',
    );
    invariant(
      state.rows[0].routing_state_exists
        && state.rows[0].routing_state_rls
        && state.rows[0].selector_security_definer
        && state.rows[0].selector_volatility === 'v'
        && !state.rows[0].backend_routing_state_access,
      '0077 candidate reviewer fairness state is not private and dark',
    );

    const inserted = await client.query(
      `INSERT INTO public.extracted_candidates (
         candidate_id, extraction_id, extract_key_sha256, extracted_at,
         organization_name, service_name, correlation_id
       )
       VALUES (
         'migration-expand-proof',
         'migration-expand-proof-extraction',
         'migration-expand-proof-hash',
         NOW(),
         'Migration expand proof organization',
         'Migration expand proof service',
         'migration-expand-proof-correlation'
       )
       RETURNING lineage_root_candidate_id, revision_number`,
    );
    invariant(
      inserted.rows[0].lineage_root_candidate_id === 'migration-expand-proof'
        && inserted.rows[0].revision_number === 1,
      '0077 did not preserve a legacy-shaped root insert',
    );
    console.log('    dark expand compatibility proof passed');
  } finally {
    await client.query('ROLLBACK');
  }
}

async function proveCandidateLineageActivationRequiresReviewers(
  client,
  activationSource,
) {
  let activationError;
  try {
    await client.query(activationSource);
  } catch (error) {
    activationError = error;
  }
  await client.query('ROLLBACK');
  invariant(activationError, '0078 activated without two operational reviewers');
  invariant(
    activationError.message.includes(
      'candidate lineage activation refused: at least two active authorized community reviewers with capacity are required',
    ),
    `0078 reviewer prerequisite failed for the wrong reason: ${activationError.message}`,
  );
  console.log('  proved 0078 fails closed without two operational reviewers');
}

async function prepareCandidateLineageActivationPrerequisites(client) {
  await client.query(`
    INSERT INTO public.user_profiles (user_id, role)
    VALUES
      ('migration-activation-reviewer-a', 'community_admin'),
      ('migration-activation-reviewer-b', 'oran_admin');

    INSERT INTO public.admin_review_profiles (user_id)
    VALUES
      ('migration-activation-reviewer-a'),
      ('migration-activation-reviewer-b');
  `);
}

async function addSecondCommunityReviewerForActivation(client) {
  await client.query(`
    INSERT INTO public.user_profiles (user_id, role)
    VALUES
      ('migration-activation-reviewer-c', 'community_admin'),
      ('migration-activation-reviewer-d', 'community_admin');

    INSERT INTO public.admin_review_profiles (user_id)
    VALUES
      ('migration-activation-reviewer-c'),
      ('migration-activation-reviewer-d');
  `);
}

async function proveCandidateLineageActivationFailsClosed(client, activationSource) {
  await client.query(
    `INSERT INTO public.extracted_candidates (
       candidate_id, extraction_id, extract_key_sha256, extracted_at,
       organization_name, service_name, correlation_id
     )
     VALUES
       (
         'migration-drift-root',
         'migration-drift-root-extraction',
         'migration-drift-root-hash',
         NOW(),
         'Migration drift proof organization',
         'Migration drift proof root',
         'migration-drift-proof-correlation'
       ),
       (
         'migration-drift-child',
         'migration-drift-child-extraction',
         'migration-drift-child-hash',
         NOW(),
         'Migration drift proof organization',
         'Migration drift proof child',
         'migration-drift-proof-correlation'
       )`,
  );
  await client.query(
    `UPDATE public.extracted_candidates
        SET revision_of_candidate_id = 'migration-drift-root',
            lineage_root_candidate_id = 'migration-drift-root',
            revision_number = 3
      WHERE candidate_id = 'migration-drift-child'`,
  );

  let activationError;
  try {
    await client.query(activationSource);
  } catch (error) {
    activationError = error;
  }
  // 0078 owns an explicit transaction; an expected error leaves it aborted.
  await client.query('ROLLBACK');
  await client.query(
    `DELETE FROM public.extracted_candidates
     WHERE candidate_id IN ('migration-drift-child', 'migration-drift-root')`,
  );
  invariant(activationError, '0078 accepted semantic lineage drift');
  invariant(
    activationError.message.includes(
      'candidate lineage activation refused: child parent/root/revision drift exists',
    ),
    `0078 failed for the wrong reason: ${activationError.message}`,
  );
  console.log('  proved 0078 fails closed on expand-window lineage drift');
}

async function seedCandidateLineageActivationBackfill(client) {
  await client.query(
    `INSERT INTO public.extracted_candidates (
       candidate_id, extraction_id, extract_key_sha256, extracted_at,
       organization_name, service_name, correlation_id
     )
     VALUES (
       'migration-activation-open-candidate',
       'migration-activation-open-extraction',
       'migration-activation-open-hash',
       NOW(),
       'Migration activation proof organization',
       'Migration activation proof service',
       'migration-activation-proof-correlation'
     )`,
  );
  await client.query(
    `INSERT INTO public.extracted_candidates (
       candidate_id, extraction_id, extract_key_sha256, extracted_at,
       organization_name, service_name, correlation_id, review_status
     )
     VALUES (
       'migration-activation-conflict-candidate',
       'migration-activation-conflict-extraction',
       'migration-activation-conflict-hash',
       NOW(),
       'Migration activation conflict organization',
       'Migration activation conflict service',
       'migration-activation-conflict-correlation',
       'verified'
     )`,
  );
  await client.query(
    `INSERT INTO public.candidate_admin_assignments (
       candidate_id,
       admin_profile_id,
       status,
       claimed_at,
       completed_at,
       outcome
     )
     SELECT
       'migration-activation-conflict-candidate',
       reviewer.id,
       'completed',
       NOW(),
       NOW(),
       CASE
         WHEN reviewer.user_id = 'migration-activation-reviewer-c'
           THEN 'rejected'
         ELSE 'verified'
       END
     FROM public.admin_review_profiles reviewer
     WHERE reviewer.user_id IN (
       'migration-activation-reviewer-a',
       'migration-activation-reviewer-b',
       'migration-activation-reviewer-c'
     )`,
  );
  await client.query(
    `INSERT INTO public.extracted_candidates (
       candidate_id, extraction_id, extract_key_sha256, extracted_at,
       organization_name, service_name, correlation_id, review_status
     )
     VALUES (
       'migration-activation-escalated-candidate',
       'migration-activation-escalated-extraction',
       'migration-activation-escalated-hash',
       NOW(),
       'Migration activation escalated organization',
       'Migration activation escalated service',
       'migration-activation-escalated-correlation',
       'verified'
     )`,
  );
  await client.query(
    `INSERT INTO public.candidate_admin_assignments (
       candidate_id, admin_profile_id, status, claimed_at, completed_at, outcome
     )
     SELECT
       'migration-activation-escalated-candidate',
       reviewer.id,
       'completed',
       NOW(),
       NOW(),
       CASE
         WHEN reviewer.user_id = 'migration-activation-reviewer-c'
           THEN 'escalated'
         ELSE 'verified'
       END
     FROM public.admin_review_profiles reviewer
     WHERE reviewer.user_id IN (
       'migration-activation-reviewer-a',
       'migration-activation-reviewer-b',
       'migration-activation-reviewer-c'
     )`,
  );
  await client.query(
    `INSERT INTO public.candidate_admin_assignments (
       candidate_id, admin_profile_id, status, claimed_at, completed_at, outcome
     )
     SELECT
       'migration-activation-open-candidate', reviewer.id,
       CASE
         WHEN reviewer.user_id = 'migration-activation-reviewer-a'
           THEN 'completed'
         ELSE 'claimed'
       END,
       NOW(),
       CASE
         WHEN reviewer.user_id = 'migration-activation-reviewer-a'
           THEN NOW()
         ELSE NULL
       END,
       CASE
         WHEN reviewer.user_id = 'migration-activation-reviewer-a'
           THEN 'verified'
         ELSE NULL
       END
     FROM public.admin_review_profiles reviewer
     WHERE reviewer.user_id IN (
       'migration-activation-reviewer-a',
       'migration-activation-reviewer-b'
     )`,
  );
  await client.query(
    `INSERT INTO public.resource_tags (
       target_id, target_type, tag_type, tag_value, confidence, source
     )
     VALUES (
       'migration-activation-open-candidate', 'candidate', 'category',
       'legacy_unbound_category', 40, 'agent'
     )`,
  );
  await client.query(
    `INSERT INTO public.tag_confirmation_queue (
       resource_tag_id, candidate_id, tag_type, tag_value,
       original_confidence, status, modified_tag_value,
       assigned_to_user_id, assigned_at, reviewed_by_user_id, reviewed_at
     )
     SELECT
       tag.id,
       'migration-activation-open-candidate',
       'category',
       tag.tag_value,
       40,
       'modified',
       'legacy_modified_category',
       'migration-activation-reviewer-b',
       NOW(),
       'migration-activation-reviewer-b',
       NOW()
     FROM public.resource_tags tag
     WHERE tag.target_id = 'migration-activation-open-candidate'
       AND tag.target_type = 'candidate'
       AND tag.tag_type = 'category'`,
  );
  await client.query(
    `INSERT INTO public.llm_suggestions (
       candidate_id, suggestion_id, field, suggested_value,
       original_value, confidence, status, reviewed_by, reviewed_at
     )
     VALUES (
       'migration-activation-open-candidate',
       'migration-activation-unbound-suggestion',
       'description',
       'Legacy oversight accepted description',
       'Legacy oversight original description',
       95,
       'accepted',
       'migration-activation-reviewer-b',
       NOW()
     )`,
  );
  await client.query(
    `INSERT INTO public.extracted_candidates (
       candidate_id, extraction_id, extract_key_sha256, extracted_at,
       organization_name, service_name, correlation_id, review_status
     )
     VALUES (
       'migration-activation-incomplete-evidence',
       'migration-activation-incomplete-extraction',
       'migration-activation-incomplete-hash',
       NOW(),
       'Migration activation incomplete evidence organization',
       'Migration activation incomplete evidence service',
       'migration-activation-incomplete-correlation',
       'archived'
     )`,
  );
  await client.query(
    `INSERT INTO public.candidate_admin_assignments (
       candidate_id, admin_profile_id, status, completed_at, outcome
     )
     SELECT
       'migration-activation-incomplete-evidence',
       reviewer.id,
       'completed',
       NOW(),
       'verified'
     FROM public.admin_review_profiles reviewer
     WHERE reviewer.user_id = 'migration-activation-reviewer-a'`,
  );
  await client.query(
    `INSERT INTO public.candidate_admin_assignments (
       candidate_id, admin_profile_id, status
     )
     SELECT 'migration-activation-incomplete-evidence', reviewer.id, 'pending'
     FROM public.admin_review_profiles reviewer
     WHERE reviewer.user_id = 'migration-activation-reviewer-b'`,
  );
}

async function proveCandidateLineageActivationBackfill(client) {
  const coverage = await client.query(
    `SELECT count(DISTINCT reviewer.id)::integer AS reviewer_count
     FROM public.candidate_admin_assignments assignment
     JOIN public.admin_review_profiles reviewer
       ON reviewer.id = assignment.admin_profile_id
     JOIN public.user_profiles account
       ON account.user_id = reviewer.user_id
     WHERE assignment.candidate_id = 'migration-activation-open-candidate'
       AND assignment.status IN ('pending', 'claimed')
       AND reviewer.is_active IS TRUE
       AND (
         assignment.status = 'claimed'
         OR reviewer.is_accepting_new IS TRUE
       )
       AND (
         assignment.expires_at IS NULL
         OR assignment.expires_at > NOW()
       )
       AND COALESCE(account.account_status, 'active') = 'active'
       AND account.role = 'community_admin'`,
  );
  invariant(
    coverage.rows[0].reviewer_count === 2,
    '0078 did not backfill two independent reviewers for an open candidate',
  );
  const oversightAssignment = await client.query(
    `SELECT assignment.status, assignment.decision_reviewer_profile_id
     FROM public.candidate_admin_assignments assignment
     JOIN public.admin_review_profiles reviewer
       ON reviewer.id = assignment.admin_profile_id
     WHERE assignment.candidate_id = 'migration-activation-open-candidate'
       AND reviewer.user_id = 'migration-activation-reviewer-b'`,
  );
  invariant(
    oversightAssignment.rows[0].status === 'reassigned'
      && oversightAssignment.rows[0].decision_reviewer_profile_id === null,
    '0078 left an ORAN oversight profile in a candidate reviewer slot',
  );
  const oversightLegacyCoverage = await client.query(
    `SELECT count(*)::integer AS assignment_count,
            count(*) FILTER (
              WHERE assignment.status <> 'reassigned'
                 OR assignment.decision_reviewer_profile_id IS NOT NULL
            )::integer AS unsafe_count
     FROM public.candidate_admin_assignments assignment
     JOIN public.admin_review_profiles reviewer
       ON reviewer.id = assignment.admin_profile_id
     WHERE reviewer.user_id = 'migration-activation-reviewer-b'`,
  );
  invariant(
    oversightLegacyCoverage.rows[0].assignment_count >= 4
      && oversightLegacyCoverage.rows[0].unsafe_count === 0,
    '0078 did not reopen every pending, claimed, and completed ORAN assignment',
  );
  const reopenedCandidateAuthority = await client.query(
    `SELECT candidate.review_status,
            count(assignment.id) FILTER (
              WHERE assignment.status = 'completed'
            )::integer AS completed_count
     FROM public.extracted_candidates candidate
     LEFT JOIN public.candidate_admin_assignments assignment
       ON assignment.candidate_id = candidate.candidate_id
     WHERE candidate.candidate_id = 'migration-activation-open-candidate'
     GROUP BY candidate.candidate_id, candidate.review_status`,
  );
  invariant(
    reopenedCandidateAuthority.rows[0].review_status === 'escalated'
      && reopenedCandidateAuthority.rows[0].completed_count === 0,
    '0078 retained completed approval authority beside reopened human evidence',
  );
  const conflict = await client.query(
    `SELECT review_status
     FROM public.extracted_candidates
     WHERE candidate_id = 'migration-activation-conflict-candidate'`,
  );
  invariant(
    conflict.rows[0].review_status === 'escalated',
    '0078 left conflicting verified/rejected evidence in a terminal state',
  );
  const legacyCompletedAuthority = await client.query(
    `SELECT count(*) FILTER (
              WHERE assignment.status = 'completed'
            )::integer AS completed_count,
            count(assignment.decision_reviewer_profile_id)::integer
              AS bound_decision_count
     FROM public.candidate_admin_assignments assignment
     JOIN public.admin_review_profiles reviewer
       ON reviewer.id = assignment.admin_profile_id
     JOIN public.user_profiles account
       ON account.user_id = reviewer.user_id
     WHERE assignment.candidate_id = 'migration-activation-conflict-candidate'
       AND account.role = 'community_admin'`,
  );
  invariant(
    legacyCompletedAuthority.rows[0].completed_count === 0
      && legacyCompletedAuthority.rows[0].bound_decision_count === 0,
    '0078 grandfathered two legacy assignees as completed decision authority',
  );
  const escalatedConflict = await client.query(
    `SELECT review_status
     FROM public.extracted_candidates
     WHERE candidate_id = 'migration-activation-escalated-candidate'`,
  );
  invariant(
    escalatedConflict.rows[0].review_status === 'escalated',
    '0078 left completed escalation evidence in a verified terminal state',
  );
  const incompleteEvidence = await client.query(
    `SELECT status, claimed_at, completed_at, outcome,
            decision_reviewer_profile_id
     FROM public.candidate_admin_assignments
     WHERE candidate_id = 'migration-activation-incomplete-evidence'`,
  );
  invariant(
    incompleteEvidence.rows[0].status === 'reassigned'
      && incompleteEvidence.rows[0].claimed_at === null
      && incompleteEvidence.rows[0].completed_at === null
      && incompleteEvidence.rows[0].outcome === null
      && incompleteEvidence.rows[0].decision_reviewer_profile_id === null,
    '0078 froze incomplete legacy approval evidence as authoritative',
  );
  const reopenedTagDecision = await client.query(
    `SELECT status, assigned_to_user_id, assigned_at,
            reviewed_by_user_id, reviewed_at, modified_tag_value
     FROM public.tag_confirmation_queue
     WHERE candidate_id = 'migration-activation-open-candidate'`,
  );
  invariant(
    reopenedTagDecision.rows[0].status === 'pending'
      && reopenedTagDecision.rows[0].assigned_to_user_id === null
      && reopenedTagDecision.rows[0].assigned_at === null
      && reopenedTagDecision.rows[0].reviewed_by_user_id === null
      && reopenedTagDecision.rows[0].reviewed_at === null
      && reopenedTagDecision.rows[0].modified_tag_value === null,
    '0078 did not reopen fully attributed legacy ORAN-admin tag evidence',
  );
  const reopenedSuggestion = await client.query(
    `SELECT status, reviewed_by, reviewed_at, original_value
     FROM public.llm_suggestions
     WHERE suggestion_id = 'migration-activation-unbound-suggestion'`,
  );
  invariant(
    reopenedSuggestion.rows[0].status === 'pending'
      && reopenedSuggestion.rows[0].reviewed_by === null
      && reopenedSuggestion.rows[0].reviewed_at === null
      && reopenedSuggestion.rows[0].original_value === null,
    '0078 did not reopen fully attributed legacy ORAN-admin LLM evidence',
  );
  await client.query(
    `DELETE FROM public.tag_confirmation_queue
     WHERE candidate_id = 'migration-activation-open-candidate'`,
  );
  await client.query(
    `DELETE FROM public.resource_tags
     WHERE target_id = 'migration-activation-open-candidate'
       AND target_type = 'candidate'`,
  );
  await client.query(
    `DELETE FROM public.llm_suggestions
     WHERE candidate_id = 'migration-activation-open-candidate'`,
  );
  await client.query(
    `DELETE FROM public.candidate_admin_assignments
     WHERE candidate_id = 'migration-activation-open-candidate'`,
  );
  await client.query(
    `DELETE FROM public.extracted_candidates
     WHERE candidate_id = 'migration-activation-open-candidate'`,
  );
  console.log('  candidate reviewer activation reconciliation proof passed');
}

/**
 * Exercise the 0077 -> application -> 0078 contract on real PostgreSQL after
 * the full chain is installed. Static SQL tests guard wording; this probe proves
 * trigger order, auto-rooting, reviewer identity binding, two-person evidence,
 * immutability, audit vocabulary, and least-privilege function exposure.
 */
async function exerciseCandidateLineageWorkflow(client) {
  console.log('\nexercising activated candidate-lineage workflow');
  await client.query('BEGIN');
  try {
    const candidateColumns = `
      candidate_id, extraction_id, extract_key_sha256, extracted_at,
      organization_name, service_name, correlation_id
    `;
    const candidateValues = `
      $1, $2, $3, NOW(), $4, $5, $6
    `;

    // Root inserts remain compatible with the pre-lineage column list even
    // after 0078; the strict trigger auto-roots before NOT NULL is checked.
    const root = await client.query(
      `INSERT INTO public.extracted_candidates (${candidateColumns})
       VALUES (${candidateValues})
       RETURNING candidate_id, revision_of_candidate_id,
                 lineage_root_candidate_id, revision_number`,
      [
        'migration-proof-root',
        'migration-proof-extraction-root',
        'migration-proof-hash-root',
        'Migration proof organization',
        'Migration proof service',
        'migration-proof-correlation',
      ],
    );
    invariant(root.rows[0].revision_of_candidate_id === null, 'root unexpectedly has a parent');
    invariant(
      root.rows[0].lineage_root_candidate_id === 'migration-proof-root'
        && root.rows[0].revision_number === 1,
      'legacy-shaped root insert was not auto-rooted',
    );

    // The child omits root/revision so PostgreSQL, not application inference,
    // proves the lineage values are derived from the locked parent.
    const child = await client.query(
      `INSERT INTO public.extracted_candidates (
         ${candidateColumns}, revision_of_candidate_id
       )
       VALUES (${candidateValues}, $7)
       RETURNING lineage_root_candidate_id, revision_number`,
      [
        'migration-proof-child',
        'migration-proof-extraction-child',
        'migration-proof-hash-child',
        'Migration proof organization',
        'Migration proof service revision',
        'migration-proof-correlation',
        'migration-proof-root',
      ],
    );
    invariant(
      child.rows[0].lineage_root_candidate_id === 'migration-proof-root'
        && child.rows[0].revision_number === 2,
      'child lineage was not derived from its parent',
    );

    await client.query(
      `UPDATE public.extracted_candidates
          SET description = 'Complete materialized readiness proof',
              website_url = 'https://migration-proof.example',
              is_remote_service = true,
              confidence_score = 90,
              confidence_tier = 'green',
              score_verification = 90,
              score_completeness = 90,
              score_freshness = 90
        WHERE candidate_id = 'migration-proof-root'`,
    );
    await client.query(
      `INSERT INTO public.resource_tags (
         target_id, target_type, tag_type, tag_value, confidence, source
       )
       VALUES
         ('migration-proof-root', 'candidate', 'category', 'housing', 100, 'agent'),
         ('migration-proof-root', 'candidate', 'geographic', 'US', 100, 'system')`,
    );

    await expectDatabaseError(
      client,
      `INSERT INTO public.extracted_candidates (
         ${candidateColumns}, revision_of_candidate_id
       )
       VALUES (${candidateValues}, $7)`,
      [
        'migration-proof-sibling',
        'migration-proof-extraction-sibling',
        'migration-proof-hash-sibling',
        'Migration proof organization',
        'Conflicting sibling revision',
        'migration-proof-correlation',
        'migration-proof-root',
      ],
      '23505',
    );

    await expectDatabaseError(
      client,
      `UPDATE public.extracted_candidates
          SET revision_number = 3
        WHERE candidate_id = 'migration-proof-child'`,
      [],
      'Candidate lineage identity is immutable after insert',
    );
    await client.query(
      `UPDATE public.extracted_candidates
          SET review_status = 'in_review'
        WHERE candidate_id = 'migration-proof-root'`,
    );
    await expectDatabaseError(
      client,
      `UPDATE public.extracted_candidates
          SET description = 'mutated reviewed evidence'
        WHERE candidate_id = 'migration-proof-root'`,
      [],
      'Reviewed candidate content is immutable; append a child revision',
    );
    await expectDatabaseError(
      client,
      `UPDATE public.extracted_candidates
          SET confidence_score = 91
        WHERE candidate_id = 'migration-proof-root'`,
      [],
      'Reviewed candidate content is immutable; append a child revision',
    );

    await client.query(
      `INSERT INTO public.user_profiles (user_id, clerk_user_id, role)
       VALUES
         ('migration-proof-reviewer-a', 'clerk-migration-proof-reviewer-a', 'community_admin'),
         ('migration-proof-reviewer-b', 'clerk-migration-proof-reviewer-b', 'oran_admin'),
         ('migration-proof-reviewer-c', 'clerk-migration-proof-reviewer-c', 'community_admin'),
         ('migration-proof-reviewer-d', 'clerk-migration-proof-reviewer-d', 'community_admin'),
         ('migration-proof-reviewer-e', 'clerk-migration-proof-reviewer-e', 'community_admin')`,
    );
    const reviewers = await client.query(
      `INSERT INTO public.admin_review_profiles (user_id)
       VALUES
         ('migration-proof-reviewer-a'),
         ('migration-proof-reviewer-b'),
         ('migration-proof-reviewer-c'),
         ('migration-proof-reviewer-d'),
         ('migration-proof-reviewer-e')
       RETURNING id, user_id`,
    );
    const reviewerByUser = new Map(
      reviewers.rows.map((row) => [row.user_id, row.id]),
    );

    await expectDatabaseError(
      client,
      `INSERT INTO public.admin_review_profiles (user_id)
       VALUES ('migration-proof-reviewer-a')`,
      [],
      '23505',
    );

    const completeVerifiedApproval = async (candidateId, reviewerUserId) => {
      const assignment = await client.query(
        `INSERT INTO public.candidate_admin_assignments (
           candidate_id, admin_profile_id, status
         )
         VALUES ($1, $2, 'pending')
         RETURNING id`,
        [candidateId, reviewerByUser.get(reviewerUserId)],
      );
      await client.query(
        `UPDATE public.candidate_admin_assignments
            SET status = 'claimed', claimed_at = NOW()
          WHERE id = $1`,
        [assignment.rows[0].id],
      );
      const completed = await client.query(
        `UPDATE public.candidate_admin_assignments
            SET status = 'completed', outcome = 'verified', completed_at = NOW()
          WHERE id = $1
          RETURNING decision_reviewer_profile_id`,
        [assignment.rows[0].id],
      );
      invariant(
        completed.rows[0].decision_reviewer_profile_id
          === reviewerByUser.get(reviewerUserId),
        'completion trigger did not bind the authorized reviewer profile',
      );
    };

    const pendingEvidenceAssignment = await client.query(
      `INSERT INTO public.candidate_admin_assignments (
         candidate_id, admin_profile_id, status
       )
       VALUES ('migration-proof-root', $1, 'pending')
       RETURNING id`,
      [reviewerByUser.get('migration-proof-reviewer-a')],
    );
    await client.query(
      `UPDATE public.candidate_admin_assignments
          SET status = 'claimed', claimed_at = NOW()
        WHERE id = $1`,
      [pendingEvidenceAssignment.rows[0].id],
    );
    await client.query(
      `INSERT INTO public.llm_suggestions (
         candidate_id, suggestion_id, field, suggested_value,
         original_value, confidence, status
       )
       VALUES (
         'migration-proof-root', 'migration-proof-pending-suggestion',
         'description', 'Pending corrected description',
         'Complete materialized readiness proof', 90, 'pending'
       )`,
    );
    for (const outcome of ['verified', 'rejected', 'escalated']) {
      await expectDatabaseError(
        client,
        `UPDATE public.candidate_admin_assignments
            SET status = 'completed', outcome = $2, completed_at = NOW()
          WHERE id = $1`,
        [pendingEvidenceAssignment.rows[0].id, outcome],
        'Candidate approval completion requires all LLM suggestions to be resolved',
      );
    }
    await client.query(
      `SELECT public.evaluate_candidate_readiness('migration-proof-root')`,
    );
    const pendingEvidenceReadiness = await client.query(
      `SELECT is_ready, blockers
       FROM public.candidate_readiness
       WHERE candidate_id = 'migration-proof-root'`,
    );
    invariant(
      !pendingEvidenceReadiness.rows[0].is_ready
        && pendingEvidenceReadiness.rows[0].blockers.includes('pending_llm_suggestion'),
      'pending LLM evidence did not block database readiness',
    );
    await client.query(
      `DELETE FROM public.llm_suggestions
       WHERE suggestion_id = 'migration-proof-pending-suggestion'`,
    );
    const completedAfterResolution = await client.query(
      `UPDATE public.candidate_admin_assignments
          SET status = 'completed', outcome = 'verified', completed_at = NOW()
        WHERE id = $1
        RETURNING decision_reviewer_profile_id`,
      [pendingEvidenceAssignment.rows[0].id],
    );
    invariant(
      completedAfterResolution.rows[0].decision_reviewer_profile_id
        === reviewerByUser.get('migration-proof-reviewer-a'),
      'resolved evidence did not permit an authorized approval completion',
    );
    await expectDatabaseError(
      client,
      `INSERT INTO public.llm_suggestions (
         candidate_id, suggestion_id, field, suggested_value,
         original_value, confidence, status
       )
       VALUES (
         'migration-proof-root', 'migration-proof-late-pending-suggestion',
         'description', 'Late pending correction',
         'Complete materialized readiness proof', 90, 'pending'
       )`,
      [],
      'Pending LLM suggestion evidence cannot be introduced after a completed review',
    );
    await completeVerifiedApproval(
      'migration-proof-root',
      'migration-proof-reviewer-c',
    );

    const oversightOnlyAssignment = await client.query(
      `INSERT INTO public.candidate_admin_assignments (
         candidate_id, admin_profile_id, status
       )
       VALUES ('migration-proof-root', $1, 'pending')
       RETURNING id`,
      [reviewerByUser.get('migration-proof-reviewer-b')],
    );
    await client.query(
      `UPDATE public.candidate_admin_assignments
          SET status = 'claimed', claimed_at = NOW()
        WHERE id = $1`,
      [oversightOnlyAssignment.rows[0].id],
    );
    await expectDatabaseError(
      client,
      `UPDATE public.candidate_admin_assignments
          SET status = 'completed', outcome = 'verified', completed_at = NOW()
        WHERE id = $1`,
      [oversightOnlyAssignment.rows[0].id],
      'Candidate approval completion requires an active authorized community reviewer',
    );
    const oversightOnlyEvidence = await client.query(
      `UPDATE public.candidate_admin_assignments
          SET status = 'reassigned', claimed_at = NULL
        WHERE id = $1
        RETURNING decision_reviewer_profile_id`,
      [oversightOnlyAssignment.rows[0].id],
    );
    invariant(
      oversightOnlyEvidence.rows[0].decision_reviewer_profile_id === null,
      'ORAN oversight profile produced candidate decision evidence',
    );

    const approvals = await client.query(
      `SELECT count(DISTINCT decision_reviewer_profile_id)::integer AS approval_count
       FROM public.candidate_admin_assignments
       WHERE candidate_id = 'migration-proof-root'
         AND status = 'completed'
         AND outcome = 'verified'`,
    );
    invariant(
      approvals.rows[0].approval_count === 2,
      'two distinct completed reviewer identities were not preserved',
    );

    await client.query(
      `SELECT public.evaluate_candidate_readiness('migration-proof-root')`,
    );
    let readiness = await client.query(
      `SELECT is_ready, has_required_fields, has_required_tags,
              tags_confirmed, meets_score_threshold, has_admin_approval,
              admin_approval_count, blockers
       FROM public.candidate_readiness
       WHERE candidate_id = 'migration-proof-root'`,
    );
    invariant(
      readiness.rows[0].is_ready
        && readiness.rows[0].has_required_fields
        && readiness.rows[0].has_required_tags
        && readiness.rows[0].tags_confirmed
        && readiness.rows[0].meets_score_threshold
        && readiness.rows[0].has_admin_approval
        && readiness.rows[0].admin_approval_count === 2,
      'complete category/geographic candidate did not become ready after two approvals',
    );
    invariant(
      Array.isArray(readiness.rows[0].blockers)
        && readiness.rows[0].blockers.length === 0,
      'complete candidate retained unexpected readiness blockers',
    );

    // Candidate approval evidence must survive account erasure without
    // retaining the reviewer's raw ORAN or Clerk identity. The immutable UUID
    // profile identity remains referentially valid while the profile itself is
    // tombstoned by the real bounded erasure workflow.
    await client.query(
      `INSERT INTO public.ingestion_audit_events
         (candidate_id, event_type, actor_type, actor_id)
       VALUES
         ('migration-proof-root', 'approval.claimed', 'human', 'migration-proof-reviewer-a'),
         ('migration-proof-root', 'approval.decided', 'human', 'migration-proof-reviewer-c')`,
    );
    const erasureRequest = await client.query(
      `SELECT request_id
       FROM oran_internal.queue_account_erasure($1, $2, $3, $4::uuid)`,
      [
        'migration-proof-reviewer-a',
        'clerk-migration-proof-reviewer-a',
        'deleted-user:00000000-0000-4000-8000-0000000000a1',
        '00000000-0000-4000-8000-0000000000a2',
      ],
    );
    const erasureRequestId = erasureRequest.rows[0].request_id;
    await client.query(
      'SELECT oran_internal.mark_clerk_account_deleted($1, $2, $3)',
      [
        erasureRequestId,
        'migration-proof-reviewer-a',
        'clerk-migration-proof-reviewer-a',
      ],
    );
    let erasureCompleted = false;
    for (let pageNumber = 0; pageNumber < 200; pageNumber += 1) {
      const page = await client.query(
        'SELECT * FROM oran_internal.process_account_erasure_page($1, 500)',
        [erasureRequestId],
      );
      if (page.rows[0]?.completed) {
        erasureCompleted = true;
        break;
      }
    }
    invariant(erasureCompleted, 'reviewer account erasure did not complete');

    const erasedApproval = await client.query(
      `SELECT assignment.id,
              assignment.admin_profile_id,
              assignment.decision_reviewer_profile_id,
              pg_catalog.to_jsonb(assignment)::text AS evidence_text,
              reviewer.user_id AS reviewer_user_id
       FROM public.candidate_admin_assignments assignment
       JOIN public.admin_review_profiles reviewer
         ON reviewer.id = assignment.decision_reviewer_profile_id
       WHERE assignment.candidate_id = 'migration-proof-root'
         AND assignment.admin_profile_id = $1`,
      [reviewerByUser.get('migration-proof-reviewer-a')],
    );
    invariant(
      erasedApproval.rowCount === 1
        && erasedApproval.rows[0].decision_reviewer_profile_id
          === erasedApproval.rows[0].admin_profile_id
        && erasedApproval.rows[0].reviewer_user_id
          === 'deleted-user:00000000-0000-4000-8000-0000000000a1'
        && !erasedApproval.rows[0].evidence_text.includes('migration-proof-reviewer-a')
        && !erasedApproval.rows[0].evidence_text.includes(
          'clerk-migration-proof-reviewer-a',
        ),
      'account erasure left raw identity in completed candidate approval evidence',
    );
    const erasedApprovalAudit = await client.query(
      `SELECT COALESCE(
         pg_catalog.jsonb_agg(pg_catalog.to_jsonb(event))::text,
         '[]'
       ) AS evidence_text
       FROM public.ingestion_audit_events event
       WHERE event.candidate_id = 'migration-proof-root'`,
    );
    invariant(
      !erasedApprovalAudit.rows[0].evidence_text.includes('migration-proof-reviewer-a')
        && !erasedApprovalAudit.rows[0].evidence_text.includes(
          'clerk-migration-proof-reviewer-a',
        ),
      'account erasure left raw identity in candidate approval audit evidence',
    );
    await client.query(
      `SELECT public.evaluate_candidate_readiness('migration-proof-root')`,
    );
    const postErasureReadiness = await client.query(
      `SELECT is_ready, has_admin_approval, admin_approval_count
       FROM public.candidate_readiness
       WHERE candidate_id = 'migration-proof-root'`,
    );
    invariant(
      postErasureReadiness.rows[0].is_ready
        && postErasureReadiness.rows[0].has_admin_approval
        && postErasureReadiness.rows[0].admin_approval_count === 2,
      'account erasure invalidated durable completed approval evidence',
    );
    await expectDatabaseError(
      client,
      `UPDATE public.candidate_admin_assignments
          SET outcome = 'rejected'
        WHERE id = $1`,
      [erasedApproval.rows[0].id],
      'Completed candidate approval evidence is immutable',
    );
    console.log('  reviewer account-erasure approval privacy proof passed');

    const safetyCandidateIds = [
      'migration-proof-incomplete',
      'migration-proof-quarantine',
      'migration-proof-critical-failure',
      'migration-proof-domain-failure',
      'migration-proof-escalated-consensus',
      'migration-proof-rejected-category',
    ];
    await client.query(
      `INSERT INTO public.extracted_candidates (
         candidate_id, extraction_id, extract_key_sha256, extracted_at,
         organization_name, service_name, description, website_url,
         is_remote_service, confidence_score, confidence_tier, correlation_id
       )
       VALUES
         (
           'migration-proof-incomplete', 'migration-proof-extraction-incomplete',
           'migration-proof-hash-incomplete', NOW(), 'Incomplete organization',
           'Incomplete service', NULL, NULL, false, 90, 'green',
           'migration-proof-correlation-incomplete'
         ),
         (
           'migration-proof-quarantine', 'migration-proof-extraction-quarantine',
           'migration-proof-hash-quarantine', NOW(), 'Quarantine organization',
           'Quarantine service', 'Complete description',
           'https://quarantine.example', true, 90, 'green',
           'migration-proof-correlation-quarantine'
         ),
         (
           'migration-proof-critical-failure', 'migration-proof-extraction-critical',
           'migration-proof-hash-critical', NOW(), 'Critical organization',
           'Critical service', 'Complete description',
           'https://critical.example', true, 90, 'green',
           'migration-proof-correlation-critical'
         ),
         (
           'migration-proof-domain-failure', 'migration-proof-extraction-domain',
           'migration-proof-hash-domain', NOW(), 'Domain organization',
           'Domain service', 'Complete description',
           'https://domain.example', true, 90, 'green',
           'migration-proof-correlation-domain'
         ),
         (
           'migration-proof-escalated-consensus', 'migration-proof-extraction-escalated',
           'migration-proof-hash-escalated', NOW(), 'Escalated organization',
           'Escalated service', 'Complete description',
           'https://escalated.example', true, 90, 'green',
           'migration-proof-correlation-escalated'
         ),
         (
           'migration-proof-rejected-category', 'migration-proof-extraction-rejected-category',
           'migration-proof-hash-rejected-category', NOW(), 'Rejected category organization',
           'Rejected category service', 'Complete description',
           'https://rejected-category.example', true, 90, 'green',
           'migration-proof-correlation-rejected-category'
         ),
         (
           'migration-proof-mixed-category', 'migration-proof-extraction-mixed-category',
           'migration-proof-hash-mixed-category', NOW(), 'Mixed category organization',
           'Mixed category service', 'Complete description',
           'https://mixed-category.example', true, 90, 'green',
           'migration-proof-correlation-mixed-category'
         )`,
    );
    await client.query(
      `INSERT INTO public.resource_tags (
         target_id, target_type, tag_type, tag_value, confidence, source
       )
       VALUES
         ('migration-proof-incomplete', 'candidate', 'category', 'housing', 100, 'agent'),
         ('migration-proof-incomplete', 'candidate', 'geographic', 'US', 100, 'system'),
         ('migration-proof-quarantine', 'candidate', 'category', 'housing', 100, 'agent'),
         ('migration-proof-quarantine', 'candidate', 'geographic', 'US', 100, 'system'),
         ('migration-proof-quarantine', 'candidate', 'source_quality', 'quarantine_source', 100, 'system'),
         ('migration-proof-critical-failure', 'candidate', 'category', 'housing', 100, 'agent'),
         ('migration-proof-critical-failure', 'candidate', 'geographic', 'US', 100, 'system'),
         ('migration-proof-domain-failure', 'candidate', 'category', 'housing', 100, 'agent'),
         ('migration-proof-domain-failure', 'candidate', 'geographic', 'US', 100, 'system'),
         ('migration-proof-escalated-consensus', 'candidate', 'category', 'housing', 100, 'agent'),
         ('migration-proof-escalated-consensus', 'candidate', 'geographic', 'US', 100, 'system'),
         ('migration-proof-rejected-category', 'candidate', 'category', 'rejected_only', 40, 'agent'),
         ('migration-proof-rejected-category', 'candidate', 'geographic', 'US', 100, 'system'),
         ('migration-proof-mixed-category', 'candidate', 'category', 'accepted_high', 100, 'agent'),
         ('migration-proof-mixed-category', 'candidate', 'category', 'rejected_low', 40, 'agent'),
         ('migration-proof-mixed-category', 'candidate', 'geographic', 'US', 100, 'system')`,
    );
    await client.query(
      `INSERT INTO public.tag_confirmation_queue (
         resource_tag_id, candidate_id, tag_type, tag_value,
         original_confidence, status, reviewed_by_user_id, reviewed_at
       )
       SELECT
         tag.id,
         tag.target_id,
         tag.tag_type,
         tag.tag_value,
         COALESCE(tag.confidence, 0),
         'rejected',
         'migration-proof-reviewer-c',
         NOW()
       FROM public.resource_tags tag
       WHERE tag.target_id IN (
         'migration-proof-rejected-category',
         'migration-proof-mixed-category'
       )
         AND tag.tag_type = 'category'
         AND tag.tag_value IN ('rejected_only', 'rejected_low')`,
    );
    await client.query(
      `INSERT INTO public.verification_checks (
         candidate_id, check_type, severity, status
       )
       VALUES
         ('migration-proof-critical-failure', 'contact_validity', 'critical', 'fail'),
         ('migration-proof-domain-failure', 'domain_allowlist', 'warning', 'fail')`,
    );

    for (const candidateId of safetyCandidateIds) {
      for (const reviewerUserId of [
        'migration-proof-reviewer-c',
        'migration-proof-reviewer-d',
      ]) {
        await completeVerifiedApproval(candidateId, reviewerUserId);
      }
      if (candidateId === 'migration-proof-escalated-consensus') {
        const escalatedAssignment = await client.query(
          `INSERT INTO public.candidate_admin_assignments (
             candidate_id, admin_profile_id, status
           )
           VALUES ($1, $2, 'pending')
           RETURNING id`,
          [candidateId, reviewerByUser.get('migration-proof-reviewer-e')],
        );
        await client.query(
          `UPDATE public.candidate_admin_assignments
              SET status = 'claimed', claimed_at = NOW()
            WHERE id = $1`,
          [escalatedAssignment.rows[0].id],
        );
        await client.query(
          `UPDATE public.candidate_admin_assignments
              SET status = 'completed', outcome = 'escalated', completed_at = NOW()
            WHERE id = $1`,
          [escalatedAssignment.rows[0].id],
        );
      }
      await client.query(
        'SELECT public.evaluate_candidate_readiness($1)',
        [candidateId],
      );
    }

    for (const reviewerUserId of [
      'migration-proof-reviewer-c',
      'migration-proof-reviewer-d',
    ]) {
      await completeVerifiedApproval('migration-proof-mixed-category', reviewerUserId);
    }
    await client.query(
      `SELECT public.evaluate_candidate_readiness('migration-proof-mixed-category')`,
    );

    const safetyReadiness = await client.query(
      `SELECT candidate_id, is_ready, has_admin_approval,
              admin_approval_count, blockers
       FROM public.candidate_readiness
       WHERE candidate_id = ANY($1::text[])`,
      [safetyCandidateIds],
    );
    const expectedSafetyBlocker = new Map([
      ['migration-proof-incomplete', 'missing_required_fields'],
      ['migration-proof-quarantine', 'quarantine_source'],
      ['migration-proof-critical-failure', 'critical_verification_failure'],
      ['migration-proof-domain-failure', 'domain_allowlist_failed'],
      ['migration-proof-escalated-consensus', 'candidate_escalated'],
      ['migration-proof-rejected-category', 'missing_required_tags'],
    ]);
    for (const row of safetyReadiness.rows) {
      const approvalExpected =
        row.candidate_id !== 'migration-proof-escalated-consensus';
      invariant(
        !row.is_ready
          && row.has_admin_approval === approvalExpected
          && row.admin_approval_count === 2
          && Array.isArray(row.blockers)
          && row.blockers.includes(expectedSafetyBlocker.get(row.candidate_id)),
        `two approvals erased the ${expectedSafetyBlocker.get(row.candidate_id)} safety blocker`,
      );
    }
    invariant(
      safetyReadiness.rowCount === safetyCandidateIds.length,
      'readiness safety fixtures were not all evaluated',
    );
    const mixedCategoryReadiness = await client.query(
      `SELECT is_ready, has_required_tags, has_admin_approval, blockers
       FROM public.candidate_readiness
       WHERE candidate_id = 'migration-proof-mixed-category'`,
    );
    invariant(
      mixedCategoryReadiness.rows[0].is_ready
        && mixedCategoryReadiness.rows[0].has_required_tags
        && mixedCategoryReadiness.rows[0].has_admin_approval
        && mixedCategoryReadiness.rows[0].blockers.length === 0,
      'a rejected low-confidence category suppressed a separate publishable category',
    );

    const rejectingAssignment = await client.query(
      `INSERT INTO public.candidate_admin_assignments (
         candidate_id, admin_profile_id, status
       )
       VALUES ('migration-proof-root', $1, 'pending')
       RETURNING id`,
      [reviewerByUser.get('migration-proof-reviewer-d')],
    );
    await client.query(
      `UPDATE public.candidate_admin_assignments
          SET status = 'claimed', claimed_at = NOW()
        WHERE id = $1`,
      [rejectingAssignment.rows[0].id],
    );
    await client.query(
      `UPDATE public.candidate_admin_assignments
          SET status = 'completed', outcome = 'rejected', completed_at = NOW()
        WHERE id = $1`,
      [rejectingAssignment.rows[0].id],
    );
    await client.query(
      `SELECT public.evaluate_candidate_readiness('migration-proof-root')`,
    );
    readiness = await client.query(
      `SELECT is_ready, has_admin_approval, admin_approval_count, blockers
       FROM public.candidate_readiness
       WHERE candidate_id = 'migration-proof-root'`,
    );
    invariant(
      !readiness.rows[0].is_ready
        && !readiness.rows[0].has_admin_approval
        && readiness.rows[0].admin_approval_count === 2
        && readiness.rows[0].blockers.includes('candidate_rejected'),
      'a completed rejection did not fail the readiness gate closed',
    );

    const firstAssignment = await client.query(
      `SELECT id
       FROM public.candidate_admin_assignments
       WHERE candidate_id = 'migration-proof-root'
         AND status = 'completed'
       ORDER BY created_at, id
       LIMIT 1`,
    );
    await expectDatabaseError(
      client,
      `UPDATE public.candidate_admin_assignments
          SET outcome = 'rejected'
        WHERE id = $1`,
      [firstAssignment.rows[0].id],
      'Completed candidate approval evidence is immutable',
    );

    const criteria = await client.query(
      'SELECT count(*)::integer AS weak_count FROM public.publish_criteria WHERE min_admin_approvals < 2',
    );
    invariant(criteria.rows[0].weak_count === 0, 'publish criteria still allow one-person approval');

    await client.query(
      'UPDATE public.admin_review_profiles SET is_active = false',
    );
    await client.query(
      `INSERT INTO public.user_profiles (user_id, role)
       VALUES
         ('migration-routing-county', 'community_admin'),
         ('migration-routing-state', 'community_admin'),
         ('migration-routing-unrestricted', 'community_admin'),
         ('migration-routing-oversight', 'oran_admin'),
         ('migration-routing-other-county', 'community_admin')`,
    );
    await client.query(
      `INSERT INTO public.admin_review_profiles (
         user_id, coverage_states, coverage_counties, category_expertise
       )
       VALUES
         ('migration-routing-county', '{}', ARRAY['WA_KING'], '{}'),
         ('migration-routing-state', ARRAY['WA'], '{}', ARRAY['housing']),
         ('migration-routing-unrestricted', '{}', '{}', ARRAY['housing']),
         ('migration-routing-oversight', '{}', ARRAY['WA_KING'], ARRAY['housing']),
         ('migration-routing-other-county', '{}', ARRAY['WA_PIERCE'], ARRAY['housing'])`,
    );
    await client.query(
      `INSERT INTO public.extracted_candidates (
         candidate_id, extraction_id, extract_key_sha256, extracted_at,
         organization_name, service_name, jurisdiction_state,
         jurisdiction_county, correlation_id
       )
       VALUES
         (
           'migration-routing-ranked', 'migration-routing-ranked-extraction',
           'migration-routing-ranked-hash', NOW(), 'Routing organization',
           'Routing service', 'wa', 'King', 'migration-routing-ranked-correlation'
         ),
         (
           'migration-routing-exhausted', 'migration-routing-exhausted-extraction',
           'migration-routing-exhausted-hash', NOW(), 'Exhausted organization',
           'Exhausted service', 'WA', 'KING', 'migration-routing-exhausted-correlation'
         )`,
    );
    await client.query(
      `INSERT INTO public.resource_tags (
         target_id, target_type, tag_type, tag_value, confidence, source
       )
       VALUES
         ('migration-routing-ranked', 'candidate', 'category', 'housing', 95, 'agent'),
         ('migration-routing-exhausted', 'candidate', 'category', 'housing', 95, 'agent')`,
    );
    const rankedRouting = await client.query(
      `SELECT oran_internal.assign_candidate_reviewers(
         'migration-routing-ranked', 3
       )::integer AS reviewer_count`,
    );
    invariant(
      rankedRouting.rows[0].reviewer_count === 3,
      'jurisdiction-aware routing did not cover the candidate with three reviewers',
    );
    const rankedReviewers = await client.query(
      `SELECT reviewer.user_id
       FROM public.candidate_admin_assignments assignment
       JOIN public.admin_review_profiles reviewer
         ON reviewer.id = assignment.admin_profile_id
       WHERE assignment.candidate_id = 'migration-routing-ranked'
       ORDER BY assignment.priority_rank`,
    );
    invariant(
      JSON.stringify(rankedReviewers.rows.map((row) => row.user_id)) === JSON.stringify([
        'migration-routing-county',
        'migration-routing-state',
        'migration-routing-unrestricted',
      ]),
      'reviewer routing did not prefer county, then state, then unrestricted coverage',
    );
    const idempotentRouting = await client.query(
      `SELECT oran_internal.assign_candidate_reviewers(
         'migration-routing-ranked', 3
       )::integer AS reviewer_count`,
    );
    invariant(
      idempotentRouting.rows[0].reviewer_count === 3,
      'reviewer routing returned newly inserted rows instead of total qualifying identities',
    );
    await client.query(
      `UPDATE public.admin_review_profiles
       SET is_accepting_new = false
       WHERE user_id IN (
         'migration-routing-state',
         'migration-routing-unrestricted'
       )`,
    );
    const exhaustedRouting = await client.query(
      `SELECT oran_internal.assign_candidate_reviewers(
         'migration-routing-exhausted', 2
       )::integer AS reviewer_count`,
    );
    invariant(
      exhaustedRouting.rows[0].reviewer_count === 1,
      'reviewer routing did not report capacity/coverage exhaustion',
    );
    const exhaustedReviewer = await client.query(
      `SELECT reviewer.user_id
       FROM public.candidate_admin_assignments assignment
       JOIN public.admin_review_profiles reviewer
         ON reviewer.id = assignment.admin_profile_id
       WHERE assignment.candidate_id = 'migration-routing-exhausted'`,
    );
    invariant(
      exhaustedReviewer.rows.length === 1
        && exhaustedReviewer.rows[0].user_id === 'migration-routing-county',
      'reviewer routing assigned a profile explicitly covering another region',
    );
    await client.query(
      `INSERT INTO public.user_profiles (user_id, role)
       VALUES
         ('migration-routing-replacement-a', 'community_admin'),
         ('migration-routing-replacement-b', 'community_admin');

       INSERT INTO public.admin_review_profiles (
         user_id, coverage_states, coverage_counties, category_expertise
       )
       VALUES
         ('migration-routing-replacement-a', ARRAY['WA'], '{}', ARRAY['housing']),
         ('migration-routing-replacement-b', '{}', '{}', ARRAY['housing']);`,
    );

    // Overdue leases and no-longer-eligible assignments are repaired inside
    // the candidate lock before coverage is counted. Vacation mode releases
    // unclaimed work but never evicts an otherwise-authorized claimed review.
    await client.query(
      `UPDATE public.candidate_admin_assignments assignment
          SET status = 'claimed',
              claimed_at = NOW(),
              expires_at = NOW() - interval '1 hour'
         FROM public.admin_review_profiles reviewer
        WHERE assignment.admin_profile_id = reviewer.id
          AND assignment.candidate_id = 'migration-routing-ranked'
          AND reviewer.user_id = 'migration-routing-county'`,
    );
    await client.query(
      `UPDATE public.candidate_admin_assignments assignment
          SET status = 'claimed', claimed_at = NOW()
         FROM public.admin_review_profiles reviewer
        WHERE assignment.admin_profile_id = reviewer.id
          AND assignment.candidate_id = 'migration-routing-ranked'
          AND reviewer.user_id = 'migration-routing-unrestricted'`,
    );
    const repairedRouting = await client.query(
      `SELECT oran_internal.assign_candidate_reviewers(
         'migration-routing-ranked', 3
       )::integer AS reviewer_count`,
    );
    invariant(
      repairedRouting.rows[0].reviewer_count === 3,
      'reviewer routing did not restore three current reviewer identities',
    );
    const repairedAssignments = await client.query(
      `SELECT reviewer.user_id, assignment.status,
              assignment.expires_at <= NOW() AS overdue
         FROM public.candidate_admin_assignments assignment
         JOIN public.admin_review_profiles reviewer
           ON reviewer.id = assignment.admin_profile_id
        WHERE assignment.candidate_id = 'migration-routing-ranked'`,
    );
    const repairedByReviewer = new Map(
      repairedAssignments.rows.map((row) => [row.user_id, row]),
    );
    invariant(
      repairedByReviewer.get('migration-routing-county')?.status === 'expired'
        && repairedByReviewer.get('migration-routing-county')?.overdue
        && repairedByReviewer.get('migration-routing-state')?.status === 'reassigned'
        && repairedByReviewer.get('migration-routing-unrestricted')?.status === 'claimed'
        && repairedByReviewer.get('migration-routing-replacement-a')?.status === 'pending'
        && repairedByReviewer.get('migration-routing-replacement-b')?.status === 'pending',
      'expiry, vacation, or claimed-review rerouting semantics drifted',
    );

    await client.query(
      `UPDATE public.candidate_admin_assignments assignment
          SET status = 'claimed', claimed_at = NOW(),
              expires_at = NOW() + interval '1 hour'
         FROM public.admin_review_profiles reviewer
        WHERE assignment.admin_profile_id = reviewer.id
          AND assignment.candidate_id = 'migration-routing-exhausted'
          AND reviewer.user_id = 'migration-routing-county'`,
    );
    await client.query(
      `UPDATE public.user_profiles
          SET role = 'oran_admin'
        WHERE user_id = 'migration-routing-county'`,
    );
    const authorityRepair = await client.query(
      `SELECT oran_internal.assign_candidate_reviewers(
         'migration-routing-exhausted', 2
       )::integer AS reviewer_count`,
    );
    const invalidClaim = await client.query(
      `SELECT assignment.status
         FROM public.candidate_admin_assignments assignment
         JOIN public.admin_review_profiles reviewer
           ON reviewer.id = assignment.admin_profile_id
        WHERE assignment.candidate_id = 'migration-routing-exhausted'
          AND reviewer.user_id = 'migration-routing-county'`,
    );
    invariant(
      authorityRepair.rows[0].reviewer_count === 2
        && invalidClaim.rows[0].status === 'reassigned',
      'a claimed assignment survived loss of community-reviewer authority',
    );

    await client.query(
      `INSERT INTO public.extracted_candidates (
         candidate_id, extraction_id, extract_key_sha256, extracted_at,
         organization_name, service_name, jurisdiction_state,
         jurisdiction_county, correlation_id, created_at
       )
       VALUES (
         '000-migration-routing-batch', 'migration-routing-batch-extraction',
         'migration-routing-batch-hash', NOW(), 'Batch routing organization',
         'Batch routing service', 'WA', 'KING',
         'migration-routing-batch-correlation', NOW() - interval '1 day'
       )`,
    );
    const batchRouting = await client.query(
      `SELECT routed.candidate_id
         FROM oran_internal.list_undercovered_candidate_reviews(1, 2)
           AS routed(candidate_id)`,
    );
    invariant(
      batchRouting.rowCount === 1
        && batchRouting.rows[0].candidate_id === '000-migration-routing-batch',
      'bounded selector did not return only the oldest under-covered candidate ID',
    );
    const selectorMutation = await client.query(
      `SELECT count(*)::integer AS assignment_count
         FROM public.candidate_admin_assignments
        WHERE candidate_id = '000-migration-routing-batch'`,
    );
    invariant(
      selectorMutation.rows[0].assignment_count === 0,
      'undercoverage selector mutated reviewer assignments',
    );
    const batchSelectionState = await client.query(
      `SELECT selection_count,
              last_selected_at < next_selectable_at AS retry_window_valid
         FROM oran_internal.candidate_reviewer_routing_state
        WHERE candidate_id = '000-migration-routing-batch'`,
    );
    invariant(
      batchSelectionState.rowCount === 1
        && batchSelectionState.rows[0].selection_count === 1
        && batchSelectionState.rows[0].retry_window_valid,
      'bounded selector did not atomically advance private retry state',
    );
    const batchAssignment = await client.query(
      `SELECT oran_internal.assign_candidate_reviewers(
         '000-migration-routing-batch', 2
       )::integer AS reviewer_count`,
    );
    invariant(
      batchAssignment.rows[0].reviewer_count === 2,
      'selected candidate could not be routed in an isolated assignment call',
    );
    const completedSelectionState = await client.query(
      `SELECT count(*)::integer AS state_count
         FROM oran_internal.candidate_reviewer_routing_state
        WHERE candidate_id = '000-migration-routing-batch'`,
    );
    invariant(
      completedSelectionState.rows[0].state_count === 0,
      'successful reviewer routing retained stale selector retry state',
    );

    // A selected candidate that remains impossible to route must enter a
    // bounded backoff before the next page. Otherwise an oldest-first LIMIT 1
    // would return the same permanent prefix and never reach later work.
    await client.query(
      `INSERT INTO public.extracted_candidates (
         candidate_id, extraction_id, extract_key_sha256, extracted_at,
         organization_name, service_name, jurisdiction_state,
         jurisdiction_county, correlation_id, created_at
       )
       VALUES
         (
           'migration-routing-fair-oldest', 'migration-routing-fair-oldest-extraction',
           'migration-routing-fair-oldest-hash', NOW(), 'Fair routing organization',
           'Fair routing oldest service', 'WA', 'KING',
           'migration-routing-fair-oldest-correlation', NOW() - interval '3 days'
         ),
         (
           'migration-routing-fair-later', 'migration-routing-fair-later-extraction',
           'migration-routing-fair-later-hash', NOW(), 'Fair routing organization',
           'Fair routing later service', 'WA', 'KING',
           'migration-routing-fair-later-correlation', NOW() - interval '2 days'
         )`,
    );
    await client.query(
      `CREATE TEMP TABLE migration_routing_accepting_snapshot AS
       SELECT id, is_accepting_new
       FROM public.admin_review_profiles`,
    );
    await client.query(
      'UPDATE public.admin_review_profiles SET is_accepting_new = false',
    );
    try {
      const oldestFairSelection = await client.query(
        `SELECT routed.candidate_id
           FROM oran_internal.list_undercovered_candidate_reviews(1, 2)
             AS routed(candidate_id)`,
      );
      invariant(
        oldestFairSelection.rowCount === 1
          && oldestFairSelection.rows[0].candidate_id === 'migration-routing-fair-oldest',
        'fair selector did not preserve oldest-first priority for never-selected work',
      );
      const impossibleRouting = await client.query(
        `SELECT oran_internal.assign_candidate_reviewers(
           'migration-routing-fair-oldest', 2
         )::integer AS reviewer_count`,
      );
      invariant(
        impossibleRouting.rows[0].reviewer_count === 0,
        'fair selector fixture unexpectedly found reviewer capacity',
      );
      const laterFairSelection = await client.query(
        `SELECT routed.candidate_id
           FROM oran_internal.list_undercovered_candidate_reviews(1, 2)
             AS routed(candidate_id)`,
      );
      invariant(
        laterFairSelection.rowCount === 1
          && laterFairSelection.rows[0].candidate_id === 'migration-routing-fair-later',
        'a permanently under-covered prefix starved later candidate work',
      );
      const fairSelectionState = await client.query(
        `SELECT count(*)::integer AS state_count,
                min(selection_count)::integer AS minimum_selection_count,
                bool_and(next_selectable_at > last_selected_at) AS retry_windows_valid
           FROM oran_internal.candidate_reviewer_routing_state
          WHERE candidate_id IN (
            'migration-routing-fair-oldest',
            'migration-routing-fair-later'
          )`,
      );
      invariant(
        fairSelectionState.rows[0].state_count === 2
          && fairSelectionState.rows[0].minimum_selection_count === 1
          && fairSelectionState.rows[0].retry_windows_valid,
        'fair selector did not retain bounded per-candidate retry state',
      );
    } finally {
      await client.query(
        `UPDATE public.admin_review_profiles reviewer
            SET is_accepting_new = snapshot.is_accepting_new
           FROM migration_routing_accepting_snapshot snapshot
          WHERE snapshot.id = reviewer.id`,
      );
      await client.query('DROP TABLE migration_routing_accepting_snapshot');
    }
    const fairCoverage = await client.query(
      `SELECT candidate_id,
              oran_internal.assign_candidate_reviewers(candidate_id, 2)::integer
                AS reviewer_count
         FROM pg_catalog.unnest(ARRAY[
           'migration-routing-fair-oldest',
           'migration-routing-fair-later'
         ]::text[]) AS candidate(candidate_id)`,
    );
    invariant(
      fairCoverage.rowCount === 2
        && fairCoverage.rows.every((row) => row.reviewer_count === 2),
      'fair selector fixtures could not recover after reviewer capacity returned',
    );
    const fairStateCleanup = await client.query(
      `SELECT count(*)::integer AS state_count
         FROM oran_internal.candidate_reviewer_routing_state
        WHERE candidate_id IN (
          'migration-routing-fair-oldest',
          'migration-routing-fair-later'
        )`,
    );
    invariant(
      fairStateCleanup.rows[0].state_count === 0,
      'successful fair routing did not clear bounded retry state',
    );

    await client.query(
      `INSERT INTO public.extracted_candidates (
         candidate_id, extraction_id, extract_key_sha256, extracted_at,
         organization_name, service_name, jurisdiction_state,
         jurisdiction_county, correlation_id
       )
       VALUES (
         'migration-routing-renewal', 'migration-routing-renewal-extraction',
         'migration-routing-renewal-hash', NOW(), 'Renewal routing organization',
         'Renewal routing service', 'WA', 'KING',
         'migration-routing-renewal-correlation'
       )`,
    );
    await client.query(
      `SELECT oran_internal.assign_candidate_reviewers(
         'migration-routing-renewal', 2
       )`,
    );
    await client.query(
      `UPDATE public.candidate_admin_assignments
          SET expires_at = NOW() - interval '1 hour'
        WHERE candidate_id = 'migration-routing-renewal'
          AND status = 'pending'`,
    );
    const renewedRouting = await client.query(
      `SELECT oran_internal.assign_candidate_reviewers(
         'migration-routing-renewal', 2
       )::integer AS reviewer_count`,
    );
    const renewedLeases = await client.query(
      `SELECT count(*)::integer AS current_count
         FROM public.candidate_admin_assignments assignment
         JOIN public.admin_review_profiles reviewer
           ON reviewer.id = assignment.admin_profile_id
        WHERE assignment.candidate_id = 'migration-routing-renewal'
          AND assignment.status = 'pending'
          AND assignment.expires_at > NOW()
          AND reviewer.user_id IN (
            'migration-routing-replacement-a',
            'migration-routing-replacement-b'
          )`,
    );
    invariant(
      renewedRouting.rows[0].reviewer_count === 2
        && renewedLeases.rows[0].current_count === 2,
      'exact-two eligible reviewers did not receive renewed future leases',
    );
    await expectDatabaseError(
      client,
      'SELECT * FROM oran_internal.list_undercovered_candidate_reviews(0, 2)',
      [],
      'Candidate review selector batch limit must be between 1 and 500',
    );

    const functionAcl = await client.query(
      `SELECT
         pg_catalog.has_function_privilege(
           'oran_backend_runtime',
           'oran_internal.assign_candidate_reviewers(text,integer)',
           'EXECUTE'
         ) AS backend_assign,
         pg_catalog.has_function_privilege(
           'oran_backend_runtime',
           'oran_internal.list_undercovered_candidate_reviews(integer,integer)',
           'EXECUTE'
         ) AS backend_reroute,
         pg_catalog.has_function_privilege(
           'oran_runtime',
           'oran_internal.list_undercovered_candidate_reviews(integer,integer)',
           'EXECUTE'
         ) AS legacy_reroute,
         pg_catalog.has_function_privilege(
           'oran_backend_runtime',
           'oran_internal.escalate_candidate_for_review(text)',
           'EXECUTE'
         ) AS backend_escalate,
         pg_catalog.has_function_privilege(
           'oran_backend_runtime',
           'public.evaluate_candidate_readiness(text)',
           'EXECUTE'
         ) AS backend_readiness,
         (
           pg_catalog.has_table_privilege(
             'oran_backend_runtime',
             'oran_internal.candidate_reviewer_routing_state',
             'SELECT'
           ) OR pg_catalog.has_table_privilege(
             'oran_backend_runtime',
             'oran_internal.candidate_reviewer_routing_state',
             'INSERT'
           ) OR pg_catalog.has_table_privilege(
             'oran_backend_runtime',
             'oran_internal.candidate_reviewer_routing_state',
             'UPDATE'
           ) OR pg_catalog.has_table_privilege(
             'oran_backend_runtime',
             'oran_internal.candidate_reviewer_routing_state',
             'DELETE'
           )
         ) AS backend_routing_state_access,
         EXISTS (
           SELECT 1
           FROM pg_catalog.pg_proc function_row
           CROSS JOIN LATERAL pg_catalog.aclexplode(
             COALESCE(
               function_row.proacl,
               pg_catalog.acldefault('f', function_row.proowner)
             )
           ) privilege
           WHERE function_row.oid =
             'oran_internal.assign_candidate_reviewers(text,integer)'::pg_catalog.regprocedure
             AND privilege.grantee = 0
             AND privilege.privilege_type = 'EXECUTE'
         ) AS public_assign,
         EXISTS (
           SELECT 1
           FROM pg_catalog.pg_proc function_row
           CROSS JOIN LATERAL pg_catalog.aclexplode(
             COALESCE(
               function_row.proacl,
               pg_catalog.acldefault('f', function_row.proowner)
             )
           ) privilege
           WHERE function_row.oid =
             'oran_internal.list_undercovered_candidate_reviews(integer,integer)'::pg_catalog.regprocedure
             AND privilege.grantee = 0
             AND privilege.privilege_type = 'EXECUTE'
         ) AS public_reroute`,
    );
    invariant(
      functionAcl.rows[0].backend_assign
        && functionAcl.rows[0].backend_reroute
        && !functionAcl.rows[0].legacy_reroute
        && functionAcl.rows[0].backend_escalate
        && functionAcl.rows[0].backend_readiness
        && !functionAcl.rows[0].backend_routing_state_access
        && !functionAcl.rows[0].public_assign
        && !functionAcl.rows[0].public_reroute,
      'candidate workflow function ACL is not least privilege',
    );

    console.log('  candidate-lineage workflow proof passed');
  } finally {
    await client.query('ROLLBACK');
  }
}

async function validateBackendRuntimeIdentity(ownerClient, rawUrl) {
  const runtimePassword = randomBytes(32).toString('hex');
  const runtimeTarget = new URL(rawUrl);
  runtimeTarget.username = BACKEND_ROLE;
  runtimeTarget.password = runtimePassword;
  const validatorPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../validate-backend-runtime.sql',
  );
  const validatorSource = (await readFile(validatorPath, 'utf8'))
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('\\'))
    .join('\n');

  // Production rotates this credential outside migrations. The disposable
  // proof temporarily creates an in-memory password, connects as the exact
  // runtime session identity, then restores PASSWORD NULL in all cases.
  await ownerClient.query(
    `ALTER ROLE ${BACKEND_ROLE} PASSWORD '${runtimePassword}'`,
  );
  const runtimeClient = new pg.Client({ connectionString: runtimeTarget.toString() });
  try {
    await runtimeClient.connect();
    await runtimeClient.query(validatorSource);
    console.log('backend runtime identity validator passed');
  } finally {
    await runtimeClient.end().catch(() => undefined);
    await ownerClient.query(`ALTER ROLE ${BACKEND_ROLE} PASSWORD NULL`);
  }
}

async function validateCandidateLineageActivationOwner(ownerClient) {
  const validatorPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../validate-candidate-lineage-activation.sql',
  );
  const validatorSource = (await readFile(validatorPath, 'utf8'))
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('\\'))
    .join('\n');

  // The disposable verifier intentionally owns no deployment ledger. Build the
  // one-row post-activation state solely for this catalog proof, then remove it
  // before the global relation/grant inventory runs.
  await ownerClient.query(`
    CREATE TABLE public.schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT NOW()
    );
    INSERT INTO public.schema_migrations (filename)
    VALUES ('0078_candidate_revision_activation.sql');
  `);
  try {
    for (const [tableName, triggerName] of [
      ['public.extracted_candidates', 'trg_enforce_candidate_revision_lineage'],
      ['public.candidate_admin_assignments', 'trg_protect_completed_candidate_approval'],
    ]) {
      await ownerClient.query(
        `ALTER TABLE ${tableName} ENABLE REPLICA TRIGGER ${triggerName}`,
      );
      let replicaOnlyRejected = false;
      try {
        await ownerClient.query(validatorSource);
      } catch (error) {
        replicaOnlyRejected = String(error?.message ?? error).includes(
          'candidate-lineage activation triggers are incomplete',
        );
        await ownerClient.query('ROLLBACK').catch(() => undefined);
      } finally {
        await ownerClient.query(
          `ALTER TABLE ${tableName} ENABLE TRIGGER ${triggerName}`,
        );
      }
      invariant(
        replicaOnlyRejected,
        `${triggerName} replica-only state did not fail the activation validator`,
      );
    }

    await ownerClient.query(
      `INSERT INTO public.llm_suggestions (
         candidate_id, suggestion_id, field, suggested_value,
         confidence, status, reviewed_by, reviewed_at
       )
       VALUES (
         'migration-activation-conflict-candidate',
         'migration-validator-legacy-oversight-decision',
         'description', 'Legacy oversight decision', 95, 'accepted',
         'migration-activation-reviewer-b', NOW()
       )`,
    );
    let oversightDecisionRejected = false;
    try {
      await ownerClient.query(validatorSource);
    } catch (error) {
      oversightDecisionRejected = String(error?.message ?? error).includes(
        'candidate human decision evidence lacks community reviewer authority',
      );
      await ownerClient.query('ROLLBACK').catch(() => undefined);
    } finally {
      await ownerClient.query(
        `DELETE FROM public.llm_suggestions
          WHERE suggestion_id = 'migration-validator-legacy-oversight-decision'`,
      );
    }
    invariant(
      oversightDecisionRejected,
      'fully attributed ORAN-admin human evidence passed the activation validator',
    );

    await ownerClient.query(validatorSource);
    console.log('candidate-lineage owner catalog validator passed');
  } finally {
    await ownerClient.query('ROLLBACK').catch(() => undefined);
    await ownerClient.query('DROP TABLE public.schema_migrations');
  }
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
    await exerciseCandidateLineageWorkflow(client);
    await validateCandidateLineageActivationOwner(client);
    await validateBackendRuntimeIdentity(client, rawUrl);

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
