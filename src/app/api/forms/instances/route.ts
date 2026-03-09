import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole, requireOrgAccess } from '@/services/auth/guards';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import {
  createFormInstance,
  getFormTemplateById,
  listAccessibleFormInstances,
} from '@/services/forms/vault';
import {
  FORM_RECIPIENT_ROLES,
  getVisibleFormTemplateAudiences,
} from '@/domain/forms';
import {
  HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from '@/domain/constants';

const ListQuerySchema = z.object({
  status: z.string().min(1).max(60).optional(),
  templateId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const CreateInstanceSchema = z.object({
  templateId: z.string().uuid(),
  ownerOrganizationId: z.string().uuid().nullable().optional(),
  coverageZoneId: z.string().uuid().nullable().optional(),
  recipientRole: z.enum(FORM_RECIPIENT_ROLES).nullable().optional(),
  recipientUserId: z.string().min(1).max(200).nullable().optional(),
  recipientOrganizationId: z.string().uuid().nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  formData: z.record(z.string(), z.unknown()).default({}),
  attachmentManifest: z.array(z.unknown()).default([]),
});

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`forms:instances:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!requireMinRole(authCtx, 'host_member')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const parsed = ListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await listAccessibleFormInstances(authCtx, parsed.data);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, max-age=30' } });
  } catch (error) {
    await captureException(error, { feature: 'api_forms_instances_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`forms:instances:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!requireMinRole(authCtx, 'host_member')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CreateInstanceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.ownerOrganizationId && !requireOrgAccess(authCtx, parsed.data.ownerOrganizationId)) {
    return NextResponse.json({ error: 'Access denied to organization scope' }, { status: 403 });
  }

  if (parsed.data.recipientOrganizationId && !requireOrgAccess(authCtx, parsed.data.recipientOrganizationId) && authCtx.role !== 'oran_admin') {
    return NextResponse.json({ error: 'Access denied to recipient organization scope' }, { status: 403 });
  }

  try {
    const template = await getFormTemplateById(
      parsed.data.templateId,
      getVisibleFormTemplateAudiences(authCtx.role),
      authCtx.role === 'oran_admin',
    );
    if (!template || (!template.is_published && authCtx.role !== 'oran_admin')) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    if (template.storage_scope === 'organization' && !parsed.data.ownerOrganizationId) {
      return NextResponse.json({ error: 'Organization-scoped templates require an owning organization' }, { status: 400 });
    }

    if (template.storage_scope === 'community') {
      if (!parsed.data.coverageZoneId) {
        return NextResponse.json({ error: 'Community-scoped templates require a coverage zone' }, { status: 400 });
      }

      const zones = await executeQuery<{ id: string }>(
        `SELECT id FROM coverage_zones WHERE id = $1 AND status = 'active' LIMIT 1`,
        [parsed.data.coverageZoneId],
      );
      if (zones.length === 0) {
        return NextResponse.json({ error: 'Coverage zone not found or inactive' }, { status: 404 });
      }
    }

    const instance = await createFormInstance({
      template,
      submittedByUserId: authCtx.userId,
      ownerOrganizationId: parsed.data.ownerOrganizationId ?? null,
      coverageZoneId: parsed.data.coverageZoneId ?? null,
      recipientRole: parsed.data.recipientRole ?? null,
      recipientUserId: parsed.data.recipientUserId ?? null,
      recipientOrganizationId: parsed.data.recipientOrganizationId ?? null,
      title: parsed.data.title ?? null,
      notes: parsed.data.notes ?? null,
      formData: parsed.data.formData,
      attachmentManifest: parsed.data.attachmentManifest,
    });

    return NextResponse.json({ instance }, { status: 201 });
  } catch (error) {
    await captureException(error, { feature: 'api_forms_instances_create' });
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = /require an owning organization|require a coverage zone/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: status === 500 ? 'Internal server error' : message }, { status });
  }
}
