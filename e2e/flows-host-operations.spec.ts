import { expect, test } from '@playwright/test';
import { loginAs } from './helpers/auth';

test.describe('Host operations workflow coverage', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  test('claim wizard supports full step navigation with state retention', async ({ page }) => {
    const orgName = `E2E Claim ${Date.now().toString(36)}`;

    await loginAs(page, 'host_admin');
    await page.goto('/claim');

    await expect(page.getByRole('heading', { name: 'Claim an Organization' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();

    await page.locator('#claim-org-name').fill(orgName);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText(/Contact information/i)).toBeVisible();

    await page.locator('#claim-url').fill('https://example.org');
    await page.locator('#claim-email').fill('host-e2e@example.org');
    await page.locator('#claim-phone').fill('(555) 555-1212');
    await page.locator('#claim-notes').fill('Automated claim wizard coverage test.');
    await page.getByRole('button', { name: 'Review' }).click();

    await expect(page.getByText('Review your claim')).toBeVisible();
    await expect(page.getByText(orgName)).toBeVisible();

    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.locator('#claim-url')).toHaveValue('https://example.org');
    await expect(page.locator('#claim-email')).toHaveValue('host-e2e@example.org');
  });

  test('team invite form validates both email and UUID modes', async ({ page }) => {
    await loginAs(page, 'host_admin');
    await page.goto('/admins');

    await expect(page.getByRole('heading', { name: 'Team Management' })).toBeVisible();

    const addMember = page.getByRole('button', { name: 'Add Member' });

    await page.locator('#invite-email').fill('bad-email');
    await expect(page.getByText('Enter a valid email')).toBeVisible();
    await expect(addMember).toBeDisabled();

    await page.locator('#invite-email').fill('valid@example.org');
    await expect(addMember).toBeEnabled();

    await page.getByRole('button', { name: 'User ID' }).click();
    await page.locator('#invite-user-id').fill('not-a-uuid');
    await expect(page.getByText('Enter a valid UUID')).toBeVisible();
    await expect(addMember).toBeDisabled();

    await page.locator('#invite-user-id').fill('11111111-1111-4111-8111-111111111111');
    await expect(addMember).toBeEnabled();
  });

  test('organization dashboard supports search control and claim shortcut', async ({ page }) => {
    await loginAs(page, 'host_admin');
    await page.goto('/org');

    await expect(page.getByRole('heading', { name: 'Organizations' })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search organizations' }).fill('example');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(
      page.locator('#main-content').getByRole('link', { name: 'Claim', exact: true }),
    ).toHaveAttribute('href', '/claim');
    await expect(page.getByText('Application error')).toHaveCount(0);
  });

  test('services page supports search and modal open/close when creation is available', async ({ page }) => {
    await loginAs(page, 'host_admin');
    await page.goto('/services');

    await expect(page.getByRole('heading', { name: 'Services' })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search services' }).fill('food');
    await page.getByRole('button', { name: 'Search' }).click();

    const addService = page.getByRole('button', { name: 'Add Service' });
    if (await addService.isEnabled().catch(() => false)) {
      await addService.click();
      await expect(page.getByRole('heading', { name: 'Add Service' })).toBeVisible();
      await page.getByRole('button', { name: 'Cancel' }).first().click();
      await expect(page.getByRole('heading', { name: 'Add Service' })).toHaveCount(0);
    } else {
      await expect(addService).toBeDisabled();
    }
  });

  test('locations page enforces client-side latitude validation in the create dialog', async ({ page }) => {
    await loginAs(page, 'host_admin');
    await page.goto('/locations');

    await expect(page.getByRole('heading', { name: 'Locations' })).toBeVisible();

    const addLocation = page.getByRole('button', { name: 'Add Location' });
    if (await addLocation.isEnabled().catch(() => false)) {
      await addLocation.click();
      await expect(page.getByRole('heading', { name: 'Add Location' })).toBeVisible();

      await page.locator('#loc-name').fill(`E2E Location ${Date.now().toString(36)}`);
      await page.locator('#loc-lat').fill('1000');
      await page.getByRole('button', { name: 'Create' }).click();

      await expect(page.getByText('Latitude must be a number between -90 and 90.')).toBeVisible();
      await page.getByRole('button', { name: 'Cancel' }).first().click();
    } else {
      await expect(addLocation).toBeDisabled();
    }
  });
});
