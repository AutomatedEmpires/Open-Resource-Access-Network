/**
 * GET  /api/admin/rules — List all feature flags.
 * PUT  /api/admin/rules — Update a feature flag.
 *
 * ORAN-admin only. Uses the in-memory FlagService for runtime;
 * DB-backed persistence is planned but not yet wired.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { flagService } from '@/services/flags/flags';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

// ============================================================
// SCHEMAS
// ============================================================

const UpdateFlagSchema = z.object({
  name:       z.string().min(1, 'Flag name is required').max(200),
  enabled:    z.boolean(),
  rolloutPct: z.number().int().min(0).max(100).default(100),
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
  const ip = getIp(req);
  const rl = checkRateLimit(`admin:rules:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  try {
    const flags = await flagService.getAllFlags();

    return NextResponse.json(
      { flags },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_admin_rules_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const ip = getIp(req);
  const rl = checkRateLimit(`admin:rules:write:${ip}`, {
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

  const parsed = UpdateFlagSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { name, enabled, rolloutPct } = parsed.data;

  try {
    await flagService.setFlag(name, enabled, rolloutPct);
    const updated = await flagService.getFlag(name);

    return NextResponse.json({
      success: true,
      flag: updated,
      message: `Flag "${name}" updated: ${enabled ? 'enabled' : 'disabled'} at ${rolloutPct}% rollout.`,
    });
  } catch (error) {
    await captureException(error, { feature: 'api_admin_rules_update' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
