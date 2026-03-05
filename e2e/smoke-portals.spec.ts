import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { isDbConfigured } from './helpers/db';
import { ROUTES } from './helpers/routes';

async function gotoAndAssertNotCrashed(page: Page, path: string, opts?: { allowLoadingShell?: boolean }) {
  // Retry once on transient frame-detach/ERR_ABORTED navigation races.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!(message.includes('ERR_ABORTED') || message.includes('frame was detached')) || attempt === 2) {
        throw error;
      }
    }
  }
  const loadingShell = page.getByText(/Loading (Host|ORAN|Community Admin) portal/i).first();
  const allowLoadingShell = opts?.allowLoadingShell ?? false;

  if (allowLoadingShell) {
    await expect(async () => {
      const mainVisible = await page.locator('#main-content').isVisible().catch(() => false);
      const loadingVisible = await loadingShell.isVisible().catch(() => false);
      expect(mainVisible || loadingVisible).toBe(true);
    }).toPass({ timeout: 30_000 });
  } else {
    await expect(loadingShell).toHaveCount(0, { timeout: 30_000 });
    // Basic invariant: main content should exist (skip links use #main-content across shells)
    await expect(page.locator('#main-content')).toBeVisible({ timeout: 30_000 });
  }
  // Avoid silent Next.js error overlay (best-effort)
  await expect(page.getByText('Application error')).toHaveCount(0);
}

test.describe('Portals and role-based flows', () => {
  test('host portal loads and org edit flow works when DB is configured', async ({ page }) => {
    const db = await isDbConfigured(page.request);

    await loginAs(page, 'host_admin');

    // Visit host routes (smoke)
    for (const route of ROUTES.host) {
      await gotoAndAssertNotCrashed(page, route);
    }

    if (!db) {
      // Expect DB-not-configured errors on data-backed pages
      await page.goto('/org');
      await expect(page.getByText(/Database not configured/i)).toBeVisible();
      return;
    }

    // Create an org via API (works in dev; auth token exists anyway)
    const createRes = await page.request.post('/api/host/organizations', {
      data: {
        name: 'E2E Test Org',
        description: 'Created by Playwright',
        url: 'https://example.org',
        email: 'test@example.org',
      },
    });
    expect(createRes.ok()).toBeTruthy();

    await page.goto('/org');
    await expect(page.getByRole('heading', { name: 'Organizations' })).toBeVisible();

    // Open the edit modal for the first org card
    await page.getByRole('button', { name: 'Edit' }).first().click();
    await expect(page.getByRole('heading', { name: 'Edit Organization' })).toBeVisible();

    // Change name and save
    const nameInput = page.locator('#edit-name');
    await nameInput.fill('E2E Test Org Updated');
    await page.getByRole('button', { name: /Save/i }).click();

    // Success toast lives in UI; also the list should refresh.
    await expect(page.getByText('E2E Test Org Updated')).toBeVisible({ timeout: 30_000 });
  });

  test('host claim wizard validates and submits (DB optional)', async ({ page }) => {
    const db = await isDbConfigured(page.request);

    await loginAs(page, 'host_admin');
    await page.goto('/claim');

    await expect(page.getByRole('heading', { name: 'Claim an Organization' })).toBeVisible();

    const continueButton = page.getByRole('button', { name: 'Continue' });
    await expect(continueButton).toBeDisabled();

    await page.locator('#claim-org-name').fill('E2E Claim Org');
    await continueButton.click();

    await expect(page.getByText(/Contact information/i)).toBeVisible();
    await page.getByPlaceholder('https://www.example.org').fill('https://example.org');
    await page.getByPlaceholder('contact@example.org').fill('test@example.org');
    await page.getByRole('button', { name: 'Review' }).click();

    await expect(page.getByText('Review your claim')).toBeVisible();
    await page.getByRole('button', { name: 'Submit Claim' }).click();

    if (!db) {
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 30_000 });
      return;
    }

    await expect(page.getByText('Claim Submitted!')).toBeVisible({ timeout: 30_000 });
  });

  test('host can create a service and location (DB configured)', async ({ page }) => {
    const db = await isDbConfigured(page.request);
    await loginAs(page, 'host_admin');
    if (!db) return;

    // Create an org to attach new records to.
    const orgRes = await page.request.post('/api/host/organizations', {
      data: {
        name: 'E2E CRUD Org',
        description: 'Created by Playwright',
        url: 'https://example.org',
        email: 'test@example.org',
      },
    });
    expect(orgRes.ok()).toBeTruthy();
    const org = (await orgRes.json()) as { id: string };

    // Create Service via UI
    await page.goto('/services');
    await expect(page.getByRole('heading', { name: 'Services' })).toBeVisible();
    await page.getByRole('button', { name: 'Add Service' }).click();
    await expect(page.getByRole('heading', { name: 'Add Service' })).toBeVisible();

    await page.selectOption('#svc-org', org.id);
    await page.locator('#svc-name').fill('E2E Test Service');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('E2E Test Service')).toBeVisible({ timeout: 30_000 });

    // Create Location via UI
    await page.goto('/locations');
    await expect(page.getByRole('heading', { name: 'Locations' })).toBeVisible();
    await page.getByRole('button', { name: 'Add Location' }).click();
    await expect(page.getByRole('heading', { name: 'Add Location' })).toBeVisible();

    await page.selectOption('#loc-org', org.id);
    await page.locator('#loc-name').fill('E2E Test Location');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('E2E Test Location')).toBeVisible({ timeout: 30_000 });
  });

  test('host admins form validates UUID format client-side', async ({ page }) => {
    await loginAs(page, 'host_admin');
    await page.goto('/admins');

    await expect(page.getByRole('heading', { name: 'Team Management' })).toBeVisible();

    await page.getByRole('button', { name: 'User ID' }).click();
    await page.locator('#invite-user-id').fill('not-a-uuid');
    await expect(page.getByText('Enter a valid UUID')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Member' })).toBeDisabled();
  });

  test('community admin portal routes are accessible when authenticated', async ({ page }) => {
    await loginAs(page, 'community_admin');

    for (const route of ROUTES.communityAdmin) {
      await gotoAndAssertNotCrashed(page, route, { allowLoadingShell: true });
    }

    // A minimal assertion that the nav shell rendered
    await expect(page.getByRole('navigation', { name: 'Community admin navigation' })).toBeVisible();
  });

  test('ORAN admin portal routes are accessible and feature flags can be edited', async ({ page }) => {
    test.slow();
    await loginAs(page, 'oran_admin');

    for (const route of ROUTES.oranAdmin) {
      await gotoAndAssertNotCrashed(page, route);
    }

    await page.goto('/rules');
    await expect(page.getByRole('heading', { name: /System Rules & Feature Flags/i })).toBeVisible();

    // If flags exist, exercise the edit form; otherwise accept empty state.
    const editButtons = page.getByRole('button', { name: 'Edit' });
    const editCount = await editButtons.count();
    if (editCount > 0) {
      await editButtons.first().click();
      await expect(page.getByRole('button', { name: /Save Changes/i })).toBeVisible();
      await page.getByRole('button', { name: /Save Changes/i }).click();
      // Save result banner is role=alert
      await expect(page.getByRole('alert')).toBeVisible();
    }
  });
});
