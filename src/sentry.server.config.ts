import * as Sentry from '@sentry/nextjs';
import { assertAllowedRuntimeEndpoint } from '@/services/runtime/providerPolicy';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
  ? assertAllowedRuntimeEndpoint(process.env.NEXT_PUBLIC_SENTRY_DSN, 'NEXT_PUBLIC_SENTRY_DSN')
  : undefined;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 0,
  beforeSend(event) {
    // Do not send cookies, headers, request bodies, search terms, or identities.
    delete event.user;
    delete event.request;
    return event;
  },
});
