import { expect, test, type Locator } from '@playwright/test';

async function expectNoHorizontalOverlap(left: Locator, right: Locator, gap = 8) {
  const leftBox = await left.boundingBox();
  const rightBox = await right.boundingBox();

  expect(leftBox).not.toBeNull();
  expect(rightBox).not.toBeNull();
  expect(leftBox!.x + leftBox!.width + gap).toBeLessThanOrEqual(rightBox!.x);
}

for (const width of [1024, 1280, 1440, 1920]) {
  test(`header stays collision-free at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();

    const primary = page.getByTestId('desktop-primary-nav');
    const actions = page.getByTestId('desktop-nav-actions');

    if (width < 1536) {
      await expect(primary).toBeVisible();
      await expect(actions).toBeHidden();
      await expectNoHorizontalOverlap(page.getByTestId('nav-brand-scope'), primary);
      await expectNoHorizontalOverlap(primary, page.getByTestId('compact-nav-actions'));

      const before = await primary.boundingBox();
      await primary.getByRole('link', { name: 'Browse services', exact: true }).hover();
      expect(await primary.boundingBox()).toEqual(before);
      await expectNoHorizontalOverlap(primary, page.getByTestId('compact-nav-actions'));

      const menuButton = page.getByRole('button', { name: 'Open navigation menu' });
      await expect(menuButton).toBeVisible();
      await menuButton.click();

      const drawer = page.locator('#mobile-nav');
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole('link', { name: 'Find help', exact: true })).toHaveAttribute('href', '/chat');
      await expect(drawer.getByRole('link', { name: 'Browse services', exact: true })).toHaveAttribute('href', '/directory');
      await expect(drawer.getByRole('link', { name: 'Map', exact: true })).toHaveAttribute('href', '/map');
      await expect(drawer.getByRole('link', { name: 'Saved', exact: true })).toHaveAttribute('href', '/saved');

      const drawerBox = await drawer.boundingBox();
      expect(drawerBox).not.toBeNull();
      expect(drawerBox!.y + drawerBox!.height).toBeLessThanOrEqual(900);
      return;
    }

    await expect(primary).toBeVisible();
    await expect(actions).toBeVisible();
    await expectNoHorizontalOverlap(primary, actions);

    await expect(actions.getByRole('link', { name: 'Saved', exact: true })).toBeVisible();
    await expect(actions.getByRole('link', { name: 'For providers', exact: true })).toBeVisible();
    await expect(actions.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Open account menu' })).toHaveCount(0);

    const before = await primary.boundingBox();
    await primary.getByRole('link', { name: 'Browse services', exact: true }).hover();
    const after = await primary.boundingBox();
    expect(before).toEqual(after);
    await expectNoHorizontalOverlap(primary, actions);
  });
}

test('French desktop header stays collision-free at the 2xl breakpoint', async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 900 });
  const localeResponse = await page.request.post('/api/locale', { data: { locale: 'fr' } });
  expect(localeResponse.ok()).toBe(true);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const navigation = page.getByRole('navigation', { name: 'Navigation principale' });
  await expect(navigation).toBeVisible();

  const brand = navigation.getByRole('link', { name: 'ORAN', exact: true });
  const primary = page.getByTestId('desktop-primary-nav');
  const actions = page.getByTestId('desktop-nav-actions');
  await expect(primary).toBeVisible();
  await expect(actions).toBeVisible();
  await expect(primary.getByRole('link', { name: 'Trouver de l’aide', exact: true })).toBeVisible();
  await expect(primary.getByRole('link', { name: 'Parcourir les services', exact: true })).toBeVisible();
  await expect(actions.getByRole('link', { name: 'Enregistrés', exact: true })).toBeVisible();
  await expect(actions.getByRole('link', { name: 'Pour les prestataires', exact: true })).toBeVisible();

  await expectNoHorizontalOverlap(brand, primary);
  await expectNoHorizontalOverlap(primary, actions);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1536);

  const before = await primary.boundingBox();
  await primary.getByRole('link', { name: 'Parcourir les services', exact: true }).hover();
  expect(await primary.boundingBox()).toEqual(before);
  await expectNoHorizontalOverlap(primary, actions);
});

test('mobile intake and crisis access do not compete for the same space', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();

  const intake = page.getByRole('form', { name: 'Guided service intake' });
  const need = intake.getByRole('textbox', { name: 'What do you need help with?' });
  const submit = intake.getByRole('button', { name: 'Find help' });
  const bottomNav = page.getByRole('navigation', { name: 'Seeker mobile navigation' });
  const crisis = bottomNav.getByRole('button', { name: /Open crisis resources/i });

  await expect(need).toBeVisible();
  await expect(crisis).toBeVisible();
  await expect(page.locator('.crisis-fab-position')).toBeHidden();

  await submit.scrollIntoViewIfNeeded();
  const submitBox = await submit.boundingBox();
  const bottomNavBox = await bottomNav.boundingBox();
  expect(submitBox).not.toBeNull();
  expect(bottomNavBox).not.toBeNull();
  expect(submitBox!.y + submitBox!.height + 16).toBeLessThanOrEqual(bottomNavBox!.y);
});

test('public mobile navigation exposes every primary destination without a scoped bottom nav', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/about', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();

  await expect(page.getByRole('navigation', { name: 'Seeker mobile navigation' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open navigation menu' }).click();

  const drawer = page.locator('#mobile-nav');
  await expect(drawer.getByRole('link', { name: 'Find help', exact: true })).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Browse services', exact: true })).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Map', exact: true })).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Saved', exact: true })).toBeVisible();
});

test('scoped mobile navigation avoids duplicate primary links while preserving map access', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation menu' }).click();

  const drawer = page.locator('#mobile-nav');
  await expect(drawer.getByRole('link', { name: 'Find help', exact: true })).toBeHidden();
  await expect(drawer.getByRole('link', { name: 'Browse services', exact: true })).toBeHidden();
  await expect(drawer.getByRole('link', { name: 'Saved', exact: true })).toBeHidden();
  await expect(drawer.getByRole('link', { name: 'Map', exact: true })).toBeVisible();
});

test('tablet header crisis control opens verified emergency options', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();

  await expect(page.locator('.crisis-fab-position')).toBeHidden();
  const crisis = page.locator('[data-tablet-crisis-control]');
  await expect(crisis).toBeVisible();
  await crisis.click();

  const dialog = page.getByRole('dialog', { name: 'Crisis Resources' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('link', { name: /Call Emergency Services: 911/i })).toHaveAttribute('href', 'tel:911');
  await expect(dialog.getByRole('link', { name: /Call 988 Suicide & Crisis Lifeline: 988/i })).toHaveAttribute('href', 'tel:988');
  await expect(dialog.getByRole('link', { name: /Call 211 Community Helpline: 211/i })).toHaveAttribute('href', 'tel:211');
});
