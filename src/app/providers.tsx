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
import { OranAuthProvider } from '@/services/auth/client';
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
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const appProviders = (
    <OranAuthProvider enabled={Boolean(publishableKey)}>
      <ToastProvider>
        <CrisisProvider>{children}</CrisisProvider>
      </ToastProvider>
    </OranAuthProvider>
  );

  return (
    <LocaleProvider locale={locale} dir={dir} messages={messages}>
      {publishableKey ? (
        <ClerkProvider
          publishableKey={publishableKey}
          appearance={{
            variables: {
              colorPrimary: '#125dff',
              colorBackground: '#f8fbff',
              colorForeground: '#071a44',
              colorMutedForeground: '#3d526f',
              borderRadius: '0.875rem',
              fontFamily: 'var(--font-manrope)',
            },
          }}
        >
          {appProviders}
        </ClerkProvider>
      ) : appProviders}
    </LocaleProvider>
  );
}
