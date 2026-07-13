'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth, useClerk, useUser } from '@clerk/nextjs';
import type { AccountStatus, OranRole } from '@/domain/types';

export interface OranClientSession {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    role: OranRole;
    accountStatus: AccountStatus;
  };
}

export type OranSessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

type OranSessionState =
  | { data: null; status: 'loading' }
  | { data: OranClientSession; status: 'authenticated' }
  | { data: null; status: 'unauthenticated' };

type OranAuthValue = OranSessionState & {
  signOut: (options?: { redirectUrl?: string }) => Promise<void>;
};

interface AuthorizationResponse {
  userId: string;
  role: OranRole;
  accountStatus: AccountStatus;
}

const disabledAuthValue: OranAuthValue = {
  data: null,
  status: 'unauthenticated',
  signOut: async () => undefined,
};

const OranAuthContext = createContext<OranAuthValue>(disabledAuthValue);

function ClerkAuthBridge({ children }: { children: React.ReactNode }) {
  const { isLoaded: isAuthLoaded, isSignedIn, sessionId, userId } = useAuth();
  const { isLoaded: isUserLoaded, user } = useUser();
  const clerk = useClerk();
  const authorizationKey = userId ? `${sessionId ?? 'session'}:${userId}` : null;
  const [authorizationState, setAuthorizationState] = useState<{
    key: string | null;
    context: AuthorizationResponse | null;
  }>({ key: null, context: null });

  useEffect(() => {
    if (!isAuthLoaded) return;

    if (!isSignedIn || !userId || !authorizationKey) return;

    const controller = new AbortController();

    void fetch('/api/auth/context', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const candidate = await response.json() as Partial<AuthorizationResponse>;
        if (
          typeof candidate.userId !== 'string'
          || !candidate.userId
          || !['seeker', 'host_member', 'host_admin', 'community_admin', 'oran_admin'].includes(
            candidate.role ?? '',
          )
          || !['active', 'frozen'].includes(candidate.accountStatus ?? '')
        ) {
          return null;
        }
        return candidate as AuthorizationResponse;
      })
      .then((context) => {
        if (!controller.signal.aborted) {
          setAuthorizationState({ key: authorizationKey, context });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setAuthorizationState({ key: authorizationKey, context: null });
        }
      });

    return () => controller.abort();
  }, [authorizationKey, isAuthLoaded, isSignedIn, userId]);

  const value = useMemo<OranAuthValue>(() => {
    const authorizationResolved = authorizationState.key === authorizationKey;
    const authorization = authorizationResolved ? authorizationState.context : null;
    const loading = !isAuthLoaded || (Boolean(isSignedIn) && (!isUserLoaded || !authorizationResolved));
    if (loading) {
      return {
        data: null,
        status: 'loading',
        signOut: async (options) => {
          await clerk.signOut({ redirectUrl: options?.redirectUrl ?? '/' });
        },
      };
    }

    if (!isSignedIn || !userId || !authorization || !user) {
      return {
        data: null,
        status: 'unauthenticated',
        signOut: async (options) => {
          await clerk.signOut({ redirectUrl: options?.redirectUrl ?? '/' });
        },
      };
    }

    const primaryEmail = user.primaryEmailAddress?.emailAddress ?? null;
    const displayName = user.fullName ?? user.username ?? primaryEmail;

    return {
      data: {
        user: {
          id: authorization.userId,
          name: displayName,
          email: primaryEmail,
          role: authorization.role,
          accountStatus: authorization.accountStatus,
        },
      },
      status: 'authenticated',
      signOut: async (options) => {
        await clerk.signOut({ redirectUrl: options?.redirectUrl ?? '/' });
      },
    };
  }, [authorizationKey, authorizationState, clerk, isAuthLoaded, isSignedIn, isUserLoaded, user, userId]);

  return <OranAuthContext.Provider value={value}>{children}</OranAuthContext.Provider>;
}

export function OranAuthProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  if (!enabled) {
    return <OranAuthContext.Provider value={disabledAuthValue}>{children}</OranAuthContext.Provider>;
  }

  return <ClerkAuthBridge>{children}</ClerkAuthBridge>;
}

export function useSession(): OranSessionState {
  const { data, status } = useContext(OranAuthContext);
  return { data, status } as OranSessionState;
}

export function useOranAuth(): OranAuthValue {
  return useContext(OranAuthContext);
}
