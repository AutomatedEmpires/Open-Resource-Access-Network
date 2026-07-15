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

import crypto from 'node:crypto';

import { trackAiEvent } from '@/services/telemetry/events';
import { isRetiredMicrosoftProviderRuntime } from '@/services/runtime/providerPolicy';
import { buildPublishedServicePredicate } from './publication';

export const EMBEDDING_DIMENSIONS = 1024;

export function computeEmbeddingContentSha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function resolveEmbeddingModelName(): string {
  return process.env.EMBEDDINGS_MODEL
    ?? (isRetiredMicrosoftProviderRuntime() ? undefined : process.env.FOUNDRY_EMBED_DEPLOYMENT)
    ?? 'unconfigured';
}

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
  if (isRetiredMicrosoftProviderRuntime()) return null;

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
  embeddedText: string,
  sourceUpdatedAt: string,
  executeQuery: (sql: string, params: unknown[]) => Promise<unknown[]>
): Promise<void> {
  if (embedding.length !== EMBEDDING_DIMENSIONS || embedding.some((value) => !Number.isFinite(value))) {
    throw new Error(`Embedding for service ${serviceId} must contain ${EMBEDDING_DIMENSIONS} finite values`);
  }
  // pgvector expects the array in the form '[0.1,0.2,...]'
  const vectorLiteral = `[${embedding.join(',')}]`;
  const contentSha256 = computeEmbeddingContentSha256(embeddedText);
  const updated = await executeQuery(
    `INSERT INTO service_embeddings
       (service_id, embedding, model, content_sha256, source_updated_at, embedded_at)
     SELECT service.id, $1::vector, $2, $3, service.updated_at, NOW()
     FROM services service
     WHERE service.id = $4
       AND service.status = 'active'
       AND service.updated_at = $5::timestamptz
       AND pg_catalog.encode(
         pg_catalog.sha256(
           pg_catalog.convert_to(
             pg_catalog.left(
               pg_catalog.concat_ws(
                 ' ',
                 pg_catalog.nullif(service.name, ''),
                 pg_catalog.nullif(service.description, '')
               ),
               2048
             ),
             'UTF8'
           )
         ),
         'hex'
       ) = $3
     ON CONFLICT (service_id) DO UPDATE
       SET embedding = EXCLUDED.embedding,
           model = EXCLUDED.model,
           content_sha256 = EXCLUDED.content_sha256,
           source_updated_at = EXCLUDED.source_updated_at,
           embedded_at = EXCLUDED.embedded_at
     RETURNING service_id AS id`,
    [vectorLiteral, resolveEmbeddingModelName(), contentSha256, serviceId, sourceUpdatedAt]
  );
  if (updated.length !== 1) {
    throw new Error(`Service ${serviceId} is no longer an active or content-matched embedding target`);
  }
}

/**
 * Retrieve up to `limit` service IDs that are missing embeddings.
 * Used by the reindex batch job to build the initial index.
 */
export async function getServicesNeedingEmbedding(
  limit: number,
  executeQuery: (sql: string, params: unknown[]) => Promise<{ id: string; name: string; description: string | null; source_updated_at: string }[]>
): Promise<{ id: string; name: string; description: string | null; source_updated_at: string }[]> {
  return executeQuery(
    `SELECT s.id, s.name, s.description, s.updated_at AS source_updated_at
     FROM services s
     JOIN organizations o ON o.id = s.organization_id
     LEFT JOIN service_embeddings service_embedding
       ON service_embedding.service_id = s.id
     WHERE ${buildPublishedServicePredicate('s', 'o')}
       AND (
         service_embedding.service_id IS NULL
         OR service_embedding.source_updated_at IS DISTINCT FROM s.updated_at
         OR service_embedding.content_sha256 IS DISTINCT FROM pg_catalog.encode(
           pg_catalog.sha256(
             pg_catalog.convert_to(
               pg_catalog.left(
                 pg_catalog.concat_ws(
                   ' ',
                   pg_catalog.nullif(s.name, ''),
                   pg_catalog.nullif(s.description, '')
                 ),
                 2048
               ),
               'UTF8'
             )
           ),
           'hex'
         )
       )
     ORDER BY s.updated_at DESC
     LIMIT $1`,
    [limit]
  );
}
