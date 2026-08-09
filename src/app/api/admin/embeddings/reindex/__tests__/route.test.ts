import { describe, expect, it } from 'vitest';

describe('POST /api/admin/embeddings/reindex', () => {
  it('is permanently retired without invoking a provider', async () => {
    const { POST } = await import('../route');
    const response = await POST();

    expect(response.status).toBe(410);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      error: 'Embedding reindexing is retired and unavailable.',
    });
  });
});
