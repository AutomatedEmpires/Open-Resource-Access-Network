import { beforeEach, describe, expect, it, vi } from 'vitest';

const buildVectorSimilarityQueryMock = vi.hoisted(() => vi.fn());
const reRankWithVectorSimilarityMock = vi.hoisted(() => vi.fn());

vi.mock('../vectorSearch', () => ({
  buildVectorSimilarityQuery: buildVectorSimilarityQueryMock,
  reRankWithVectorSimilarity: reRankWithVectorSimilarityMock,
}));

import { buildFiltersWhereClause, ServiceSearchEngine } from '../engine';

function makeSearchRow(id: string, score: number) {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id,
    organization_id: 'org-1',
    name: `Service ${id}`,
    description: null,
    status: 'active',
    updated_at: now,
    created_at: now,
    organization_name: 'Org One',
    organization_description: null,
    organization_updated_at: now,
    organization_created_at: now,
    confidence_id: `conf-${id}`,
    confidence_score: score,
    verification_confidence: score,
    eligibility_match: 80,
    constraint_fit: 70,
    confidence_computed_at: now,
    distance_meters: 1000,
  };
}

describe('search engine hybrid coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildVectorSimilarityQueryMock.mockReturnValue({
      sql: 'SELECT id, similarity FROM vectors',
      params: ['vector-param'],
    });
    reRankWithVectorSimilarityMock.mockImplementation((items: Array<unknown>) => items);
  });

  it('adds confidence-band minimum score filter when minConfidenceBand is provided', () => {
    const clause = buildFiltersWhereClause({
      status: 'active',
      minConfidenceBand: 'LIKELY',
    });

    expect(clause.sql).toContain('cs.verification_confidence >=');
    expect(clause.params).toContain(60);
  });

  it('returns SQL response unchanged when query embedding is null', async () => {
    const executeQuery = vi.fn().mockResolvedValue([makeSearchRow('svc-a', 88)]);
    const executeCount = vi.fn().mockResolvedValue(1);
    const engine = new ServiceSearchEngine({ executeQuery, executeCount });

    const response = await engine.hybridSearch(
      { filters: { status: 'active' }, pagination: { page: 1, limit: 10 } },
      null,
    );

    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.service.service.id).toBe('svc-a');
    expect(buildVectorSimilarityQueryMock).not.toHaveBeenCalled();
    expect(reRankWithVectorSimilarityMock).not.toHaveBeenCalled();
  });

  it('returns SQL response unchanged when no SQL candidates are found', async () => {
    const executeQuery = vi.fn().mockResolvedValue([]);
    const executeCount = vi.fn().mockResolvedValue(0);
    const engine = new ServiceSearchEngine({ executeQuery, executeCount });

    const response = await engine.hybridSearch(
      { filters: { status: 'active' }, pagination: { page: 1, limit: 10 } },
      [0.1, 0.2, 0.3],
    );

    expect(response.results).toEqual([]);
    expect(buildVectorSimilarityQueryMock).not.toHaveBeenCalled();
    expect(reRankWithVectorSimilarityMock).not.toHaveBeenCalled();
  });

  it('reranks SQL results with vector similarity and strips helper fields before returning', async () => {
    const executeQuery = vi
      .fn()
      .mockResolvedValueOnce([makeSearchRow('svc-a', 91), makeSearchRow('svc-b', 72)])
      .mockResolvedValueOnce([
        { id: 'svc-a', similarity: 0.2 },
        { id: 'svc-b', similarity: 0.95 },
      ]);
    const executeCount = vi.fn().mockResolvedValue(2);
    reRankWithVectorSimilarityMock.mockImplementationOnce((items: Array<Record<string, unknown>>) => [
      items[1],
      items[0],
    ]);

    const engine = new ServiceSearchEngine({ executeQuery, executeCount });
    const response = await engine.hybridSearch(
      { filters: { status: 'active' }, pagination: { page: 1, limit: 10 } },
      [0.1, 0.2, 0.3],
      0.4,
    );

    expect(buildVectorSimilarityQueryMock).toHaveBeenCalledWith(
      [0.1, 0.2, 0.3],
      ['svc-a', 'svc-b'],
      2,
    );
    expect(reRankWithVectorSimilarityMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'svc-a', confidenceScore: 91 }),
        expect.objectContaining({ id: 'svc-b', confidenceScore: 72 }),
      ]),
      new Map([
        ['svc-a', 0.2],
        ['svc-b', 0.95],
      ]),
      0.4,
    );
    expect(response.results[0]?.service.service.id).toBe('svc-b');
    expect((response.results[0] as unknown as Record<string, unknown>).id).toBeUndefined();
    expect((response.results[0] as unknown as Record<string, unknown>).confidenceScore).toBeUndefined();
  });
});

