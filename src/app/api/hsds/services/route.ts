/**
 * GET /api/hsds/services
 *
 * HSDS-compliant endpoint returning published services from live tables.
 * Supports pagination via `page` and `per_page` query parameters.
 * Retrieval-first: returns only stored records, no hallucinated data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { executeCount, executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { listPublishedServicesPage, normalizePublicationPagination } from '@/services/search/publication';
import { captureException } from '@/services/telemetry/sentry';
import { checkRateLimit } from '@/services/security/rateLimit';
import { getIp } from '@/services/security/ip';
import { RATE_LIMIT_WINDOW_MS, SEARCH_RATE_LIMIT_MAX_REQUESTS } from '@/domain/constants';

const publicationDeps = {
  executeQuery,
  executeCount,
};

export async function GET(req: NextRequest) {
  const ip = getIp(req);
  const rl = checkRateLimit(`hsds:services:read:${ip}`, {
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
    return NextResponse.json(
      { error: 'Service unavailable' },
      { status: 503 }
    );
  }

  try {
    const { searchParams } = req.nextUrl;
    const pagination = normalizePublicationPagination(
      searchParams.get('page'),
      searchParams.get('per_page'),
    );
    const result = await listPublishedServicesPage(publicationDeps, pagination);

    return NextResponse.json({
      total_items: result.totalItems,
      total_pages: result.totalPages,
      page_number: result.page,
      per_page: result.perPage,
      contents: result.contents,
    });
  } catch (err) {
    captureException(err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
