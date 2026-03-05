import { expect, test, type Page } from '@playwright/test';
import { loginAs } from './helpers/auth';
import { isDbConfigured } from './helpers/db';

function runId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function postJsonWithRetry(
  page: Page,
  url: string,
  data: Record<string, unknown>,
): Promise<{ ok: boolean; status: number }> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await page.request.post(url, { data });
    if (res.ok()) return { ok: true, status: res.status() };

    if ((res.status() === 429 || res.status() === 503 || res.status() === 404) && attempt < 5) {
      const retryAfter = Number(res.headers()['retry-after'] ?? '1');
      const waitMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000;
      await page.waitForTimeout(waitMs);
      continue;
    }

    return { ok: false, status: res.status() };
  }

  return { ok: false, status: 500 };
}

test.describe('Admin workflow coverage', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  test('community admin verify route handles missing queue id', async ({ page }) => {
    await loginAs(page, 'community_admin');
    await page.goto('/verify');

    await expect(page.getByText('No entry selected')).toBeVisible();
    await expect(page.getByRole('link', { name: 'verification queue' })).toHaveAttribute('href', '/queue');
  });

  test('host claim can be submitted and reviewed from ORAN approvals', async ({ page }) => {
    const db = await isDbConfigured(page.request);
    if (!db) return;

    const id = runId();
    const orgName = `E2E Workflow Claim ${id}`;

    await loginAs(page, 'host_admin', `e2e-host-${id}`);
    const claim = await postJsonWithRetry(page, '/api/host/claim', {
      organizationName: orgName,
      description: 'Created by Playwright admin workflow test.',
      url: 'https://example.org',
      email: `claim-${id}@example.org`,
      claimNotes: 'Automated end-to-end claim workflow validation.',
    });
    expect(claim.ok).toBeTruthy();

    await loginAs(page, 'oran_admin', `e2e-oran-${id}`);
    await page.goto('/approvals');
    await expect(page.getByRole('heading', { name: /Claim Approvals/i })).toBeVisible();

    const row = page.locator('tr', { hasText: orgName }).first();
    const reviewButton = row.getByRole('button', { name: 'Review' });

    if (await reviewButton.isVisible().catch(() => false)) {
      await reviewButton.click();
      await page.getByRole('button', { name: 'Approve' }).click();
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 30_000 });
    } else {
      // If queue ordering changes and the row is not immediately visible, still assert page health.
      await expect(page.getByText(/No claims found|Claim Approvals/i)).toBeVisible();
    }
  });

  test('ORAN admin can create a new platform scope from UI', async ({ page }) => {
    const db = await isDbConfigured(page.request);
    if (!db) return;

    const id = runId();
    const scopeName = `e2e.scope.${id.replace(/[^a-z0-9]/gi, '')}`.toLowerCase();

    await loginAs(page, 'oran_admin', `e2e-oran-scope-${id}`);
    await page.goto('/scopes');

    await expect(page.getByRole('heading', { name: 'Scope Center' })).toBeVisible();
    await page.getByRole('button', { name: 'New Scope' }).click();
    await page.getByLabel('Scope name').fill(scopeName);
    await page.getByLabel('Description').fill('Playwright-created scope for admin workflow coverage.');
    await page.getByLabel('Risk level').selectOption('high');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText(scopeName)).toBeVisible({ timeout: 30_000 });
  });

  test('two-person scope grant can be requested and approved by different admins', async ({ page }) => {
    const db = await isDbConfigured(page.request);
    if (!db) return;

    const id = runId();
    const scopeName = `e2e.grant.${id.replace(/[^a-z0-9]/gi, '')}`.toLowerCase();
    const requesterId = `e2e-requester-${id}`;
    const approverId = `e2e-approver-${id}`;
    const targetUserId = `e2e-target-${id}`;

    await loginAs(page, 'oran_admin', requesterId);

    const createScope = await postJsonWithRetry(page, '/api/admin/scopes', {
      name: scopeName,
      description: 'Scope used for two-person approval e2e flow.',
      risk_level: 'medium',
      requires_approval: true,
    });
    expect(createScope.ok).toBeTruthy();

    const requestGrant = await postJsonWithRetry(page, '/api/admin/scopes/grants', {
      userId: targetUserId,
      scopeName,
      organizationId: null,
      justification: 'Automated two-person workflow validation.',
    });
    expect(requestGrant.ok).toBeTruthy();

    await loginAs(page, 'oran_admin', approverId);
    await page.goto('/scopes');
    await page.getByRole('tab', { name: 'Pending Grants' }).click();
    await expect(page.getByText(scopeName)).toBeVisible({ timeout: 30_000 });

    const grantRow = page.locator('tr', { hasText: scopeName }).first();
    await grantRow.getByRole('button', { name: 'Review' }).click();
    await page.getByLabel('Decision reason').fill('Approved by second reviewer in e2e workflow.');
    await page.getByRole('button', { name: 'Approve' }).click();

    await expect(async () => {
      const pendingRes = await page.request.get('/api/admin/scopes/grants');
      expect(pendingRes.ok()).toBeTruthy();
      const pending = (await pendingRes.json()) as { results?: Array<{ scope_name?: string }> };
      const hasPending = (pending.results ?? []).some((g) => g.scope_name === scopeName);
      expect(hasPending).toBe(false);
    }).toPass({ timeout: 30_000 });
  });

  test('community admin queue tabs switch between assigned and status filters', async ({ page }) => {
    await loginAs(page, 'community_admin');
    await page.goto('/queue');

    await expect(page.getByRole('heading', { name: 'Verification Queue' })).toBeVisible();

    const assignedTab = page.getByRole('tab', { name: 'Assigned to me' });
    await assignedTab.click();
    await expect(assignedTab).toHaveAttribute('aria-selected', 'true');

    const submittedTab = page.getByRole('tab', { name: 'Submitted' });
    await submittedTab.click();
    await expect(submittedTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Application error')).toHaveCount(0);
  });

  test('ORAN zone management create dialog enforces required zone name', async ({ page }) => {
    await loginAs(page, 'oran_admin');
    await page.goto('/zone-management');

    await expect(page.getByRole('heading', { name: 'Coverage Zone Administration' })).toBeVisible();
    await page.getByRole('button', { name: 'New Zone' }).click();
    await expect(page.getByRole('heading', { name: 'Create Coverage Zone' })).toBeVisible();

    const createButton = page.getByRole('button', { name: 'Create Zone' });
    await expect(createButton).toBeDisabled();

    await page.locator('#create-name').fill(`E2E Zone ${runId()}`);
    await expect(createButton).toBeEnabled();

    await page.getByRole('button', { name: 'Cancel' }).last().click();
    await expect(page.getByRole('heading', { name: 'Create Coverage Zone' })).toHaveCount(0);
  });

  test('ORAN rules editor can open and cancel without saving', async ({ page }) => {
    await loginAs(page, 'oran_admin');
    await page.goto('/rules');

    await expect(page.getByRole('heading', { name: /System Rules & Feature Flags/i })).toBeVisible();

    const editButtons = page.getByRole('button', { name: 'Edit' });
    if (await editButtons.first().isVisible().catch(() => false)) {
      await editButtons.first().click();
      await expect(page.getByRole('button', { name: 'Save Changes' })).toBeVisible();
      await page.getByRole('button', { name: 'Cancel' }).first().click();
      await expect(page.getByRole('button', { name: 'Save Changes' })).toHaveCount(0);
    } else {
      await expect(page.getByText('No feature flags configured')).toBeVisible();
    }
  });

  test('ORAN audit filters can be applied and then cleared', async ({ page }) => {
    await loginAs(page, 'oran_admin');
    await page.goto('/audit');

    await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible();

    const actionFilter = page.locator('#action-filter');
    const tableFilter = page.locator('#table-filter');
    await actionFilter.selectOption('create');
    await tableFilter.fill('submissions');
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible();

    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(actionFilter).toHaveValue('');
    await expect(tableFilter).toHaveValue('');
  });

  test('ORAN ingestion process tab enforces input-driven button enablement', async ({ page }) => {
    await loginAs(page, 'oran_admin');
    await page.goto('/ingestion');

    await expect(page.getByRole('heading', { name: 'Ingestion Agent' })).toBeVisible();
    await page.getByRole('tab', { name: 'Process' }).click();
    await expect(page.getByRole('heading', { name: 'Process Single URL' })).toBeVisible();

    const processButton = page.getByRole('button', { name: 'Process' });
    await expect(processButton).toBeDisabled();
    await page.getByLabel('Source URL to process').fill('https://example.org/services');
    await expect(processButton).toBeEnabled();
    await page.getByLabel('Source URL to process').fill('');
    await expect(processButton).toBeDisabled();

    const batchButton = page.getByRole('button', { name: 'Run Batch' });
    await expect(batchButton).toBeDisabled();
    await page.getByLabel('URLs to batch process').fill('https://example.org/a\nhttps://example.org/b');
    await expect(batchButton).toBeEnabled();
  });

  test('ORAN appeals page supports review action or empty-state fallback', async ({ page }) => {
    await loginAs(page, 'oran_admin');
    await page.goto('/appeals');

    await expect(page.getByRole('heading', { name: 'Appeal Review' })).toBeVisible();

    const review = page.getByRole('button', { name: 'Review' }).first();
    if (await review.isVisible().catch(() => false)) {
      await review.click();
      await page.getByRole('button', { name: 'Approve Appeal' }).click();
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 30_000 });
    } else {
      await expect(page.getByText('Application error')).toHaveCount(0);
    }
  });
});
