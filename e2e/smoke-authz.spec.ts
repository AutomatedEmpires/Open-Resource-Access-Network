import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { ROUTES } from './helpers/routes';

async function assertAccessibleRoute(page: Page, path: string) {
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
  await expect(page).not.toHaveURL(/\/auth\/signin|\/api\/auth\/signin/);
  await expect(
    page.getByText(/Forbidden: Insufficient permissions|Access denied|Insufficient permissions/i),
  ).toHaveCount(0);
  await expect(page.getByText(/Loading (Host|ORAN|Community Admin) portal/i)).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(page.getByText('Application error')).toHaveCount(0);
}

test.describe('AuthZ & route protection (middleware + portals)', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  test('unauthenticated users are redirected from protected routes', async ({ page }) => {
    // A representative sample from each protected surface.
    const protectedPaths = [
      ...ROUTES.seeker.filter((p) => p === '/saved' || p === '/profile'),
      ...ROUTES.host,
      ...ROUTES.communityAdmin,
      ...ROUTES.oranAdmin,
    ];

    for (const path of protectedPaths) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/auth\/signin|\/api\/auth\/signin/);
    }
  });

  test('seeker can access seeker-protected routes when authenticated', async ({ page }) => {
    await loginAs(page, 'seeker');

    for (const path of ['/saved', '/profile'] as const) {
      await assertAccessibleRoute(page, path);
    }
  });

  test('host admin can access host-protected routes when authenticated', async ({ page }) => {
    await loginAs(page, 'host_admin');

    for (const path of ROUTES.host) {
      await assertAccessibleRoute(page, path);
    }
  });

  test('host admin is blocked from ORAN-admin routes', async ({ page }) => {
    await loginAs(page, 'host_admin');
    await page.goto('/approvals');

    await expect(
      page.getByText(/Forbidden: Insufficient permissions|Access denied|Insufficient permissions/i),
    ).toBeVisible();
  });

  test('role-based access: wrong role gets blocked by middleware', async ({ page }) => {
    // Seeker attempting ORAN admin should be forbidden.
    await loginAs(page, 'seeker');
    await page.goto('/approvals');

    // Depending on where the block happens, we expect either 403 or an access denied shell.
    // - Middleware returns 403 text for insufficient role.
    // - If middleware is bypassed, portal UI shows AccessDenied.
    await expect(
      page.getByText(/Forbidden: Insufficient permissions|Access denied|Insufficient permissions/i)
    ).toBeVisible();
  });
});
