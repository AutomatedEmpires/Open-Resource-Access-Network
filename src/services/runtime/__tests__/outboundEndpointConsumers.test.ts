import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sentryInitMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@sentry/nextjs', () => ({
  init: sentryInitMock,
  captureRouterTransitionStart: vi.fn(),
  captureRequestError: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VITEST', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('generic outbound endpoint consumers', () => {
  it('rejects a Microsoft NEXT_PUBLIC_SITE_URL while constructing site metadata', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://oran.azurewebsites.net');

    await expect(import('@/lib/site')).rejects.toThrow(
      'NEXT_PUBLIC_SITE_URL uses a prohibited Microsoft endpoint',
    );
  });

  it('rejects Microsoft Sentry DSNs before every SDK initialization surface', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://public@oran.monitor.azure.com/1');

    await expect(import('../../../sentry.server.config')).rejects.toThrow(
      'NEXT_PUBLIC_SENTRY_DSN uses a prohibited Microsoft endpoint',
    );
    await expect(import('../../../sentry.edge.config')).rejects.toThrow(
      'NEXT_PUBLIC_SENTRY_DSN uses a prohibited Microsoft endpoint',
    );
    await expect(import('../../../instrumentation-client')).rejects.toThrow(
      'NEXT_PUBLIC_SENTRY_DSN uses a prohibited Microsoft endpoint',
    );
    expect(sentryInitMock).not.toHaveBeenCalled();
  });

  it('rejects a late Microsoft Sentry DSN in the telemetry accessor', async () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://public@oran.monitor.azure.com/1');
    const { captureMessage } = await import('@/services/telemetry/sentry');

    await expect(captureMessage('safe structural event')).rejects.toThrow(
      'NEXT_PUBLIC_SENTRY_DSN uses a prohibited Microsoft endpoint',
    );
    expect(sentryInitMock).not.toHaveBeenCalled();
  });

  it('revalidates the sitemap base immediately before its network request', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://openresourceaccessnetwork.com');
    vi.stubGlobal('fetch', fetchMock);
    const { SITE } = await import('@/lib/site');
    (SITE as { baseUrl: string }).baseUrl = 'https://oran.azurewebsites.net';
    const { default: sitemap } = await import('@/app/sitemap');

    await expect(sitemap()).rejects.toThrow('sitemap base URL uses a prohibited Microsoft endpoint');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
