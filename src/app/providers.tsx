'use client';

/**
 * Client-side provider tree.
 * Keeps the root layout a server component while wrapping children
 * with any client-boundary providers (auth session, toasts, etc.).
 */

import React from 'react';
import { SessionProvider } from 'next-auth/react';
import { ToastProvider } from '@/components/ui/toast';
import { CrisisProvider } from '@/components/crisis/CrisisContext';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>
        <CrisisProvider>{children}</CrisisProvider>
      </ToastProvider>
    </SessionProvider>
  );
}
