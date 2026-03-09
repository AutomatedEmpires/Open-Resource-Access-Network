/**
 * GET  /api/host/services — List services (optionally filtered by organizationId).
 * POST /api/host/services — Create a new service under an organization.
 *
 * Auth enforcement: GET filters to user's orgs; POST requires org access.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, withTransaction, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext, shouldEnforceAuth, isOranAdmin, requireOrgAccess } from '@/services/auth';
import { applySla } from '@/services/workflow/engine';
import {
  createHostPortalSourceAssertion,
  queueServiceVerificationSubmission,
  type HostPortalDayScheduleInput,
  type HostPortalPhoneInput,
  type HostServiceRequestedChanges,
} from '@/services/ingestion/hostPortalIntake';
import {
  RATE_LIMIT_WINDOW_MS,
  HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_PAGE_SIZE,
} from '@/domain/constants';
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

function buildRequestedChanges(
  input: {
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
    phones?: HostPortalPhoneInput[];
    schedule?: HostPortalDayScheduleInput[];
  },
): HostServiceRequestedChanges {
  const requested: HostServiceRequestedChanges = {
    name: input.name,
  };

  if (input.description !== undefined) requested.description = input.description;
  if (input.url !== undefined) requested.url = input.url;
  if (input.email !== undefined) requested.email = input.email;
  if (input.interpretationServices !== undefined) requested.interpretationServices = input.interpretationServices;
  if (input.applicationProcess !== undefined) requested.applicationProcess = input.applicationProcess;
  if (input.waitTime !== undefined) requested.waitTime = input.waitTime;
  if (input.fees !== undefined) requested.fees = input.fees;
  if (input.accreditations !== undefined) requested.accreditations = input.accreditations;
  if (input.licenses !== undefined) requested.licenses = input.licenses;
  if (input.phones !== undefined) requested.phones = input.phones;
  if (input.schedule !== undefined) requested.schedule = input.schedule;

  return requested;
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

    const result = await withTransaction(async (client) => {
      // 1. Create the service
      const svcRows = await client.query<Service>(
        `INSERT INTO services
           (organization_id, name, description, url, email, status,
            interpretation_services, application_process, wait_time, fees,
            accreditations, licenses, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
          d.organizationId,
          d.name,
          d.description ?? null,
          d.url ?? null,
          d.email ?? null,
          'inactive',
          d.interpretationServices ?? null,
          d.applicationProcess ?? null,
          d.waitTime ?? null,
          d.fees ?? null,
          d.accreditations ?? null,
          d.licenses ?? null,
          authCtx.userId,
        ],
      );
      const service = svcRows.rows[0];

      const requestedChanges = buildRequestedChanges({
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
      });

      const assertion = await createHostPortalSourceAssertion(client, {
        actorUserId: authCtx.userId,
        actorRole: authCtx.role,
        recordType: 'host_service_create',
        recordId: service.id,
        canonicalSourceUrl: `oran://host-portal/services/${service.id}`,
        payload: {
          organizationId: d.organizationId,
          serviceId: service.id,
          requestedChanges,
        },
      });

      const submissionId = await queueServiceVerificationSubmission(client, {
        serviceId: service.id,
        submittedByUserId: authCtx.userId,
        actorRole: authCtx.role,
        title: `Service verification: ${service.name}`,
        notes: 'Service submitted via host portal.',
        payload: {
          flow: 'host_portal',
          changeType: 'host_service_create',
          sourceRecordId: assertion.sourceRecordId,
          organizationId: d.organizationId,
          serviceId: service.id,
          currentStatus: service.status,
          requestedChanges,
        },
      });

      // 2. Insert phones if provided
      if (d.phones && d.phones.length > 0) {
        for (const ph of d.phones) {
          await client.query(
            `INSERT INTO phones (service_id, number, extension, type, description)
             VALUES ($1, $2, $3, $4, $5)`,
            [service.id, ph.number, ph.extension ?? null, ph.type === 'text' ? 'sms' : ph.type, ph.description ?? null],
          );
        }
      }

      // 3. Insert schedule rows for non-closed days
      if (d.schedule && d.schedule.length > 0) {
        for (const ds of d.schedule) {
          if (ds.closed) continue;
          await client.query(
            `INSERT INTO schedules (service_id, days, opens_at, closes_at)
             VALUES ($1, $2, $3, $4)`,
            [service.id, [ds.day], ds.opens, ds.closes],
          );
        }
      }

      return {
        service,
        submissionId,
        sourceRecordId: assertion.sourceRecordId,
      };
    });

    try {
      await applySla(result.submissionId, 'service_verification');
    } catch {
      // SLA is best-effort.
    }

    return NextResponse.json(
      {
        ...result.service,
        queuedForReview: true,
        submissionId: result.submissionId,
        sourceRecordId: result.sourceRecordId,
        message: 'Service submitted for review. It will publish after approval.',
      },
      { status: 201 },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_host_services_create' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
