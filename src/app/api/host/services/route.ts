/**
 * GET  /api/host/services — List services (optionally filtered by organizationId).
 * POST /api/host/services — Create a new service under an organization.
 *
 * Auth enforcement: GET filters to user's orgs; POST requires org access.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext, shouldEnforceAuth, isOranAdmin, requireOrgAccess } from '@/services/auth';
import {
  createResourceSubmission,
  getResourceSubmissionDetailForActor,
} from '@/services/resourceSubmissions/service';
import { processSubmittedResourceSubmission } from '@/services/resourceSubmissions/submissionExecution';
import {
  RATE_LIMIT_WINDOW_MS,
  HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_PAGE_SIZE,
} from '@/domain/constants';
import {
  createEmptyResourceSubmissionDraft,
  type ResourceSubmissionDraft,
} from '@/domain/resourceSubmission';
import type { Service } from '@/domain/types';

// ============================================================
// SCHEMAS
// ============================================================

const PhoneInputSchema = z.object({
  number:      z.string().min(7, 'Phone number too short').max(30),
  extension:   z.string().max(10).optional(),
  type:        z.enum(['voice', 'fax', 'text', 'hotline', 'tty']).default('voice'),
  description: z.string().max(200).optional(),
});

const DayScheduleInputSchema = z.object({
  day:    z.enum(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']),
  opens:  z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM'),
  closes: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM'),
  closed: z.boolean().default(false),
});

const ListParamsSchema = z.object({
  organizationId: z.string().uuid().optional(),
  status:         z.enum(['active', 'inactive', 'defunct']).optional(),
  page:           z.coerce.number().int().min(1).default(1),
  limit:          z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
  q:              z.string().max(200).optional(),
});

const CreateServiceSchema = z.object({
  organizationId:        z.string().uuid('organizationId must be a valid UUID'),
  name:                  z.string().min(1, 'Name is required').max(500),
  description:           z.string().max(5000).optional(),
  url:                   z.string().url().max(2000).optional(),
  email:                 z.string().email().max(500).optional(),
  interpretationServices: z.string().max(1000).optional(),
  applicationProcess:    z.string().max(2000).optional(),
  waitTime:              z.string().max(500).optional(),
  fees:                  z.string().max(1000).optional(),
  accreditations:        z.string().max(1000).optional(),
  licenses:              z.string().max(1000).optional(),
  phones:                z.array(PhoneInputSchema).max(10).optional(),
  schedule:              z.array(DayScheduleInputSchema).min(7).max(7).optional(),
});

// ============================================================
// HELPERS
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

function buildCreateDraft(
  input: {
    organizationId: string;
    name: string;
    description?: string;
    url?: string;
    email?: string;
    interpretationServices?: string;
    applicationProcess?: string;
    waitTime?: string;
    fees?: string;
    accreditations?: string;
    licenses?: string;
    phones?: Array<{
      number: string;
      extension?: string;
      type: 'voice' | 'fax' | 'text' | 'hotline' | 'tty';
      description?: string;
    }>;
    schedule?: Array<{
      day: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
      opens: string;
      closes: string;
      closed: boolean;
    }>;
  },
): ResourceSubmissionDraft {
  const draft = createEmptyResourceSubmissionDraft('listing', 'host');
  draft.ownerOrganizationId = input.organizationId;
  draft.service = {
    ...draft.service,
    name: input.name,
    description: input.description ?? '',
    url: input.url ?? '',
    email: input.email ?? '',
    interpretationServices: input.interpretationServices ?? '',
    applicationProcess: input.applicationProcess ?? '',
    waitTime: input.waitTime ?? '',
    fees: input.fees ?? '',
    accreditations: input.accreditations ?? '',
    licenses: input.licenses ?? '',
    phones: (input.phones ?? []).map((phone) => ({
      number: phone.number,
      extension: phone.extension ?? '',
      type: phone.type,
      description: phone.description ?? '',
    })),
  };
  draft.evidence = {
    ...draft.evidence,
    sourceName: 'Host service create',
    sourceUrl: input.url ?? '',
    contactEmail: input.email ?? '',
    submitterRelationship: 'Organization operator',
    notes: 'Service submitted via host portal.',
  };

  if (input.schedule?.some((day) => !day.closed)) {
    draft.locations[0] = {
      ...draft.locations[0],
      name: 'Primary service location',
      schedule: input.schedule.map((day) => ({ ...day })),
    };
  }

  return draft;
}

// ============================================================
// HANDLERS
// ============================================================

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  // Auth check
  const authCtx = await getAuthContext();
  if (!authCtx && shouldEnforceAuth()) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`host:svc:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_READ_RATE_LIMIT_MAX_REQUESTS,
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

  const raw: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => { raw[k] = v; });
  const parsed = ListParamsSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid parameters', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { organizationId, status, page, limit, q } = parsed.data;
  const offset = (page - 1) * limit;

  try {
    const conditions: string[] = [];
    const params: unknown[] = [];

    // Filter to user's organizations unless oran_admin
    if (authCtx && !isOranAdmin(authCtx)) {
      if (authCtx.orgIds.length === 0) {
        return NextResponse.json(
          { results: [], total: 0, page, hasMore: false },
          { headers: { 'Cache-Control': 'private, no-store' } },
        );
      }
      params.push(authCtx.orgIds);
      conditions.push(`s.organization_id = ANY($${params.length})`);
    }

    // If specific org requested, verify access
    if (organizationId) {
      if (authCtx && !requireOrgAccess(authCtx, organizationId)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
      params.push(organizationId);
      conditions.push(`s.organization_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`s.status = $${params.length}`);
    } else {
      // Exclude defunct services by default
      conditions.push(`s.status != 'defunct'`);
    }
    if (q) {
      params.push(q);
      conditions.push(`(to_tsvector('english', s.name) @@ plainto_tsquery('english', $${params.length})
        OR to_tsvector('english', coalesce(s.description, '')) @@ plainto_tsquery('english', $${params.length}))`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRows = await executeQuery<{ count: number }>(
      `SELECT count(*)::int AS count FROM services s ${where}`,
      params,
    );
    const total = countRows[0]?.count ?? 0;

    params.push(limit, offset);
    const rows = await executeQuery<Service & { organization_name?: string }>(
      `SELECT s.id, s.organization_id, s.name, s.alternate_name, s.description,
              s.url, s.email, s.status, s.interpretation_services,
              s.application_process, s.wait_time, s.fees,
              s.accreditations, s.licenses, s.created_at, s.updated_at,
              o.name AS organization_name
       FROM services s
       JOIN organizations o ON o.id = s.organization_id
       ${where}
       ORDER BY s.name ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return NextResponse.json(
      { results: rows, total, page, hasMore: offset + rows.length < total },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_host_services_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  // Auth check — required unconditionally because submitted_by_user_id is NOT NULL
  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`host:svc:write:${ip}`, {
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

  const parsed = CreateServiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const d = parsed.data;

  // Authorization: user must have write access to the target organization
  if (authCtx && !requireOrgAccess(authCtx, d.organizationId)) {
    return NextResponse.json({ error: 'Access denied to this organization' }, { status: 403 });
  }

  try {
    // Verify org exists and isn't defunct
    const orgCheck = await executeQuery<{ id: string; status?: string }>(
      'SELECT id, status FROM organizations WHERE id = $1',
      [d.organizationId],
    );
    if (orgCheck.length === 0) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    if (orgCheck[0].status === 'defunct') {
      return NextResponse.json({ error: 'Cannot add services to a defunct organization' }, { status: 400 });
    }

    const detail = await createResourceSubmission({
      variant: 'listing',
      channel: 'host',
      submittedByUserId: authCtx.userId,
      actorRole: authCtx.role,
      ownerOrganizationId: d.organizationId,
      title: `Service listing: ${d.name}`,
      notes: 'Service submitted via host portal.',
      draft: buildCreateDraft({
        organizationId: d.organizationId,
        name: d.name,
        description: d.description,
        url: d.url,
        email: d.email,
        interpretationServices: d.interpretationServices,
        applicationProcess: d.applicationProcess,
        waitTime: d.waitTime,
        fees: d.fees,
        accreditations: d.accreditations,
        licenses: d.licenses,
        phones: d.phones,
        schedule: d.schedule,
      }),
    });

    const processed = await processSubmittedResourceSubmission({
      detail,
      actorUserId: authCtx.userId,
      actorRole: authCtx.role,
      allowAutoApprove: true,
    });
    if (!processed.success) {
      return NextResponse.json({ error: processed.error ?? 'Unable to create service submission.' }, { status: 409 });
    }

    const refreshed = await getResourceSubmissionDetailForActor(authCtx, detail.instance.id);
    const responseDetail = refreshed ?? detail;

    return NextResponse.json(
      {
        detail: responseDetail,
        queuedForReview: !processed.autoPublished,
        published: processed.autoPublished,
        submissionId: detail.instance.submission_id,
        serviceId: processed.autoPublished ? responseDetail.reviewMeta.targetId : null,
        sourceRecordId: responseDetail.reviewMeta.sourceRecordId,
        message: processed.autoPublished
          ? 'Service published and added to your live listings.'
          : 'Service submitted for review. It will publish after approval.',
      },
      { status: 201 },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_host_services_create' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
