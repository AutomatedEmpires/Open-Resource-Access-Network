/**
 * GET /api/organizations/[id] — Public organization profile.
 *
 * No auth required. Returns org details + services for public display.
 * Rate-limited per IP.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeCount, executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { getPublishedOrganizationDetail } from '@/services/search/publication';
import { captureException } from '@/services/telemetry/sentry';
import { RATE_LIMIT_WINDOW_MS } from '@/domain/constants';
import { getIp } from '@/services/security/ip';

// ============================================================
// HANDLER
// ============================================================
const publicationDeps = {
  executeQuery,
  executeCount,
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`org:profile:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: 60,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid organization ID' }, { status: 400 });
  }

  try {
    const organization = await getPublishedOrganizationDetail(publicationDeps, id);

    if (!organization) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    return NextResponse.json({
      organization,
      services: Array.isArray(organization.services) ? organization.services : [],
      serviceCount: Array.isArray(organization.services) ? organization.services.length : 0,
    });
  } catch (err) {
    captureException(err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
