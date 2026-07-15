import * as Sentry from '@sentry/nextjs';
import { assertAllowedRuntimeEndpoint } from '@/services/runtime/providerPolicy';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
  ? assertAllowedRuntimeEndpoint(process.env.NEXT_PUBLIC_SENTRY_DSN, 'NEXT_PUBLIC_SENTRY_DSN')
  : undefined;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 0,
  beforeSend(event) {
    // Resource searches can include sensitive needs and approximate location.
    // Automatic browser events must never attach user or request payloads.
    delete event.user;
    delete event.request;
    return event;
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
