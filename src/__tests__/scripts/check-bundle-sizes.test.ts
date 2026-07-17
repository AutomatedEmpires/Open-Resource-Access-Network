import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The budget check regressed to a no-op once before: it read the Pages Router
// manifest in an App Router app, measured 0 bytes for every route, treated 0 as
// "skip", and exited 0 — green while measuring nothing. These tests pin the
// property that failed: an unmeasurable budget must FAIL, never pass.

const script = resolve(process.cwd(), 'scripts/check-bundle-sizes.js');

function runCheck(statsPath: string): { code: number; output: string } {
  try {
    const output = execFileSync('node', [script, '--stats', statsPath, '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

function writeStats(entries: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), 'oran-budget-'));
  const path = join(directory, 'route-bundle-stats.json');
  writeFileSync(path, JSON.stringify(entries));
  return path;
}

describe('check-bundle-sizes', () => {
  it('fails when the stats file is absent instead of silently passing', () => {
    const { code, output } = runCheck('/nonexistent/route-bundle-stats.json');
    expect(code).toBe(1);
    expect(output).toContain('Route bundle stats not found');
  });

  it('fails when a tracked route is missing from the stats', () => {
    // The old script treated an unfound route as 0 bytes and passed it.
    const statsPath = writeStats([{ route: '/unrelated', firstLoadChunkPaths: [] }]);
    const { code, output } = runCheck(statsPath);
    expect(code).toBe(1);
    expect(output).toContain('UNMEASURABLE');
  });

  it('fails when a route regresses past its ratchet', () => {
    // One incompressible chunk larger than /chat's ratchet. Random bytes do not
    // gzip down, so this stays over the ceiling without re-reading a small file
    // thousands of times (which made this test slow enough to flake under load).
    const directory = mkdtempSync(join(tmpdir(), 'oran-budget-chunk-'));
    const chunk = join(directory, 'oversized.js');
    writeFileSync(chunk, randomBytes(700 * 1024));

    const statsPath = writeStats([{ route: '/chat', firstLoadChunkPaths: [chunk] }]);
    const { code, output } = runCheck(statsPath);
    expect(code).toBe(1);
    expect(output).toContain('REGRESSED');
  });

  it('tracks every seeker route the budget claims to cover', () => {
    const source = readFileSync(script, 'utf8');
    for (const route of ['/chat', '/directory', '/map', '/profile', '/saved']) {
      expect(source).toContain(`'${route}'`);
    }
  });
});
