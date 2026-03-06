import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildServiceEmbeddingText,
  EMBEDDING_DIMENSIONS,
  embedForIndexing,
  embedForQuery,
  getServicesNeedingEmbedding,
  updateServiceEmbedding,
} from '../embeddings';

const fetchMock = vi.hoisted(() => vi.fn());

describe('search embeddings service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds service embedding text and truncates to model max length', () => {
    const longDescription = 'x'.repeat(3000);
    const text = buildServiceEmbeddingText({
      name: 'Food Pantry',
      description: longDescription,
      eligibility: 'Adults',
    });

    expect(text.startsWith('Food Pantry')).toBe(true);
    expect(text.length).toBe(2048);
  });

  it('includes eligibility text when not truncated away', () => {
    const text = buildServiceEmbeddingText({
      name: 'Food Pantry',
      description: 'Emergency groceries',
      eligibility: 'Adults',
    });

    expect(text).toContain('Food Pantry');
    expect(text).toContain('Emergency groceries');
    expect(text).toContain('Adults');
  });

  it('returns null when foundry env is not configured', async () => {
    const vector = await embedForIndexing('food resources');
    expect(vector).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls embeddings API for indexing mode with expected payload', async () => {
    vi.stubEnv('FOUNDRY_ENDPOINT', 'https://example-foundry.openai.azure.com');
    vi.stubEnv('FOUNDRY_KEY', 'test-key');

    const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ embedding: vector }] }),
    });

    const result = await embedForIndexing('food pantry');

    expect(result).toEqual(vector);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/openai/deployments/cohere-embed-v3-multilingual/embeddings');
    const body = JSON.parse(String(init.body)) as { input_type: string; input: string };
    expect(body.input).toBe('food pantry');
    expect(body.input_type).toBe('search_document');
  });

  it('calls embeddings API for query mode and returns null for malformed response', async () => {
    vi.stubEnv('FOUNDRY_ENDPOINT', 'https://example-foundry.openai.azure.com');
    vi.stubEnv('FOUNDRY_KEY', 'test-key');
    vi.stubEnv('FOUNDRY_EMBED_DEPLOYMENT', 'embed-v3');

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2] }] }),
    });

    const result = await embedForQuery('nearest shelter');

    expect(result).toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/openai/deployments/embed-v3/embeddings');
    const body = JSON.parse(String(init.body)) as { input_type: string };
    expect(body.input_type).toBe('search_query');
  });

  it('fails open (null) on network or HTTP failures', async () => {
    vi.stubEnv('FOUNDRY_ENDPOINT', 'https://example-foundry.openai.azure.com');
    vi.stubEnv('FOUNDRY_KEY', 'test-key');

    fetchMock.mockRejectedValueOnce(new Error('network'));
    await expect(embedForQuery('help')).resolves.toBeNull();

    fetchMock.mockResolvedValueOnce({ ok: false });
    await expect(embedForIndexing('housing')).resolves.toBeNull();
  });

  it('updates and retrieves embeddings through provided SQL executor functions', async () => {
    const executeQuery = vi.fn().mockResolvedValue([
      { id: 'svc-1', name: 'Food Pantry', description: 'Emergency food' },
    ]);

    await updateServiceEmbedding('svc-1', [0.1, 0.2, 0.3], executeQuery);
    expect(executeQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('UPDATE services SET embedding'),
      ['[0.1,0.2,0.3]', 'svc-1'],
    );

    const rows = await getServicesNeedingEmbedding(25, executeQuery);
    expect(executeQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('WHERE embedding IS NULL'),
      [25],
    );
    expect(rows).toEqual([{ id: 'svc-1', name: 'Food Pantry', description: 'Emergency food' }]);
  });
});
