import { describe, expect, it, vi } from 'vitest';

import {
  CandidateReviewerRoutingRepairError,
  candidateReviewerRoutingRepairResultFrom,
  repairCandidateReviewerCoverage,
} from '../candidateReviewerRoutingRepair';

function createStore(candidateIds: string[] | null, reviewerCounts: Array<number | null | Error>) {
  return {
    listCandidatesNeedingReviewerCoverage: vi.fn().mockResolvedValue(candidateIds),
    routeForReview: vi.fn(async () => {
      const result = reviewerCounts.shift();
      if (result instanceof Error) throw result;
      return result ?? null;
    }),
  };
}

describe('candidate reviewer routing repair', () => {
  it('stays dark without querying candidates when activation is not active', async () => {
    const store = createStore(null, []);

    await expect(repairCandidateReviewerCoverage(store)).resolves.toEqual({
      active: false,
      selectedCount: 0,
      attemptedCount: 0,
      coveredCount: 0,
      undercoveredCount: 0,
      failureCount: 0,
      retryCount: 0,
    });
    expect(store.listCandidatesNeedingReviewerCoverage).toHaveBeenCalledWith(100);
    expect(store.routeForReview).not.toHaveBeenCalled();
  });

  it('routes every selected candidate through the database-owned router', async () => {
    const store = createStore(['candidate-oldest', 'candidate-newer'], [2, 3]);

    await expect(repairCandidateReviewerCoverage(store, 25)).resolves.toEqual({
      active: true,
      selectedCount: 2,
      attemptedCount: 2,
      coveredCount: 2,
      undercoveredCount: 0,
      failureCount: 0,
      retryCount: 0,
    });
    expect(store.listCandidatesNeedingReviewerCoverage).toHaveBeenCalledWith(25);
    expect(store.routeForReview).toHaveBeenNthCalledWith(1, 'candidate-oldest', 2);
    expect(store.routeForReview).toHaveBeenNthCalledWith(2, 'candidate-newer', 2);
  });

  it('preserves partial progress and throws a count-only aggregate for retry', async () => {
    const store = createStore(
      ['candidate-covered', 'candidate-capacity', 'candidate-db-error', 'candidate-dark-drift'],
      [2, 1, new Error('candidate-db-error was deleted'), new Error('still unavailable'), null, null],
    );

    let caught: unknown;
    try {
      await repairCandidateReviewerCoverage(store);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CandidateReviewerRoutingRepairError);
    expect(candidateReviewerRoutingRepairResultFrom(caught)).toEqual({
      active: true,
      selectedCount: 4,
      attemptedCount: 4,
      coveredCount: 1,
      undercoveredCount: 1,
      failureCount: 2,
      retryCount: 2,
    });
    expect(String(caught)).not.toContain('candidate-');
    expect(store.routeForReview).toHaveBeenCalledTimes(6);
  });

  it('reduces selection failures to aggregate telemetry without leaking database details', async () => {
    const store = createStore([], []);
    store.listCandidatesNeedingReviewerCoverage.mockRejectedValue(
      new Error('query included candidate-sensitive-value'),
    );

    await expect(repairCandidateReviewerCoverage(store)).rejects.toMatchObject({
      name: 'CandidateReviewerRoutingRepairError',
      result: {
        selectedCount: 0,
        attemptedCount: 0,
        failureCount: 1,
        retryCount: 1,
      },
    });

    try {
      await repairCandidateReviewerCoverage({
        ...store,
        listCandidatesNeedingReviewerCoverage: vi.fn().mockRejectedValue(
          new Error('candidate-sensitive-value'),
        ),
      });
    } catch (error) {
      expect(String(error)).not.toContain('candidate-sensitive-value');
    }
  });

  it('recovers from one transient selector and router failure in the same invocation', async () => {
    const store = createStore(
      ['candidate-transient'],
      [new Error('temporary router failure'), 2],
    );
    store.listCandidatesNeedingReviewerCoverage.mockRejectedValueOnce(
      new Error('temporary selector failure'),
    );

    await expect(repairCandidateReviewerCoverage(store)).resolves.toEqual({
      active: true,
      selectedCount: 1,
      attemptedCount: 1,
      coveredCount: 1,
      undercoveredCount: 0,
      failureCount: 0,
      retryCount: 2,
    });
    expect(store.listCandidatesNeedingReviewerCoverage).toHaveBeenCalledTimes(2);
    expect(store.routeForReview).toHaveBeenCalledTimes(2);
  });
});
