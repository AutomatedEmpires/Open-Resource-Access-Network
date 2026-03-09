import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { listAccessibleFormInstances } from '@/services/forms/vault';
import {
  HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from '@/domain/constants';
import { generateFormReference } from '@/domain/forms';

/**
 * GET /api/forms/instances/export
 *
 * Exports accessible form instances as CSV or JSON.
 * Query params:
 *   format=csv|json (default csv)
 *   status=<filter>
 *   templateId=<filter>
 *   limit=<max 500>
 *
 * Available to community_admin+ roles.
 */
export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!requireMinRole(ctx, 'community_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const rl = checkRateLimit(`forms_export:${ctx.userId}`, {
    maxRequests: HOST_READ_RATE_LIMIT_MAX_REQUESTS,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const { searchParams } = req.nextUrl;
  const format = searchParams.get('format') === 'json' ? 'json' : 'csv';
  const status = searchParams.get('status') ?? undefined;
  const templateId = searchParams.get('templateId') ?? undefined;
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '500', 10) || 500, 500);

  try {
    const result = await listAccessibleFormInstances(ctx, {
      status,
      templateId,
      limit,
      offset: 0,
    });

    if (format === 'json') {
      return new NextResponse(JSON.stringify(result.instances, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="form-instances-${Date.now()}.json"`,
        },
      });
    }

    // CSV format
    const headers = [
      'reference', 'title', 'template', 'status', 'priority',
      'submitted_by', 'submitted_at', 'updated_at',
      'sla_deadline', 'sla_breached', 'recipient_role',
      'assigned_to', 'storage_scope',
    ];
    const rows = result.instances.map((i) => [
      generateFormReference(i.submission_id),
      csvEscape(i.title ?? i.template_title),
      csvEscape(i.template_title),
      i.status,
      String(i.priority),
      i.submitted_by_user_id,
      i.submitted_at ?? '',
      i.updated_at ?? '',
      i.sla_deadline ?? '',
      String(i.sla_breached ?? false),
      i.recipient_role ?? '',
      i.assigned_to_user_id ?? '',
      i.storage_scope,
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="form-instances-${Date.now()}.csv"`,
      },
    });
  } catch (error) {
    await captureException(error, { feature: 'api_forms_export' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
