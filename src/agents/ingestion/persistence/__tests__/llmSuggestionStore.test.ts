import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleLlmSuggestionStore } from '../llmSuggestionStore';

function createMockDb(selectResults: unknown[] = []) {
  const insertValues: unknown[] = [];
  const updateSets: unknown[] = [];

  const db = {
    select: vi.fn(() => {
      const result = selectResults.shift() ?? [];
      const terminal: any = {
        offset: vi.fn(() => Promise.resolve(result)),
        then: (
          onFulfilled?: ((value: unknown) => unknown) | null,
          onRejected?: ((reason: unknown) => unknown) | null,
        ) => Promise.resolve(result).then(onFulfilled ?? undefined, onRejected ?? undefined),
      };
      const builder: any = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        limit: vi.fn(() => terminal),
        offset: terminal.offset,
        then: terminal.then,
      };
      return builder;
    }),
    insert: vi.fn(() => ({
      values: vi.fn((value: unknown) => {
        insertValues.push(value);
        return {
          then: (
            onFulfilled?: ((value: void) => unknown) | null,
            onRejected?: ((reason: unknown) => unknown) | null,
          ) => Promise.resolve().then(onFulfilled ?? undefined, onRejected ?? undefined),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((value: unknown) => {
        updateSets.push(value);
        return {
          where: vi.fn(() => Promise.resolve()),
        };
      }),
    })),
  };

  return { db, insertValues, updateSets };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'suggest-1',
    suggestionId: 'suggest-ref-1',
    candidateId: 'cand-1',
    field: 'name',
    suggestedValue: 'Helping Hands Pantry',
    originalValue: null,
    confidence: 74,
    reasoning: 'High confidence from source metadata',
    status: 'pending',
    evidenceId: 'ev-1',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('llmSuggestionStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates suggestion rows and maps lookups into domain suggestions', async () => {
    const { db, insertValues } = createMockDb([[makeRow()]]);
    const uuidSpy = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('generated-suggestion-id');
    const store = createDrizzleLlmSuggestionStore(db as never);

    await store.create({
      candidateId: 'cand-1',
      fieldName: 'name',
      suggestedValue: 'Helping Hands Pantry',
      llmConfidence: 74,
      suggestionStatus: 'pending',
      sourceEvidenceRefs: ['ev-1'],
    } as never);

    await store.bulkCreate([
      {
        candidateId: 'cand-1',
        id: 'suggest-2',
        fieldName: 'description',
        suggestedValue: 'Food assistance',
        llmConfidence: 81,
        suggestionStatus: 'accepted',
      } as never,
      {
        candidateId: 'cand-1',
        fieldName: 'phone',
        suggestedValue: '555-0100',
        llmConfidence: 66,
        suggestionStatus: 'pending',
      } as never,
    ]);

    expect(insertValues[0]).toEqual(
      expect.objectContaining({
        candidateId: 'cand-1',
        suggestionId: 'generated-suggestion-id',
        field: 'name',
        suggestedValue: 'Helping Hands Pantry',
        confidence: 74,
        status: 'pending',
        evidenceId: 'ev-1',
      }),
    );
    expect(insertValues[1]).toEqual([
      expect.objectContaining({
        suggestionId: 'suggest-2',
        field: 'description',
      }),
      expect.objectContaining({
        suggestionId: 'generated-suggestion-id',
        field: 'phone',
      }),
    ]);

    await expect(store.getById('suggest-1')).resolves.toEqual(
      expect.objectContaining({
        id: 'suggest-1',
        fieldName: 'name',
        suggestedValue: 'Helping Hands Pantry',
        llmConfidence: 74,
        suggestionStatus: 'pending',
        sourceEvidenceRefs: ['ev-1'],
        llmProvider: 'azure',
      }),
    );

    uuidSpy.mockRestore();
  });

  it('updates human decisions and lists suggestions with filters', async () => {
    const { db, updateSets } = createMockDb([
      [
        makeRow({ id: 'suggest-1', confidence: 85 }),
        makeRow({ id: 'suggest-2', confidence: 45, field: 'description' }),
      ],
    ]);
    const store = createDrizzleLlmSuggestionStore(db as never);

    await store.updateDecision(
      'suggest-1',
      'modified',
      'Edited service name',
      'reviewer-1',
      'Normalized naming',
    );

    expect(updateSets[0]).toEqual(
      expect.objectContaining({
        status: 'modified',
        originalValue: 'Edited service name',
        reviewedBy: 'reviewer-1',
        reasoning: 'Normalized naming',
        reviewedAt: expect.any(Date),
      }),
    );

    await expect(
      store.list(
        {
          candidateId: 'cand-1',
          fieldName: 'name',
          suggestionStatus: 'pending',
          minConfidence: 80,
          reviewedByUserId: 'reviewer-1',
        },
        50,
        0,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'suggest-1',
        llmConfidence: 85,
      }),
      expect.objectContaining({
        id: 'suggest-2',
      }),
    ]);
  });

  it('returns pending and accepted candidate suggestion views', async () => {
    const { db } = createMockDb([
      [
        makeRow({ id: 'suggest-1', field: 'name' }),
        makeRow({ id: 'suggest-2', field: 'description' }),
      ],
      [
        makeRow({ id: 'suggest-3', status: 'pending', field: 'phone' }),
      ],
      [
        makeRow({
          id: 'suggest-4',
          field: 'name',
          status: 'accepted',
          originalValue: null,
          suggestedValue: 'Accepted As Is',
        }),
        makeRow({
          id: 'suggest-5',
          field: 'description',
          status: 'accepted',
          originalValue: 'Human Edited Description',
          suggestedValue: 'Original Description',
        }),
      ],
    ]);
    const store = createDrizzleLlmSuggestionStore(db as never);

    await expect(store.listForCandidate('cand-1')).resolves.toHaveLength(2);
    await expect(store.listPendingForCandidate('cand-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'suggest-3',
        suggestionStatus: 'pending',
      }),
    ]);
    await expect(store.getAcceptedValues('cand-1')).resolves.toEqual(
      new Map([
        ['name', 'Accepted As Is'],
        ['description', 'Human Edited Description'],
      ]),
    );
  });
});
