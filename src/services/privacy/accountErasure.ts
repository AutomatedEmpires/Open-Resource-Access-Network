import { randomUUID } from 'node:crypto';

import { clerkClient } from '@clerk/nextjs/server';

import { executeQuery } from '@/services/db/postgres';

interface QueueRow {
  request_id: string;
  request_status: 'pending' | 'processing' | 'blocked' | 'completed';
}

export interface QueuedAccountErasure {
  requestId: string;
  status: QueueRow['request_status'];
  userId: string;
  clerkUserId: string;
  clerkDeleted?: boolean;
}

interface ClaimedRow {
  request_id: string;
  user_id: string;
  clerk_user_id: string;
  clerk_deleted: boolean;
}

export interface AccountErasureProcessingResult {
  completed: boolean;
  requestId: string;
  status: 'pending' | 'processing' | 'blocked' | 'completed';
  accessRevoked: true;
  identityProviderDeleted: boolean;
  nextStep: 'identity_provider_deletion' | 'secure_data_erasure' | 'operator_review' | null;
}

export interface AccountErasureBatchResult extends AccountErasureProcessingResult {
  pagesProcessed: number;
}

interface PageRow {
  request_status: 'pending' | 'processing' | 'blocked' | 'completed';
  clerk_deleted: boolean;
  completed: boolean;
  next_step: string | null;
}

function isClerkNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    errors?: Array<{ code?: unknown }>;
  };
  if (candidate.status === 404 || candidate.statusCode === 404) return true;
  return candidate.errors?.some((entry) => (
    entry.code === 'resource_not_found' || entry.code === 'user_not_found'
  )) ?? false;
}

async function deleteClerkUser(clerkUserId: string): Promise<void> {
  try {
    const client = await clerkClient();
    await client.users.deleteUser(clerkUserId);
  } catch (error) {
    // A retry after Clerk succeeded but the database completion transaction
    // failed sees a 404. Treat that state as the desired external outcome.
    if (!isClerkNotFound(error)) throw error;
  }
}

export async function queueAccountErasure(
  userId: string,
  clerkUserId: string,
): Promise<QueuedAccountErasure> {
  const textTombstone = `deleted-user:${randomUUID()}`;
  const uuidTombstone = randomUUID();
  const rows = await executeQuery<QueueRow>(
    `SELECT request_id, request_status
       FROM oran_internal.queue_account_erasure(
         $1::text,
         $2::text,
         $3::text,
         $4::uuid
       )`,
    [userId, clerkUserId, textTombstone, uuidTombstone],
  );
  const row = rows[0];
  if (!row?.request_id
      || !['pending', 'processing', 'blocked', 'completed'].includes(row.request_status)) {
    throw new Error('Account erasure queue returned an invalid result');
  }
  return {
    requestId: row.request_id,
    status: row.request_status,
    userId,
    clerkUserId,
  };
}

async function recordFailure(requestId: string, errorCode: string): Promise<void> {
  await executeQuery(
    `SELECT oran_internal.record_account_erasure_failure($1::uuid, $2::text)`,
    [requestId, errorCode],
  );
}

function publicNextStep(
  status: PageRow['request_status'],
  identityProviderDeleted: boolean,
): AccountErasureProcessingResult['nextStep'] {
  if (status === 'completed') return null;
  if (status === 'blocked') return 'operator_review';
  return identityProviderDeleted ? 'secure_data_erasure' : 'identity_provider_deletion';
}

export async function processAccountErasure(
  request: Pick<
    QueuedAccountErasure,
    'requestId' | 'userId' | 'clerkUserId' | 'status' | 'clerkDeleted'
  >,
): Promise<AccountErasureProcessingResult> {
  if (request.status === 'completed') {
    return {
      completed: true,
      requestId: request.requestId,
      status: 'completed',
      accessRevoked: true,
      identityProviderDeleted: true,
      nextStep: null,
    };
  }

  let identityProviderDeleted = request.clerkDeleted === true;
  if (!identityProviderDeleted) {
    try {
      await deleteClerkUser(request.clerkUserId);
      identityProviderDeleted = true;
    } catch {
      await recordFailure(request.requestId, 'clerk_delete_failed');
      return {
        completed: false,
        requestId: request.requestId,
        status: 'pending',
        accessRevoked: true,
        identityProviderDeleted: false,
        nextStep: 'identity_provider_deletion',
      };
    }

    try {
      await executeQuery(
        `SELECT oran_internal.mark_clerk_account_deleted(
         $1::uuid,
         $2::text,
         $3::text
       )`,
        [request.requestId, request.userId, request.clerkUserId],
      );
    } catch {
      await recordFailure(request.requestId, 'clerk_delete_record_failed');
      return {
        completed: false,
        requestId: request.requestId,
        status: 'pending',
        accessRevoked: true,
        identityProviderDeleted: true,
        nextStep: 'secure_data_erasure',
      };
    }
  }

  try {
    const rows = await executeQuery<PageRow>(
      `SELECT request_status, clerk_deleted, completed, next_step
         FROM oran_internal.process_account_erasure_page(
           $1::uuid,
           $2::integer
         )`,
      [request.requestId, 1000],
    );
    const row = rows[0];
    if (!row || !['pending', 'processing', 'blocked', 'completed'].includes(
      row.request_status,
    )) {
      throw new Error('Account erasure page returned an invalid result');
    }
    return {
      completed: row.completed,
      requestId: request.requestId,
      status: row.request_status,
      accessRevoked: true,
      identityProviderDeleted: row.clerk_deleted,
      nextStep: publicNextStep(row.request_status, row.clerk_deleted),
    };
  } catch {
    await recordFailure(request.requestId, 'database_erasure_page_failed');
    return {
      completed: false,
      requestId: request.requestId,
      status: 'processing',
      accessRevoked: true,
      identityProviderDeleted,
      nextStep: 'secure_data_erasure',
    };
  }
}

export async function claimAccountErasures(limit = 10): Promise<QueuedAccountErasure[]> {
  const rows = await executeQuery<ClaimedRow>(
    `SELECT request_id, user_id, clerk_user_id, clerk_deleted
       FROM oran_internal.claim_account_erasure_requests($1::integer)`,
    [limit],
  );
  return rows.map((row) => ({
    requestId: row.request_id,
    status: 'processing',
    userId: row.user_id,
    clerkUserId: row.clerk_user_id,
    clerkDeleted: row.clerk_deleted,
  }));
}

/** Advance a request under both a page cap and a wall-clock deadline. */
export async function processAccountErasurePages(
  request: QueuedAccountErasure,
  options: { maxPages?: number; deadlineMs?: number } = {},
): Promise<AccountErasureBatchResult> {
  const maxPages = Math.max(1, Math.min(options.maxPages ?? 8, 10));
  const deadlineMs = options.deadlineMs ?? Date.now() + 20_000;
  let current = request;
  let result: AccountErasureProcessingResult | undefined;
  let pagesProcessed = 0;

  do {
    result = await processAccountErasure(current);
    pagesProcessed += 1;
    if (result.completed || result.status === 'blocked' || result.status === 'pending') break;
    current = {
      ...current,
      status: result.status,
      clerkDeleted: result.identityProviderDeleted,
    };
  } while (pagesProcessed < maxPages && Date.now() < deadlineMs);

  if (!result) {
    throw new Error('Account erasure page loop did not run');
  }
  return { ...result, pagesProcessed };
}
