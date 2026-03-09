/**
 * GET    /api/host/organizations/[id] — Fetch a single organization.
 * PUT    /api/host/organizations/[id] — Update organization fields.
 * DELETE /api/host/organizations/[id] — Soft-delete an organization (status = 'defunct').
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, isDatabaseConfigured, withTransaction } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext, shouldEnforceAuth, requireOrgAccess, requireOrgRole, isOranAdmin } from '@/services/auth';
import { createHostPortalSourceAssertion } from '@/services/ingestion/hostPortalIntake';
import {
  RATE_LIMIT_WINDOW_MS,
  HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';
import type { Organization } from '@/domain/types';

// ============================================================
// SCHEMAS
// ============================================================

const UpdateOrgSchema = z.object({
  name:              z.string().min(1).max(500).optional(),
  description:       z.string().max(5000).optional(),
  url:               z.string().url().max(2000).optional(),
  email:             z.string().email().max(500).optional(),
  taxStatus:         z.string().max(200).optional(),
  taxId:             z.string().max(100).optional(),
  yearIncorporated:  z.number().int().min(1800).max(2100).optional(),
  legalStatus:       z.string().max(200).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });

// ============================================================
// HELPERS
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

type RouteContext = { params: Promise<{ id: string }> };

// ============================================================
// HANDLERS
// ============================================================

export async function GET(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid organization ID' }, { status: 400 });
  }

  // Auth check
  const authCtx = await getAuthContext();
  if (!authCtx && shouldEnforceAuth()) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  // Authorization: user must have access to this org
  if (authCtx && !requireOrgAccess(authCtx, id)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
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

  try {
    // Exclude defunct organizations unless oran_admin
    const statusFilter = authCtx && isOranAdmin(authCtx) ? '' : `AND (status IS NULL OR status != 'defunct')`;
    const rows = await executeQuery<Organization>(
      `SELECT id, name, description, url, email, tax_status, tax_id,
              year_incorporated, legal_status, logo_url, uri,
              created_at, updated_at
       FROM organizations WHERE id = $1 ${statusFilter}`,
      [id],
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    return NextResponse.json(rows[0], {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    await captureException(error, { feature: 'api_host_org_get' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid organization ID' }, { status: 400 });
  }

  // Auth check
  const authCtx = await getAuthContext();
  if (!authCtx && shouldEnforceAuth()) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  // Authorization: user must have write access to this org
  if (authCtx && !requireOrgAccess(authCtx, id)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
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

  const parsed = UpdateOrgSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const d = parsed.data;

  const existingOrganizations = await executeQuery<{ id: string }>(
    `SELECT id
     FROM organizations
     WHERE id = $1`,
    [id],
  );

  if (existingOrganizations.length === 0) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  // Build SET clause dynamically from provided fields
  const setClauses: string[] = [];
  const params: unknown[] = [];

  const fieldMap: Record<string, string> = {
    name: 'name',
    description: 'description',
    url: 'url',
    email: 'email',
    taxStatus: 'tax_status',
    taxId: 'tax_id',
    yearIncorporated: 'year_incorporated',
    legalStatus: 'legal_status',
  };

  for (const [tsKey, dbCol] of Object.entries(fieldMap)) {
    if (tsKey in d) {
      params.push((d as Record<string, unknown>)[tsKey] ?? null);
      setClauses.push(`${dbCol} = $${params.length}`);
    }
  }

  // Add updated_by_user_id if authenticated
  if (authCtx) {
    params.push(authCtx.userId);
    setClauses.push(`updated_by_user_id = $${params.length}`);
  }

  params.push(id);

  try {
    const result = await withTransaction(async (client) => {
      const updateResult = await client.query<Organization>(
        `UPDATE organizations
         SET ${setClauses.join(', ')}
         WHERE id = $${params.length}
         RETURNING id, name, description, url, email, tax_status, tax_id,
                   year_incorporated, legal_status, logo_url, uri, created_at, updated_at`,
        params,
      );

      const organization = updateResult.rows[0];
      if (!organization) {
        return null;
      }

      await createHostPortalSourceAssertion(client, {
        actorUserId: authCtx?.userId ?? 'system',
        actorRole: authCtx?.role ?? null,
        recordType: 'host_org_update',
        recordId: organization.id,
        canonicalSourceUrl: `oran://host-portal/organizations/${organization.id}`,
        payload: {
          organizationId: organization.id,
          requestedChanges: d,
        },
      });

      return organization;
    });

    if (!result) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    await captureException(error, { feature: 'api_host_org_update' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid organization ID' }, { status: 400 });
  }

  // Auth check - delete requires host_admin or oran_admin
  const authCtx = await getAuthContext();
  if (!authCtx && shouldEnforceAuth()) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  // Authorization: delete requires host_admin (or oran_admin)
  if (authCtx && !requireOrgRole(authCtx, id, 'host_admin')) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
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

  try {
    const existingOrganizations = await executeQuery<{ id: string }>(
      `SELECT id
       FROM organizations
       WHERE id = $1 AND (status IS NULL OR status != 'defunct')`,
      [id],
    );

    if (existingOrganizations.length === 0) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const result = await withTransaction(async (client) => {
      const archiveResult = await client.query<{ id: string }>(
        `UPDATE organizations
         SET status = 'defunct', updated_at = now(), updated_by_user_id = $2
         WHERE id = $1 AND (status IS NULL OR status != 'defunct')
         RETURNING id`,
        [id, authCtx?.userId ?? null],
      );

      const organization = archiveResult.rows[0];
      if (!organization) {
        return null;
      }

      await createHostPortalSourceAssertion(client, {
        actorUserId: authCtx?.userId ?? 'system',
        actorRole: authCtx?.role ?? null,
        recordType: 'host_org_archive',
        recordId: organization.id,
        canonicalSourceUrl: `oran://host-portal/organizations/${organization.id}`,
        payload: {
          organizationId: organization.id,
          status: 'defunct',
        },
      });

      return organization;
    });

    if (!result) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    return NextResponse.json({ archived: true, id: result.id });
  } catch (error) {
    await captureException(error, { feature: 'api_host_org_delete' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
