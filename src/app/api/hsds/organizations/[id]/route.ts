/**
 * GET /api/hsds/organizations/[id]
 *
 * HSDS-compliant endpoint returning a single organization
 * with its services and contact details.
 * Retrieval-first: returns only stored records.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseConfigured, getPgPool } from '@/services/db/postgres';
import { captureException } from '@/services/telemetry/sentry';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }

  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid organization ID' }, { status: 400 });
  }

  try {
    const pool = getPgPool();

    const orgResult = await pool.query(
      `SELECT id, name, description, url, email, tax_status,
              tax_id, year_incorporated, legal_status, logo_url,
              uri, status, phone,
              created_at, updated_at
       FROM organizations WHERE id = $1`,
      [id]
    );

    if (orgResult.rows.length === 0) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const org = orgResult.rows[0];

    // Services under this org
    const svcResult = await pool.query(
      `SELECT id, name, alternate_name, description, url, email,
              status, created_at, updated_at
       FROM services WHERE organization_id = $1 AND status = 'active'
       ORDER BY name`,
      [id]
    );

    // Phones for the org
    const phoneResult = await pool.query(
      `SELECT id, number, extension, type, language, description
       FROM phones WHERE organization_id = $1`,
      [id]
    );

    return NextResponse.json({
      ...org,
      services: svcResult.rows,
      phones: phoneResult.rows,
    });
  } catch (err) {
    captureException(err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
