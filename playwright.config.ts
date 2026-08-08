import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PORT ?? 3000);
const remoteBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
const webServerCommand = process.env.PLAYWRIGHT_WEB_SERVER_COMMAND?.trim() || 'npm run dev';
const baseURL = remoteBaseUrl || `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      pathTemplate: `{testDir}/{testFilePath}-snapshots/{arg}-{projectName}-{platform}-${process.arch}{ext}`,
    },
  },
  // Hosted acceptance may mutate a resettable preview database. Serialize it
  // and disable retries so a failed lifecycle cannot be replayed concurrently.
  fullyParallel: !remoteBaseUrl,
  retries: remoteBaseUrl ? 0 : process.env.CI ? 2 : 0,
  workers: remoteBaseUrl ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: remoteBaseUrl ? undefined : {
    command: webServerCommand,
    url: `http://localhost:${port}`,
    // Avoid reusing an already-running local dev server that may not have
    // ORAN E2E auth env vars (causes flaky auth callback failures).
    reuseExistingServer: process.env.PW_REUSE_SERVER === '1',
    timeout: 120_000,
    env: {
      ...process.env,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '',
      CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ?? '',
      PORT: String(port),
    },
  },
  projects: [
    {
      name: 'clerk setup',
      testMatch: /global\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(chromiumExecutablePath
          ? { launchOptions: { executablePath: chromiumExecutablePath } }
          : {}),
      },
      dependencies: ['clerk setup'],
    },
  ],
});
