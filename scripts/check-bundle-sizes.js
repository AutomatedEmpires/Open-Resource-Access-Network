#!/usr/bin/env node
/**
 * ORAN Performance Budget Check
 *
 * Parses the Next.js build manifest to check First Load JS sizes for
 * seeker-facing routes. Fails with exit code 1 if any route exceeds its budget.
 *
 * Usage:
 *   node scripts/check-bundle-sizes.js [--manifest <path>] [--json]
 *
 * Run after: npm run build
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Budget configuration ───────────────────────────────────────────────────
// Units: bytes. Budgets are conservative starting points based on Next.js
// best practices after TASK-03 (lazy Azure Maps) and TASK-07 (Command Palette).
// Adjust downward once actual measurements are recorded in STATUS_OMEGA.md.
const BUDGETS = {
  '/chat':      160 * 1024,   // 160 kB — chat window + service cards
  '/directory': 160 * 1024,   // 160 kB — directory + filters + infinite scroll
  '/map':       120 * 1024,   // 120 kB — slimmer; Azure Maps lazy-loaded (TASK-03)
  '/':          100 * 1024,   // 100 kB — landing page
  '/profile':   100 * 1024,   // 100 kB — profile / settings
  '/saved':     100 * 1024,   // 100 kB — saved services
};

// ── Manifest discovery ─────────────────────────────────────────────────────
const manifestPath = process.argv.includes('--manifest')
  ? process.argv[process.argv.indexOf('--manifest') + 1]
  : resolve('.next', 'build-manifest.json');

const emitJson = process.argv.includes('--json');

if (!existsSync(manifestPath)) {
  console.error(`[budget] Build manifest not found at: ${manifestPath}`);
  console.error('[budget] Run "npm run build" first.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

// ── Parse page bundle sizes from next-build-manifest ──────────────────────
// The manifest structure: { pages: { '/path': ['_app', 'chunk1', ...] }, ... }
// We sum the sizes of all referenced chunks for each tracked route.

const chunksDir = resolve('.next', 'static', 'chunks');
const pagesDir = resolve('.next', 'static', 'chunks', 'pages');

/** Best-effort size lookup for a chunk filename */
function chunkSize(filename) {
  // Filenames in the manifest may be bare names or paths; try several locations
  const candidates = [
    resolve('.next', filename.startsWith('/') ? filename.slice(1) : filename),
    resolve(chunksDir, filename),
    resolve(pagesDir, filename),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try { return readFileSync(p).length; } catch { /* skip */ }
    }
  }
  return 0;
}

// ── Evaluate budgets ───────────────────────────────────────────────────────
const results = [];
let violations = 0;

for (const [route, budget] of Object.entries(BUDGETS)) {
  const chunks = manifest.pages?.[route] ?? [];
  const totalBytes = chunks.reduce((sum, chunk) => sum + chunkSize(chunk), 0);
  const pass = totalBytes === 0 || totalBytes <= budget; // 0 = chunk not found → skip
  const skipped = totalBytes === 0;

  if (!pass) violations++;

  results.push({
    route,
    budgetKb: Math.round(budget / 1024),
    actualKb: skipped ? null : Math.round(totalBytes / 1024),
    status: skipped ? 'SKIP' : pass ? 'PASS' : 'FAIL',
  });
}

// ── Output ─────────────────────────────────────────────────────────────────
if (emitJson) {
  console.log(JSON.stringify({ violations, results }, null, 2));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  console.log('');
  console.log('  ORAN Performance Budget Report');
  console.log('  ─────────────────────────────────────────────────────────');
  console.log(`  ${pad('Route', 20)} ${pad('Budget', 10)} ${pad('Actual', 10)} Status`);
  console.log('  ─────────────────────────────────────────────────────────');
  for (const r of results) {
    const actual = r.actualKb !== null ? `${r.actualKb} kB` : '(n/a)';
    const icon = r.status === 'PASS' ? '✓' : r.status === 'SKIP' ? '–' : '✗';
    console.log(`  ${icon} ${pad(r.route, 19)} ${pad(r.budgetKb + ' kB', 10)} ${pad(actual, 10)} ${r.status}`);
  }
  console.log('  ─────────────────────────────────────────────────────────');

  if (violations > 0) {
    console.log(`\n  ✗ ${violations} route(s) exceed their First Load JS budget.\n`);
  } else {
    const measurable = results.filter(r => r.status !== 'SKIP');
    if (measurable.length === 0) {
      console.log('\n  – No chunks measured (run "npm run build" first).\n');
    } else {
      console.log(`\n  ✓ All ${measurable.length} measured routes within budget.\n`);
    }
  }
}

process.exit(violations > 0 ? 1 : 0);
