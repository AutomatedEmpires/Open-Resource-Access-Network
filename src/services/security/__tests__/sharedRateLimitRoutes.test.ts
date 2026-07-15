import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const API_ROOT = join(process.cwd(), 'src', 'app', 'api');
const COSTLY_GET_SHARED_ROUTES = [
  'forms/instances/export/route.ts',
  'forms/analytics/route.ts',
  'host/dashboard/route.ts',
  'host/services/export/route.ts',
] as const;

const MUTATING_METHOD_EXPORT =
  /export\s+(?:(?:async\s+)?function\s+|const\s+)(?:POST|PUT|PATCH|DELETE)\b/;

function collectRouteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectRouteFiles(path);
    return entry.name === 'route.ts' ? [path] : [];
  });
}

function normalizedRelativePath(path: string): string {
  return relative(API_ROOT, path).replaceAll('\\', '/');
}

describe('shared rate limit route guards', () => {
  it('awaits every shared limiter and fails closed before returning 429', () => {
    const failures: string[] = [];

    for (const path of collectRouteFiles(API_ROOT)) {
      const route = normalizedRelativePath(path);
      const source = readFileSync(path, 'utf8');
      const calls = [...source.matchAll(/checkRateLimitShared\(/g)];
      if (calls.length === 0) continue;

      const awaitedCalls = [...source.matchAll(/await\s+checkRateLimitShared\(/g)];
      if (awaitedCalls.length !== calls.length) {
        failures.push(`${route}: ${awaitedCalls.length}/${calls.length} shared limiter calls are awaited`);
        continue;
      }

      for (let index = 0; index < awaitedCalls.length; index += 1) {
        const start = awaitedCalls[index]?.index ?? 0;
        const end = awaitedCalls[index + 1]?.index ?? source.length;
        const guardedCall = source.slice(start, end);
        const unavailableIndex = guardedCall.indexOf('.backendUnavailable');
        const exceededIndex = guardedCall.search(/\.exceeded(?:\s*===\s*true)?/);

        if (unavailableIndex < 0 || exceededIndex <= unavailableIndex) {
          failures.push(`${route} call ${index + 1}: backendUnavailable must be handled before exceeded`);
          continue;
        }

        const unavailableBranch = guardedCall.slice(unavailableIndex, exceededIndex);
        const exceededBranch = guardedCall.slice(exceededIndex);
        if (!/status:\s*503/.test(unavailableBranch) || !/Retry-After/.test(unavailableBranch)) {
          failures.push(`${route} call ${index + 1}: unavailable branch must return 503 with Retry-After`);
        }
        if (!/status:\s*429/.test(exceededBranch) || !/Retry-After/.test(exceededBranch)) {
          failures.push(`${route} call ${index + 1}: exceeded branch must return 429 with Retry-After`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it('keeps every mutating API route off the per-instance limiter', () => {
    const failures = collectRouteFiles(API_ROOT).flatMap((path) => {
      const route = normalizedRelativePath(path);
      const source = readFileSync(path, 'utf8');

      if (!MUTATING_METHOD_EXPORT.test(source) || !/\bcheckRateLimit\(/.test(source)) {
        return [];
      }

      return [route];
    });

    expect(failures).toEqual([]);
  });

  it('keeps costly GET and export routes off the per-instance limiter', () => {
    const failures = COSTLY_GET_SHARED_ROUTES.filter((route) => {
      const source = readFileSync(join(API_ROOT, ...route.split('/')), 'utf8');
      return /\bcheckRateLimit\(/.test(source);
    });

    expect(failures).toEqual([]);
  });
});
