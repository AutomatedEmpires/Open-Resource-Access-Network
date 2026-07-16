import { describe, expect, it } from 'vitest';

import { GET } from '../route';

describe('api/maps/token route', () => {
  it('is permanently retired and never returns a browser credential', async () => {
    const response = await GET();

    expect(response.status).toBe(410);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400, immutable');
    await expect(response.json()).resolves.toEqual({
      error: 'Map token brokerage has been retired.',
    });
  });
});
