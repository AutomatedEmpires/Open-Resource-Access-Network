/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // applicationinsights uses dynamic require() internally (diagnostic-channel-publishers).
  // Turbopack cannot statically resolve dynamic requires, so these packages must be treated
  // as external Node.js modules rather than bundled by Turbopack.
  serverExternalPackages: ['applicationinsights', 'diagnostic-channel-publishers'],
  async headers() {
    const securityHeaders = [
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      {
        key: 'Permissions-Policy',
        value:
          'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
      },
      {
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          // Next.js requires 'unsafe-inline' for styles (Tailwind CSS injects styles at build time)
          // and 'unsafe-eval' in development for HMR/Fast Refresh.
          // In production, only 'unsafe-inline' is needed for Tailwind.
          process.env.NODE_ENV === 'development'
            ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
            : "script-src 'self' 'unsafe-inline'",
          // Tailwind CSS requires 'unsafe-inline' for its generated styles.
          "style-src 'self' 'unsafe-inline'",
          // Allow map tiles (Azure Maps), data URIs for inline images, and HTTPS images.
          "img-src 'self' data: https: blob:",
          // Allow connections to self, Azure Maps, Azure AD, Application Insights, Sentry.
          "connect-src 'self' https://atlas.microsoft.com https://login.microsoftonline.com https://*.applicationinsights.azure.com https://*.sentry.io",
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

export default nextConfig;
