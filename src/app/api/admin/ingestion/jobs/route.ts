/**
 * GET /api/admin/ingestion/jobs — List ingestion jobs with optional filters.
 *
 * ORAN-admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { getIp } from '@/services/security/ip';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

const VALID_STATUSES = new Set([
  'queued', 'running', 'completed', 'failed', 'cancelled',
]);
export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(ip, { maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS, windowMs: RATE_LIMIT_WINDOW_MS });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    );
  }

  try {
    const session = await getAuthContext();
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (!requireMinRole(session, 'oran_admin')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get('status');
    const limitStr = searchParams.get('limit');
    const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 50, 1), 200) : 50;

    const { createIngestionStores } = await import(
      '@/agents/ingestion/persistence/storeFactory'
    );
    const { getDrizzle } = await import('@/services/db/drizzle');

    const db = getDrizzle();
    const stores = createIngestionStores(db);

    if (statusParam && VALID_STATUSES.has(statusParam)) {
      const jobs = await stores.jobs.listByStatus(
        statusParam as 'queued' | 'running' | 'completed' | 'failed' | 'cancelled',
        limit
      );
      return NextResponse.json({ jobs, filter: { status: statusParam } });
    }

    // No status filter → return recent across all statuses
    const [queued, running, completed, failed] = await Promise.all([
      stores.jobs.listByStatus('queued', limit),
      stores.jobs.listByStatus('running', limit),
      stores.jobs.listByStatus('completed', limit),
      stores.jobs.listByStatus('failed', limit),
    ]);

    const jobs = [...queued, ...running, ...completed, ...failed]
      .sort((a, b) => b.queuedAt.localeCompare(a.queuedAt))
      .slice(0, limit);

    return NextResponse.json({ jobs });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
