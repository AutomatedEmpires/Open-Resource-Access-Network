import type { APIRequestContext } from '@playwright/test';

export async function isDbConfigured(request: APIRequestContext): Promise<boolean> {
  const res = await request.get('/api/health');
  const health = (await res.json().catch(() => null)) as {
    status?: unknown;
    configuration?: unknown;
    database?: unknown;
  } | null;

  const ready = res.ok()
    && health?.status === 'healthy'
    && health.configuration === 'ready'
    && health.database === 'connected';

  if (!ready && process.env.PLAYWRIGHT_BASE_URL?.trim()) {
    throw new Error('Hosted acceptance requires a healthy, fully configured preview database.');
  }

  return ready;
}
