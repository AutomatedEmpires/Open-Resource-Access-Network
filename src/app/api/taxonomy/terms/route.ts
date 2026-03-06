/**
 * GET /api/taxonomy/terms
 *
 * Returns taxonomy terms from stored records (Postgres) for UI filtering.
 *
 * NOTE: This endpoint is intentionally read-only and retrieval-first.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { captureException } from '@/services/telemetry/sentry';

const ParamsSchema = z.object({
  q: z.string().max(200).optional(),
  taxonomy: z.string().max(100).optional(),
  parentId: z.string().uuid().optional(),
  /** Defaults to true; when true, only returns terms used by active services. */
  onlyUsed: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(250),
});

type TaxonomyTermRow = {
  id: string;
  term: string;
  description: string | null;
  parent_id: string | null;
  taxonomy: string | null;
  service_count: string | number | null;
};

export type TaxonomyTermDTO = {
  id: string;
  term: string;
  description: string | null;
  parentId: string | null;
  taxonomy: string | null;
  serviceCount: number;
};

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'Taxonomy is temporarily unavailable (database not configured).' },
      { status: 503 }
    );
  }

  const rawParams: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((value, key) => {
    rawParams[key] = value;
  });

  const parsed = ParamsSchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query parameters', details: parsed.error.issues },
      { status: 400 }
    );
  }

  const { q, taxonomy, parentId, onlyUsed, limit } = parsed.data;
  const onlyUsedBool = onlyUsed !== 'false';

  const sql = `
    SELECT
      t.id,
      t.term,
      t.description,
      t.parent_id,
      t.taxonomy,
      COUNT(DISTINCT st.service_id) AS service_count
    FROM taxonomy_terms t
    LEFT JOIN service_taxonomy st
      ON st.taxonomy_term_id = t.id
    LEFT JOIN services s
      ON s.id = st.service_id
      AND s.status = 'active'
    WHERE 1=1
      AND ($1::text IS NULL OR t.term ILIKE '%' || $1 || '%')
      AND ($2::text IS NULL OR t.taxonomy = $2)
      AND ($3::uuid IS NULL OR t.parent_id = $3)
    GROUP BY t.id
    ${onlyUsedBool ? 'HAVING COUNT(DISTINCT st.service_id) > 0' : ''}
    ORDER BY COUNT(DISTINCT st.service_id) DESC, t.term ASC
    LIMIT $4;
  `;

  try {
    const rows = await executeQuery<TaxonomyTermRow>(sql, [q ?? null, taxonomy ?? null, parentId ?? null, limit]);
    const terms: TaxonomyTermDTO[] = rows.map((r) => ({
      id: r.id,
      term: r.term,
      description: r.description,
      parentId: r.parent_id,
      taxonomy: r.taxonomy,
      serviceCount:
        typeof r.service_count === 'number'
          ? r.service_count
          : Number.parseInt(String(r.service_count ?? '0'), 10) || 0,
    }));

    return NextResponse.json(
      { terms },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      }
    );
  } catch (error) {
    await captureException(error, { feature: 'api_taxonomy_terms' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
