import { describe, expect, it } from 'vitest';

import {
  buildRuntimeDatabaseConnectionString,
  ORAN_BACKEND_DATABASE_ROLE,
} from '../runtimeRole';

const DATABASE_URL = 'postgres://oran_backend_runtime:secret@localhost:5432/oran?sslmode=require';
const POOLER_DATABASE_URL = 'postgres://oran_backend_runtime.tpatxospkuqvajusuryw:secret@aws-0-us-west-1.pooler.supabase.com:6543/postgres?sslmode=require';
const PRODUCTION_ENV = {
  NODE_ENV: 'production',
  ORAN_DATABASE_ROLE: ORAN_BACKEND_DATABASE_ROLE,
  ORAN_SUPABASE_PROJECT_REF: 'tpatxospkuqvajusuryw',
} as const;

describe('backend database login identity', () => {
  it('leaves local connections unchanged when no role is configured', () => {
    expect(buildRuntimeDatabaseConnectionString(DATABASE_URL, {
      NODE_ENV: 'development',
    })).toBe(DATABASE_URL);
  });

  it('requires the reviewed capability role in production', () => {
    expect(() => buildRuntimeDatabaseConnectionString(DATABASE_URL, {
      NODE_ENV: 'production',
      ORAN_SUPABASE_PROJECT_REF: 'tpatxospkuqvajusuryw',
    })).toThrow('ORAN_DATABASE_ROLE is required');

    expect(() => buildRuntimeDatabaseConnectionString(DATABASE_URL, {
      NODE_ENV: 'production',
      ORAN_DATABASE_ROLE: 'postgres',
      ORAN_SUPABASE_PROJECT_REF: 'tpatxospkuqvajusuryw',
    })).toThrow('not an approved ORAN backend role');
  });

  it('accepts the dedicated login only on the isolated production pooler', () => {
    expect(buildRuntimeDatabaseConnectionString(
      POOLER_DATABASE_URL,
      PRODUCTION_ENV,
    )).toBe(POOLER_DATABASE_URL);

    expect(() => buildRuntimeDatabaseConnectionString(
      DATABASE_URL,
      PRODUCTION_ENV,
    )).toThrow('must use the isolated ORAN Supabase transaction pooler');

    expect(() => buildRuntimeDatabaseConnectionString(
      'postgres://oran_runtime.tpatxospkuqvajusuryw:secret@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
      PRODUCTION_ENV,
    )).toThrow('must authenticate as the dedicated ORAN backend role');

    expect(() => buildRuntimeDatabaseConnectionString(
      'postgres://oran_backend_runtime.abcdefghijklmnopqrst:secret@aws-0-us-west-1.pooler.supabase.com:6543/postgres?sslmode=require',
      PRODUCTION_ENV,
    )).toThrow('must use the isolated ORAN Supabase transaction pooler');
  });

  it('rejects startup overrides and missing production credentials', () => {
    expect(() => buildRuntimeDatabaseConnectionString(
      `${DATABASE_URL}&options=-c%20role%3Dpostgres`,
      PRODUCTION_ENV,
    )).toThrow('must not include PostgreSQL startup options');

    expect(() => buildRuntimeDatabaseConnectionString(
      'postgres://oran_backend_runtime@localhost:5432/oran',
      PRODUCTION_ENV,
    )).toThrow('must include the ORAN backend role credential');
  });

  it('requires the isolated Supabase project identity in production', () => {
    expect(() => buildRuntimeDatabaseConnectionString(POOLER_DATABASE_URL, {
      NODE_ENV: 'production',
      ORAN_DATABASE_ROLE: ORAN_BACKEND_DATABASE_ROLE,
    })).toThrow('ORAN_SUPABASE_PROJECT_REF is required');
  });
});
