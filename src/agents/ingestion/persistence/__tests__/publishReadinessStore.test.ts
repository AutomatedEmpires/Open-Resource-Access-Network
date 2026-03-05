import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzlePublishReadinessStore } from '../publishReadinessStore';

function createMockDb(selectResults: unknown[] = []) {
  const db = {
    select: vi.fn(() => {
      const result = selectResults.shift() ?? [];
      const terminal: any = {
        then: (
          onFulfilled?: ((value: unknown) => unknown) | null,
          onRejected?: ((reason: unknown) => unknown) | null,
        ) => Promise.resolve(result).then(onFulfilled ?? undefined, onRejected ?? undefined),
      };
      const builder: any = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        limit: vi.fn(() => terminal),
        then: terminal.then,
      };
      return builder;
    }),
  };

  return { db };
}

function makeReadinessRow(overrides: Record<string, unknown> = {}) {
  return {
    candidateId: 'cand-1',
    pendingTagCount: 2,
    adminApprovalCount: 1,
    isReady: false,
    ...overrides,
  };
}

function makeCandidateRow(overrides: Record<string, unknown> = {}) {
  return {
    candidateId: 'cand-1',
    reviewStatus: 'verified',
    confidenceScore: 82,
    confidenceTier: 'green',
    ...overrides,
  };
}

describe('publishReadinessStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no readiness row exists', async () => {
    const { db } = createMockDb([[]]);
    const store = createDrizzlePublishReadinessStore(db as never);

    await expect(store.getReadiness('cand-404')).resolves.toBeNull();
  });

  it('maps readiness and candidate rows into domain readiness', async () => {
    const { db } = createMockDb([
      [makeReadinessRow({ candidateId: 'cand-1', pendingTagCount: 3, adminApprovalCount: 2, isReady: true })],
      [makeCandidateRow({ candidateId: 'cand-1', reviewStatus: 'published', confidenceScore: 91, confidenceTier: 'green' })],
    ]);
    const store = createDrizzlePublishReadinessStore(db as never);

    await expect(store.getReadiness('cand-1')).resolves.toEqual({
      candidateId: 'cand-1',
      reviewStatus: 'published',
      confidenceScore: 91,
      confidenceTier: 'green',
      confirmedTagsCount: 0,
      pendingTagsCount: 3,
      approvalCount: 2,
      rejectionCount: 0,
      hasOrgApproval: false,
      satisfiedChecklistCount: 0,
      missingChecklistCount: 0,
      pendingLlmSuggestions: 0,
      meetsPublishThreshold: true,
    });
  });

  it('checks threshold boolean and defaults false when row is missing', async () => {
    const { db } = createMockDb([
      [{ isReady: true }],
      [],
    ]);
    const store = createDrizzlePublishReadinessStore(db as never);

    await expect(store.meetsThreshold('cand-1')).resolves.toBe(true);
    await expect(store.meetsThreshold('cand-2')).resolves.toBe(false);
  });

  it('lists ready candidates and falls back to pending/red defaults when candidate row is absent', async () => {
    const { db } = createMockDb([
      [
        makeReadinessRow({ candidateId: 'cand-1', pendingTagCount: 1, adminApprovalCount: 2, isReady: true }),
        makeReadinessRow({ candidateId: 'cand-2', pendingTagCount: 4, adminApprovalCount: 0, isReady: true }),
      ],
      [
        makeCandidateRow({ candidateId: 'cand-1', reviewStatus: 'in_review', confidenceScore: 74, confidenceTier: 'yellow' }),
      ],
    ]);
    const store = createDrizzlePublishReadinessStore(db as never);

    await expect(store.listReadyForPublish(25)).resolves.toEqual([
      expect.objectContaining({
        candidateId: 'cand-1',
        reviewStatus: 'in_review',
        confidenceScore: 74,
        confidenceTier: 'yellow',
        pendingTagsCount: 1,
        approvalCount: 2,
      }),
      expect.objectContaining({
        candidateId: 'cand-2',
        reviewStatus: 'pending',
        confidenceScore: 0,
        confidenceTier: 'red',
        pendingTagsCount: 4,
        approvalCount: 0,
      }),
    ]);
  });
});
