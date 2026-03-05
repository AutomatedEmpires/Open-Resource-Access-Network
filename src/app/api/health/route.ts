/**
 * GET /api/health — Database connection-pool health check.
 *
 * Used by load balancers and orchestrators for liveness/readiness probes.
 * Returns 200 when the database is reachable, 503 otherwise.
 *
 * No auth required. Rate-limited to prevent abuse.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseConfigured, executeQuery } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function GET(req: NextRequest) {
  const ip = getIp(req);
  const rl = checkRateLimit(`health:${ip}`, {
    windowMs: 60_000,
    maxRequests: 30,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { status: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { status: 'unhealthy', database: 'not_configured' },
      { status: 503 },
    );
  }

  try {
    const start = Date.now();
    await executeQuery<{ ok: number }>('SELECT 1 AS ok', []);
    const latencyMs = Date.now() - start;

    return NextResponse.json({
      status: 'healthy',
      database: 'connected',
      latencyMs,
    });
  } catch {
    return NextResponse.json(
      { status: 'unhealthy', database: 'unreachable' },
      { status: 503 },
    );
  }
}
