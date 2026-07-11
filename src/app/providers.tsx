'use client';

/**
 * Client-side provider tree.
 * Keeps the root layout a server component while wrapping children
 * with any client-boundary providers (auth session, toasts, etc.).
 */

import React from 'react';
import { ClerkProvider } from '@clerk/nextjs';
import { ToastProvider } from '@/components/ui/toast';
import { CrisisProvider } from '@/components/crisis/CrisisContext';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { OranAuthSessionProvider } from '@/services/auth/useOranSession';
import type { LocaleCode } from '@/services/i18n/i18n';

interface ProvidersProps {
  /** Resolved locale from the server. Passed through to <LocaleProvider>. */
  locale: LocaleCode;
  /** Document direction derived from locale. */
  dir: 'ltr' | 'rtl';
  /** Pre-merged messages bundle from getMessages(locale). */
  messages: Record<string, unknown>;
  children: React.ReactNode;
}

export function Providers({ locale, dir, messages, children }: ProvidersProps) {
  const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const providerTree = (
    <OranAuthSessionProvider clerkConfigured={clerkConfigured}>
      <LocaleProvider locale={locale} dir={dir} messages={messages}>
        <ToastProvider>
          <CrisisProvider>{children}</CrisisProvider>
        </ToastProvider>
      </LocaleProvider>
    </OranAuthSessionProvider>
  );

  // Public routes remain renderable for local/CI smoke tests when Clerk is not
  // configured. Protected production routes still fail closed in `proxy.ts`,
  // and the production runtime contract requires both Clerk keys.
  return clerkConfigured
    ? <ClerkProvider>{providerTree}</ClerkProvider>
    : providerTree;
}
