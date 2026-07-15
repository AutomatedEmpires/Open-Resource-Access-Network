/**
 * GET/POST /api/internal/resource-freshness-scan
 *
 * Deterministic, no-LLM resource lifecycle maintenance. Vercel Cron uses GET;
 * POST remains available for an authenticated manual/rollback worker run.
 */

import { NextRequest, NextResponse } from 'next/server';
import { rejectUnauthorizedInternalRequest } from '@/services/auth/internalRequest';
import { isDatabaseConfigured } from '@/services/db/postgres';
import {
  DEFAULT_FRESHNESS_SCAN_LIMIT,
  MAX_FRESHNESS_SCAN_LIMIT,
  scanResourceFreshness,
} from '@/services/freshness/resourceFreshness';
import { captureException } from '@/services/telemetry/sentry';

function clampLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_FRESHNESS_SCAN_LIMIT;
  }
  return Math.max(1, Math.min(MAX_FRESHNESS_SCAN_LIMIT, Math.floor(value)));
}

async function runAuthorizedScan(limit: number) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503 },
    );
  }

  try {
    const result = await scanResourceFreshness({ limit });
    return NextResponse.json(
      {
        success: true,
        ...result,
        checkedAt: new Date().toISOString(),
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  } catch (error) {
    await captureException(error, { feature: 'resource_freshness_scan' });
    return NextResponse.json(
      { error: 'Resource freshness scan failed' },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const rejection = rejectUnauthorizedInternalRequest(req);
  if (rejection) return rejection;

  const rawLimit = req.nextUrl.searchParams.get('limit');
  const parsedLimit = rawLimit === null ? undefined : Number(rawLimit);
  return runAuthorizedScan(clampLimit(parsedLimit));
}

export async function POST(req: NextRequest) {
  const rejection = rejectUnauthorizedInternalRequest(req);
  if (rejection) return rejection;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const rawLimit = body && typeof body === 'object'
    ? (body as Record<string, unknown>)['limit']
    : undefined;
  return runAuthorizedScan(clampLimit(rawLimit));
}
