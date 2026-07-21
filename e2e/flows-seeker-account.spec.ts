import { expect, test, type Page } from '@playwright/test';
import { loginAs } from './helpers/auth';

const SAVED_COMPARISON_SERVICE_IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
];

// These records exist only inside the intercepted browser response. They are
// deliberately never inserted into a database or exposed through a production
// data path; the acceptance test exercises the real saved-comparison UI using
// the same JSON contract as GET /api/services.
const SAVED_COMPARISON_SERVICES = [
  {
    service: {
      id: SAVED_COMPARISON_SERVICE_IDS[0],
      organizationId: '31111111-1111-4111-8111-111111111111',
      name: 'E2E Intake and Navigation',
      description: 'Protected acceptance fixture with recorded next-step details.',
      status: 'active',
      capacityStatus: 'limited',
      applicationProcess: 'Call to request an intake appointment',
      waitTime: 'Two business days recorded',
      fees: 'No fee recorded',
      createdAt: '2026-07-01T12:00:00.000Z',
      updatedAt: '2026-07-20T12:00:00.000Z',
    },
    organization: {
      id: '31111111-1111-4111-8111-111111111111',
      name: 'E2E Reviewed Provider',
      status: 'active',
      verifiedAt: '2026-07-19T12:00:00.000Z',
      createdAt: '2026-07-01T12:00:00.000Z',
      updatedAt: '2026-07-20T12:00:00.000Z',
    },
    address: {
      id: '41111111-1111-4111-8111-111111111111',
      locationId: '51111111-1111-4111-8111-111111111111',
      address1: '100 Test Avenue',
      city: 'Spokane',
      stateProvince: 'WA',
      postalCode: '99201',
      createdAt: '2026-07-01T12:00:00.000Z',
      updatedAt: '2026-07-20T12:00:00.000Z',
    },
    phones: [],
    schedules: [],
    taxonomyTerms: [{
      id: '61111111-1111-4111-8111-111111111111',
      term: 'Resource Navigation',
    }],
    eligibility: [{
      id: '71111111-1111-4111-8111-111111111111',
      serviceId: SAVED_COMPARISON_SERVICE_IDS[0],
      description: 'Recorded for residents of the test service area',
      createdAt: '2026-07-01T12:00:00.000Z',
      updatedAt: '2026-07-20T12:00:00.000Z',
    }],
    requiredDocuments: [{
      id: '81111111-1111-4111-8111-111111111111',
      serviceId: SAVED_COMPARISON_SERVICE_IDS[0],
      document: 'Photo ID if available',
      createdAt: '2026-07-01T12:00:00.000Z',
      updatedAt: '2026-07-20T12:00:00.000Z',
    }],
    confidenceScore: {
      id: '91111111-1111-4111-8111-111111111111',
      serviceId: SAVED_COMPARISON_SERVICE_IDS[0],
      score: 88,
      verificationConfidence: 92,
      eligibilityMatch: 70,
      constraintFit: 80,
      computedAt: '2026-07-20T12:00:00.000Z',
      createdAt: '2026-07-20T12:00:00.000Z',
      updatedAt: '2026-07-20T12:00:00.000Z',
    },
    provenance: {
      serviceId: SAVED_COMPARISON_SERVICE_IDS[0],
      origin: 'provider_submission',
      sourceName: 'E2E reviewed fixture',
      sourceCount: 1,
      firstSeenAt: '2026-07-01T12:00:00.000Z',
      informationUpdatedAt: '2026-07-20T12:00:00.000Z',
      lastHumanReviewAt: '2026-07-19T12:00:00.000Z',
    },
    attributes: [{
      id: 'a1111111-1111-4111-8111-111111111111',
      serviceId: SAVED_COMPARISON_SERVICE_IDS[0],
      taxonomy: 'access',
      tag: 'appointment_required',
      createdAt: '2026-07-01T12:00:00.000Z',
      updatedAt: '2026-07-20T12:00:00.000Z',
    }],
    serviceAreas: [{
      id: 'b1111111-1111-4111-8111-111111111111',
      serviceId: SAVED_COMPARISON_SERVICE_IDS[0],
      name: 'E2E test service area',
      createdAt: '2026-07-01T12:00:00.000Z',
      updatedAt: '2026-07-20T12:00:00.000Z',
    }],
  },
  {
    service: {
      id: SAVED_COMPARISON_SERVICE_IDS[1],
      organizationId: '32222222-2222-4222-8222-222222222222',
      name: 'E2E Information Referral',
      description: 'Protected acceptance fixture with deliberately incomplete evidence.',
      status: 'active',
      createdAt: '2026-07-01T12:00:00.000Z',
      updatedAt: '2026-07-02T12:00:00.000Z',
    },
    organization: {
      id: '32222222-2222-4222-8222-222222222222',
      name: 'E2E Unreviewed Provider',
      status: 'active',
      createdAt: '2026-07-01T12:00:00.000Z',
      updatedAt: '2026-07-02T12:00:00.000Z',
    },
    address: null,
    phones: [],
    schedules: [],
    taxonomyTerms: [{
      id: '62222222-2222-4222-8222-222222222222',
      term: 'Information and Referral',
    }],
    eligibility: [],
    requiredDocuments: [],
    confidenceScore: null,
    provenance: null,
    attributes: [],
    serviceAreas: [],
  },
];

function requireHostedSavedComparisonAuth(): void {
  if (!process.env.PLAYWRIGHT_BASE_URL?.trim()) return;

  const publishableKey = (
    process.env.CLERK_PUBLISHABLE_KEY
    ?? process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  )?.trim();
  const missing = [
    !publishableKey ? 'CLERK_PUBLISHABLE_KEY or NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY' : null,
    !process.env.CLERK_SECRET_KEY?.trim() ? 'CLERK_SECRET_KEY' : null,
    !process.env.ORAN_E2E_SEEKER_EMAIL?.trim() ? 'ORAN_E2E_SEEKER_EMAIL' : null,
  ].filter((name): name is string => Boolean(name));

  if (missing.length > 0) {
    throw new Error(
      `Hosted saved-comparison acceptance requires an active ORAN-only Clerk seeker fixture. Missing: ${missing.join(', ')}.`,
    );
  }
}

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

  test('saved services compare recorded next steps and uncertainty on mobile', async ({ page }) => {
    requireHostedSavedComparisonAuth();
    await page.setViewportSize({ width: 390, height: 844 });

    let requestedIds: string[] = [];
    const blockedSavedApiRequests: string[] = [];
    await page.route(/\/api\/saved(?:\/|$)/, async (route) => {
      blockedSavedApiRequests.push(route.request().url());
      await route.abort('blockedbyclient');
    });
    await page.route('**/api/services?**', async (route) => {
      const requestUrl = new URL(route.request().url());
      requestedIds = requestUrl.searchParams.get('ids')?.split(',').filter(Boolean) ?? [];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: SAVED_COMPARISON_SERVICES,
          notFound: [],
        }),
      });
    });

    await loginAs(page, 'seeker');
    await page.addInitScript((serviceIds) => {
      localStorage.setItem('oran:saved-service-ids', JSON.stringify(serviceIds));

      const existingPreferences = JSON.parse(localStorage.getItem('oran:preferences') ?? '{}') as Record<string, unknown>;
      localStorage.setItem('oran:preferences', JSON.stringify({
        ...existingPreferences,
        serverSyncEnabled: false,
      }));
    }, SAVED_COMPARISON_SERVICE_IDS);
    await page.goto('/saved');

    await expect(page.getByRole('heading', { name: 'Saved Services' })).toBeVisible();
    await expect(page.locator('article[aria-label^="Service:"]')).toHaveCount(2);
    expect(requestedIds).toEqual(SAVED_COMPARISON_SERVICE_IDS);
    expect(blockedSavedApiRequests).toEqual([]);
    await expect(page.getByText('Sync off on this device')).toBeVisible();

    const firstSelection = page.getByRole('checkbox', { name: 'Add E2E Intake and Navigation to comparison' });
    const secondSelection = page.getByRole('checkbox', { name: 'Add E2E Information Referral to comparison' });
    await expect(firstSelection).toBeVisible();
    await expect(secondSelection).toBeVisible();
    await firstSelection.check();
    await expect(page.getByRole('status').filter({ hasText: 'One selected' })).toBeVisible();
    await secondSelection.check();

    const comparison = page.getByRole('table', {
      name: 'Comparison of selected saved services using stored ORAN information',
    });
    await expect(comparison).toBeVisible();
    await expect(comparison.getByRole('rowheader', { name: 'Trust and freshness' })).toBeVisible();
    await expect(comparison.getByRole('rowheader', { name: 'Eligibility on record' })).toBeVisible();
    await expect(comparison.getByRole('rowheader', { name: 'Documents to prepare' })).toBeVisible();
    await expect(comparison.getByRole('rowheader', { name: 'Access and next step' })).toBeVisible();

    await expect(comparison.getByText('Record verification confidence: 92/100')).toBeVisible();
    await expect(comparison.getByText('Latest recorded ORAN review: Jul 19, 2026')).toBeVisible();
    await expect(comparison.getByText('Recorded for residents of the test service area')).toBeVisible();
    await expect(comparison.getByText('Photo ID if available')).toBeVisible();
    await expect(comparison.getByText('Stored capacity: Limited — confirm with the provider')).toBeVisible();

    await expect(comparison.getByText('No recent human review is recorded')).toBeVisible();
    await expect(comparison.getByText('Eligibility criteria are not recorded; ask the provider')).toBeVisible();
    await expect(comparison.getByText('No document requirements are recorded; confirm before applying')).toBeVisible();
    await expect(comparison.getByText('Current availability is not recorded; confirm with the provider')).toBeVisible();
    await expect(page.getByText(/not an eligibility or availability decision/i)).toBeVisible();

    const horizontalScroller = comparison.locator('xpath=..');
    const comparisonWidths = await horizontalScroller.evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }));
    expect(comparisonWidths.scroll).toBeGreaterThan(comparisonWidths.client);
    await horizontalScroller.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    await expect.poll(() => horizontalScroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});
