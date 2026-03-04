/**
 * GET /api/community/queue/[id] — Fetch a single verification queue entry with full service + org details.
 * PUT /api/community/queue/[id] — Submit a verification decision (verify / reject / escalate).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, isDatabaseConfigured, withTransaction } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import {
  RATE_LIMIT_WINDOW_MS,
  COMMUNITY_READ_RATE_LIMIT_MAX_REQUESTS,
  COMMUNITY_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

// ============================================================
// SCHEMAS
// ============================================================

const DecisionSchema = z.object({
  decision: z.enum(['verified', 'rejected', 'escalated'], {
    message: 'decision is required',
  }),
  notes: z.string().max(5000).optional(),
});

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
    return NextResponse.json({ error: 'Invalid queue entry ID' }, { status: 400 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`community:verify:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: COMMUNITY_READ_RATE_LIMIT_MAX_REQUESTS,
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
  if (!requireMinRole(authCtx, 'community_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  try {
    // Full detail: queue entry + service + organization + location(s) + address(es) + phone(s)
    const rows = await executeQuery<{
      id: string;
      service_id: string;
      status: string;
      submitted_by_user_id: string;
      assigned_to_user_id: string | null;
      notes: string | null;
      created_at: string;
      updated_at: string;
      // Service
      service_name: string;
      service_description: string | null;
      service_url: string | null;
      service_email: string | null;
      service_status: string;
      // Organization
      organization_id: string;
      organization_name: string;
      organization_url: string | null;
      organization_email: string | null;
      organization_description: string | null;
    }>(
      `SELECT vq.id, vq.service_id, vq.status,
              vq.submitted_by_user_id, vq.assigned_to_user_id, vq.notes,
              vq.created_at, vq.updated_at,
              s.name AS service_name, s.description AS service_description,
              s.url AS service_url, s.email AS service_email, s.status AS service_status,
              o.id AS organization_id, o.name AS organization_name,
              o.url AS organization_url, o.email AS organization_email,
              o.description AS organization_description
       FROM verification_queue vq
       JOIN services s ON s.id = vq.service_id
       JOIN organizations o ON o.id = s.organization_id
       WHERE vq.id = $1`,
      [id],
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Queue entry not found' }, { status: 404 });
    }

    const entry = rows[0];

    // Fetch locations associated with this service
    const locations = await executeQuery<{
      id: string;
      name: string | null;
      address_1: string | null;
      city: string | null;
      state_province: string | null;
      postal_code: string | null;
      latitude: number | null;
      longitude: number | null;
    }>(
      `SELECT l.id, l.name, a.address_1, a.city, a.state_province, a.postal_code,
              l.latitude, l.longitude
       FROM service_at_location sal
       JOIN locations l ON l.id = sal.location_id
       LEFT JOIN addresses a ON a.location_id = l.id
       WHERE sal.service_id = $1`,
      [entry.service_id],
    );

    // Fetch phones for this service
    const phones = await executeQuery<{
      id: string;
      number: string;
      type: string | null;
      description: string | null;
    }>(
      `SELECT id, number, type, description FROM phones WHERE service_id = $1`,
      [entry.service_id],
    );

    // Fetch confidence score
    const scores = await executeQuery<{
      score: number;
      verification_confidence: number;
      eligibility_match: number;
      constraint_fit: number;
      computed_at: string;
    }>(
      `SELECT score, verification_confidence, eligibility_match, constraint_fit, computed_at
       FROM confidence_scores WHERE service_id = $1`,
      [entry.service_id],
    );

    return NextResponse.json(
      {
        ...entry,
        locations,
        phones,
        confidenceScore: scores[0] ?? null,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_community_verify_get' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid queue entry ID' }, { status: 400 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`community:verify:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: COMMUNITY_WRITE_RATE_LIMIT_MAX_REQUESTS,
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
  if (!requireMinRole(authCtx, 'community_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
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

  const { decision, notes } = parsed.data;

  try {
    const result = await withTransaction(async (client) => {
      // 1. Update the verification queue entry
      const queueResult = await client.query<{
        id: string;
        service_id: string;
      }>(
        `UPDATE verification_queue
         SET status = $1, notes = $2, assigned_to_user_id = $3, updated_at = now()
         WHERE id = $4 AND status IN ('pending', 'in_review')
         RETURNING id, service_id`,
        [decision, notes ?? null, authCtx.userId, id],
      );

      if (queueResult.rows.length === 0) {
        return null; // 404 or already decided
      }

      const serviceId = queueResult.rows[0].service_id;

      // 2. If verified, update the confidence score
      if (decision === 'verified') {
        // Bump verification_confidence to 80+ since a human verified it
        await client.query(
          `INSERT INTO confidence_scores (service_id, score, verification_confidence, eligibility_match, constraint_fit)
           VALUES ($1, 80, 80, 50, 50)
           ON CONFLICT (service_id)
           DO UPDATE SET verification_confidence = 80,
                         score = GREATEST(confidence_scores.score, 80),
                         computed_at = now()`,
          [serviceId],
        );
      }

      // 3. If rejected, create an actionable change request note
      //    This is recorded in the verification_queue notes for now.
      //    The host will see this when checking their service claim status.

      return { id: queueResult.rows[0].id, serviceId, decision };
    });

    if (result === null) {
      return NextResponse.json(
        { error: 'Queue entry not found or already reviewed' },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      ...result,
      message:
        decision === 'verified'
          ? 'Record verified. Confidence score updated.'
          : decision === 'rejected'
            ? 'Record rejected. Change request notes saved for the host.'
            : 'Record escalated for ORAN admin review.',
    });
  } catch (error) {
    await captureException(error, { feature: 'api_community_verify_decision' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
