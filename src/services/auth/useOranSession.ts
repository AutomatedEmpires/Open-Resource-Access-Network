'use client';

/**
 * useOranSession — NextAuth-shaped session hook backed by Clerk.
 *
 * Drop-in replacement for `useSession()` from `next-auth/react`, so client
 * components migrate to Clerk by changing only their import. It combines Clerk's
 * auth state with the DB-driven ORAN role fetched from `/api/me` (the role is
 * NOT stored in Clerk — `user_profiles.role` is the source of truth).
 *
 * Also re-exports `signIn`/`signOut` helpers with the same call shape the old
 * components used.
 */

import { useAuth, useClerk, useUser } from '@clerk/nextjs';
import { useEffect, useState } from 'react';
import type { AccountStatus, OranRole } from '@/domain/types';

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface OranSessionUser {
  id: string;
  role: OranRole;
  accountStatus: AccountStatus;
  orgIds: string[];
  name: string | null;
  email: string | null;
}

export interface OranSession {
  user: OranSessionUser;
}

/**
 * Discriminated union mirroring next-auth's `useSession()` return, so
 * `status === 'authenticated'` narrows `data` to a non-null session.
 */
export type UseSessionResult =
  | { data: OranSession; status: 'authenticated' }
  | { data: null; status: 'unauthenticated' }
  | { data: null; status: 'loading' };

interface MeResponse {
  authenticated: boolean;
  user?: { id: string; role: OranRole; accountStatus: AccountStatus; orgIds: string[] };
}

/**
 * Returns `{ data, status }` mirroring next-auth's `useSession()`.
 */
export function useSession(): UseSessionResult {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  // `forUser` records which Clerk user the fetched profile belongs to, so a
  // single fetch runs per user and the effect never calls setState synchronously.
  const [state, setState] = useState<{ profile: MeResponse['user'] | null; forUser: string | null }>({
    profile: null,
    forUser: null,
  });

  const currentUid = isSignedIn ? (user?.id ?? 'signed-in') : null;

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    const uid = user?.id ?? 'signed-in';
    if (state.forUser === uid) return;

    let cancelled = false;
    fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => r.json() as Promise<MeResponse>)
      .then((d) => {
        if (!cancelled) setState({ profile: d.authenticated ? (d.user ?? null) : null, forUser: uid });
      })
      .catch(() => {
        if (!cancelled) setState({ profile: null, forUser: uid });
      });

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, user?.id, state.forUser]);

  const profileReady = currentUid !== null && state.forUser === currentUid;
  const status: SessionStatus =
    !isLoaded || (isSignedIn && !profileReady)
      ? 'loading'
      : isSignedIn && state.profile
        ? 'authenticated'
        : 'unauthenticated';

  const data: OranSession | null =
    status === 'authenticated' && state.profile
      ? {
          user: {
            id: state.profile.id,
            role: state.profile.role,
            accountStatus: state.profile.accountStatus,
            orgIds: state.profile.orgIds,
            name: user?.fullName ?? user?.username ?? null,
            email: user?.primaryEmailAddress?.emailAddress ?? null,
          },
        }
      : null;

  return { data, status } as UseSessionResult;
}

/**
 * Redirect to the Clerk sign-in page. Mirrors next-auth's `signIn()` call.
 */
export function signIn(_provider?: string, options?: { callbackUrl?: string }): void {
  const callback = options?.callbackUrl ?? window.location.pathname;
  window.location.href = `/sign-in?redirect_url=${encodeURIComponent(callback)}`;
}

/**
 * Sign out the current user. Mirrors next-auth's standalone `signOut()`.
 * Uses the global Clerk instance (available once ClerkProvider has mounted);
 * falls back to a hard redirect if Clerk has not loaded yet.
 */
export function signOut(options?: { callbackUrl?: string }): void {
  const redirectUrl = options?.callbackUrl ?? '/';
  const w = window as unknown as { Clerk?: { signOut: (o?: { redirectUrl?: string }) => Promise<void> } };
  if (w.Clerk?.signOut) {
    void w.Clerk.signOut({ redirectUrl });
  } else {
    window.location.href = redirectUrl;
  }
}

/**
 * Hook variant of {@link signOut} for components that prefer the Clerk hook.
 */
export function useSignOut(): (options?: { callbackUrl?: string }) => Promise<void> {
  const clerk = useClerk();
  return (options) => clerk.signOut({ redirectUrl: options?.callbackUrl ?? '/' });
}
