/**
 * GET /api/hsds/services
 *
 * HSDS-compliant endpoint returning published services from live tables.
 * Supports pagination via `page` and `per_page` query parameters.
 * Retrieval-first: returns only stored records, no hallucinated data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseConfigured, getPgPool } from '@/services/db/postgres';
import { captureException } from '@/services/telemetry/sentry';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'Service unavailable' },
      { status: 503 }
    );
  }

  try {
    const { searchParams } = req.nextUrl;
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
    const perPage = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(searchParams.get('per_page') ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE)
    );
    const offset = (page - 1) * perPage;

    const pool = getPgPool();

    // Count total
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM services WHERE status = 'active'`
    );
    const totalItems = countResult.rows[0]?.total ?? 0;
    const totalPages = Math.ceil(totalItems / perPage);

    // Fetch page
    const result = await pool.query(
      `SELECT id, organization_id, name, alternate_name, description,
              url, email, status, interpretation_services, fees,
              accreditations, licenses,
              created_at, updated_at
       FROM services
       WHERE status = 'active'
       ORDER BY updated_at DESC
       LIMIT $1 OFFSET $2`,
      [perPage, offset]
    );

    return NextResponse.json({
      total_items: totalItems,
      total_pages: totalPages,
      page_number: page,
      per_page: perPage,
      contents: result.rows,
    });
  } catch (err) {
    captureException(err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
