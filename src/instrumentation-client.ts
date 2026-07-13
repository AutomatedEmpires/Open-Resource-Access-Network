import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
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
