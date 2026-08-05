import type { AdminAssignmentStore } from '@/agents/ingestion/stores';
import { createDrizzleAdminAssignmentStore } from '@/agents/ingestion/persistence/adminAssignmentStore';
import { getDrizzle } from '@/services/db/drizzle';

const DEFAULT_BATCH_LIMIT = 100;
const REQUIRED_REVIEWER_COUNT = 2;
const MAX_OPERATION_ATTEMPTS = 2;

type CandidateReviewerRoutingStore = Pick<
  AdminAssignmentStore,
  'listCandidatesNeedingReviewerCoverage' | 'routeForReview'
>;

export interface CandidateReviewerRoutingRepairResult {
  active: boolean;
  selectedCount: number;
  attemptedCount: number;
  coveredCount: number;
  undercoveredCount: number;
  failureCount: number;
  retryCount: number;
}

export class CandidateReviewerRoutingRepairError extends Error {
  constructor(readonly result: CandidateReviewerRoutingRepairResult) {
    super(
      `Candidate reviewer coverage repair incomplete: ${result.undercoveredCount} under-covered and ${result.failureCount} failed`,
    );
    this.name = 'CandidateReviewerRoutingRepairError';
  }
}

function emptyResult(active: boolean): CandidateReviewerRoutingRepairResult {
  return {
    active,
    selectedCount: 0,
    attemptedCount: 0,
    coveredCount: 0,
    undercoveredCount: 0,
    failureCount: 0,
    retryCount: 0,
  };
}

function defaultStore(): CandidateReviewerRoutingStore {
  return createDrizzleAdminAssignmentStore(getDrizzle());
}

/**
 * Repairs a bounded batch of open candidates after reviewer assignments expire
 * or reviewer eligibility changes. Per-candidate failures are reduced to counts
 * so candidate identities never enter cron responses or telemetry.
 */
export async function repairCandidateReviewerCoverage(
  store: CandidateReviewerRoutingStore = defaultStore(),
  batchLimit = DEFAULT_BATCH_LIMIT,
): Promise<CandidateReviewerRoutingRepairResult> {
  if (
    typeof store.listCandidatesNeedingReviewerCoverage !== 'function'
    || typeof store.routeForReview !== 'function'
  ) {
    const result = emptyResult(true);
    result.failureCount = 1;
    throw new CandidateReviewerRoutingRepairError(result);
  }

  let candidateIds: string[] | null = null;
  let selectionRetryCount = 0;
  for (let attempt = 1; attempt <= MAX_OPERATION_ATTEMPTS; attempt += 1) {
    try {
      candidateIds = await store.listCandidatesNeedingReviewerCoverage(batchLimit);
      break;
    } catch {
      if (attempt < MAX_OPERATION_ATTEMPTS) {
        selectionRetryCount += 1;
        continue;
      }
      const result = emptyResult(true);
      result.failureCount = 1;
      result.retryCount = selectionRetryCount;
      throw new CandidateReviewerRoutingRepairError(result);
    }
  }

  if (candidateIds === null) {
    const result = emptyResult(false);
    result.retryCount = selectionRetryCount;
    return result;
  }

  const result = emptyResult(true);
  result.selectedCount = candidateIds.length;
  result.retryCount = selectionRetryCount;

  for (const candidateId of candidateIds) {
    result.attemptedCount += 1;
    for (let attempt = 1; attempt <= MAX_OPERATION_ATTEMPTS; attempt += 1) {
      if (attempt > 1) result.retryCount += 1;
      try {
        const reviewerCount = await store.routeForReview(candidateId, REQUIRED_REVIEWER_COUNT);
        if (reviewerCount === null) {
          if (attempt === MAX_OPERATION_ATTEMPTS) result.failureCount += 1;
          continue;
        }
        if (reviewerCount >= REQUIRED_REVIEWER_COUNT) {
          result.coveredCount += 1;
        } else {
          result.undercoveredCount += 1;
        }
        break;
      } catch {
        if (attempt === MAX_OPERATION_ATTEMPTS) result.failureCount += 1;
      }
    }
  }

  if (result.undercoveredCount > 0 || result.failureCount > 0) {
    throw new CandidateReviewerRoutingRepairError(result);
  }

  return result;
}

export function candidateReviewerRoutingRepairResultFrom(
  error: unknown,
): CandidateReviewerRoutingRepairResult | null {
  return error instanceof CandidateReviewerRoutingRepairError
    ? error.result
    : null;
}
