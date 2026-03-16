import type { PoolClient } from 'pg';

import { clamp0to100, getConfidenceTier, type ConfidenceTier } from '@/domain/confidence';

export const HSDS_PROFILE_URI = 'https://openreferral.org/imls/hsds/';

const REVERIFY_BY_DAYS: Record<ConfidenceTier, number> = {
  green: 90,
  yellow: 45,
  orange: 14,
  red: 7,
};

export interface PublicationLifecycleWindow {
  confidenceScore: number;
  confidenceTier: ConfidenceTier;
  lastVerifiedAt: string;
  reverifyAt: string;
}

export interface UpsertConfidenceScoreInput {
  serviceId: string;
  score: number;
  verificationConfidence?: number;
  eligibilityMatch?: number;
  constraintFit?: number;
}

export interface ReplaceCurrentSnapshotInput {
  entityType: 'service';
  entityId: string;
  hsdsPayload: Record<string, unknown>;
  profileUri?: string;
  replaceCurrent?: boolean;
}

export interface AppendLifecycleEventInput {
  entityType: 'service';
  entityId: string;
  eventType: string;
  fromStatus: string;
  toStatus: string;
  actorType: 'system' | 'service_principal' | 'human';
  actorId: string;
  metadata: Record<string, unknown>;
  identifiersAffected?: number;
  snapshotsInvalidated?: number;
}

export function buildPublicationLifecycleWindow(
  score: number,
  now: Date = new Date(),
): PublicationLifecycleWindow {
  const confidenceScore = clamp0to100(score);
  const confidenceTier = getConfidenceTier(confidenceScore);
  const lastVerifiedAt = now.toISOString();
  const reverifyAt = new Date(
    now.getTime() + REVERIFY_BY_DAYS[confidenceTier] * 24 * 60 * 60 * 1000,
  ).toISOString();

  return {
    confidenceScore,
    confidenceTier,
    lastVerifiedAt,
    reverifyAt,
  };
}

export async function upsertConfidenceScore(
  client: Pick<PoolClient, 'query'>,
  input: UpsertConfidenceScoreInput,
): Promise<void> {
  const score = clamp0to100(input.score);
  const verificationConfidence = clamp0to100(input.verificationConfidence ?? score);
  const eligibilityMatch = clamp0to100(input.eligibilityMatch ?? 0);
  const constraintFit = clamp0to100(input.constraintFit ?? 0);

  await client.query(
    `INSERT INTO confidence_scores
       (service_id, score, verification_confidence, eligibility_match,
        constraint_fit, computed_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (service_id) DO UPDATE
       SET score = EXCLUDED.score,
           verification_confidence = EXCLUDED.verification_confidence,
           eligibility_match = EXCLUDED.eligibility_match,
           constraint_fit = EXCLUDED.constraint_fit,
           computed_at = NOW()`,
    [input.serviceId, score, verificationConfidence, eligibilityMatch, constraintFit],
  );
}

export async function replaceCurrentSnapshot(
  client: Pick<PoolClient, 'query'>,
  input: ReplaceCurrentSnapshotInput,
): Promise<number> {
  if (input.replaceCurrent) {
    await client.query(
      `UPDATE hsds_export_snapshots
       SET status = 'superseded', withdrawn_at = NOW()
       WHERE entity_type = $1 AND entity_id = $2 AND status = 'current'`,
      [input.entityType, input.entityId],
    );
  }

  const versionResult = await client.query<{ next_version: number }>(
    `SELECT COALESCE(MAX(snapshot_version), 0) + 1 AS next_version
     FROM hsds_export_snapshots
     WHERE entity_type = $1 AND entity_id = $2`,
    [input.entityType, input.entityId],
  );
  const nextVersion = versionResult.rows[0]?.next_version ?? 1;

  await client.query(
    `INSERT INTO hsds_export_snapshots
       (entity_type, entity_id, snapshot_version, hsds_payload,
        profile_uri, status, generated_at, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, 'current', NOW(), NOW())`,
    [
      input.entityType,
      input.entityId,
      nextVersion,
      JSON.stringify(input.hsdsPayload),
      input.profileUri ?? HSDS_PROFILE_URI,
    ],
  );

  return nextVersion;
}

export async function appendLifecycleEvent(
  client: Pick<PoolClient, 'query'>,
  input: AppendLifecycleEventInput,
): Promise<void> {
  await client.query(
    `INSERT INTO lifecycle_events
       (entity_type, entity_id, event_type, from_status, to_status,
        actor_type, actor_id, metadata, identifiers_affected,
        snapshots_invalidated, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, NOW())`,
    [
      input.entityType,
      input.entityId,
      input.eventType,
      input.fromStatus,
      input.toStatus,
      input.actorType,
      input.actorId,
      JSON.stringify(input.metadata),
      input.identifiersAffected ?? 1,
      input.snapshotsInvalidated ?? 0,
    ],
  );
}
