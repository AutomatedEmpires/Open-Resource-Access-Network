/**
 * GET /api/hsds/services/[id]
 *
 * HSDS-compliant endpoint returning a single service with its
 * organization, locations, phones, and addresses.
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
    return NextResponse.json({ error: 'Invalid service ID' }, { status: 400 });
  }

  try {
    const pool = getPgPool();

    // Service
    const svcResult = await pool.query(
      `SELECT id, organization_id, name, alternate_name, description,
              url, email, status, interpretation_services, fees,
              accreditations, licenses,
              created_at, updated_at
       FROM services WHERE id = $1`,
      [id]
    );

    if (svcResult.rows.length === 0) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    const service = svcResult.rows[0];

    // Organization
    const orgResult = await pool.query(
      `SELECT id, name, description, url, email, status, phone
       FROM organizations WHERE id = $1`,
      [service.organization_id]
    );

    // Locations via service_at_location
    const locResult = await pool.query(
      `SELECT l.id, l.name, l.description, l.latitude, l.longitude,
              l.transportation, l.status
       FROM service_at_location sal
       JOIN locations l ON l.id = sal.location_id
       WHERE sal.service_id = $1`,
      [id]
    );

    // Phones
    const phoneResult = await pool.query(
      `SELECT id, number, extension, type, language, description
       FROM phones WHERE service_id = $1`,
      [id]
    );

    // Addresses for the service's locations
    const locationIds = locResult.rows.map((l: { id: string }) => l.id);
    let addresses: unknown[] = [];
    if (locationIds.length > 0) {
      const addrResult = await pool.query(
        `SELECT id, location_id, address_1, city, state_province,
                postal_code, country
         FROM addresses WHERE location_id = ANY($1)`,
        [locationIds]
      );
      addresses = addrResult.rows;
    }

    return NextResponse.json({
      ...service,
      organization: orgResult.rows[0] ?? null,
      locations: locResult.rows,
      phones: phoneResult.rows,
      addresses,
    });
  } catch (err) {
    captureException(err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
