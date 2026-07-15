// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clerkMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useUser: vi.fn(),
  useClerk: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@clerk/nextjs', () => ({
  useAuth: clerkMocks.useAuth,
  useUser: clerkMocks.useUser,
  useClerk: clerkMocks.useClerk,
}));

import { OranAuthProvider, useOranAuth, useSession } from '../client';

const fetchMock = vi.fn();

function SessionProbe() {
  const { data, status } = useSession();
  return (
    <output data-testid="session" data-status={status}>
      {data ? `${data.user.id}:${data.user.role}:${data.user.name}` : 'none'}
    </output>
  );
}

function SignOutProbe() {
  const { signOut } = useOranAuth();
  return <button type="button" onClick={() => void signOut()}>Sign out</button>;
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  clerkMocks.useAuth.mockReturnValue({ isLoaded: true, isSignedIn: false, userId: null });
  clerkMocks.useUser.mockReturnValue({ isLoaded: true, user: null });
  clerkMocks.useClerk.mockReturnValue({ signOut: clerkMocks.signOut });
  clerkMocks.signOut.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('ORAN Clerk client bridge', () => {
  it('stays unauthenticated without Clerk configuration and does not fetch authorization', () => {
    render(
      <OranAuthProvider enabled={false}>
        <SessionProbe />
      </OranAuthProvider>,
    );

    expect(screen.getByTestId('session')).toHaveAttribute('data-status', 'unauthenticated');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('combines Clerk identity details with ORAN-owned authorization', async () => {
    clerkMocks.useAuth.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      userId: 'user_clerk_1',
    });
    clerkMocks.useUser.mockReturnValue({
      isLoaded: true,
      user: {
        fullName: 'Jordan Rivera',
        username: null,
        primaryEmailAddress: { emailAddress: 'jordan@example.org' },
      },
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        userId: 'oran-user-1',
        role: 'community_admin',
        accountStatus: 'active',
      }),
    });

    render(
      <OranAuthProvider enabled>
        <SessionProbe />
      </OranAuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('session')).toHaveAttribute('data-status', 'authenticated');
    });
    expect(screen.getByTestId('session')).toHaveTextContent(
      'oran-user-1:community_admin:Jordan Rivera',
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/context', expect.objectContaining({
      credentials: 'same-origin',
      cache: 'no-store',
    }));
  });

  it('fails closed when the authorization response is invalid', async () => {
    clerkMocks.useAuth.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      userId: 'user_clerk_1',
    });
    clerkMocks.useUser.mockReturnValue({ isLoaded: true, user: { fullName: 'Jordan' } });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        userId: 'oran-user-1',
        role: 'owner',
        accountStatus: 'active',
      }),
    });

    render(
      <OranAuthProvider enabled>
        <SessionProbe />
      </OranAuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('session')).toHaveAttribute('data-status', 'unauthenticated');
    });
    expect(screen.getByTestId('session')).toHaveTextContent('none');
  });

  it('clears the Clerk session with a same-site homepage redirect by default', async () => {
    render(
      <OranAuthProvider enabled>
        <SignOutProbe />
      </OranAuthProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => {
      expect(clerkMocks.signOut).toHaveBeenCalledWith({ redirectUrl: '/' });
    });
  });
});
