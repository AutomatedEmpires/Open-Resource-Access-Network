import { test, expect } from '@playwright/test';
import { isDbConfigured } from './helpers/db';

test.describe('Seeker flows (public)', () => {
  test('landing page shows crisis FAB and can reach chat', async ({ page }) => {
    await page.goto('/');

    // Persistent floating crisis help button — present on every page
    await expect(
      page.getByRole('button', { name: /open crisis resources/i }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Find services' }).click();
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
    await expect(page.getByRole('heading', { name: 'Service Directory' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText(/Showing|0 of/i);
  });

  test('map page loads (and search box is present)', async ({ page }) => {
    await page.goto('/map');

    await expect(page.getByRole('heading', { name: 'Service Map' })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Search services to plot' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeVisible();
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
