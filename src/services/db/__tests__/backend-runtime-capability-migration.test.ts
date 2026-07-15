import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'db/migrations/0066_backend_runtime_capability.sql'),
  'utf8',
);

const validator = readFileSync(
  resolve(process.cwd(), 'scripts/validate-backend-runtime.sql'),
  'utf8',
);

type Operation = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

const operations: Operation[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

function extractMigrationManifest(operation: Operation): string[] {
  const match = migration.match(
    new RegExp(`GRANT ${operation} ON TABLE\\s+([\\s\\S]*?)\\s+TO oran_backend_runtime;`),
  );

  const manifestBody = match?.[1];
  if (!manifestBody) {
    throw new Error(`Missing ${operation} migration manifest`);
  }

  const names: string[] = [...(manifestBody.match(/(?:public|oran_internal)\.[a-z_]+/g) ?? [])];
  names.push('oran_internal.resource_freshness_findings');
  if (operation !== 'DELETE') {
    names.push('public.service_embeddings');
  }
  return [...new Set(names)].sort();
}

function extractValidatorManifest(operation: Operation): string[] {
  const match = validator.match(
    new RegExp(`v_${operation.toLowerCase()} text\\[\\] := ARRAY\\[([\\s\\S]*?)\\n  \\];`),
  );

  const manifestBody = match?.[1];
  if (!manifestBody) {
    throw new Error(`Missing ${operation} validator manifest`);
  }

  return [...manifestBody.matchAll(/'((?:public|oran_internal)\.[a-z_]+)'/g)]
    .map((entry) => entry[1])
    .filter((name): name is string => Boolean(name))
    .sort();
}

describe('0066 backend runtime capability migration', () => {
  it('creates a dedicated direct-login role without rotating credentials on rerun', () => {
    expect(migration).toContain("EXECUTE 'CREATE ROLE oran_backend_runtime '");
    expect(migration).toContain("|| 'LOGIN PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE '");
    expect(migration).toContain("|| 'NOINHERIT NOREPLICATION BYPASSRLS CONNECTION LIMIT 20'");

    const existingRoleBranch = migration.slice(
      migration.indexOf("EXECUTE 'ALTER ROLE oran_backend_runtime '"),
      migration.indexOf("WHERE rolname = 'oran_runtime'"),
    );
    expect(existingRoleBranch).toContain('LOGIN NOCREATEDB NOCREATEROLE');
    expect(migration).toContain('oran_backend_runtime must never be superuser');
    expect(existingRoleBranch).not.toContain('PASSWORD');

    const passwordClauses = migration.match(/PASSWORD\s+(?:NULL|'[^']*')/g) ?? [];
    expect(passwordClauses).toEqual(['PASSWORD NULL', 'PASSWORD NULL']);
    expect(migration).not.toMatch(/PASSWORD\s+'[^']+'/);
  });

  it('locks the legacy name on greenfield and preserves existing operator access', () => {
    expect(migration).toContain("EXECUTE 'CREATE ROLE oran_runtime '");
    expect(migration).toContain("|| 'NOLOGIN PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE '");
    expect(migration).toContain('REVOKE oran_backend_runtime FROM oran_runtime;');
    expect(migration).not.toMatch(/GRANT\s+oran_backend_runtime\s+TO\s+oran_runtime/i);

    const boundary = migration.slice(
      migration.indexOf('DO $assert_boundary$'),
      migration.indexOf('$assert_boundary$;', migration.indexOf('DO $assert_boundary$')),
    );
    expect(boundary).toContain('WHERE m.member IN (');
    expect(boundary).not.toContain('m.roleid IN (');
  });

  it('sets pooler-safe server defaults and constrains persistent DDL', () => {
    expect(migration).toContain(
      'ALTER ROLE oran_backend_runtime SET search_path TO pg_catalog, public;',
    );
    expect(migration).toContain(
      "ALTER ROLE oran_backend_runtime SET statement_timeout TO '30s';",
    );
    expect(migration).toContain("ALTER ROLE oran_backend_runtime SET lock_timeout TO '5s';");
    expect(migration).toContain(
      "ALTER ROLE oran_backend_runtime SET idle_in_transaction_session_timeout TO '30s';",
    );
    expect(migration).toContain('GRANT USAGE ON SCHEMA public, oran_internal');
    expect(migration).not.toMatch(/GRANT\s+CREATE\s+ON\s+SCHEMA/i);
    expect(migration).not.toMatch(/GRANT\s+[\s\S]*\b(?:TRUNCATE|TRIGGER|REFERENCES)\b/i);
    expect(migration).not.toMatch(/\bGRANT\s+ALL(?:\s+PRIVILEGES)?\b/i);
    expect(migration).not.toMatch(/GRANT\s+.*\bSEQUENCE/i);
    expect(migration).toContain("d.classid = 'pg_catalog.pg_class'::pg_catalog.regclass");
    expect(migration).toContain('FROM oran_runtime, oran_backend_runtime, PUBLIC');
    expect(validator).toContain('PUBLIC retains CRUD on ORAN relation');
    expect(validator).toContain('PUBLIC retains privileges on an ORAN sequence');
  });

  it('keeps the operation allow-list synchronized with its validator', () => {
    for (const operation of operations) {
      expect(extractMigrationManifest(operation)).toEqual(
        extractValidatorManifest(operation),
      );
    }

    const manifests = Object.fromEntries(
      operations.map((operation) => [operation, extractMigrationManifest(operation)]),
    ) as Record<Operation, string[]>;

    expect(manifests.SELECT).toContain('public.services');
    expect(manifests.INSERT).toContain('public.services');
    expect(manifests.UPDATE).toContain('public.services');
    expect(manifests.SELECT).toContain('public.service_embeddings');
    expect(manifests.INSERT).toContain('public.service_embeddings');
    expect(manifests.UPDATE).toContain('public.service_embeddings');
    expect(manifests.DELETE).not.toContain('public.service_embeddings');
    expect(manifests.UPDATE).toContain('public.dietary_options');
    expect(manifests.UPDATE).toContain('public.org_service_scope');
    expect(manifests.DELETE).not.toContain('public.services');

    expect(manifests.INSERT).toContain('public.source_record_taxonomy');
    expect(manifests.SELECT).not.toContain('public.source_record_taxonomy');
    expect(manifests.UPDATE).not.toContain('public.source_record_taxonomy');
    expect(manifests.DELETE).not.toContain('public.source_record_taxonomy');

    for (const operation of operations) {
      expect(manifests[operation]).toContain('oran_internal.resource_freshness_findings');
    }
  });

  it('exposes exactly the three chat functions and revokes PUBLIC execution', () => {
    const executeGrant = migration.slice(
      migration.indexOf('GRANT EXECUTE ON FUNCTION'),
      migration.indexOf('TO oran_backend_runtime;', migration.indexOf('GRANT EXECUTE ON FUNCTION')),
    );

    expect(executeGrant).toContain('oran_internal.check_chat_quota(text, text, integer)');
    expect(executeGrant).toContain('oran_internal.reserve_chat_request(');
    expect(executeGrant).toContain('oran_internal.finalize_chat_request(uuid, boolean)');
    expect(executeGrant.match(/oran_internal\.[a-z_]+/g)).toHaveLength(3);
    expect(migration).not.toMatch(/GRANT EXECUTE ON ALL FUNCTIONS/i);
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON FUNCTION %s');
    expect(migration).toContain('FROM oran_runtime, oran_backend_runtime, PUBLIC');
    expect(migration).toContain("d.deptype = 'e'");
  });

  it('ships a read-only release probe for the real backend identity', () => {
    expect(validator).toContain('BEGIN TRANSACTION READ ONLY;');
    expect(validator).toContain("session_user::text <> 'oran_backend_runtime'");
    expect(validator).toContain("current_user::text <> 'oran_backend_runtime'");
    expect(validator).toContain("'search_path=pg_catalog, public'");
    expect(validator).toContain("'statement_timeout=30s'");
    expect(validator).toContain("'lock_timeout=5s'");
    expect(validator).toContain("'idle_in_transaction_session_timeout=30s'");
    expect(validator).toContain("current_database(), 'CREATE'");
    expect(validator).toContain("n.oid, 'CREATE'");
    expect(validator).toContain('ROLLBACK;');
    expect(validator).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP)\b/im);
  });
});
