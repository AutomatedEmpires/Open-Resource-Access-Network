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
import { validateRuntimeEnv } from '@/services/runtime/envContract';
import { checkRateLimit } from '@/services/security/rateLimit';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
};

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
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          'Retry-After': String(rl.retryAfterSeconds),
        },
      },
    );
  }

  const runtimeEnv = validateRuntimeEnv('webapp', process.env);
  if (!runtimeEnv.ok) {
    const body: Record<string, unknown> = {
      status: 'unhealthy',
      configuration: 'invalid',
    };

    if (process.env.NODE_ENV !== 'production') {
      body.missing = runtimeEnv.missingCritical;
    }

    return NextResponse.json(body, {
      status: 503,
      headers: NO_STORE_HEADERS,
    });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { status: 'unhealthy', database: 'not_configured' },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const start = Date.now();
    await executeQuery<{ ok: number }>('SELECT 1 AS ok', []);
    const latencyMs = Date.now() - start;

    return NextResponse.json({
      status: 'healthy',
      configuration: 'ready',
      database: 'connected',
      latencyMs,
    }, {
      headers: NO_STORE_HEADERS,
    });
  } catch {
    return NextResponse.json(
      { status: 'unhealthy', database: 'unreachable' },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
