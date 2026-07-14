import { test, expect } from '@playwright/test';
import { isDbConfigured } from './helpers/db';

test.describe('Seeker flows (public)', () => {
  test('mobile landing navigation is seeker-scoped and clears crisis help', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    const nav = page.getByRole('navigation', { name: 'Seeker mobile navigation' });
    const crisis = page.getByRole('button', { name: /open crisis resources and emergency hotlines/i });

    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link')).toHaveText(['Chat', 'Map', 'Scroll', 'Profile']);
    await expect(nav.getByRole('link', { name: 'Chat', exact: true })).toHaveAttribute('href', '/chat');
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(0);
    await expect(crisis).toBeVisible();

    const navBox = await nav.boundingBox();
    const crisisBox = await crisis.boundingBox();
    expect(navBox).not.toBeNull();
    expect(crisisBox).not.toBeNull();
    expect(crisisBox!.y + crisisBox!.height).toBeLessThanOrEqual(navBox!.y);
  });

  test('landing page shows crisis FAB and can reach chat', async ({ page }) => {
    await page.goto('/');

    // Persistent floating crisis help button — present on every page
    await expect(
      page.getByRole('button', { name: /open crisis resources and emergency hotlines/i }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Find services with chat' }).click();
    await expect(page).toHaveURL(/\/chat$/);
    await expect(page.getByRole('textbox', { name: 'Chat message input' })).toBeVisible();
  });

  test('chat crisis flow triggers crisis banner', async ({ page }) => {
    await page.goto('/chat');

    await page.getByRole('textbox', { name: 'Chat message input' }).fill('I am thinking about suicide');
    await page.getByRole('button', { name: 'Send message' }).click();

    await expect(page.getByRole('log', { name: 'Chat messages' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Immediate Help Available')).toBeVisible();
    await expect(page.getByRole('link', { name: /Emergency: Call 911/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Crisis Line: Call or text 988/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Community Resources: Call 211/i })).toBeVisible();

    // Eligibility disclaimer should still be present (always shown)
    await expect(page.getByRole('note', { name: 'Eligibility disclaimer' })).toBeVisible();
  });

  test('directory search behaves with/without DB', async ({ page }) => {
    await page.goto('/directory');

    const db = await isDbConfigured(page.request);

    await page.getByRole('searchbox', { name: 'Search services' }).fill('food');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    if (!db) {
      // When DB is absent, /api/search returns 503 and the directory surfaces an error.
      await expect(page.getByText('Search is temporarily unavailable (database not configured).')).toBeVisible();
      return;
    }

    // When DB is configured, we should land in a results state.
    await expect(page.getByRole('heading', { name: 'Directory', exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toContainText(/Showing|0 of/i);
  });

  test('map page loads (and search box is present)', async ({ page }) => {
    await page.goto('/map');

    await expect(page.getByRole('heading', { name: 'Map', exact: true })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Search services' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search map', exact: true })).toBeVisible();
  });

  test('service detail page renders for a retrieved record when DB is configured', async ({ page }) => {
    const db = await isDbConfigured(page.request);
    if (!db) return;

    // Best-effort: find any service ID from search results.
    const res = await page.request.get('/api/search?q=food&limit=1&page=1&status=active');
    if (!res.ok()) return;

    const json = (await res.json()) as { results?: Array<{ service?: { id?: string } }> };
    const serviceId = json.results?.[0]?.service?.id;
    if (!serviceId) return;

    await page.goto(`/service/${serviceId}`);

    await expect(page.locator('article[aria-label^="Service:"]')).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/Service information comes from verified records\. Always confirm eligibility/i),
    ).toBeVisible();
  });
});
