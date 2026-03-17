/**
 * GET /api/host/services/export
 *
 * Returns a CSV file of service records the caller manages.
 * Supports optional ?organizationId= and ?status= filters.
 *
 * Security: identical auth scoping rules as GET /api/host/services.
 * PII caution: email addresses are included — response is not cached
 * and is streamed directly to the authenticated caller only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext, shouldEnforceAuth, isOranAdmin } from '@/services/auth';
import { getIp } from '@/services/security/ip';
import {
  RATE_LIMIT_WINDOW_MS,
  HOST_READ_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

// ============================================================
// SCHEMA
// ============================================================

const ExportParamsSchema = z.object({
  organizationId: z.string().uuid().optional(),
  status: z.enum(['active', 'inactive', 'defunct']).optional(),
});

// ============================================================
// HELPERS
// ============================================================
/** Escape a single CSV cell value */
function csvCell(value: string | null | undefined): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Convert an array of objects to a CSV string */
function toCsv(
  rows: Record<string, string | null | undefined>[],
  columns: string[],
): string {
  const header = columns.map(csvCell).join(',');
  const lines = rows.map((row) =>
    columns.map((col) => csvCell(row[col])).join(',')
  );
  return [header, ...lines].join('\r\n');
}

// ============================================================
// HANDLER
// ============================================================

export async function GET(req: NextRequest): Promise<NextResponse> {
  // --- rate limit ---
  const ip = getIp(req);
  const rl = checkRateLimit(`export-services:${ip}`, { maxRequests: HOST_READ_RATE_LIMIT_MAX_REQUESTS, windowMs: RATE_LIMIT_WINDOW_MS });
  if (rl.exceeded) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  // --- auth ---
  const authCtx = await getAuthContext();
  if (shouldEnforceAuth() && !authCtx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  // --- parse params ---
  const { searchParams } = req.nextUrl;
  const rawParams = Object.fromEntries(searchParams.entries());
  const parsed = ExportParamsSchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 });
  }
  const { organizationId, status } = parsed.data;

  try {
    const admin = authCtx ? isOranAdmin(authCtx) : false;
    const userId = authCtx?.userId;

    // Build WHERE clauses — identical scoping as list endpoint
    const conditions: string[] = [];
    const params: (string | undefined)[] = [];
    let paramIdx = 1;

    if (!admin && userId) {
      conditions.push(`s.organization_id IN (
        SELECT om.organization_id FROM org_members om WHERE om.user_id = $${paramIdx++} AND om.status = 'active'
      )`);
      params.push(userId);
    }
    if (organizationId) {
      conditions.push(`s.organization_id = $${paramIdx++}`);
      params.push(organizationId);
    }
    if (status) {
      conditions.push(`s.status = $${paramIdx++}`);
      params.push(status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await executeQuery<{
      id: string;
      name: string;
      description: string | null;
      status: string;
      url: string | null;
      email: string | null;
      fees: string | null;
      wait_time: string | null;
      organization_name: string | null;
      organization_id: string;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT
         s.id,
         s.name,
         s.description,
         s.status,
         s.url,
         s.email,
         s.fees,
         s.wait_time,
         s.organization_id,
         o.name AS organization_name,
         s.created_at::text,
         s.updated_at::text
       FROM services s
       LEFT JOIN organizations o ON o.id = s.organization_id
       ${whereClause}
       ORDER BY s.updated_at DESC
       LIMIT 5000`,
      params.filter(Boolean) as string[],
    );

    const COLUMNS = [
      'id',
      'organization_name',
      'organization_id',
      'name',
      'status',
      'description',
      'url',
      'email',
      'fees',
      'wait_time',
      'created_at',
      'updated_at',
    ] as const;

    type ExportRow = typeof result[number];

    const rows: Record<string, string | null | undefined>[] = result.map(
      (row: ExportRow) => Object.fromEntries(
        COLUMNS.map((col) => [col, row[col as keyof ExportRow] as string | null | undefined])
      )
    );

    const csv = toCsv(rows, [...COLUMNS]);

    const filename = `services-export-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    captureException(err);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
