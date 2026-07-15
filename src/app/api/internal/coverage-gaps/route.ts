/**
 * GET|POST /api/internal/coverage-gaps
 *
 * Vercel Cron uses GET with the default threshold. POST remains available to
 * authenticated rollback workers and operational tooling with a custom threshold.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { rejectUnauthorizedInternalRequest } from '@/services/auth/internalRequest';
import { captureException } from '@/services/telemetry/sentry';
import {
  getCoverageGapSummaries,
  alertOranAdminsAboutGaps,
} from '@/services/coverage/gaps';

const BodySchema = z.object({
  thresholdHours: z.number().int().min(1).max(720).default(24),
}).strict();

export const dynamic = 'force-dynamic';

async function runCoverageGapCheck(
  body: z.infer<typeof BodySchema>,
) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503 },
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

export async function GET(req: NextRequest) {
  const authFailure = rejectUnauthorizedInternalRequest(req);
  if (authFailure) return authFailure;

  return runCoverageGapCheck({ thresholdHours: 24 });
}

export async function POST(req: NextRequest) {
  const authFailure = rejectUnauthorizedInternalRequest(req);
  if (authFailure) return authFailure;

  let body: z.infer<typeof BodySchema>;
  try {
    const parsed = BodySchema.safeParse(await req.json());
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

  return runCoverageGapCheck(body);
}
