import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/db', () => ({
  getDb: dbMocks.getDb,
}));

describe('drizzle helper', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns the shared drizzle db instance from getDb', async () => {
    const fakeDb = { dialect: 'pg', schema: 'oran' };
    dbMocks.getDb.mockReturnValue(fakeDb);

    const drizzle = await import('../drizzle');

    expect(drizzle.getDrizzle()).toBe(fakeDb);
    expect(dbMocks.getDb).toHaveBeenCalledTimes(1);
  });
});
