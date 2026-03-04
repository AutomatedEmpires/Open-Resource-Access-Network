/**
 * POST /api/host/claim — Submit an organization claim.
 *
 * Creates an organization record and a verification_queue entry with status 'pending'.
 * The community admin workflow processes the queue and verifies claims.
 *
 * This does NOT create SQL migrations — the verification_queue table is assumed
 * to exist from 0000_initial_schema.sql. The submitted_by column was renamed to
 * submitted_by_user_id in 0002_audit_fields.sql.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured, withTransaction } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth';
import {
  RATE_LIMIT_WINDOW_MS,
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

// ============================================================
// SCHEMA
// ============================================================

const ClaimSchema = z.object({
  /** Organization name to claim */
  organizationName: z.string().min(1, 'Organization name is required').max(500),
  /** Brief description of the organization */
  description:      z.string().max(5000).optional(),
  /** Organization website (helps verification) */
  url:              z.string().url().max(2000).optional(),
  /** Contact email for verification */
  email:            z.string().email().max(500).optional(),
  /** Notes for the reviewer (role at org, how to verify, etc.) */
  claimNotes:       z.string().max(2000).optional(),
});

// ============================================================
// HELPERS
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

// ============================================================
// HANDLER
// ============================================================

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'Database not configured.' },
      { status: 503 },
    );
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`host:claim:write:${ip}`, {
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

  const parsed = ClaimSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const d = parsed.data;

  // Auth required unconditionally for claim submission.
  // Claims create organizations and enter the approval queue — they must be
  // attributed to a real, authenticated user in all environments.
  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json(
      { error: 'Authentication required to submit claims' },
      { status: 401 },
    );
  }

  try {
    const submitterId = authCtx.userId;

    // All inserts in a transaction — if any fail, everything rolls back
    const result = await withTransaction(async (client) => {
      // 1. Create the organization
      const orgResult = await client.query<{ id: string }>(
        `INSERT INTO organizations (name, description, url, email)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [
          d.organizationName,
          d.description ?? null,
          d.url ?? null,
          d.email ?? null,
        ],
      );
      const orgId = orgResult.rows[0].id;

      // 2. Create a placeholder service for verification tracking.
      const svcResult = await client.query<{ id: string }>(
        `INSERT INTO services (organization_id, name, description, status)
         VALUES ($1, $2, $3, 'inactive')
         RETURNING id`,
        [orgId, `${d.organizationName} — General Services`, 'Placeholder service created during organization claim.'],
      );
      const serviceId = svcResult.rows[0].id;

      // 3. Create verification_queue entry with submitter ID
      await client.query(
        `INSERT INTO verification_queue (service_id, status, submitted_by_user_id, notes)
         VALUES ($1, 'pending', $2, $3)`,
        [
          serviceId,
          submitterId,
          d.claimNotes ?? 'Organization claim submitted via host portal.',
        ],
      );

      return { orgId, serviceId };
    });

    return NextResponse.json(
      {
        success: true,
        organizationId: result.orgId,
        serviceId: result.serviceId,
        message: 'Claim submitted. A community administrator will review your request.',
      },
      { status: 201 },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_host_claim' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
