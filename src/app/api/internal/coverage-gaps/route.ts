/**
 * POST /api/internal/coverage-gaps
 *
 * Internal endpoint called by alertCoverageGaps Azure Function (daily timer).
 * Finds unrouted candidates and geographic coverage gaps, then notifies ORAN admins.
 *
 * Protected by shared secret (INTERNAL_API_KEY via Bearer auth) — not accessible to end users.
 */

import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { captureException } from '@/services/telemetry/sentry';
import {
  getCoverageGapSummaries,
  alertOranAdminsAboutGaps,
} from '@/services/coverage/gaps';

const BodySchema = z.object({
  thresholdHours: z.number().int().min(1).max(720).default(24),
}).strict();

export async function POST(req: NextRequest) {
  // Validate internal API key (same pattern as sla-check)
  const apiKey = process.env.INTERNAL_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Internal API not configured' },
      { status: 503 },
    );
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${apiKey}`;
  const authBuf = Buffer.from(authHeader);
  const expectedBuf = Buffer.from(expected);
  if (authBuf.length !== expectedBuf.length || !timingSafeEqual(authBuf, expectedBuf)) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 },
    );
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503 },
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    const raw = await req.json();
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.issues },
        { status: 400 },
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  try {
    const gapSummaries = await getCoverageGapSummaries(body.thresholdHours);

    const unroutedCount = gapSummaries.reduce((sum, g) => sum + g.unroutedCount, 0);
    const gapStates = [
      ...new Set(gapSummaries.map((g) => g.state).filter((s) => s !== 'Unknown')),
    ];

    const alertsSent = await alertOranAdminsAboutGaps(gapSummaries);

    return NextResponse.json({
      success: true,
      unroutedCount,
      gapStates,
      alertsSent,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    await captureException(error, { feature: 'coverage_gaps' });
    return NextResponse.json(
      { error: 'Coverage gap check failed' },
      { status: 500 },
    );
  }
}
