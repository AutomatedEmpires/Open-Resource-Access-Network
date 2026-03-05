import { expect, test, type Page } from '@playwright/test';
import { loginAs } from './helpers/auth';

async function expectAnyVisible(page: Page, checks: Array<() => Promise<boolean>>): Promise<void> {
  await expect(async () => {
    const results = await Promise.all(checks.map((check) => check().catch(() => false)));
    expect(results.some(Boolean)).toBe(true);
  }).toPass({ timeout: 30_000 });
}

test.describe('Seeker journey coverage', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  test('chat suggestion chips produce a user-visible response state', async ({ page }) => {
    await page.goto('/chat');

    await expect(page.getByRole('heading', { name: 'Find Services' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Food pantry near me' })).toBeVisible();

    await page.getByRole('button', { name: 'Food pantry near me' }).click();
    await expect(page.getByText('Where can I find a food pantry near me?')).toBeVisible();

    await expect
      .poll(async () => page.locator('[role="log"] > div.flex').count(), { timeout: 30_000 })
      .toBeGreaterThan(1);

    await expect(page.getByRole('note', { name: 'Eligibility disclaimer' })).toBeVisible();
  });

  test('directory trust, sort, category, and clear controls are interactive', async ({ page }) => {
    await page.goto('/directory');

    const search = page.getByRole('searchbox', { name: 'Search services' });
    await page.getByRole('button', { name: 'Food' }).click();
    await expect(search).toHaveValue('food');

    const highTrust = page.getByRole('button', { name: 'High confidence only' });
    await highTrust.click();
    await expect(highTrust).toHaveAttribute('aria-pressed', 'true');

    const sortSelect = page.locator('#sort-select');
    await sortSelect.selectOption('name_asc');
    await expect(sortSelect).toHaveValue('name_asc');

    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(search).toHaveValue('');
  });

  test('map flow enables search-this-area mode after first search', async ({ page }) => {
    await page.goto('/map');

    await expect(page.getByRole('heading', { name: 'Service Map' })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search services to plot' }).fill('food');
    await page.getByRole('button', { name: 'Search', exact: true }).click();

    await expect(page.getByRole('button', { name: 'Search this area' })).toBeVisible();
    await expect(page.getByText('Application error')).toHaveCount(0);
  });

  test('service detail handles unknown IDs gracefully', async ({ page }) => {
    await page.goto('/service/00000000-0000-4000-8000-000000000000');

    await expectAnyVisible(page, [
      () => page.getByRole('heading', { name: 'Service not found' }).isVisible(),
      () => page.getByText('Could not load service').isVisible(),
    ]);
  });

  test('appeal form validates UUID format and supports evidence row add/remove', async ({ page }) => {
    await loginAs(page, 'seeker');
    await page.goto('/appeal');

    await expect(page.getByRole('heading', { name: 'Appeal a Decision' })).toBeVisible();

    await page.getByLabel('Submission ID').fill('not-a-uuid');
    await expect(page.getByText('Please enter a valid UUID format')).toBeVisible();

    await page.getByRole('button', { name: 'Add evidence' }).click();
    await expect(page.getByText('Evidence #1')).toBeVisible();

    await page.getByPlaceholder('Description of this evidence').fill('Updated denial letter');
    await page.getByPlaceholder('URL to document or screenshot (https://...)').fill('https://example.org/evidence');
    await page.getByRole('button', { name: 'Remove evidence 1' }).click();
    await expect(page.getByText('Evidence #1')).toHaveCount(0);

    await page.getByLabel('Submission ID').fill('11111111-1111-4111-8111-111111111111');
    await page.getByLabel('Reason for appeal').fill('too short');
    await expect(page.getByRole('button', { name: 'Submit Appeal' })).toBeDisabled();
  });

  test('notifications inbox filter toggles are usable for authenticated seekers', async ({ page }) => {
    await loginAs(page, 'seeker');
    await page.goto('/notifications');

    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();

    const unread = page.getByRole('button', { name: /^Unread \(/ });
    const all = page.getByRole('button', { name: /^All \(/ });

    await unread.click();
    await all.click();

    await expect(page.getByText('Application error')).toHaveCount(0);
  });
});
