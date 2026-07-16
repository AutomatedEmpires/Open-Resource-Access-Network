/**
 * Public provenance summaries for published services.
 *
 * Answers, from stored evidence only: where did this record come from, when
 * was its information last updated, and when did a human reviewer last approve
 * it. Absence of evidence stays absent — callers render "not recorded" states
 * instead of inferring trust from generic timestamps (see docs/DATA_MODEL.md:
 * verification states must never be inferred from confidence bands or update
 * timestamps).
 *
 * This is attribution, not authorization: rows are already seeker-visible via
 * the positive publication authority gate (services/search/publication.ts).
 * Contributor identity is never exposed — only source-system and dataset names.
 */

import type { PublicProvenanceSummary, PublicRecordOrigin } from '@/domain/types';

export interface ProvenanceDeps {
  executeQuery: <T>(sql: string, params: unknown[]) => Promise<T[]>;
}

const FEED_ORIGIN_BY_TRUST_TIER: Record<string, PublicRecordOrigin> = {
  verified_publisher: 'official_feed',
  trusted_partner: 'partner_feed',
  curated: 'curated_feed',
  community: 'community_feed',
};

/** Labels for the bulk open-data import path (created_by_user_id = 'import:<key>'). */
const IMPORT_SOURCE_LABELS: Record<string, string> = {
  hrsa: 'HRSA Health Center Program data',
  'hud-hca': 'HUD housing counseling agency data',
  'hud-pha': 'HUD public housing agency data',
  'usda-snap': 'USDA SNAP retailer data',
  samhsa: 'SAMHSA treatment locator data',
  nppes: 'CMS NPPES provider registry data',
  'irs-bmf': 'IRS tax-exempt organization data',
  headstart: 'Head Start center data',
  'college-scorecard': 'U.S. Department of Education College Scorecard data',
  hotline: 'ORAN curated national hotline list',
  opendata: 'a public open-data portal',
};

interface CanonicalAttributionRow {
  service_id: string;
  source_name: string | null;
  trust_tier: string | null;
  source_count: number | string | null;
  first_seen_at: Date | string | null;
  last_refreshed_at: Date | string | null;
}

interface ManualAttributionRow {
  service_id: string;
  source_kind: string | null;
  last_approved_at: Date | string | null;
}

interface ServiceBaseRow {
  service_id: string;
  created_by_user_id: string | null;
  updated_at: Date | string | null;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toCount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function importLabel(createdBy: string): string {
  const key = createdBy.slice('import:'.length).trim();
  return IMPORT_SOURCE_LABELS[key] ?? `a public dataset (${key || 'unrecorded'})`;
}

const CANONICAL_ATTRIBUTION_SQL = `SELECT
    cs.published_service_id::text AS service_id,
    ss.name AS source_name,
    ss.trust_tier,
    cs.source_count,
    cs.first_seen_at,
    cs.last_refreshed_at
  FROM public.canonical_services cs
  JOIN public.source_systems ss ON ss.id = cs.winning_source_system_id
  WHERE cs.published_service_id = ANY($1::uuid[])
    AND cs.publication_status = 'published'
    AND ss.family <> 'manual'
  ORDER BY cs.last_refreshed_at DESC NULLS LAST`;

const MANUAL_ATTRIBUTION_SQL = `SELECT
    snap.entity_id::text AS service_id,
    (snap.hsds_payload #>> '{meta,publicationSourceKind}') AS source_kind,
    approval.last_approved_at
  FROM public.hsds_export_snapshots snap
  JOIN public.submissions sub
    ON sub.id::text = (snap.hsds_payload #>> '{meta,sourceSubmissionId}')
   AND sub.service_id = snap.entity_id
   AND sub.status = 'approved'
  JOIN LATERAL (
    SELECT MAX(st.created_at) AS last_approved_at
    FROM public.submission_transitions st
    WHERE st.submission_id = sub.id
      AND st.to_status = 'approved'
      AND st.gates_passed IS TRUE
      AND st.actor_role IN ('community_admin', 'oran_admin')
  ) approval ON TRUE
  WHERE snap.entity_type = 'service'
    AND snap.status = 'current'
    AND snap.entity_id = ANY($1::uuid[])`;

const SERVICE_BASE_SQL = `SELECT
    s.id::text AS service_id,
    s.created_by_user_id,
    s.updated_at
  FROM public.services s
  WHERE s.id = ANY($1::uuid[])`;

/**
 * Resolve public provenance for a batch of published service ids.
 * Precedence when multiple kinds of evidence exist: canonical feed
 * attribution, then approved manual submission, then bulk import marker,
 * then 'unknown' (record exists but no origin evidence is stored).
 */
export async function getPublicProvenanceSummaries(
  deps: ProvenanceDeps,
  serviceIds: string[],
): Promise<Map<string, PublicProvenanceSummary>> {
  const summaries = new Map<string, PublicProvenanceSummary>();
  if (serviceIds.length === 0) {
    return summaries;
  }

  const [canonicalRows, manualRows, baseRows] = await Promise.all([
    deps.executeQuery<CanonicalAttributionRow>(CANONICAL_ATTRIBUTION_SQL, [serviceIds]),
    deps.executeQuery<ManualAttributionRow>(MANUAL_ATTRIBUTION_SQL, [serviceIds]),
    deps.executeQuery<ServiceBaseRow>(SERVICE_BASE_SQL, [serviceIds]),
  ]);

  const canonicalByService = new Map<string, CanonicalAttributionRow>();
  for (const row of canonicalRows) {
    // Rows arrive ordered by last_refreshed_at DESC; keep the freshest.
    if (!canonicalByService.has(row.service_id)) {
      canonicalByService.set(row.service_id, row);
    }
  }

  const manualByService = new Map<string, ManualAttributionRow>();
  for (const row of manualRows) {
    const existing = manualByService.get(row.service_id);
    const existingAt = existing ? toIso(existing.last_approved_at) : null;
    const candidateAt = toIso(row.last_approved_at);
    if (!existing || (candidateAt && (!existingAt || candidateAt > existingAt))) {
      manualByService.set(row.service_id, row);
    }
  }

  for (const base of baseRows) {
    const serviceId = base.service_id;
    const canonical = canonicalByService.get(serviceId);
    if (canonical) {
      summaries.set(serviceId, {
        serviceId,
        origin: FEED_ORIGIN_BY_TRUST_TIER[canonical.trust_tier ?? ''] ?? 'unknown',
        sourceName: canonical.source_name ?? null,
        sourceCount: toCount(canonical.source_count),
        firstSeenAt: toIso(canonical.first_seen_at),
        informationUpdatedAt: toIso(canonical.last_refreshed_at),
        lastHumanReviewAt: null,
      });
      continue;
    }

    const manual = manualByService.get(serviceId);
    if (manual) {
      const isProvider = manual.source_kind === 'host_submission';
      summaries.set(serviceId, {
        serviceId,
        origin: isProvider ? 'provider_submission' : 'community_submission',
        sourceName: isProvider
          ? 'The provider organization, through the ORAN host portal'
          : 'A community contribution reviewed by ORAN',
        sourceCount: null,
        firstSeenAt: null,
        informationUpdatedAt: toIso(manual.last_approved_at),
        lastHumanReviewAt: toIso(manual.last_approved_at),
      });
      continue;
    }

    const createdBy = base.created_by_user_id ?? '';
    if (createdBy.startsWith('import:')) {
      summaries.set(serviceId, {
        serviceId,
        origin: 'curated_import',
        sourceName: importLabel(createdBy),
        sourceCount: null,
        firstSeenAt: null,
        informationUpdatedAt: toIso(base.updated_at),
        lastHumanReviewAt: null,
      });
      continue;
    }

    summaries.set(serviceId, {
      serviceId,
      origin: 'unknown',
      sourceName: null,
      sourceCount: null,
      firstSeenAt: null,
      informationUpdatedAt: toIso(base.updated_at),
      lastHumanReviewAt: null,
    });
  }

  return summaries;
}
