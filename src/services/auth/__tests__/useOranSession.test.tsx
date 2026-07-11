import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const useAuthMock = vi.hoisted(() => vi.fn());
const useClerkMock = vi.hoisted(() => vi.fn());
const useUserMock = vi.hoisted(() => vi.fn());

vi.mock('@clerk/nextjs', () => ({
  useAuth: useAuthMock,
  useClerk: useClerkMock,
  useUser: useUserMock,
}));

import {
  OranAuthSessionProvider,
  useSession,
} from '@/services/auth/useOranSession';

function SessionProbe() {
  const session = useSession();
  return <span data-status={session.status}>{session.data ? 'signed-in' : 'signed-out'}</span>;
}

describe('OranAuthSessionProvider', () => {
  it('supplies a stable unauthenticated session without invoking Clerk when unconfigured', () => {
    const html = renderToStaticMarkup(
      <OranAuthSessionProvider clerkConfigured={false}>
        <SessionProbe />
      </OranAuthSessionProvider>,
    );

    expect(html).toContain('data-status="unauthenticated"');
    expect(html).toContain('signed-out');
    expect(useAuthMock).not.toHaveBeenCalled();
    expect(useClerkMock).not.toHaveBeenCalled();
    expect(useUserMock).not.toHaveBeenCalled();
  });
});
