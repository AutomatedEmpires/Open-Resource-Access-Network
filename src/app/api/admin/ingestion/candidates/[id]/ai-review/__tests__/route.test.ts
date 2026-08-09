import { describe, expect, it } from 'vitest';

describe('GET /api/admin/ingestion/candidates/[id]/ai-review', () => {
  it('is permanently retired without invoking a provider', async () => {
    const { GET } = await import('../route');
    const response = await GET();

    expect(response.status).toBe(410);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      error: 'Automated candidate review is retired and unavailable.',
    });
  });
});
