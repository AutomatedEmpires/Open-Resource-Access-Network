import { describe, expect, it } from 'vitest';
import {
  buildVectorSimilarityQuery,
  buildVectorTopKQuery,
  reRankWithVectorSimilarity,
} from '../vectorSearch';

describe('search vector utilities', () => {
  it('returns a fast empty query when there are no candidate ids', () => {
    const built = buildVectorSimilarityQuery([0.1, 0.2], []);

    expect(built.sql).toContain('WHERE false');
    expect(built.params).toEqual([]);
  });

  it('builds a candidate-constrained similarity query', () => {
    const built = buildVectorSimilarityQuery(
      [0.5, 0.6],
      ['11111111-1111-4111-8111-111111111111'],
      12,
    );

    expect(built.sql).toContain('s.id = ANY($2::uuid[])');
    expect(built.sql).toContain('ORDER BY s.embedding <=> $1::vector');
    expect(built.params).toEqual([
      '[0.5,0.6]',
      ['11111111-1111-4111-8111-111111111111'],
      12,
    ]);
  });

  it('builds a top-k vector query for supplemental retrieval', () => {
    const built = buildVectorTopKQuery([0.7, 0.8], 8, 'inactive');

    expect(built.sql).toContain('WHERE s.embedding IS NOT NULL');
    expect(built.sql).toContain('AND s.status = $2');
    expect(built.params).toEqual(['[0.7,0.8]', 'inactive', 8]);
  });

  it('keeps original ordering when no vector scores are present', () => {
    const sqlResults = [
      { id: 'a', confidenceScore: 90 },
      { id: 'b', confidenceScore: 70 },
    ];

    const reranked = reRankWithVectorSimilarity(sqlResults, new Map());
    expect(reranked).toEqual(sqlResults);
  });

  it('re-ranks by hybrid confidence/vector score and handles missing confidence', () => {
    const sqlResults = [
      { id: 'a', confidenceScore: 20 }, // low trust
      { id: 'b', confidenceScore: 80 }, // high trust
      { id: 'c' }, // defaults to 50
    ];

    const similarityMap = new Map<string, number>([
      ['a', 0.95],
      ['b', 0.1],
      ['c', 0.9],
    ]);

    const reranked = reRankWithVectorSimilarity(sqlResults, similarityMap, 0.5);
    expect(reranked.map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });
});
