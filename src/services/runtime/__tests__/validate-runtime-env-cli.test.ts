import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('validate-runtime-env CLI', () => {
  it('reports an invalid production contract without throwing', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/validate-runtime-env.mjs');
    const result = spawnSync(
      process.execPath,
      [scriptPath, '--target', 'webapp', '--node-env', 'production'],
      {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          NODE_ENV: 'production',
        },
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('[ERROR] Missing critical webapp settings:');
    expect(result.stdout).toContain('DATABASE_URL');
    expect(result.stderr).not.toContain('TypeError');
  });
});
