import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PORT ?? 3000);

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: `http://127.0.0.1:${port}`,
    // Avoid reusing an already-running local dev server that may not have
    // ORAN E2E auth env vars (causes flaky auth callback failures).
    reuseExistingServer: process.env.PW_REUSE_SERVER === '1',
    timeout: 120_000,
    env: {
      ...process.env,
      ORAN_TEST_AUTH_ENABLED: process.env.ORAN_TEST_AUTH_ENABLED ?? '1',
      // Required so next-auth/jwt (Edge middleware) can decode the session token.
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? 'e2e-nextauth-secret',
      NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? `http://127.0.0.1:${port}`,
      // Set dummy Entra vars so RBAC middleware enforces protected routes during e2e.
      // (We still authenticate using the dev-only Credentials provider.)
      AZURE_AD_CLIENT_ID: process.env.AZURE_AD_CLIENT_ID ?? 'e2e-client-id',
      AZURE_AD_CLIENT_SECRET: process.env.AZURE_AD_CLIENT_SECRET ?? 'e2e-client-secret',
      AZURE_AD_TENANT_ID: process.env.AZURE_AD_TENANT_ID ?? 'e2e-tenant-id',
      PORT: String(port),
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
