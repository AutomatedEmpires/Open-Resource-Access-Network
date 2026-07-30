#!/usr/bin/env node
/**
 * ORAN bundle attribution
 *
 * `check-bundle-sizes.js` answers "did a route get bigger?". This answers
 * "what is the weight actually made of?" — which is the question a reduction
 * effort needs, and the one that is expensive to re-derive by hand.
 *
 * Usage:
 *   npm run build
 *   node scripts/analyze-bundle.mjs
 *
 * Reports, all gzipped (what a seeker on a slow connection downloads):
 *   1. first-load total per tracked route
 *   2. the largest first-load chunks, each tagged by content and scoped to the
 *      routes that pay for it
 *   3. the shared set — chunks every tracked route loads — grouped by tag, so
 *      shared-baseline debt is separable from route-specific debt
 *
 * Tagging is deliberately crude: chunk contents are matched against marker
 * patterns. Turbopack strips module paths, so package attribution has to come
 * from recognizable identifiers that survive minification. A chunk can carry
 * several tags; treat the tags as "this chunk contains some of X", not as a
 * precise byte split. The numbers per chunk are exact; the attribution is a
 * strong hint.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const statsPath = resolve('.next', 'diagnostics', 'route-bundle-stats.json');
if (!existsSync(statsPath)) {
  console.error('[analyze] No route-bundle-stats.json — run "npm run build" first.');
  process.exit(1);
}

const stats = JSON.parse(readFileSync(statsPath, 'utf8'));

/** Kept in sync with the routes tracked by check-bundle-sizes.js. */
const TRACKED = ['/', '/chat', '/directory', '/map', '/profile', '/saved'];

const MARKERS = [
  ['clerk', /clerk/i],
  ['sentry', /sentry/i],
  ['zod', /ZodError|ZodType/],
  ['leaflet', /leaflet/i],
  ['react-dom', /react-dom|Minified React error/],
  ['next-runtime', /__next_app__|next\/dist/],
  ['taxonomy', /SERVICE_ATTRIBUTES_TAXONOMY|wheelchair/i],
  ['radix', /radix-ui|RovingFocus/i],
  ['lucide', /lucide/i],
];

const KB = 1024;
const chunkInfo = new Map();

function inspect(chunkPath) {
  const cached = chunkInfo.get(chunkPath);
  if (cached) return cached;

  // Stats entries are inconsistent about whether ".next/" is already on the
  // front. Probe as-given first, then relative to .next.
  const full = existsSync(chunkPath) ? chunkPath : join('.next', chunkPath);
  if (!existsSync(full)) {
    const missing = { gz: 0, tags: ['MISSING'] };
    chunkInfo.set(chunkPath, missing);
    return missing;
  }

  const buf = readFileSync(full);
  const text = buf.toString('utf8');
  const info = {
    gz: gzipSync(buf).length,
    tags: MARKERS.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag),
  };
  chunkInfo.set(chunkPath, info);
  return info;
}

const routeTotals = [];
const chunkRoutes = new Map();

for (const entry of stats) {
  if (!TRACKED.includes(entry.route)) continue;
  let total = 0;
  for (const chunkPath of entry.firstLoadChunkPaths) {
    total += inspect(chunkPath).gz;
    if (!chunkRoutes.has(chunkPath)) chunkRoutes.set(chunkPath, new Set());
    chunkRoutes.get(chunkPath).add(entry.route);
  }
  routeTotals.push({
    route: entry.route,
    chunks: entry.firstLoadChunkPaths.length,
    gzKb: Math.round(total / KB),
  });
}

if (routeTotals.length === 0) {
  console.error('[analyze] No tracked routes found in the stats file. Has the route set changed?');
  process.exit(1);
}

console.log('First Load JS per route (gzipped)\n');
for (const row of [...routeTotals].sort((a, b) => b.gzKb - a.gzKb)) {
  console.log(`  ${row.route.padEnd(12)} ${String(row.gzKb).padStart(4)} kB   ${row.chunks} chunks`);
}

console.log('\nLargest first-load chunks\n');
const largest = [...chunkRoutes.entries()]
  .map(([chunkPath, routes]) => ({ chunkPath, ...chunkInfo.get(chunkPath), routes }))
  .sort((a, b) => b.gz - a.gz)
  .slice(0, 25);
for (const chunk of largest) {
  const size = (chunk.gz / KB).toFixed(1).padStart(7);
  const scope = chunk.routes.size === routeTotals.length ? 'all routes' : [...chunk.routes].join(' ');
  const tags = chunk.tags.length ? chunk.tags.join(',') : 'app code';
  console.log(`  ${size} kB  [${tags}]  ${scope}`);
}

console.log('\nShared set — every tracked route pays for these\n');
const sharedByTag = new Map();
let sharedTotal = 0;
for (const [chunkPath, routes] of chunkRoutes) {
  if (routes.size !== routeTotals.length) continue;
  const { gz, tags } = chunkInfo.get(chunkPath);
  sharedTotal += gz;
  const key = tags.length ? tags.join('+') : 'untagged app code';
  sharedByTag.set(key, (sharedByTag.get(key) ?? 0) + gz);
}
console.log(`  ${String(Math.round(sharedTotal / KB)).padStart(7)} kB  TOTAL`);
for (const [tag, bytes] of [...sharedByTag.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${(bytes / KB).toFixed(1).padStart(7)} kB  ${tag}`);
}
console.log(
  '\nShared weight is charged to every route, so it sets the floor no route can'
  + '\nbeat. Route-specific debt is each route\'s total minus this floor.',
);
