/**
 * POST /api/host/services/claim — Claim ownership of an existing service.
 *
 * When an organization signs up and discovers that a service they own was
 * previously crawled/community-managed, they can initiate an ownership transfer.
 *
 * GET /api/host/services/claim — Detect services matching the org's identity.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth';
import {
  RATE_LIMIT_WINDOW_MS,
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';
import {
  detectExistingServices,
  initiateTransfer,
} from '@/services/ownershipTransfer/service';

// ============================================================
// SCHEMA
// ============================================================

const ClaimServiceSchema = z.object({
  serviceId: z.string().uuid('Invalid service ID'),
  organizationId: z.string().uuid('Invalid organization ID'),
  verificationMethod: z
    .enum(['domain_match', 'email_match', 'manual_review', 'admin_review'])
    .optional()
    .default('admin_review'),
  transferNotes: z.string().max(2000).optional(),
});

const DetectSchema = z.object({
  organizationName: z.string().min(1).max(500),
  url: z.string().url().max(2000).optional(),
  email: z.string().email().max(500).optional(),
});

// ============================================================
// HELPERS
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

// ============================================================
// POST — Initiate ownership transfer
// ============================================================

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`host:claim-service:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json(
      { error: 'Authentication required to claim a service' },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = ClaimServiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const d = parsed.data;

  try {
    const transfer = await initiateTransfer({
      serviceId: d.serviceId,
      organizationId: d.organizationId,
      requestedByUserId: authCtx.userId,
      verificationMethod: d.verificationMethod,
      transferNotes: d.transferNotes,
    });

    return NextResponse.json(
      {
        success: true,
        transfer,
        message: 'Ownership transfer initiated. An admin will review your request.',
      },
      { status: 201 },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Internal server error';
    if (msg.includes('active transfer already exists') || msg.includes('Service not found')) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    await captureException(error, { feature: 'api_host_services_claim' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================================
// GET — Detect matching services for an organization
// ============================================================

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const url = new URL(req.url);
  const raw = {
    organizationName: url.searchParams.get('organizationName') ?? '',
    url: url.searchParams.get('url') || undefined,
    email: url.searchParams.get('email') || undefined,
  };

  const parsed = DetectSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const matches = await detectExistingServices(
      parsed.data.organizationName,
      parsed.data.url ?? null,
      parsed.data.email ?? null,
    );

    return NextResponse.json({ matches });
  } catch (error) {
    await captureException(error, { feature: 'api_host_services_claim_detect' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
