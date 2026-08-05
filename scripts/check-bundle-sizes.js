#!/usr/bin/env node
/**
 * ORAN Performance Budget Check
 *
 * Measures First Load JS for seeker-facing routes and fails on regression.
 *
 * Usage:
 *   node scripts/check-bundle-sizes.js [--stats <path>] [--json]
 *
 * Run after: npm run build
 *
 * ── Why this reads route-bundle-stats.json ────────────────────────────────
 * This script previously parsed `.next/build-manifest.json` and looked up
 * `manifest.pages['/chat']`. That is the Pages Router shape. ORAN is an App
 * Router app, so those lookups always returned nothing, every route measured
 * 0 bytes, 0 bytes was treated as "skip", and the job exited 0. The budget
 * reported green while measuring nothing at all.
 *
 * Next.js 16 emits `.next/diagnostics/route-bundle-stats.json`, which lists the
 * first-load chunk set per route. That is the authoritative source and is what
 * this script now uses. If it is missing or a tracked route is absent from it,
 * this check FAILS rather than skipping -- an unmeasurable budget is a broken
 * budget, not a passing one.
 *
 * ── Ratchets vs targets ───────────────────────────────────────────────────
 * TARGETS are the product goal. RATCHETS are today's measured ceiling. Every
 * tracked route currently exceeds its target by 3.4x-4.5x, which the broken
 * check hid. Enforcing the targets today would fail every build without making
 * a single page smaller, so the gate enforces the ratchet (no regression) and
 * reports the distance to target on every run. Ratchets only ever move down:
 * when a route improves, lower its ratchet in the same pull request.
 *
 * Sizes are gzipped, which is what a seeker on a slow connection actually
 * downloads (Vercel serves compressed).
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

// ── Budget configuration ───────────────────────────────────────────────────
// Units: kilobytes of gzipped First Load JS.
const ROUTES = {
  //            target  ratchet (measured 2026-07-17)
  // '/' ratchet 345->340 (2026-08-05): defer below-fold and authenticated-only
  // seeker shell controls so the simplified entry experience loads first.
  '/':          { target: 100, ratchet: 340 },
  // '/chat' ratchet 430->425 (2026-07-30): measured 422 kB, so the old ceiling
  // had drifted 8 kB above reality. Ratchets only move down; keeping a few kB
  // of headroom absorbs shared-chunk rebalancing without hiding a regression.
  '/chat':      { target: 160, ratchet: 425 },
  '/directory': { target: 160, ratchet: 560 },
  '/map':       { target: 120, ratchet: 455 },
  '/profile':   { target: 100, ratchet: 440 },
  '/saved':     { target: 100, ratchet: 450 },
};

const KB = 1024;

const statsPath = process.argv.includes('--stats')
  ? process.argv[process.argv.indexOf('--stats') + 1]
  : resolve('.next', 'diagnostics', 'route-bundle-stats.json');

const emitJson = process.argv.includes('--json');

function fail(message) {
  console.error(`[budget] ${message}`);
  process.exit(1);
}

if (!existsSync(statsPath)) {
  fail(
    `Route bundle stats not found at ${statsPath}.\n`
      + '[budget] Run "npm run build" first. If this path changed with a Next.js upgrade, '
      + 'repoint this script — do not let the budget silently stop measuring.',
  );
}

/** @type {Array<{route: string, firstLoadUncompressedJsBytes: number, firstLoadChunkPaths: string[]}>} */
const stats = JSON.parse(readFileSync(statsPath, 'utf8'));

// Routes share most of their first-load chunks (152 chunk references across the
// six tracked routes resolve to 37 distinct files), so compress each file once.
const gzipSizeCache = new Map();

/** Gzipped size of a single chunk file, memoized across routes. */
function gzipSizeOf(absolutePath) {
  const cached = gzipSizeCache.get(absolutePath);
  if (cached !== undefined) return cached;
  const size = gzipSync(readFileSync(absolutePath)).length;
  gzipSizeCache.set(absolutePath, size);
  return size;
}

/** Gzipped size of a route's first-load chunk set. */
function measureRoute(entry) {
  let gzipBytes = 0;
  const missing = [];
  // A chunk listed twice for one route must not be counted twice.
  for (const chunkPath of new Set(entry.firstLoadChunkPaths ?? [])) {
    const absolute = resolve(chunkPath);
    if (!existsSync(absolute)) {
      missing.push(chunkPath);
      continue;
    }
    gzipBytes += gzipSizeOf(absolute);
  }
  return { gzipBytes, missing };
}

const results = [];
let regressions = 0;

for (const [route, { target, ratchet }] of Object.entries(ROUTES)) {
  const entry = stats.find((candidate) => candidate.route === route);
  if (!entry) {
    // Never "skip". A tracked route that cannot be measured is a failure.
    results.push({ route, target, ratchet, actualKb: null, status: 'UNMEASURABLE' });
    regressions++;
    continue;
  }

  const { gzipBytes, missing } = measureRoute(entry);
  if (missing.length > 0 || gzipBytes === 0) {
    results.push({ route, target, ratchet, actualKb: null, status: 'UNMEASURABLE' });
    regressions++;
    continue;
  }

  const actualKb = Math.round(gzipBytes / KB);
  const status = actualKb > ratchet ? 'REGRESSED' : 'OK';
  if (status === 'REGRESSED') regressions++;
  results.push({ route, target, ratchet, actualKb, status });
}

const overTarget = results.filter((r) => r.actualKb !== null && r.actualKb > r.target);
const slack = results.filter((r) => r.actualKb !== null && r.actualKb < r.ratchet - 5);

if (emitJson) {
  console.log(JSON.stringify({ regressions, results }, null, 2));
} else {
  const pad = (value, width) => String(value).padEnd(width);
  console.log('');
  console.log('  ORAN First Load JS (gzipped)');
  console.log('  ──────────────────────────────────────────────────────────────');
  console.log(`  ${pad('Route', 14)} ${pad('Target', 9)} ${pad('Ratchet', 9)} ${pad('Actual', 9)} Status`);
  console.log('  ──────────────────────────────────────────────────────────────');
  for (const result of results) {
    const icon = result.status === 'OK' ? '✓' : '✗';
    const actual = result.actualKb === null ? '(none)' : `${result.actualKb} kB`;
    console.log(
      `  ${icon} ${pad(result.route, 12)} ${pad(result.target + ' kB', 9)} `
        + `${pad(result.ratchet + ' kB', 9)} ${pad(actual, 9)} ${result.status}`,
    );
  }
  console.log('  ──────────────────────────────────────────────────────────────');

  if (overTarget.length > 0) {
    console.log(
      `\n  ${overTarget.length} route(s) are over the product target. This is existing debt,`,
    );
    console.log('  not a regression — the gate holds the ratchet so it cannot grow:');
    for (const result of overTarget) {
      const factor = (result.actualKb / result.target).toFixed(1);
      console.log(
        `    ${result.route}: ${result.actualKb} kB vs ${result.target} kB target (${factor}x)`,
      );
    }
  }

  if (slack.length > 0) {
    console.log('\n  Ratchets with slack — lower them in this pull request:');
    for (const result of slack) {
      console.log(`    ${result.route}: ratchet ${result.ratchet} kB, actual ${result.actualKb} kB`);
    }
  }

  if (regressions > 0) {
    console.log(`\n  ✗ ${regressions} route(s) regressed or could not be measured.\n`);
  } else {
    console.log(`\n  ✓ All ${results.length} routes measured and within ratchet.\n`);
  }
}

process.exit(regressions > 0 ? 1 : 0);
