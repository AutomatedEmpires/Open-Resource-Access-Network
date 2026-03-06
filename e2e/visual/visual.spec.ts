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

// Viewports to cover: mobile (390), tablet (768), desktop (1440)
const VIEWPORTS = [
  { name: 'mobile',   width: 390,  height: 844  },
  { name: 'tablet',   width: 768,  height: 1024 },
  { name: 'desktop',  width: 1440, height: 900  },
] as const;

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
  await page.goto(route);
  await page.waitForLoadState('networkidle');

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
