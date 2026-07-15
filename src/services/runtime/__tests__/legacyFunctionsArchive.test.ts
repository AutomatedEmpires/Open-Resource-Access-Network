import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { alertCoverageGaps } from '../../../../functions/alertCoverageGaps';
import { checkSlaBreaches } from '../../../../functions/checkSlaBreaches';
import { extractService } from '../../../../functions/extractService';
import { fetchPage } from '../../../../functions/fetchPage';
import { manualSubmit } from '../../../../functions/manualSubmit';
import { pollSourceFeeds } from '../../../../functions/pollSourceFeeds';
import { routeToAdmin } from '../../../../functions/routeToAdmin';
import { scanConfidenceRegressions } from '../../../../functions/scanConfidenceRegressions';
import { scheduledCrawl } from '../../../../functions/scheduledCrawl';
import { verifyCandidate } from '../../../../functions/verifyCandidate';

const fetchMock = vi.hoisted(() => vi.fn());
const repositoryRoot = resolve(import.meta.dirname, '../../../..');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('legacy Azure Functions archive boundary', () => {
  it('blocks every direct handler invocation before network or database work', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', '');
    vi.stubGlobal('fetch', fetchMock);

    const invocations: Array<Promise<unknown>> = [
      alertCoverageGaps({ schedule: { isRunning: true }, isPastDue: false }),
      checkSlaBreaches({ schedule: { isRunning: true }, isPastDue: false }),
      extractService({} as never),
      fetchPage({} as never),
      manualSubmit({} as never),
      pollSourceFeeds({ schedule: { isRunning: true }, isPastDue: false }),
      routeToAdmin({} as never),
      scanConfidenceRegressions({ schedule: { isRunning: true }, isPastDue: false }),
      scheduledCrawl({} as never),
      verifyCandidate({} as never),
    ];

    const results = await Promise.allSettled(invocations);
    expect(results).toHaveLength(10);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect(String(result.reason)).toContain('Legacy Azure Functions are archived');
      }
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the direct builder and Functions host inert', () => {
    const build = spawnSync(process.execPath, ['scripts/build-functions.mjs'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });
    expect(build.status).not.toBe(0);
    expect(`${build.stdout}${build.stderr}`).toContain('ORAN_LEGACY_AZURE_FUNCTIONS_ARCHIVED');
    expect(existsSync(resolve(repositoryRoot, 'dist/host.json'))).toBe(false);

    const host = JSON.parse(
      readFileSync(resolve(repositoryRoot, 'functions/host.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(host.functions).toEqual([]);
    expect(host).not.toHaveProperty('extensionBundle');
    expect(JSON.stringify(host).toLowerCase()).not.toContain('applicationinsights');
  });
});
