/**
 * ORAN Embedding Service — Cohere-embed-v3-multilingual via Azure AI Foundry
 *
 * Phase 3 — Idea 5: Semantic vector search infrastructure.
 *
 * Wraps the Azure AI Foundry embeddings endpoint (Cohere-embed-v3-multilingual,
 * 1024-dim). Two modes:
 *   • `embedForIndexing` — use `input_type: "search_document"` for service records
 *   • `embedForQuery`    — use `input_type: "search_query"` for user messages
 *
 * Both return a Float32Array-shaped `number[]` suitable for pgvector `vector(1024)`.
 *
 * Non-negotiable constraints:
 *   1. User query text MUST NOT be sent until `vector_search` flag is on.
 *   2. No PII in embeddings: only service metadata (name, description, eligibility).
 *   3. Fail-open: all callers must handle null returns gracefully.
 *
 * Env vars required:
 *   FOUNDRY_ENDPOINT            — Azure AI Foundry resource endpoint
 *   FOUNDRY_KEY                 — Azure AI Foundry API key
 *   FOUNDRY_EMBED_DEPLOYMENT    — deployment name (default: cohere-embed-v3-multilingual)
 *   FOUNDRY_API_VERSION         — API version (default: 2024-08-01-preview)
 *
 * @module src/services/search/embeddings
 */

import { trackAiEvent } from '@/services/telemetry/appInsights';

export const EMBEDDING_DIMENSIONS = 1024;

/**
 * Builds the text to embed for a service record.
 * Concatenates the service name, description, and eligibility text
 * to produce a rich, multi-faceted document vector.
 *
 * Security: no user input is accepted — only server-controlled field values.
 */
export function buildServiceEmbeddingText(service: {
  name: string;
  description?: string | null;
  eligibility?: string | null;
}): string {
  const parts = [
    service.name,
    service.description ?? '',
    service.eligibility ?? '',
  ].filter(Boolean);
  return parts.join(' ').slice(0, 2048); // Cohere embed max input ~2048 chars
}

// ---------------------------------------------------------------------------
// Core embedding call
// ---------------------------------------------------------------------------

/** Input type for Cohere embed v3 models */
type CohereInputType = 'search_document' | 'search_query';

/**
 * Calls the Azure AI Foundry embeddings endpoint and returns a 1024-dim float vector.
 * Returns null on any failure (network error, unconfigured env, malformed response).
 *
 * Uses the Azure AI model inference REST API (OpenAI-compatible embeddings endpoint).
 * The same endpoint handles both Azure OpenAI and Cohere models on AIServices resources.
 */
async function callEmbeddingsApi(
  text: string,
  inputType: CohereInputType
): Promise<number[] | null> {
  const endpoint = process.env.FOUNDRY_ENDPOINT;
  const apiKey = process.env.FOUNDRY_KEY;
  const deployment =
    process.env.FOUNDRY_EMBED_DEPLOYMENT ?? 'cohere-embed-v3-multilingual';
  const apiVersion =
    process.env.FOUNDRY_API_VERSION ?? '2024-08-01-preview';

  if (!endpoint || !apiKey) return null;

  const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deployment}/embeddings?api-version=${apiVersion}`;
  const t0 = Date.now();

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        input: text,
        // Cohere-specific parameter for retrieval optimization.
        // Cohere embed v3 models accept input_type as a top-level body param
        // via the Azure AI Foundry OpenAI-compatible endpoint.
        input_type: inputType,
        // Note: do NOT pass `dimensions` — Cohere embed v3 has fixed 1024 dims
        // and some API versions return 400 if the field is present.
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    // Network failure — caller handles null as graceful degradation
    void trackAiEvent('embedding_call', {
      duration_ms: Date.now() - t0,
      input_type: inputType,
      model: deployment,
      error_type: 'network_error',
      success: false,
    });
    return null;
  }

  if (!response.ok) {
    void trackAiEvent('embedding_call', {
      duration_ms: Date.now() - t0,
      input_type: inputType,
      model: deployment,
      http_status: response.status,
      error_type: 'http_error',
      success: false,
    });
    return null;
  }

  try {
    const data = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const embedding = data?.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
      void trackAiEvent('embedding_call', {
        duration_ms: Date.now() - t0,
        input_type: inputType,
        model: deployment,
        error_type: 'schema_error',
        success: false,
      });
      return null;
    }
    void trackAiEvent('embedding_call', {
      duration_ms: Date.now() - t0,
      input_type: inputType,
      model: deployment,
      success: true,
    });
    return embedding;
  } catch {
    void trackAiEvent('embedding_call', {
      duration_ms: Date.now() - t0,
      input_type: inputType,
      model: deployment,
      error_type: 'parse_error',
      success: false,
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Embed a service record for storage in the pgvector index.
 * Use `buildServiceEmbeddingText()` to prepare the input text.
 *
 * Returns null if Foundry is not configured or the call fails.
 * Failure is always non-fatal — services can exist without embeddings.
 */
export async function embedForIndexing(text: string): Promise<number[] | null> {
  return callEmbeddingsApi(text, 'search_document');
}

/**
 * Embed a user query for similarity search against the vector index.
 * Input should be the user's original message text — no PII beyond
 * what they typed into the search/chat interface.
 *
 * Returns null if Foundry is not configured or the call fails.
 */
export async function embedForQuery(text: string): Promise<number[] | null> {
  return callEmbeddingsApi(text, 'search_query');
}

/**
 * Persist (INSERT or UPDATE) an embedding for a service record.
 * The `executeQuery` function is passed in to avoid circular deps.
 *
 * Uses the pgvector `::vector` cast to store the float array.
 * Called at service publish time and from the reindex batch job.
 */
export async function updateServiceEmbedding(
  serviceId: string,
  embedding: number[],
  executeQuery: (sql: string, params: unknown[]) => Promise<unknown[]>
): Promise<void> {
  // pgvector expects the array in the form '[0.1,0.2,...]'
  const vectorLiteral = `[${embedding.join(',')}]`;
  await executeQuery(
    `UPDATE services SET embedding = $1::vector WHERE id = $2`,
    [vectorLiteral, serviceId]
  );
}

/**
 * Retrieve up to `limit` service IDs that are missing embeddings.
 * Used by the reindex batch job to build the initial index.
 */
export async function getServicesNeedingEmbedding(
  limit: number,
  executeQuery: (sql: string, params: unknown[]) => Promise<{ id: string; name: string; description: string | null }[]>
): Promise<{ id: string; name: string; description: string | null }[]> {
  return executeQuery(
    `SELECT id, name, description
     FROM services
     WHERE embedding IS NULL
       AND status = 'active'
     ORDER BY updated_at DESC
     LIMIT $1`,
    [limit]
  );
}
