import type { PoolClient } from 'pg';

export type PublicationSourceKind =
  | 'host_submission'
  | 'community_review'
  | 'canonical_feed'
  | 'candidate_allowlisted'
  | 'unknown';

export interface CurrentPublicationAuthority {
  sourceKind: PublicationSourceKind;
  sourceRank: number;
  generatedAt: string | null;
  payload: Record<string, unknown>;
}

export interface PublicationOverwriteDecision {
  shouldOverwrite: boolean;
  current: CurrentPublicationAuthority | null;
  reason: string;
}

const SOURCE_RANK: Record<PublicationSourceKind, number> = {
  host_submission: 100,
  community_review: 90,
  canonical_feed: 80,
  candidate_allowlisted: 70,
  unknown: 50,
};

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function getPublicationSourceRank(sourceKind: PublicationSourceKind): number {
  return SOURCE_RANK[sourceKind];
}

export function inferPublicationSourceKind(payload: Record<string, unknown>): PublicationSourceKind {
  const meta = readObject(payload.meta);
  const explicit = meta.publicationSourceKind;
  if (explicit === 'host_submission' || explicit === 'community_review' || explicit === 'canonical_feed' || explicit === 'candidate_allowlisted') {
    return explicit;
  }

  const generatedBy = meta.generatedBy;
  if (generatedBy === 'oran-resource-submission-projection') {
    return meta.channel === 'host' ? 'host_submission' : 'community_review';
  }
  if (generatedBy === 'oran-promote-to-live') {
    return 'canonical_feed';
  }
  if (generatedBy === 'oran-ingestion-publish') {
    return 'candidate_allowlisted';
  }
  return 'unknown';
}

export async function getCurrentPublicationAuthority(
  client: Pick<PoolClient, 'query'>,
  serviceId: string,
): Promise<CurrentPublicationAuthority | null> {
  const rows = await client.query<{ hsds_payload: Record<string, unknown>; generated_at: string }>(
    `SELECT hsds_payload, generated_at
       FROM hsds_export_snapshots
      WHERE entity_type = 'service'
        AND entity_id = $1
        AND status = 'current'
      ORDER BY generated_at DESC
      LIMIT 1`,
    [serviceId],
  );

  const row = rows.rows[0];
  if (!row) {
    return null;
  }

  const payload = readObject(row.hsds_payload);
  const sourceKind = inferPublicationSourceKind(payload);
  return {
    sourceKind,
    sourceRank: getPublicationSourceRank(sourceKind),
    generatedAt: row.generated_at ?? null,
    payload,
  };
}

export async function decidePublicationOverwrite(
  client: Pick<PoolClient, 'query'>,
  serviceId: string,
  incomingSourceKind: PublicationSourceKind,
): Promise<PublicationOverwriteDecision> {
  const current = await getCurrentPublicationAuthority(client, serviceId);
  if (!current) {
    return {
      shouldOverwrite: true,
      current: null,
      reason: 'no current live snapshot',
    };
  }

  const incomingRank = getPublicationSourceRank(incomingSourceKind);
  if (incomingRank >= current.sourceRank) {
    return {
      shouldOverwrite: true,
      current,
      reason: `incoming ${incomingSourceKind} rank ${incomingRank} >= current ${current.sourceKind} rank ${current.sourceRank}`,
    };
  }

  return {
    shouldOverwrite: false,
    current,
    reason: `incoming ${incomingSourceKind} rank ${incomingRank} < current ${current.sourceKind} rank ${current.sourceRank}`,
  };
}
