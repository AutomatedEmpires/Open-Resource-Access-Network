/**
 * GET  /api/host/organizations — List organizations for the authenticated host.
 * POST /api/host/organizations — Create a new organization.
 *
 * Zod-validated, rate-limited, DB-backed.
 * Auth enforcement: GET filters to user's orgs; POST creates and auto-assigns membership.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, isDatabaseConfigured, withTransaction } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext, shouldEnforceAuth, isOranAdmin } from '@/services/auth';
import { createHostPortalSourceAssertion } from '@/services/ingestion/hostPortalIntake';
import {
  RATE_LIMIT_WINDOW_MS,
  HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_PAGE_SIZE,
} from '@/domain/constants';
import type { Organization } from '@/domain/types';

// ============================================================
// SCHEMAS
// ============================================================

const ListParamsSchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
  q:     z.string().max(200).optional(),
});

const CreateOrgSchema = z.object({
  name:              z.string().min(1, 'Name is required').max(500),
  description:       z.string().max(5000).optional(),
  url:               z.string().url().max(2000).optional(),
  email:             z.string().email().max(500).optional(),
  taxStatus:         z.string().max(200).optional(),
  taxId:             z.string().max(100).optional(),
  yearIncorporated:  z.number().int().min(1800).max(2100).optional(),
  legalStatus:       z.string().max(200).optional(),
});

// ============================================================
// HELPERS
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

// ============================================================
// HANDLERS
// ============================================================

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'Database not configured.' },
      { status: 503 },
    );
  }

  // Auth check
  const authCtx = await getAuthContext();
  if (!authCtx && shouldEnforceAuth()) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`host:org:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSeconds) },
      },
    );
  }

  const raw: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => { raw[k] = v; });
  const parsed = ListParamsSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid parameters', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { page, limit, q } = parsed.data;
  const offset = (page - 1) * limit;

  try {
    const conditions: string[] = [];
    const params: unknown[] = [];

    // Filter to user's organizations unless oran_admin
    if (authCtx && !isOranAdmin(authCtx)) {
      if (authCtx.orgIds.length === 0) {
        // User has no org memberships — return empty results
        return NextResponse.json(
          { results: [], total: 0, page, hasMore: false },
          { headers: { 'Cache-Control': 'private, no-store' } },
        );
      }
      // Filter to user's orgs
      params.push(authCtx.orgIds);
      conditions.push(`id = ANY($${params.length})`);
    }

    if (q) {
      params.push(q);
      conditions.push(`to_tsvector('english', name) @@ plainto_tsquery('english', $${params.length})`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT count(*)::int AS count FROM organizations ${where}`;
    const countRows = await executeQuery<{ count: number }>(countSql, params);
    const total = countRows[0]?.count ?? 0;

    params.push(limit, offset);
    const dataSql = `
      SELECT id, name, description, url, email, tax_status, tax_id,
             year_incorporated, legal_status, logo_url, uri,
             created_at, updated_at
      FROM organizations
      ${where}
      ORDER BY name ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;

    const rows = await executeQuery<Organization>(dataSql, params);

    return NextResponse.json(
      { results: rows, total, page, hasMore: offset + rows.length < total },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_host_organizations_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'Database not configured.' },
      { status: 503 },
    );
  }

  // Auth check - creating an org requires authentication
  const authCtx = await getAuthContext();
  if (!authCtx && shouldEnforceAuth()) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`host:org:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSeconds) },
      },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CreateOrgSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const d = parsed.data;

  try {
    // Create org and auto-assign creator as host_admin in a transaction
    const result = await withTransaction(async (client) => {
      const orgResult = await client.query<Organization>(
        `INSERT INTO organizations (name, description, url, email, tax_status, tax_id, year_incorporated, legal_status, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, name, description, url, email, tax_status, tax_id, year_incorporated, legal_status, logo_url, uri, created_at, updated_at`,
        [
          d.name,
          d.description ?? null,
          d.url ?? null,
          d.email ?? null,
          d.taxStatus ?? null,
          d.taxId ?? null,
          d.yearIncorporated ?? null,
          d.legalStatus ?? null,
          authCtx?.userId ?? null,
        ],
      );

      const org = orgResult.rows[0];

      // Auto-assign the creator as host_admin if authenticated
      // (organization_members table may not exist yet — handle gracefully)
      if (authCtx) {
        try {
          await client.query(
            `INSERT INTO organization_members (organization_id, user_id, role, status, invited_by_user_id, activated_at)
             VALUES ($1, $2, 'host_admin', 'active', $2, now())
             ON CONFLICT DO NOTHING`,
            [org.id, authCtx.userId],
          );
        } catch {
          // Table may not exist yet — that's OK, org is still created
        }
      }

      const assertion = await createHostPortalSourceAssertion(client, {
        actorUserId: authCtx?.userId ?? 'system',
        actorRole: authCtx?.role ?? null,
        recordType: 'host_org_create',
        recordId: org.id,
        canonicalSourceUrl: `oran://host-portal/organizations/${org.id}`,
        payload: {
          organizationId: org.id,
          name: d.name,
          description: d.description ?? null,
          url: d.url ?? null,
          email: d.email ?? null,
          taxStatus: d.taxStatus ?? null,
          taxId: d.taxId ?? null,
          yearIncorporated: d.yearIncorporated ?? null,
          legalStatus: d.legalStatus ?? null,
        },
      });

      return {
        ...org,
        sourceRecordId: assertion.sourceRecordId,
      };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    await captureException(error, { feature: 'api_host_organizations_create' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
