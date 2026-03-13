#!/usr/bin/env node
/**
 * capture-ui-snapshots.mjs
 *
 * Captures screenshots of ORAN seeker pages at each canonical viewport
 * defined in docs/ui/viewports.json.
 *
 * Usage:
 *   node scripts/capture-ui-snapshots.mjs
 *   node scripts/capture-ui-snapshots.mjs --page directory
 *   node scripts/capture-ui-snapshots.mjs --viewport mobile-xs
 *   node scripts/capture-ui-snapshots.mjs --page chat --viewport mobile-sm
 *
 * Output: docs/ui/snapshots/<page>/<viewport-id>.png
 *
 * Prerequisites:
 *   npx playwright install --with-deps chromium
 */

import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Config ──────────────────────────────────────────────────────────────────

const viewportsConfig = JSON.parse(
  readFileSync(resolve(ROOT, 'docs/ui/viewports.json'), 'utf8'),
);

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/** Seeker pages to capture. Key = directory name, value = pathname. */
const PAGES = {
  chat: '/chat',
  directory: '/directory',
  map: '/map',
  saved: '/saved',
  profile: '/profile',
  notifications: '/notifications',
  'submit-resource': '/submit-resource',
  report: '/report',
  appeal: '/appeal',
  invitations: '/invitations',
  // Service detail — uses a placeholder ID; only captures the 404 state without auth
  'service-detail': '/service/example-id',
};

// ── CLI flags ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const pageFilter = args.includes('--page') ? args[args.indexOf('--page') + 1] : null;
const vpFilter = args.includes('--viewport') ? args[args.indexOf('--viewport') + 1] : null;

const viewports = viewportsConfig.viewports.filter(
  (vp) => !vpFilter || vp.id === vpFilter,
);
const pages = Object.entries(PAGES).filter(
  ([key]) => !pageFilter || key === pageFilter,
);

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const browser = await chromium.launch();

  for (const [pageKey, pathname] of pages) {
    for (const vp of viewports) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: vp.deviceScaleFactor ?? 1,
      });
      const page = await context.newPage();

      const url = `${BASE_URL}${pathname}`;
      await page.goto(url, { waitUntil: 'networkidle' });

      // Allow layout to settle
      await page.waitForTimeout(500);

      const outDir = resolve(ROOT, 'docs/ui/snapshots', pageKey);
      mkdirSync(outDir, { recursive: true });

      const outPath = resolve(outDir, `${vp.id}.png`);
      await page.screenshot({ path: outPath, fullPage: true });

      console.log(`✓ ${pageKey} @ ${vp.id} (${vp.width}px) → ${outPath.replace(ROOT + '/', '')}`);

      await context.close();
    }
  }

  await browser.close();
  console.log('\nDone. Snapshots saved to docs/ui/snapshots/');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
