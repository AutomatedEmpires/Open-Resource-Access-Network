import { expect, test } from '@playwright/test';

const NEED = 'Utility shutoff help';
const APPROXIMATE_LOCATION = '48201';
const EXPECTED_PROMPT = [
  `${NEED}.`,
  `Near ${APPROXIMATE_LOCATION}.`,
  'I need help today.',
  'This is for my family or household.',
  'I need help I can reach by phone.',
].join(' ');

test.describe('Guided intake acceptance', () => {
  test('keeps structured answers out of URLs and explains an empty catalog', async ({ page }) => {
    let capturedChatRequest: { url: string; body: Record<string, unknown> } | undefined;

    await page.route('**/api/chat*', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;

      if (pathname === '/api/chat/quota') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          json: { remaining: 50, resetAt: null },
        });
        return;
      }

      if (pathname !== '/api/chat' || request.method() !== 'POST') {
        await route.continue();
        return;
      }

      const body = request.postDataJSON() as Record<string, unknown>;
      capturedChatRequest = { url: request.url(), body };

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: {
          message: 'I could not find a close match for that request in the current database. Try rephrasing, broadening the filters, or contact 211 for local assistance.',
          resultSummary: 'The catalog could not resolve 48201 to a published service location, so it did not change distance ordering.',
          services: [],
          isCrisis: false,
          intent: {
            category: 'utility_assistance',
            rawQuery: EXPECTED_PROMPT,
            urgencyQualifier: 'urgent',
          },
          sessionId: body.sessionId,
          quotaRemaining: 49,
          eligibilityDisclaimer: 'Service information does not guarantee eligibility or availability. Confirm details with the provider.',
          llmSummarized: false,
          retrievalStatus: 'no_match',
          effectiveSearchText: NEED,
          locationBiasApplied: false,
          activeContextUsed: false,
          sessionContext: {
            activeNeedId: 'utility_assistance',
            activeRetrievalText: NEED,
            activeLocation: { postalCode: APPROXIMATE_LOCATION },
            urgency: 'urgent',
            urgencyWindow: 'today',
            audience: 'family',
            accessMode: 'phone',
            preferredDeliveryModes: ['phone'],
            attributeFilters: { delivery: ['phone'] },
            profileShapingEnabled: true,
          },
          followUpSuggestions: ['Try a nearby city', 'Broaden the type of utility help'],
        },
      });
    });

    await page.goto('/');
    const intake = page.getByRole('form', { name: 'Guided service intake' });

    await intake.getByLabel('What do you need help with?').fill(NEED);
    await intake.getByText('Filters: location, timing, access').click();
    await intake.getByLabel(/City or ZIP/).fill(APPROXIMATE_LOCATION);
    await intake.getByLabel('How soon?').selectOption('today');
    await intake.getByLabel('Who is this for?').selectOption('family');
    await intake.getByLabel('How can you reach help?').selectOption('phone');
    await intake.getByRole('button', { name: 'Find help' }).click();

    await expect(page).toHaveURL(/\/chat\?from=guided$/);
    const handoffUrl = new URL(page.url());
    expect(Array.from(handoffUrl.searchParams.entries())).toEqual([['from', 'guided']]);
    expect(page.url()).not.toContain(NEED);
    expect(page.url()).not.toContain(APPROXIMATE_LOCATION);

    const chatInput = page.getByRole('textbox', { name: 'Chat message input' });
    await expect(chatInput).toHaveValue(EXPECTED_PROMPT);
    await page.getByRole('button', { name: 'Send message' }).click();

    await expect(page.getByText('Status: No close match was found in the current catalog.')).toBeVisible();
    await expect(page.getByText(/contact 211 for local assistance/i)).toBeVisible();
    await expect(page.getByRole('note', { name: 'Eligibility disclaimer' })).toBeVisible();

    await expect.poll(() => capturedChatRequest).toBeTruthy();
    if (!capturedChatRequest) throw new Error('The guided chat request was not captured.');

    expect(new URL(capturedChatRequest.url).search).toBe('');
    expect(capturedChatRequest.url).not.toContain(NEED);
    expect(capturedChatRequest.url).not.toContain(APPROXIMATE_LOCATION);
    expect(capturedChatRequest.body).toMatchObject({
      message: EXPECTED_PROMPT,
      guidedIntake: {
        searchText: NEED,
        location: APPROXIMATE_LOCATION,
        urgency: 'today',
        audience: 'family',
        accessMode: 'phone',
      },
    });
    expect(capturedChatRequest.body.guidedIntake).not.toHaveProperty('prompt');

    const resultViews = page.getByRole('navigation', { name: 'Result views' });
    const directoryHref = await resultViews.getByRole('link', { name: 'List view' }).getAttribute('href');
    const mapHref = await resultViews.getByRole('link', { name: 'Map view' }).getAttribute('href');
    for (const href of [directoryHref, mapHref]) {
      expect(href).toBeTruthy();
      const url = new URL(href ?? '', page.url());
      expect(url.searchParams.get('q')).toBeNull();
      expect(url.searchParams.get('category')).toBe('utility_assistance');
      expect(href).not.toContain(NEED);
      expect(href).not.toContain(APPROXIMATE_LOCATION);
    }
  });

  test('routes a guided self-crisis turn to immediate help', async ({ page }) => {
    await page.goto('/');
    const intake = page.getByRole('form', { name: 'Guided service intake' });

    await intake.getByLabel('What do you need help with?').fill('I am thinking about suicide');
    await intake.getByText('Filters: location, timing, access').click();
    await intake.getByLabel(/City or ZIP/).fill('Tacoma, WA');
    await intake.getByLabel('How soon?').selectOption('today');
    await intake.getByLabel('Who is this for?').selectOption('self');
    await intake.getByRole('button', { name: 'Find help' }).click();

    await expect(page).toHaveURL(/\/chat\?from=guided$/);
    expect(Array.from(new URL(page.url()).searchParams.entries())).toEqual([['from', 'guided']]);
    await page.getByRole('button', { name: 'Send message' }).click();

    await expect(page.getByText('Immediate Help Available')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('link', { name: /Emergency: Call 911/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Crisis Line: Call or text 988/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Community Resources: Call 211/i })).toBeVisible();
    await expect(page.getByText('Status: No close match was found in the current catalog.')).toHaveCount(0);
  });
});
