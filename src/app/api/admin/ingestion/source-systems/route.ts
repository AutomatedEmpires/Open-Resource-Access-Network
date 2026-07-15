/**
 * GET  /api/admin/ingestion/source-systems — List active pollable source systems and feeds.
 * POST /api/admin/ingestion/source-systems — Create a source system and optional initial feed.
 *
 * ORAN-admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { SourceResourcePurposeSchema } from '@/agents/ingestion/sourcePurpose';

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

const JurisdictionScopeSchema = z.object({
  kind: z.enum(['local', 'regional', 'statewide', 'national', 'virtual']).optional(),
  country: z.string().min(2).max(2).optional(),
  stateProvince: z.string().min(1).optional(),
  countyOrRegion: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  postalCode: z.string().min(1).optional(),
}).strict();

const DomainRuleSchema = z.object({
  type: z.enum(['exact_host', 'suffix']),
  value: z.string().min(1),
}).strict();

const ContactInfoSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().min(1).optional(),
  team: z.string().min(1).optional(),
}).strict();

const InitialFeedSchema = z.object({
  feedName: z.string().min(1).max(200),
  feedType: z.string().min(1).max(100),
  feedHandler: z.enum(['none', 'hsds_api', 'ndp_211', 'azure_function']),
  baseUrl: z.string().url().optional(),
  healthcheckUrl: z.string().url().optional(),
  authType: z.string().min(1).max(50).optional(),
  profileUri: z.string().url().optional(),
  refreshIntervalHours: z.number().int().min(1).max(720).default(24),
  jurisdictionScope: JurisdictionScopeSchema.optional(),
  isActive: z.boolean().optional(),
}).strict();

const CreateSourceSystemSchema = z.object({
  name: z.string().min(1).max(200),
  family: z.enum([
    'hsds_api',
    'hsds_tabular',
    'partner_api',
    'partner_export',
    'government_open_data',
    'allowlisted_scrape',
    'manual',
  ]),
  trustTier: z.enum([
    'verified_publisher',
    'trusted_partner',
    'curated',
    'community',
    'quarantine',
    'blocked',
  ]),
  resourcePurpose: SourceResourcePurposeSchema,
  homepageUrl: z.string().url().optional(),
  licenseNotes: z.string().max(4000).optional(),
  termsUrl: z.string().url().optional(),
  hsdsProfileUri: z.string().url().optional(),
  notes: z.string().max(4000).optional(),
  domainRules: z.array(DomainRuleSchema).default([]),
  jurisdictionScope: JurisdictionScopeSchema.optional(),
  contactInfo: ContactInfoSchema.optional(),
  isActive: z.boolean().optional(),
  initialFeed: InitialFeedSchema.optional(),
}).strict();
async function requireAdmin(req: NextRequest, operation: 'read' | 'write') {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`admin:ingestion:source-systems:${operation}:${ip}`, {
    maxRequests: operation === 'read'
      ? ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS
      : ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (rl.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable. Please try again later.' },
      { status: 503, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }
  if (rl.exceeded === true) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const session = await getAuthContext();
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!requireMinRole(session, 'oran_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  return null;
}

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req, 'read');
  if (guard) return guard;

  try {
    const { createIngestionStores } = await import('@/agents/ingestion/persistence/storeFactory');
    const { getDrizzle } = await import('@/services/db/drizzle');

    const db = getDrizzle();
    const stores = createIngestionStores(db);

    const systems = await stores.sourceSystems.listActive();
    const systemsWithFeeds = await Promise.all(
      systems.map(async (system) => ({
        ...system,
        feeds: await Promise.all(
          (await stores.sourceFeeds.listBySystem(system.id)).map(async (feed) => ({
            ...feed,
            state: await stores.sourceFeedStates.getByFeedId(feed.id),
          })),
        ),
      })),
    );

    return NextResponse.json({ sourceSystems: systemsWithFeeds });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req, 'write');
  if (guard) return guard;

  try {
    const body = await req.json();
    const parsed = CreateSourceSystemSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    if (parsed.data.initialFeed?.feedHandler === 'azure_function') {
      return NextResponse.json(
        {
          error: 'Legacy Azure Function feeds cannot be created.',
          code: 'legacy_feed_handler_read_only',
        },
        { status: 400 },
      );
    }

    const session = await getAuthContext();
    const sourceSystemId = crypto.randomUUID();
    const initialFeedId = parsed.data.initialFeed ? crypto.randomUUID() : null;
    const createState = {
      id: sourceSystemId,
      name: parsed.data.name,
      family: parsed.data.family,
      homepageUrl: parsed.data.homepageUrl ?? null,
      licenseNotes: parsed.data.licenseNotes ?? null,
      termsUrl: parsed.data.termsUrl ?? null,
      trustTier: parsed.data.trustTier,
      resourcePurpose: parsed.data.resourcePurpose,
      hsdsProfileUri: parsed.data.hsdsProfileUri ?? null,
      domainRules: parsed.data.domainRules,
      crawlPolicy: {},
      jurisdictionScope: parsed.data.jurisdictionScope ?? {},
      contactInfo: parsed.data.contactInfo ?? {},
      notes: parsed.data.notes ?? null,
      isActive: parsed.data.isActive ?? true,
    };
    const initialFeed = parsed.data.initialFeed && initialFeedId ? {
        id: initialFeedId,
        sourceSystemId,
        feedName: parsed.data.initialFeed.feedName,
        feedType: parsed.data.initialFeed.feedType,
        feedHandler: parsed.data.initialFeed.feedHandler,
        baseUrl: parsed.data.initialFeed.baseUrl ?? null,
        healthcheckUrl: parsed.data.initialFeed.healthcheckUrl ?? null,
        authType: parsed.data.initialFeed.authType ?? 'none',
        profileUri: parsed.data.initialFeed.profileUri ?? null,
        jurisdictionScope: parsed.data.initialFeed.jurisdictionScope ?? {},
        refreshIntervalHours: parsed.data.initialFeed.refreshIntervalHours,
        isActive: parsed.data.initialFeed.isActive ?? true,
      } : undefined;

    const { submissionId } = await queueIngestionControlChange({
      submittedByUserId: session?.userId ?? 'unknown',
      actorRole: session?.role ?? 'oran_admin',
      targetId: sourceSystemId,
      title: `Source system creation queued: ${parsed.data.name}`,
      summary: `Creating and activating source system ${parsed.data.name} requires a different ORAN administrator to approve the exact source and feed configuration.`,
      payload: {
        entityType: 'source_system',
        action: 'create',
        entityId: sourceSystemId,
        entityLabel: parsed.data.name,
        summary: `Create ${parsed.data.family} source at ${parsed.data.trustTier} trust for ${parsed.data.resourcePurpose}`,
        beforeState: null,
        createState,
        initialFeed,
      },
    });

    return NextResponse.json(
      {
        sourceSystemId,
        initialFeedId,
        submissionId,
        queued: true,
        status: 'pending_second_approval',
      },
      { status: 202 },
    );
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
