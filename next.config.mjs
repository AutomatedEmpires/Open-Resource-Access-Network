import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  async headers() {
    const securityHeaders = [
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      {
        key: 'Permissions-Policy',
        value:
          'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()',
      },
      {
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          // Next.js requires 'unsafe-inline' for styles (Tailwind CSS injects styles at build time)
          // and 'unsafe-eval' in development for HMR/Fast Refresh.
          // In production, only 'unsafe-inline' is needed for Tailwind.
          // Next.js requires 'unsafe-inline' for scripts (inline hydration scripts).
          // In development, 'unsafe-eval' is also needed for HMR/Fast Refresh.
          // XSS risk is mitigated by: React default escaping, Zod input validation,
          // safeJsonLd() sanitization on all dangerouslySetInnerHTML, and no
          // user-controlled content injected into <script> tags.
          process.env.NODE_ENV === 'development'
            ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
            : "script-src 'self' 'unsafe-inline'",
          // Tailwind CSS requires 'unsafe-inline' for its generated styles.
          "style-src 'self' 'unsafe-inline'",
          // Allow map tiles (Azure Maps), data URIs for inline images, and HTTPS images.
          "img-src 'self' data: https: blob:",
          // Temporary Azure domains remain until the map/auth cutovers complete. The target
          // stack is Vercel + Clerk + Supabase + Sentry.
          "connect-src 'self' https://atlas.microsoft.com https://login.microsoftonline.com https://*.clerk.accounts.dev https://*.clerk.com https://*.supabase.co https://*.sentry.io",
          "font-src 'self'",
          "object-src 'none'",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "upgrade-insecure-requests",
        ].join('; '),
      },
    ];

    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
