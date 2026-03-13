/**
 * GET  /api/admin/ingestion/sources — List all active ingestion sources.
 * POST /api/admin/ingestion/sources — Create / upsert an ingestion source.
 *
 * ORAN-admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

// Reuse the authoritative schema from sourceRegistry, but make id optional for create
const CreateSourceSchema = z.object({
  id: z.string().min(1).optional(),
  displayName: z.string().min(1).max(200),
  trustLevel: z.enum(['allowlisted', 'quarantine', 'blocked']),
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
});

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(ip, { maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS, windowMs: RATE_LIMIT_WINDOW_MS });
  if (rl.exceeded) {
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
  const rl = await checkRateLimitShared(ip, { maxRequests: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS, windowMs: RATE_LIMIT_WINDOW_MS });
  if (rl.exceeded) {
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

    const { createIngestionStores } = await import(
      '@/agents/ingestion/persistence/storeFactory'
    );
    const { getDrizzle } = await import('@/services/db/drizzle');

    const db = getDrizzle();
    const stores = createIngestionStores(db);

    const now = new Date().toISOString();
    const id = parsed.data.id ?? crypto.randomUUID();

    const entry = {
      id,
      displayName: parsed.data.displayName,
      trustLevel: parsed.data.trustLevel,
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

    await stores.sourceRegistry.upsert(entry);

    return NextResponse.json({ id, created: true }, { status: 201 });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
