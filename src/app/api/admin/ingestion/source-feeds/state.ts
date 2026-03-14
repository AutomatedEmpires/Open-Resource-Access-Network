import { z } from 'zod';

import type { NewSourceFeedStateRow, SourceFeedStateRow } from '@/db/schema';

export const SourceFeedStatePatchSchema = z.object({
  publicationMode: z.enum(['canonical_only', 'review_required', 'auto_publish']).optional(),
  autoPublishApproved: z.boolean().optional(),
  emergencyPause: z.boolean().optional(),
  includedDataOwners: z.array(z.string().min(1)).optional(),
  excludedDataOwners: z.array(z.string().min(1)).optional(),
  maxOrganizationsPerPoll: z.number().int().min(1).max(1000).nullable().optional(),
  replayFromCursor: z.string().min(1).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
}).strict();

interface MergeSourceFeedStateOptions {
  actorId?: string | null;
  now?: Date;
}

export function mergeSourceFeedState(
  sourceFeedId: string,
  existingState: SourceFeedStateRow | null,
  patch: z.infer<typeof SourceFeedStatePatchSchema>,
  options: MergeSourceFeedStateOptions = {},
): NewSourceFeedStateRow {
  const publicationMode = patch.publicationMode ?? existingState?.publicationMode ?? 'review_required';
  const shouldInvalidateApproval =
    patch.autoPublishApproved === false
    || publicationMode !== 'auto_publish'
    || patch.includedDataOwners !== undefined
    || patch.excludedDataOwners !== undefined
    || patch.maxOrganizationsPerPoll !== undefined;

  let autoPublishApprovedAt = existingState?.autoPublishApprovedAt ?? null;
  let autoPublishApprovedBy = existingState?.autoPublishApprovedBy ?? null;

  if (shouldInvalidateApproval) {
    autoPublishApprovedAt = null;
    autoPublishApprovedBy = null;
  } else if (patch.autoPublishApproved === true) {
    autoPublishApprovedAt = existingState?.autoPublishApprovedAt ?? options.now ?? new Date();
    autoPublishApprovedBy = existingState?.autoPublishApprovedBy ?? options.actorId ?? 'unknown';
  }

  return {
    sourceFeedId,
    publicationMode,
    autoPublishApprovedAt,
    autoPublishApprovedBy,
    emergencyPause: patch.emergencyPause ?? existingState?.emergencyPause ?? false,
    includedDataOwners: patch.includedDataOwners ?? existingState?.includedDataOwners ?? [],
    excludedDataOwners: patch.excludedDataOwners ?? existingState?.excludedDataOwners ?? [],
    maxOrganizationsPerPoll:
      patch.maxOrganizationsPerPoll === undefined
        ? (existingState?.maxOrganizationsPerPoll ?? null)
        : patch.maxOrganizationsPerPoll,
    checkpointCursor: existingState?.checkpointCursor ?? null,
    replayFromCursor:
      patch.replayFromCursor === undefined
        ? (existingState?.replayFromCursor ?? null)
        : patch.replayFromCursor,
    lastAttemptStatus: existingState?.lastAttemptStatus ?? 'idle',
    lastAttemptStartedAt: existingState?.lastAttemptStartedAt ?? null,
    lastAttemptCompletedAt: existingState?.lastAttemptCompletedAt ?? null,
    lastSuccessfulSyncStartedAt: existingState?.lastSuccessfulSyncStartedAt ?? null,
    lastSuccessfulSyncCompletedAt: existingState?.lastSuccessfulSyncCompletedAt ?? null,
    lastAttemptSummary: existingState?.lastAttemptSummary ?? {},
    notes: patch.notes === undefined ? (existingState?.notes ?? null) : patch.notes,
  };
}
