/**
 * GET  /api/admin/approvals — List pending organization claims.
 * POST /api/admin/approvals — Approve or deny a claim.
 *
 * ORAN-admin only. Lists verification_queue entries created from /api/host/claim.
 * POST transitions the queue entry and (on approve) activates the organization.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, isDatabaseConfigured, withTransaction } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_PAGE_SIZE,
} from '@/domain/constants';

// ============================================================
// SCHEMAS
// ============================================================

const ListParamsSchema = z.object({
  status: z
    .enum(['pending', 'in_review', 'verified', 'rejected', 'escalated'])
    .optional(),
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
});

const DecisionSchema = z.object({
  queueEntryId: z.string().uuid('queueEntryId must be a valid UUID'),
  decision:     z.enum(['approved', 'denied'], {
    message: 'decision must be approved or denied',
  }),
  notes:        z.string().max(5000).optional(),
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
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`admin:approvals:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
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

  const { status, page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  try {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status) {
      params.push(status);
      conditions.push(`vq.status = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRows = await executeQuery<{ count: number }>(
      `SELECT count(*)::int AS count FROM verification_queue vq ${where}`,
      params,
    );
    const total = countRows[0]?.count ?? 0;

    params.push(limit, offset);
    const rows = await executeQuery<{
      id: string;
      service_id: string;
      status: string;
      submitted_by_user_id: string;
      assigned_to_user_id: string | null;
      notes: string | null;
      created_at: string;
      updated_at: string;
      service_name: string;
      organization_id: string;
      organization_name: string;
      organization_url: string | null;
      organization_email: string | null;
    }>(
      `SELECT vq.id, vq.service_id, vq.status,
              vq.submitted_by_user_id, vq.assigned_to_user_id, vq.notes,
              vq.created_at, vq.updated_at,
              s.name AS service_name,
              o.id AS organization_id, o.name AS organization_name,
              o.url AS organization_url, o.email AS organization_email
       FROM verification_queue vq
       JOIN services s ON s.id = vq.service_id
       JOIN organizations o ON o.id = s.organization_id
       ${where}
       ORDER BY vq.created_at ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return NextResponse.json(
      { results: rows, total, page, hasMore: offset + rows.length < total },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_admin_approvals_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`admin:approvals:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = DecisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { queueEntryId, decision, notes } = parsed.data;

  try {
    await withTransaction(async (client) => {
      // 1. Update queue entry status
      const newStatus = decision === 'approved' ? 'verified' : 'rejected';
      await client.query(
        `UPDATE verification_queue
         SET status = $1, notes = COALESCE($2, notes), updated_at = NOW()
         WHERE id = $3`,
        [newStatus, notes ?? null, queueEntryId],
      );

      // 2. If approved, activate the service
      if (decision === 'approved') {
        await client.query(
          `UPDATE services SET status = 'active', updated_at = NOW()
           WHERE id = (SELECT service_id FROM verification_queue WHERE id = $1)`,
          [queueEntryId],
        );
      }
    });

    return NextResponse.json({
      success: true,
      message: decision === 'approved'
        ? 'Claim approved. Organization is now active.'
        : 'Claim denied.',
    });
  } catch (error) {
    await captureException(error, { feature: 'api_admin_approvals_decide' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
