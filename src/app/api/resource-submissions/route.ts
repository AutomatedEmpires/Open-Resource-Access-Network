import crypto from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAuthContext } from '@/services/auth/session';
import { requireMinRole, requireOrgAccess } from '@/services/auth/guards';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { isDatabaseConfigured } from '@/services/db/postgres';
import {
  createResourceSubmission,
  listAccessibleResourceSubmissions,
  setResourceSubmissionPublicAccessToken,
  type ResourceSubmissionDetail,
} from '@/services/resourceSubmissions/service';
import {
  RESOURCE_SUBMISSION_CHANNELS,
  RESOURCE_SUBMISSION_VARIANTS,
  computeResourceSubmissionCards,
  normalizeResourceSubmissionDraft,
} from '@/domain/resourceSubmission';
import {
  HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from '@/domain/constants';

const ListQuerySchema = z.object({
  status: z.string().min(1).max(60).optional(),
});

const CreateResourceSubmissionSchema = z.object({
  variant: z.enum(RESOURCE_SUBMISSION_VARIANTS),
  channel: z.enum(RESOURCE_SUBMISSION_CHANNELS),
  ownerOrganizationId: z.string().uuid().nullable().optional(),
  existingServiceId: z.string().uuid().nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  draft: z.unknown().optional(),
}).superRefine((value, ctx) => {
  if (value.variant === 'claim' && value.channel !== 'host') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['channel'],
      message: 'Organization claims are only available in the host workspace.',
    });
  }
});

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

function buildAnonymousUserId(ip: string): string {
  return `anon_${crypto.createHash('sha256').update(ip).digest('hex').slice(0, 24)}`;
}

function buildListItem(detail: ResourceSubmissionDetail) {
  return {
    id: detail.instance.id,
    submissionId: detail.instance.submission_id,
    status: detail.instance.status,
    submissionType: detail.instance.submission_type,
    channel: detail.draft.channel,
    variant: detail.draft.variant,
    title: detail.instance.title,
    updatedAt: detail.instance.updated_at,
    submittedAt: detail.instance.submitted_at,
    ownerOrganizationId: detail.instance.owner_organization_id,
    cards: detail.cards,
    summary: {
      organizationName: detail.draft.organization.name,
      serviceName: detail.draft.service.name,
      sourceName: detail.draft.evidence.sourceName,
    },
    reviewMeta: detail.reviewMeta,
  };
}

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`resource-submissions:read:${ip}`, {
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

  const parsed = ListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const instances = await listAccessibleResourceSubmissions(authCtx);
    const details = instances
      .filter((instance) => (parsed.data.status ? instance.status === parsed.data.status : true))
      .map((instance) => {
        const draft = normalizeResourceSubmissionDraft(
          (instance.form_data as Record<string, unknown>)?.draft,
          instance.template_slug.includes('claim') ? 'claim' : 'listing',
          instance.template_slug.includes('public') ? 'public' : 'host',
        );

        return buildListItem({
          instance,
          draft,
          cards: computeResourceSubmissionCards(draft),
          reviewMeta: {
            submissionId: instance.submission_id,
            status: instance.status,
            submissionType: instance.submission_type,
            targetType: instance.target_type,
            targetId: instance.target_id,
            submittedByUserId: instance.submitted_by_user_id,
            submittedByLabel: null,
            assignedToUserId: instance.assigned_to_user_id,
            assignedToLabel: null,
            reviewedAt: instance.reviewed_at,
            resolvedAt: instance.resolved_at,
            submittedAt: instance.submitted_at,
            slaDeadline: instance.sla_deadline,
            confidenceScore: null,
            verificationConfidence: null,
            reverifyAt: null,
            reviewerNotes: instance.reviewer_notes,
            sourceRecordId: null,
          },
          transitions: [],
        });
      });

    return NextResponse.json({ results: details }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    await captureException(error, { feature: 'api_resource_submissions_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`resource-submissions:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CreateResourceSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const authCtx = await getAuthContext();
  const { variant, channel, ownerOrganizationId, existingServiceId, title, notes, draft } = parsed.data;

  if (channel === 'host' || variant === 'claim' || ownerOrganizationId || existingServiceId) {
    if (!authCtx || !requireMinRole(authCtx, 'host_member')) {
      return NextResponse.json({ error: 'Host authentication required.' }, { status: 401 });
    }
  }

  if (ownerOrganizationId && authCtx && !requireOrgAccess(authCtx, ownerOrganizationId)) {
    return NextResponse.json({ error: 'Access denied to organization scope.' }, { status: 403 });
  }

  try {
    const submittedByUserId = authCtx?.userId ?? buildAnonymousUserId(ip);
    const detail = await createResourceSubmission({
      variant,
      channel,
      submittedByUserId,
      actorRole: authCtx?.role ?? 'seeker',
      ownerOrganizationId: ownerOrganizationId ?? null,
      existingServiceId: existingServiceId ?? null,
      title: title ?? null,
      notes: notes ?? null,
      draft,
    });

    let publicAccessToken: string | null = null;
    if (!authCtx && channel === 'public') {
      publicAccessToken = crypto.randomBytes(24).toString('hex');
      await setResourceSubmissionPublicAccessToken(detail.instance.submission_id, publicAccessToken);
    }

    return NextResponse.json(
      {
        detail,
        publicAccessToken,
      },
      { status: 201 },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_resource_submissions_create' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
