/**
 * PUT    /api/admin/zones/[id] — Update a coverage zone.
 * DELETE /api/admin/zones/[id] — Delete a coverage zone.
 *
 * ORAN-admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { getIp } from '@/services/security/ip';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

// ============================================================
// SCHEMA
// ============================================================

const UuidSchema = z.string().uuid('Invalid zone ID format');

const UpdateZoneSchema = z.object({
  name:           z.string().min(1).max(500).optional(),
  description:    z.string().max(5000).optional(),
  assignedUserId: z.string().max(500).nullable().optional(),
  status:         z.enum(['active', 'inactive']).optional(),
}).strict();

// ============================================================
// HELPERS
// ============================================================
// ============================================================
// HANDLERS
// ============================================================

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await params;

  const idParsed = UuidSchema.safeParse(id);
  if (!idParsed.success) {
    return NextResponse.json(
      { error: 'Invalid zone ID format', details: idParsed.error.issues },
      { status: 400 },
    );
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`admin:zones:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
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

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!requireMinRole(authCtx, 'oran_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = UpdateZoneSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const d = parsed.data;

  try {
    const setClauses: string[] = ['updated_at = NOW()'];
    const queryParams: unknown[] = [];

    if (d.name !== undefined) {
      queryParams.push(d.name);
      setClauses.push(`name = $${queryParams.length}`);
    }
    if (d.description !== undefined) {
      queryParams.push(d.description);
      setClauses.push(`description = $${queryParams.length}`);
    }
    if (d.assignedUserId !== undefined) {
      queryParams.push(d.assignedUserId);
      setClauses.push(`assigned_user_id = $${queryParams.length}`);
    }
    if (d.status !== undefined) {
      queryParams.push(d.status);
      setClauses.push(`status = $${queryParams.length}`);
    }

    queryParams.push(id);
    const rows = await executeQuery<{ id: string }>(
      `UPDATE coverage_zones SET ${setClauses.join(', ')} WHERE id = $${queryParams.length} RETURNING id`,
      queryParams,
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Zone not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Zone updated.' });
  } catch (error) {
    await captureException(error, { feature: 'api_admin_zones_update' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await params;

  const idParsed = UuidSchema.safeParse(id);
  if (!idParsed.success) {
    return NextResponse.json(
      { error: 'Invalid zone ID format', details: idParsed.error.issues },
      { status: 400 },
    );
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`admin:zones:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
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

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!requireMinRole(authCtx, 'oran_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  try {
    const rows = await executeQuery<{ id: string }>(
      `DELETE FROM coverage_zones WHERE id = $1 RETURNING id`,
      [id],
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Zone not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Zone deleted.' });
  } catch (error) {
    await captureException(error, { feature: 'api_admin_zones_delete' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
