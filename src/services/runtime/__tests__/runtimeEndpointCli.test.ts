import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const scriptPath = resolve(process.cwd(), 'scripts/validate-runtime-endpoint.mjs');
const expectedProjectRef = 'tpatxospkuqvajusuryw';

function runValidator(options: {
  value?: string;
  projectRef?: string;
  omitProjectRef?: boolean;
} = {}) {
  const env = { ...process.env };
  if (options.value === undefined) delete env.SUPABASE_DB_URL;
  else env.SUPABASE_DB_URL = options.value;
  if (options.omitProjectRef) delete env.SUPABASE_PROJECT_REF;
  else env.SUPABASE_PROJECT_REF = options.projectRef ?? expectedProjectRef;

  return spawnSync(process.execPath, [
    scriptPath,
    'SUPABASE_DB_URL',
    'SUPABASE_PROJECT_REF',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env,
  });
}

describe('runtime endpoint validator CLI', () => {
  it('accepts a Supabase Postgres connection string', () => {
    const result = runValidator({
      value: `postgresql://postgres.${expectedProjectRef}:secret@aws-0-us-west-1.pooler.supabase.com:6543/postgres`,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'SUPABASE_DB_URL endpoint and project identity policy satisfied.',
    );
  });

  it('rejects an Azure SQL connection string without printing its secret', () => {
    const result = runValidator({
      value: 'Server=tcp:oran.database.windows.net,1433;Initial Catalog=oran;Password=do-not-print',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SUPABASE_DB_URL uses a prohibited Microsoft endpoint');
    expect(`${result.stdout}${result.stderr}`).not.toContain('do-not-print');
    expect(`${result.stdout}${result.stderr}`).not.toContain('database.windows.net');
  });

  it('fails closed when the named setting is absent', () => {
    const result = runValidator();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SUPABASE_DB_URL is not configured.');
  });

  it('fails closed when the expected project reference is absent', () => {
    const result = runValidator({
      value: `postgresql://postgres.${expectedProjectRef}:secret@aws-0-us-west-1.pooler.supabase.com:6543/postgres`,
      omitProjectRef: true,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SUPABASE_PROJECT_REF is not configured.');
  });

  it('rejects another portfolio Supabase project without logging its DSN', () => {
    const otherProjectRef = 'abcdefghijklmnopqrst';
    const result = runValidator({
      value: `postgresql://postgres.${otherProjectRef}:portfolio-secret@aws-0-us-west-1.pooler.supabase.com:6543/postgres`,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'SUPABASE_DB_URL does not match SUPABASE_PROJECT_REF',
    );
    expect(`${result.stdout}${result.stderr}`).not.toContain(otherProjectRef);
    expect(`${result.stdout}${result.stderr}`).not.toContain(expectedProjectRef);
    expect(`${result.stdout}${result.stderr}`).not.toContain('portfolio-secret');
    expect(`${result.stdout}${result.stderr}`).not.toContain('pooler.supabase.com');
  });
});
