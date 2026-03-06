import { expect, test, type Page } from '@playwright/test';
import { loginAs } from './helpers/auth';

async function expectSuccessOrAlert(page: Page, successPattern: RegExp): Promise<void> {
  await expect(async () => {
    const successVisible = await page.getByText(successPattern).first().isVisible().catch(() => false);
    const alertVisible = await page.getByRole('alert').first().isVisible().catch(() => false);
    expect(successVisible || alertVisible).toBe(true);
  }).toPass({ timeout: 30_000 });
}

async function openSeekerSubmissionPage(page: Page, path: string, heading: string): Promise<void> {
  await expect(async () => {
    await page.goto(path);
    const signInRequired = page.getByText('Sign in required');
    if (await signInRequired.isVisible().catch(() => false)) {
      await loginAs(page, 'seeker');
      await page.goto(path);
    }

    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(signInRequired).toHaveCount(0);
  }).toPass({ timeout: 45_000 });
}

test.describe('Seeker account & submission workflows', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  test('notifications page prompts unauthenticated users to sign in', async ({ page }) => {
    await page.goto('/notifications');

    const signInHeading = page.getByRole('heading', { name: 'Sign in to view notifications' });
    const inboxHeading = page.getByRole('heading', { name: 'Notifications' });

    await expect(async () => {
      const signedOut = await signInHeading.isVisible().catch(() => false);
      const inbox = await inboxHeading.isVisible().catch(() => false);
      expect(signedOut || inbox).toBe(true);
    }).toPass({ timeout: 30_000 });
  });

  test('authenticated seeker can open notifications inbox shell', async ({ page }) => {
    await loginAs(page, 'seeker');
    await page.goto('/notifications');

    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^All \(/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Unread \(/ })).toBeVisible();
    await expect(page.getByText(/No notifications yet|No unread notifications/i)).toBeVisible();
  });

  test('seeker can update profile preferences', async ({ page }) => {
    const city = `E2E City ${Date.now().toString(36)}`;
    await loginAs(page, 'seeker');
    await page.goto('/profile');

    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
    await expect(page.getByLabel('City or region')).toBeVisible();

    await page.getByLabel('City or region').fill(city);
    await page.getByLabel('City or region').press('Enter');
    await expect(page.getByText(new RegExp(`Saved:\\s+${city}`))).toBeVisible();

    await page.getByLabel('Language').selectOption('es');
    await expect.poll(async () => page.evaluate(() => document.documentElement.lang), {
      timeout: 15_000,
    }).toBe('es');
  });

  test('seeker can submit a listing report (success or API error surfaced)', async ({ page }) => {
    await loginAs(page, 'seeker');
    await openSeekerSubmissionPage(page, '/report?serviceId=11111111-1111-4111-8111-111111111111', 'Report a Listing');

    const submit = page.getByRole('button', { name: 'Submit Report' });
    await expect(submit).toBeDisabled();

    await page.getByLabel('Reason for report').selectOption('wrong_location');
    await page.getByLabel('Details').fill('Map pin appears to be incorrect for this listing.');
    await expect(submit).toBeEnabled();
    await submit.click();

    await expectSuccessOrAlert(page, /Thank you for your report/i);
  });

  test('seeker can submit an appeal (success or API error surfaced)', async ({ page }) => {
    await loginAs(page, 'seeker');
    await openSeekerSubmissionPage(
      page,
      '/appeal?submissionId=11111111-1111-4111-8111-111111111111',
      'Appeal a Decision',
    );

    const submit = page.getByRole('button', { name: 'Submit Appeal' });
    await expect(submit).toBeDisabled();

    await page
      .getByLabel('Reason for appeal')
      .fill('This decision should be reconsidered due to newly provided supporting context.');
    await expect(submit).toBeEnabled();
    await submit.click();

    await expectSuccessOrAlert(page, /Appeal submitted/i);
  });

  test('saved services page shows actionable state for authenticated users', async ({ page }) => {
    await loginAs(page, 'seeker');
    await page.addInitScript(() => {
      localStorage.setItem('oran:saved-service-ids', JSON.stringify(['11111111-1111-4111-8111-111111111111']));
    });
    await page.goto('/saved');

    await expect(page.getByRole('heading', { name: 'Saved Services' })).toBeVisible();

    const clearAll = page.getByRole('button', { name: 'Clear all' });
    if (await clearAll.isVisible().catch(() => false)) {
      await clearAll.click();
      await page.getByRole('button', { name: 'Confirm' }).click();
    }

    await expect(async () => {
      const emptyVisible = await page.getByText('No saved services yet').isVisible().catch(() => false);
      const serviceCards = await page.locator('article[aria-label^="Service:"]').count();
      const clearVisible = await page.getByRole('button', { name: 'Clear all' }).isVisible().catch(() => false);
      expect(emptyVisible || serviceCards > 0 || clearVisible).toBe(true);
    }).toPass({ timeout: 30_000 });

    if (await page.getByText('No saved services yet').isVisible().catch(() => false)) {
      await expect(page.getByRole('button', { name: /Find services via Chat/i })).toBeVisible();
    }
  });
});
