import { describe, expect, it } from 'vitest';

describe('api/tts/summary route', () => {
  it.each(['GET', 'POST'] as const)('%s is permanently retired without invoking a provider', async (method) => {
    const route = await import('../route');
    const response = await route[method]();

    expect(response.status).toBe(410);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      error: 'Speech synthesis is unavailable. Use your device or browser read-aloud tools.',
    });
  });
});
