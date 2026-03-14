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
import { LocaleProvider } from '@/contexts/LocaleContext';
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
  return (
    <LocaleProvider locale={locale} dir={dir} messages={messages}>
      <SessionProvider>
        <ToastProvider>
          <CrisisProvider>{children}</CrisisProvider>
        </ToastProvider>
      </SessionProvider>
    </LocaleProvider>
  );
}
