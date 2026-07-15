import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));

vi.mock('@/services/auth/session', () => authMocks);

import { GET } from '../route';

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.getAuthContext.mockResolvedValue(null);
});

describe('GET /api/auth/context', () => {
  it('returns a no-store 401 when ORAN authorization is unavailable', async () => {
    const response = await GET();

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' });
  });

  it('returns only the client authorization fields for an active identity', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      clerkUserId: 'user_clerk_1',
      userId: 'oran-user-1',
      role: 'host_admin',
      accountStatus: 'active',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      userId: 'oran-user-1',
      role: 'host_admin',
      accountStatus: 'active',
    });
  });
});
