/**
 * GET    /api/admin/ingestion/sources/[id] — Get source detail.
 * PUT    /api/admin/ingestion/sources/[id] — Update a source.
 * DELETE /api/admin/ingestion/sources/[id] — Deactivate (soft-delete) a source.
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
import { getIp } from '@/services/security/ip';
import {
  isHighRiskSourceUpdate,
  queueIngestionControlChange,
} from '@/services/ingestion/controlChanges';

const UpdateSourceSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  trustLevel: z.enum(['allowlisted', 'quarantine', 'blocked']).optional(),
  domainRules: z.array(
    z.object({
      type: z.enum(['exact_host', 'suffix']),
      value: z.string().min(1),
    })
  ).min(1).optional(),
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
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    if (!id || id.length === 0) {
      return NextResponse.json({ error: 'Missing source ID.' }, { status: 400 });
    }

    const { createIngestionStores } = await import(
      '@/agents/ingestion/persistence/storeFactory'
    );
    const { getDrizzle } = await import('@/services/db/drizzle');

    const db = getDrizzle();
    const stores = createIngestionStores(db);

    const source = await stores.sourceRegistry.getById(id);
    if (!source) {
      return NextResponse.json({ error: 'Source not found.' }, { status: 404 });
    }

    return NextResponse.json({ source });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    if (!id || id.length === 0) {
      return NextResponse.json({ error: 'Missing source ID.' }, { status: 400 });
    }

    const body = await req.json();
    const parsed = UpdateSourceSchema.safeParse(body);
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

    // Fetch existing to merge
    const existing = await stores.sourceRegistry.getById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Source not found.' }, { status: 404 });
    }

    const merged = {
      ...existing,
      ...parsed.data,
      id,
      updatedAt: new Date().toISOString(),
    };

    if (isHighRiskSourceUpdate(existing, parsed.data)) {
      const { submissionId } = await queueIngestionControlChange({
        submittedByUserId: session.userId,
        actorRole: session.role ?? 'oran_admin',
        targetId: id,
        title: `Source trust change queued: ${existing.displayName}`,
        summary: `Trust level change for source ${existing.displayName} requires second approval before publication authority changes.`,
        payload: {
          entityType: 'source',
          action: 'update',
          entityId: id,
          entityLabel: existing.displayName,
          summary: `Trust level ${existing.trustLevel ?? 'unknown'} -> ${parsed.data.trustLevel ?? existing.trustLevel ?? 'unknown'}`,
          beforeState: existing as Record<string, unknown>,
          nextState: merged,
        },
      });

      return NextResponse.json(
        { queued: true, submissionId, status: 'pending_second_approval' },
        { status: 202 },
      );
    }

    await stores.sourceRegistry.upsert(merged);

    return NextResponse.json({ updated: true });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    if (!id || id.length === 0) {
      return NextResponse.json({ error: 'Missing source ID.' }, { status: 400 });
    }

    const { createIngestionStores } = await import(
      '@/agents/ingestion/persistence/storeFactory'
    );
    const { getDrizzle } = await import('@/services/db/drizzle');

    const db = getDrizzle();
    const stores = createIngestionStores(db);
    const existing = await stores.sourceRegistry.getById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Source not found.' }, { status: 404 });
    }

    const { submissionId } = await queueIngestionControlChange({
      submittedByUserId: session.userId,
      actorRole: session.role ?? 'oran_admin',
      targetId: id,
      title: `Source deactivation queued: ${existing.displayName}`,
      summary: `Deactivating source ${existing.displayName} requires second approval because it can remove a publisher from ingestion coverage.`,
      payload: {
        entityType: 'source',
        action: 'deactivate',
        entityId: id,
        entityLabel: existing.displayName,
        summary: `Deactivate source ${existing.displayName}`,
        beforeState: existing as Record<string, unknown>,
      },
    });

    return NextResponse.json(
      { queued: true, submissionId, status: 'pending_second_approval' },
      { status: 202 },
    );
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
