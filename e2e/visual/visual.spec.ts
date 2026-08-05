/**
 * ORAN Visual Regression Suite
 *
 * Captures full-page screenshots of key seeker-facing routes at three viewports.
 * Baseline snapshots live in e2e/visual/visual.spec.ts-snapshots/.
 *
 * To update baselines after intentional UI changes:
 *   npx playwright test e2e/visual/visual.spec.ts --update-snapshots
 */

import { test, expect, type Page } from '@playwright/test';

// Full-page captures can take longer on the mobile profile surface because it
// renders a tall preferences form. Keep the visual contract deterministic
// without inheriting the shorter interaction-test timeout.
test.setTimeout(120_000);

// Viewports to cover: mobile (390), tablet (768), desktop (1440)
const VIEWPORTS = [
  { name: 'mobile',   width: 390,  height: 844  },
  { name: 'tablet',   width: 768,  height: 1024 },
  { name: 'desktop',  width: 1440, height: 900  },
] as const;

const READY_SELECTOR_BY_ROUTE: Record<string, string> = {
  '/': 'form[aria-label="Guided service intake"]',
  '/chat': 'form[aria-label="Guided service intake"]',
  '/directory': 'input[aria-label="Search services"]',
  '/map': 'input[aria-label^="Search services"]',
  '/profile': 'main h1',
};

/**
 * Screenshot helper — sets viewport, navigates, and compares against baseline.
 * If no baseline exists, the first run creates it (Playwright default).
 */
async function screenshotPage(
  page: Page,
  route: string,
  name: string,
  viewport: typeof VIEWPORTS[number],
) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  const readySelector = READY_SELECTOR_BY_ROUTE[route];
  if (!readySelector) {
    throw new Error(`Missing visual readiness selector for ${route}`);
  }
  await expect(page.locator(readySelector).first()).toBeVisible();
  if (route === '/map') {
    await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible({ timeout: 30_000 });
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

  await expect(page).toHaveScreenshot(`${name}-${viewport.name}.png`, {
    fullPage: true,
    maxDiffPixelRatio: 0.02, // allow up to 2% pixel diff before failing
    animations: 'disabled',
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`[${viewport.name}] Visual regression`, () => {
    test('landing page', async ({ page }) => {
      await screenshotPage(page, '/', 'landing', viewport);
    });

    test('chat page', async ({ page }) => {
      await screenshotPage(page, '/chat', 'chat', viewport);
    });

    test('directory page', async ({ page }) => {
      await screenshotPage(page, '/directory', 'directory', viewport);
    });

    test('map page', async ({ page }) => {
      await screenshotPage(page, '/map', 'map', viewport);
    });

    test('profile page', async ({ page }) => {
      await screenshotPage(page, '/profile', 'profile', viewport);
    });
  });
}
