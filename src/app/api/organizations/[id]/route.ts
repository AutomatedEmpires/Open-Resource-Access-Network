/**
 * GET /api/organizations/[id] — Public organization profile.
 *
 * No auth required. Returns org details + services for public display.
 * Rate-limited per IP.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { RATE_LIMIT_WINDOW_MS } from '@/domain/constants';

// ============================================================
// TYPES
// ============================================================

interface OrgRow {
  id: string;
  name: string;
  description: string | null;
  url: string | null;
  email: string | null;
  status: string;
  year_incorporated: number | null;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
}

interface ServiceRow {
  id: string;
  name: string;
  description: string | null;
  url: string | null;
  status: string;
  capacity_status: string | null;
}

interface LocationRow {
  service_id: string;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
}

// ============================================================
// HANDLER
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

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
    // 1. Fetch the organization
    const orgs = await executeQuery<OrgRow>(
      `SELECT id, name, description, url, email, status,
              year_incorporated, logo_url, created_at, updated_at
       FROM organizations
       WHERE id = $1 AND status = 'active'`,
      [id],
    );

    if (orgs.length === 0) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    const org = orgs[0];

    // 2. Fetch active services
    const services = await executeQuery<ServiceRow>(
      `SELECT id, name, description, url, status, capacity_status
       FROM services
       WHERE org_id = $1 AND status = 'active'
       ORDER BY name ASC
       LIMIT 100`,
      [id],
    );

    // 3. Fetch locations for those services
    const serviceIds = services.map(s => s.id);
    let locations: LocationRow[] = [];
    if (serviceIds.length > 0) {
      locations = await executeQuery<LocationRow>(
        `SELECT service_id, address, city, state_province as state, postal_code
         FROM service_at_location sal
         JOIN locations l ON sal.location_id = l.id
         WHERE sal.service_id = ANY($1::uuid[])
         LIMIT 500`,
        [serviceIds],
      );
    }

    // 4. Build response
    const servicesWithLocations = services.map(svc => ({
      ...svc,
      locations: locations.filter(l => l.service_id === svc.id),
    }));

    return NextResponse.json({
      organization: org,
      services: servicesWithLocations,
      serviceCount: services.length,
    });
  } catch (err) {
    captureException(err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
