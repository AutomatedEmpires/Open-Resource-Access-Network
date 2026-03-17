/**
 * GET /api/hsds/organizations/[id]
 *
 * HSDS-compliant endpoint returning a single organization
 * with its services and contact details.
 * Retrieval-first: returns only stored records.
 */

import { NextRequest, NextResponse } from 'next/server';
import { executeCount, executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { getPublishedOrganizationDetail } from '@/services/search/publication';
import { captureException } from '@/services/telemetry/sentry';
import { checkRateLimit } from '@/services/security/rateLimit';
import { getIp } from '@/services/security/ip';
import { RATE_LIMIT_WINDOW_MS, SEARCH_RATE_LIMIT_MAX_REQUESTS } from '@/domain/constants';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const publicationDeps = {
  executeQuery,
  executeCount,
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getIp(req);
  const rl = checkRateLimit(`hsds:organizations:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: SEARCH_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }

  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid organization ID' }, { status: 400 });
  }

  try {
    const organization = await getPublishedOrganizationDetail(publicationDeps, id);

    if (!organization) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    return NextResponse.json(organization);
  } catch (err) {
    captureException(err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
