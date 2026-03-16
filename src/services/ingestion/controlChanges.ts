import crypto from 'node:crypto';

import { executeQuery, withTransaction } from '@/services/db/postgres';
import { advance } from '@/services/workflow/engine';
import { createIngestionStores } from '@/agents/ingestion/persistence/storeFactory';
import { getDrizzle } from '@/services/db/drizzle';

type ControlChangeTargetType = 'source' | 'source_system' | 'source_feed';
type ControlChangeAction = 'update' | 'deactivate';

interface BaseControlChangePayload {
  entityType: ControlChangeTargetType;
  action: ControlChangeAction;
  entityId: string;
  entityLabel: string;
  summary: string;
  beforeState: Record<string, unknown> | null;
}

export interface SourceControlChangePayload extends BaseControlChangePayload {
  entityType: 'source';
  action: 'update' | 'deactivate';
  nextState?: Record<string, unknown>;
}

export interface SourceSystemControlChangePayload extends BaseControlChangePayload {
  entityType: 'source_system';
  action: 'update' | 'deactivate';
  patch?: Record<string, unknown>;
}

export interface SourceFeedControlChangePayload extends BaseControlChangePayload {
  entityType: 'source_feed';
  action: 'update' | 'deactivate';
  feedPatch?: Record<string, unknown>;
  nextState?: Record<string, unknown> | null;
}

export type IngestionControlChangePayload =
  | SourceControlChangePayload
  | SourceSystemControlChangePayload
  | SourceFeedControlChangePayload;

export interface QueueIngestionControlChangeInput {
  submittedByUserId: string;
  actorRole: string;
  targetId: string;
  title: string;
  summary: string;
  payload: IngestionControlChangePayload;
}

export interface PendingIngestionControlChangeRow {
  id: string;
  status: string;
  target_id: string | null;
  title: string | null;
  notes: string | null;
  payload: IngestionControlChangePayload;
  submitted_by_user_id: string;
  reviewer_notes: string | null;
  created_at: string;
  updated_at: string;
}

export function isHighRiskSourceUpdate(
  existing: { trustLevel?: string | null },
  patch: { trustLevel?: string },
): boolean {
  return patch.trustLevel !== undefined && patch.trustLevel !== existing.trustLevel;
}

export function isHighRiskSourceSystemUpdate(
  existing: { trustTier?: string | null },
  patch: { trustTier?: string },
): boolean {
  return patch.trustTier !== undefined && patch.trustTier !== existing.trustTier;
}

export function isHighRiskSourceFeedUpdate(
  patch: { state?: { publicationMode?: string; autoPublishApproved?: boolean } },
): boolean {
  return patch.state?.publicationMode === 'auto_publish' || patch.state?.autoPublishApproved === true;
}

export async function queueIngestionControlChange(
  input: QueueIngestionControlChangeInput,
): Promise<{ submissionId: string }> {
  return withTransaction(async (client) => {
    const submissionId = crypto.randomUUID();
    const metadata = {
      approvalType: 'ingestion_control_change',
      entityType: input.payload.entityType,
      action: input.payload.action,
    };

    await client.query(
      `INSERT INTO submissions
         (id, submission_type, status, target_type, target_id, submitted_by_user_id,
          title, notes, payload, priority, submitted_at)
       VALUES ($1, 'ingestion_control_change', 'pending_second_approval', 'system', $2, $3,
               $4, $5, $6::jsonb, 3, NOW())`,
      [
        submissionId,
        input.targetId,
        input.submittedByUserId,
        input.title,
        input.summary,
        JSON.stringify(input.payload),
      ],
    );

    await client.query(
      `INSERT INTO submission_transitions
         (submission_id, from_status, to_status, actor_user_id, actor_role,
          reason, gates_checked, gates_passed, metadata)
       VALUES ($1, 'draft', 'pending_second_approval', $2, $3,
               $4, '["two_person_approval"]'::jsonb, true, $5::jsonb)`,
      [
        submissionId,
        input.submittedByUserId,
        input.actorRole,
        input.summary,
        JSON.stringify(metadata),
      ],
    );

    await client.query(
      `INSERT INTO notification_events
         (recipient_user_id, event_type, title, body, resource_type, resource_id, action_url, idempotency_key)
       SELECT up.user_id,
              'two_person_approval_needed',
              $2,
              $3,
              'submission',
              $1,
              '/queue?status=pending_second_approval',
              'ingestion_control_change_' || $1 || '_' || up.user_id
       FROM user_profiles up
       WHERE up.role = 'oran_admin'
         AND up.user_id != $4
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [submissionId, input.title, input.summary, input.submittedByUserId],
    );

    return { submissionId };
  });
}

export async function listPendingIngestionControlChanges(status?: string): Promise<PendingIngestionControlChangeRow[]> {
  const params: unknown[] = [];
  let where = `WHERE submission_type = 'ingestion_control_change'`;

  if (status) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }

  return executeQuery<PendingIngestionControlChangeRow>(
    `SELECT id, status, target_id, title, notes, payload, submitted_by_user_id, reviewer_notes, created_at, updated_at
     FROM submissions
     ${where}
     ORDER BY created_at ASC`,
    params,
  );
}

export async function applyApprovedIngestionControlChange(submissionId: string): Promise<void> {
  const rows = await executeQuery<{ payload: IngestionControlChangePayload }>(
    `SELECT payload
     FROM submissions
     WHERE id = $1
       AND submission_type = 'ingestion_control_change'`,
    [submissionId],
  );

  const payload = rows[0]?.payload;
  if (!payload) {
    throw new Error(`Ingestion control change submission ${submissionId} not found`);
  }

  const stores = createIngestionStores(getDrizzle());

  if (payload.entityType === 'source') {
    if (payload.action === 'deactivate') {
      await stores.sourceRegistry.deactivate(payload.entityId);
      return;
    }

    if (!payload.nextState) {
      throw new Error(`Ingestion control change ${submissionId} is missing nextState`);
    }

    await stores.sourceRegistry.upsert(payload.nextState as never);
    return;
  }

  if (payload.entityType === 'source_system') {
    if (payload.action === 'deactivate') {
      await stores.sourceSystems.deactivate(payload.entityId);
      return;
    }

    await stores.sourceSystems.update(payload.entityId, (payload.patch ?? {}) as never);
    return;
  }

  if (payload.action === 'deactivate') {
    await stores.sourceFeeds.deactivate(payload.entityId);
    return;
  }

  if (payload.feedPatch && Object.keys(payload.feedPatch).length > 0) {
    await stores.sourceFeeds.update(payload.entityId, payload.feedPatch as never);
  }
  if (payload.nextState) {
    await stores.sourceFeedStates.upsert(payload.nextState as never);
  }
}

export async function decideIngestionControlChange(input: {
  submissionId: string;
  actorUserId: string;
  actorRole: string;
  decision: 'approved' | 'denied';
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  if (input.notes) {
    await executeQuery(
      `UPDATE submissions
       SET reviewer_notes = $1, updated_at = NOW()
       WHERE id = $2`,
      [input.notes, input.submissionId],
    );
  }

  const result = await advance({
    submissionId: input.submissionId,
    toStatus: input.decision,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    reason: input.notes ?? `Ingestion control change ${input.decision}`,
  });

  if (!result.success) {
    return { success: false, error: result.error };
  }

  if (input.decision === 'approved') {
    await applyApprovedIngestionControlChange(input.submissionId);
  }

  return { success: true };
}
