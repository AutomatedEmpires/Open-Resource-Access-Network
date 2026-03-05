import type { APIRequestContext } from '@playwright/test';

export async function isDbConfigured(request: APIRequestContext): Promise<boolean> {
  // /api/search is a reliable canary: it returns 503 when DATABASE_URL is missing.
  const res = await request.get('/api/search?status=active&limit=1');
  return res.status() !== 503;
}
