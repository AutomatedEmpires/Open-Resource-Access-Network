/**
 * GET /api/hsds/organizations
 *
 * HSDS-compliant endpoint returning published organizations.
 * Supports pagination via `page` and `per_page` query parameters.
 * Retrieval-first: returns only stored records.
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

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM organizations WHERE status = 'active'`
    );
    const totalItems = countResult.rows[0]?.total ?? 0;
    const totalPages = Math.ceil(totalItems / perPage);

    const result = await pool.query(
      `SELECT id, name, description, url, email, tax_status,
              tax_id, year_incorporated, legal_status, logo_url,
              uri, status, phone,
              created_at, updated_at
       FROM organizations
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
