/**
 * POST /api/internal/ingestion/feed-poll
 *
 * Internal endpoint called by a timer-triggered Azure Function to poll active
 * source feeds on a schedule. Protected by INTERNAL_API_KEY bearer auth.
 */

import { NextRequest, NextResponse } from 'next/server';

import { isDatabaseConfigured } from '@/services/db/postgres';
import { captureException } from '@/services/telemetry/sentry';
import { validateRuntimeEnv } from '@/services/runtime/envContract';

function isEnabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.INTERNAL_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Internal API not configured' }, { status: 503 });
  }

  const authHeader = req.headers.get('authorization');
  if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isEnabled(process.env.SOURCE_FEED_POLLING_ENABLED)) {
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: 'SOURCE_FEED_POLLING_ENABLED is disabled',
      checkedAt: new Date().toISOString(),
    });
  }

  const runtimeEnv = validateRuntimeEnv('webapp', process.env);
  if (!runtimeEnv.ok) {
    return NextResponse.json(
      {
        error: 'Runtime environment contract not satisfied',
        missingCritical: runtimeEnv.missingCritical,
      },
      { status: 503 },
    );
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  try {
    const { createIngestionStores } = await import('@/agents/ingestion/persistence/storeFactory');
    const { getDrizzle } = await import('@/services/db/drizzle');
    const { createIngestionService } = await import('@/agents/ingestion/service');

    const db = getDrizzle();
    const stores = createIngestionStores(db);
    const sourceSystems = await stores.sourceSystems.listActive();
    const sourceFeeds = (
      await Promise.all(sourceSystems.map((system) => stores.sourceFeeds.listBySystem(system.id)))
    )
      .flat()
      .filter((feed) => feed.isActive);

    if (sourceFeeds.length === 0) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'No active source feeds configured',
        checkedAt: new Date().toISOString(),
      });
    }

    if (
      sourceFeeds.some((feed) => feed.feedHandler === 'ndp_211')
      && !isEnabled(process.env.NDP_211_POLLING_ENABLED)
    ) {
      return NextResponse.json(
        {
          error: 'Active ndp_211 feeds require NDP_211_POLLING_ENABLED=true',
          missingCritical: ['NDP_211_POLLING_ENABLED'],
        },
        { status: 503 },
      );
    }

    const service = createIngestionService(stores);
    const result = await service.pollFeeds();

    return NextResponse.json({
      success: true,
      checkedAt: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    await captureException(error, { feature: 'internal_feed_poll' });
    return NextResponse.json({ error: 'Feed polling failed' }, { status: 500 });
  }
}
