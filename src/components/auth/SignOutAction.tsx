'use client';

import React from 'react';
import { useOranAuth } from '@/services/auth/client';

export interface SignOutActionProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'type'> {
  redirectUrl?: string;
}

/**
 * Clears the active Clerk session through ORAN's shared auth bridge.
 *
 * This replaces links to the retired NextAuth `/api/auth/signout` endpoint.
 */
export function SignOutAction({
  children,
  redirectUrl = '/',
  ...props
}: SignOutActionProps) {
  const { signOut } = useOranAuth();

  return (
    <button
      type="button"
      onClick={() => void signOut({ redirectUrl })}
      {...props}
    >
      {children}
    </button>
  );
}
