/**
 * GET  /api/admin/ingestion/sources — List all active ingestion sources.
 * POST /api/admin/ingestion/sources — Create / upsert an ingestion source.
 *
 * ORAN-admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SourceResourcePurposeSchema } from '@/agents/ingestion/sourcePurpose';
import { registryTrustLevelToSourceSystemTrustTier } from '@/agents/ingestion/sourceRegistry';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { getIp } from '@/services/security/ip';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';
import { queueIngestionControlChange } from '@/services/ingestion/controlChanges';

// Reuse the authoritative schema from sourceRegistry, but make id optional for create
const CreateSourceSchema = z.object({
  displayName: z.string().min(1).max(200),
  trustLevel: z.enum(['allowlisted', 'quarantine', 'blocked']),
  resourcePurpose: SourceResourcePurposeSchema,
  domainRules: z.array(
    z.object({
      type: z.enum(['exact_host', 'suffix']),
      value: z.string().min(1),
    })
  ).min(1),
  discovery: z.array(z.object({
    type: z.enum(['seeded_only', 'sitemap', 'rss', 'html_directory']),
    seedUrls: z.array(z.string().url()).optional(),
    sitemapUrl: z.string().url().optional(),
    feedUrl: z.string().url().optional(),
    indexUrl: z.string().url().optional(),
    linkSelectorHint: z.string().min(1).optional(),
  })).optional(),
  coverage: z.array(z.object({
    kind: z.enum(['local', 'regional', 'statewide', 'national', 'virtual']).default('national'),
    country: z.string().min(2).max(2).default('US'),
    stateProvince: z.string().min(1).optional(),
    countyOrRegion: z.string().min(1).optional(),
  })).optional(),
}).strict();
export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`admin:ingestion:sources:read:${ip}`, { maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS, windowMs: RATE_LIMIT_WINDOW_MS });
  if (rl.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable. Please try again later.' },
      { status: 503, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }
  if (rl.exceeded === true) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    );
  }

  try {
    const session = await getAuthContext();
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (!requireMinRole(session, 'oran_admin')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const { createIngestionStores } = await import(
      '@/agents/ingestion/persistence/storeFactory'
    );
    const { getDrizzle } = await import('@/services/db/drizzle');

    const db = getDrizzle();
    const stores = createIngestionStores(db);

    const sources = await stores.sourceRegistry.listActive();

    return NextResponse.json({ sources });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`admin:ingestion:sources:write:${ip}`, { maxRequests: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS, windowMs: RATE_LIMIT_WINDOW_MS });
  if (rl.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable. Please try again later.' },
      { status: 503, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }
  if (rl.exceeded === true) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    );
  }

  try {
    const session = await getAuthContext();
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (!requireMinRole(session, 'oran_admin')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const body = await req.json();
    const parsed = CreateSourceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input.', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const entry = {
      id,
      displayName: parsed.data.displayName,
      trustLevel: parsed.data.trustLevel,
      resourcePurpose: parsed.data.resourcePurpose,
      domainRules: parsed.data.domainRules,
      discovery: parsed.data.discovery ?? [{ type: 'seeded_only' as const }],
      crawl: {
        obeyRobotsTxt: true,
        userAgent: 'oran-ingestion-agent/1.0',
        allowedPathPrefixes: ['/'],
        blockedPathPrefixes: [],
        maxRequestsPerMinute: 60,
        maxConcurrentRequests: 3,
        fetchTtlHours: 24,
      },
      coverage: parsed.data.coverage ?? [],
      createdAt: now,
      updatedAt: now,
    };

    const { submissionId } = await queueIngestionControlChange({
      submittedByUserId: session.userId,
      actorRole: session.role ?? 'oran_admin',
      targetId: id,
      title: `Source creation queued: ${parsed.data.displayName}`,
      summary: `Creating and activating source ${parsed.data.displayName} requires a different ORAN administrator to approve the exact origin and authority configuration.`,
      payload: {
        entityType: 'source_system',
        action: 'create',
        entityId: id,
        entityLabel: parsed.data.displayName,
        summary: `Create allowlisted scrape source for ${parsed.data.resourcePurpose}`,
        beforeState: null,
        createState: {
          id,
          name: entry.displayName,
          family: 'allowlisted_scrape',
          homepageUrl: entry.discovery[0]?.seedUrls?.[0] ?? null,
          trustTier: registryTrustLevelToSourceSystemTrustTier(entry.trustLevel),
          resourcePurpose: entry.resourcePurpose,
          domainRules: entry.domainRules,
          crawlPolicy: {
            ...entry.crawl,
            discovery: entry.discovery,
          },
          jurisdictionScope: entry.coverage,
          contactInfo: {},
          notes: null,
          isActive: true,
        },
      },
    });

    return NextResponse.json({
      id,
      submissionId,
      queued: true,
      status: 'pending_second_approval',
    }, { status: 202 });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
