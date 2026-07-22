import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const script = resolve(process.cwd(), 'scripts/import/seed-resources.mjs');
const temporaryDirectories: string[] = [];

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), 'oran-legacy-loader-'));
  temporaryDirectories.push(root);

  const home = join(root, 'home');
  const fetchMarker = join(root, 'fetch-called');
  const preload = join(root, 'block-network.mjs');
  mkdirSync(home, { recursive: true });
  writeFileSync(
    preload,
    [
      "import { appendFileSync } from 'node:fs';",
      'globalThis.fetch = async () => {',
      "  appendFileSync(process.env.ORAN_FETCH_MARKER, 'called');",
      "  throw new Error('NETWORK_ACCESS_ATTEMPTED');",
      '};',
    ].join('\n'),
  );

  return { root, home, fetchMarker, preload };
}

function runLoader(
  harness: ReturnType<typeof createHarness>,
  args: string[],
  accessToken = '',
) {
  return spawnSync(process.execPath, ['--import', harness.preload, script, ...args], {
    encoding: 'utf8',
    timeout: 5_000,
    env: {
      ...process.env,
      HOME: harness.home,
      USERPROFILE: harness.home,
      SUPABASE_ACCESS_TOKEN: accessToken,
      ORAN_FETCH_MARKER: harness.fetchMarker,
    },
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('legacy seed-resources quarantine', () => {
  it('rejects every write attempt before credential or database access', () => {
    const withoutToken = createHarness();
    const tokenReadAttempt = runLoader(withoutToken, [
      '--project',
      'production-project',
      '--file',
      join(withoutToken.root, 'never-read.ndjson'),
    ]);

    expect(tokenReadAttempt.status).toBe(3);
    expect(tokenReadAttempt.stderr).toContain('Write mode is disabled');
    expect(tokenReadAttempt.stderr).not.toContain('.supabase/access-token');
    expect(tokenReadAttempt.stderr).not.toContain('ENOENT');
    expect(existsSync(withoutToken.fetchMarker)).toBe(false);

    const withToken = createHarness();
    const databaseAttempt = runLoader(
      withToken,
      ['--project', 'production-project', '--file', join(withToken.root, 'never-read.ndjson')],
      'sentinel-access-token',
    );

    expect(databaseAttempt.status).toBe(3);
    expect(databaseAttempt.stderr).toContain('Write mode is disabled');
    expect(existsSync(withToken.fetchMarker)).toBe(false);
  });

  it('keeps dry-run validation local and useful', () => {
    const harness = createHarness();
    const input = join(harness.root, 'resource.ndjson');
    writeFileSync(
      input,
      `${JSON.stringify({
        source: 'fixture',
        sourceId: 'resource-1',
        org: { name: 'Fixture Organization' },
        service: { name: 'Fixture Food Support', category: 'food' },
        location: { lat: 38.58, lon: -121.49 },
        address: { address1: '1 Fixture Way', city: 'Sacramento', state: 'CA' },
        phones: [],
        verification: 60,
      })}\n`,
    );

    const result = runLoader(harness, ['--dry-run', '--file', input]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('DRY-RUN');
    expect(result.stdout).toContain('Done. Validated 1 resources. No data was written.');
    expect(existsSync(harness.fetchMarker)).toBe(false);
  });
});
