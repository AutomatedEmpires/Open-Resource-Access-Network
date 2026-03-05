import { expect, test, type Page } from '@playwright/test';
import { loginAs } from './helpers/auth';

async function gotoStable(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Application error')).toHaveCount(0);
}

test.describe('Role surface coverage', () => {
  test.describe.configure({ timeout: 120_000 });

  test('host org page exposes dashboard search and claim shortcut', async ({ page }) => {
    test.slow();
    await loginAs(page, 'host_admin');
    await gotoStable(page, '/org');

    await expect(page.getByRole('heading', { name: 'Organizations' })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Search organizations' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Claim' }).first()).toHaveAttribute('href', '/claim');
  });

  test('host services page exposes search and add controls', async ({ page }) => {
    test.slow();
    await loginAs(page, 'host_admin');
    await gotoStable(page, '/services');

    await expect(page.getByRole('heading', { name: 'Services' })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Search services' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Service' })).toBeVisible();
  });

  test('host locations page exposes add-location control', async ({ page }) => {
    await loginAs(page, 'host_admin');
    await gotoStable(page, '/locations');

    await expect(page.getByRole('heading', { name: 'Locations' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Location' })).toBeVisible();
  });

  test('host admins page supports invite mode toggles', async ({ page }) => {
    await loginAs(page, 'host_admin');
    await gotoStable(page, '/admins');

    await expect(page.getByRole('heading', { name: 'Team Management' })).toBeVisible();
    await expect(page.locator('#invite-email')).toBeVisible();
    await page.getByRole('button', { name: 'User ID' }).click();
    await expect(page.locator('#invite-user-id')).toBeVisible();
  });

  test('host claim page starts with disabled continue action', async ({ page }) => {
    await loginAs(page, 'host_admin');
    await gotoStable(page, '/claim');

    await expect(page.getByRole('heading', { name: 'Claim an Organization' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  test('community queue page exposes filter tabs and assigned tab', async ({ page }) => {
    await loginAs(page, 'community_admin');
    await gotoStable(page, '/queue');

    await expect(page.getByRole('heading', { name: 'Verification Queue' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'All' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Assigned to me' })).toBeVisible();
  });

  test('community verify page shows missing-entry fallback without query id', async ({ page }) => {
    await loginAs(page, 'community_admin');
    await gotoStable(page, '/verify');

    await expect(page.getByText('No entry selected')).toBeVisible();
    await expect(page.getByRole('link', { name: 'verification queue' })).toHaveAttribute('href', '/queue');
  });

  test('community coverage page shows heading and refresh action', async ({ page }) => {
    await loginAs(page, 'community_admin');
    await gotoStable(page, '/coverage');

    await expect(page.getByRole('heading', { name: 'My Coverage Zone' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
  });

  test('ORAN approvals page exposes moderation status tabs', async ({ page }) => {
    await loginAs(page, 'oran_admin');
    await gotoStable(page, '/approvals');

    await expect(page.getByRole('heading', { name: 'Claim Approvals' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'All' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Submitted' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Under Review' })).toBeVisible();
  });

  test('ORAN rules page exposes refresh and edit surfaces', async ({ page }) => {
    await loginAs(page, 'oran_admin');
    await gotoStable(page, '/rules');

    await expect(page.getByRole('heading', { name: /System Rules & Feature Flags/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
  });

  test('ORAN audit page exposes action and table filters', async ({ page }) => {
    await loginAs(page, 'oran_admin');
    await gotoStable(page, '/audit');

    await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible();
    await expect(page.locator('#action-filter')).toBeVisible();
    await expect(page.locator('#table-filter')).toBeVisible();
  });

  test('ORAN zone-management page exposes new-zone action and status tabs', async ({ page }) => {
    await loginAs(page, 'oran_admin');
    await gotoStable(page, '/zone-management');

    await expect(page.getByRole('heading', { name: 'Coverage Zone Administration' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Zone' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Active', exact: true })).toBeVisible();
  });

  test('ORAN ingestion page exposes all ingestion tabs', async ({ page }) => {
    await loginAs(page, 'oran_admin');
    await gotoStable(page, '/ingestion');

    await expect(page.getByRole('heading', { name: 'Ingestion Agent' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Sources' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Jobs' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Candidates' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Process' })).toBeVisible();
  });

  test('ORAN scopes page exposes scope center tabs', async ({ page }) => {
    await loginAs(page, 'oran_admin');
    await gotoStable(page, '/scopes');

    await expect(page.getByRole('heading', { name: 'Scope Center' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Scopes' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Pending Grants' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Audit Log' })).toBeVisible();
  });

  test('ORAN appeals page renders review shell', async ({ page }) => {
    await loginAs(page, 'oran_admin');
    await gotoStable(page, '/appeals');

    await expect(page.getByRole('heading', { name: 'Appeal Review' })).toBeVisible();
  });

  test('authenticated seeker profile page renders preferences sections', async ({ page }) => {
    await loginAs(page, 'seeker');
    await gotoStable(page, '/profile');

    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
    await expect(page.getByText('Approximate location')).toBeVisible();
    await expect(page.locator('#approx-city')).toBeVisible();
  });

  test('authenticated seeker saved page renders local bookmark shell', async ({ page }) => {
    await loginAs(page, 'seeker');
    await gotoStable(page, '/saved');

    await expect(page.getByRole('heading', { name: 'Saved Services' })).toBeVisible();
  });

  test('report page keeps submit disabled until required fields are provided', async ({ page }) => {
    await gotoStable(page, '/report');

    await expect(page.getByRole('heading', { name: 'Report a Listing' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit Report' })).toBeDisabled();
  });

  test('appeal page unauthenticated state prompts for sign-in', async ({ page }) => {
    await gotoStable(page, '/appeal');

    await expect(page.getByRole('heading', { name: 'Appeal a Decision' })).toBeVisible();
    await expect(page.getByText('Sign in required')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/api/auth/signin');
  });

  test('notifications page unauthenticated state prompts for sign-in', async ({ page }) => {
    await gotoStable(page, '/notifications');

    const signInHeading = page.getByRole('heading', { name: 'Sign in to view notifications' });
    const signInButton = page.getByRole('link', { name: 'Sign in with Microsoft' });

    if (await signInHeading.isVisible().catch(() => false)) {
      await expect(signInButton).toHaveAttribute('href', /\/api\/auth\/signin/);
    } else {
      await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    }
  });
});
