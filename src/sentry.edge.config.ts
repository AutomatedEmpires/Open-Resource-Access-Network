import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 0,
  beforeSend(event) {
    delete event.user;
    delete event.request;
    return event;
  },
});
