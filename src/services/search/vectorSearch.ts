/**
 * Vector Search — pgvector cosine similarity queries
 *
 * Phase 3 — Idea 5: Semantic search via Cohere embeddings.
 *
 * Provides query builders and a re-ranking utility for hybrid text + vector search.
 * The retrieval-first constraint is preserved: vector similarity only re-ranks
 * records already returned by the SQL query — it never introduces new results
 * or replaces SQL-based retrieval.
 *
 * Non-negotiable: LLMs do NOT participate. Only raw cosine distance from pgvector.
 *
 * @module src/services/search/vectorSearch
 */

// ---------------------------------------------------------------------------
// Vector similarity query
// ---------------------------------------------------------------------------

export interface VectorSimilarityRow {
  id: string;
  similarity: number;
}

/**
 * Builds a parameterized SQL query that returns service IDs and their cosine
 * similarity to the provided query embedding.
 *
 * Uses pgvector's `<=>` operator (cosine distance), converted to similarity
 * as `1 - distance` so higher = more similar.
 *
 * Only services with non-NULL embeddings are returned. The caller is responsible
 * for merging with the primary text/geo results.
 *
 * @param queryEmbedding  1024-dim float array from embedForQuery()
 * @param candidateIds    Restrict search to these service IDs (from SQL results)
 * @param limit           Max rows to return
 */
export function buildVectorSimilarityQuery(
  queryEmbedding: number[],
  candidateIds: string[],
  limit = 20
): { sql: string; params: unknown[] } {
  const vectorLiteral = `[${queryEmbedding.join(',')}]`;

  if (candidateIds.length === 0) {
    // No candidates to re-rank — return empty result efficiently
    return {
      sql: 'SELECT id, 0::float AS similarity FROM services WHERE false',
      params: [],
    };
  }

  return {
    sql: `
      SELECT
        s.id,
        (1 - (s.embedding <=> $1::vector))::float AS similarity
      FROM services s
      WHERE s.id = ANY($2::uuid[])
        AND s.embedding IS NOT NULL
      ORDER BY s.embedding <=> $1::vector
      LIMIT $3
    `,
    params: [vectorLiteral, candidateIds, limit],
  };
}

/**
 * Builds a pgvector ANN query that finds the top-K most similar services
 * across the entire services table, regardless of text/geo filters.
 *
 * Used as an ADDITIONAL retrieval path when vector_search is enabled,
 * not as a replacement for SQL retrieval.
 *
 * @param queryEmbedding  1024-dim float array
 * @param limit           Max rows to return (default 10 — supplemental only)
 * @param statusFilter    Restrict to this service status (default 'active')
 */
export function buildVectorTopKQuery(
  queryEmbedding: number[],
  limit = 10,
  statusFilter = 'active'
): { sql: string; params: unknown[] } {
  const vectorLiteral = `[${queryEmbedding.join(',')}]`;

  return {
    sql: `
      SELECT
        s.id,
        (1 - (s.embedding <=> $1::vector))::float AS similarity
      FROM services s
      WHERE s.embedding IS NOT NULL
        AND s.status = $2
      ORDER BY s.embedding <=> $1::vector
      LIMIT $3
    `,
    params: [vectorLiteral, statusFilter, limit],
  };
}

// ---------------------------------------------------------------------------
// Hybrid re-ranking
// ---------------------------------------------------------------------------

/**
 * Merges SQL-retrieved results with vector similarity scores using a
 * weighted linear combination.
 *
 * Formula:
 *   hybridScore = alpha * normalizedSqlScore + (1 - alpha) * vectorSimilarity
 *
 * where:
 *   normalizedSqlScore = verification_confidence / 100
 *   vectorSimilarity   = cosine similarity (0–1) from pgvector
 *   alpha              = weight given to the trust/verification score (default 0.6)
 *
 * Non-negotiable: services with missing embeddings are NOT penalised.
 * They keep their original SQL rank (vectorSimilarity = 0 for them,
 * so they sort below vector-matched results but are still returned).
 *
 * @param sqlResults     Ordered array from the SQL search engine
 * @param similarityMap  Map of serviceId → similarity score (0–1)
 * @param alpha          Weight assigned to the SQL confidence score (0–1)
 */
export function reRankWithVectorSimilarity<T extends { id: string; confidenceScore?: number | null }>(
  sqlResults: T[],
  similarityMap: Map<string, number>,
  alpha = 0.6
): T[] {
  if (similarityMap.size === 0) return sqlResults;

  type Scored = { item: T; hybridScore: number };
  const scored: Scored[] = sqlResults.map((item) => {
    const normalizedConfidence = ((item.confidenceScore ?? 50) / 100);
    const vectorSim = similarityMap.get(item.id) ?? 0;
    const hybridScore = alpha * normalizedConfidence + (1 - alpha) * vectorSim;
    return { item, hybridScore };
  });

  return scored
    .sort((a, b) => b.hybridScore - a.hybridScore)
    .map((s) => s.item);
}
