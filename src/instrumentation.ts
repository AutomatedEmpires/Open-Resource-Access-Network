/** Next.js server/edge instrumentation for the target Sentry runtime. */

import * as Sentry from '@sentry/nextjs';
import { assertNoRetiredMicrosoftProviderSettings } from '@/services/runtime/providerPolicy';

export async function register(): Promise<void> {
  assertNoRetiredMicrosoftProviderSettings(process.env);

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
