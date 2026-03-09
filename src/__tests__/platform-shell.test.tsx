import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const interMock = vi.hoisted(() => vi.fn(() => ({ variable: '--font-sans' })));
const fetchMock = vi.hoisted(() => vi.fn());
const useAzureMonitorMock = vi.hoisted(() => vi.fn());

vi.mock('next/font/google', () => ({
  Inter: interMock,
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => React.createElement('a', { href, ...props }, children),
}));
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    MessageCircle: (props: Record<string, unknown>) => React.createElement('svg', props),
    List: (props: Record<string, unknown>) => React.createElement('svg', props),
    MapPin: (props: Record<string, unknown>) => React.createElement('svg', props),
    Shield: (props: Record<string, unknown>) => React.createElement('svg', props),
    Phone: (props: Record<string, unknown>) => React.createElement('svg', props),
  };
});
vi.mock('@/components/nav/AppNav', () => ({
  AppNav: () => React.createElement('nav', {}, 'AppNav'),
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('button', props, children),
}));
vi.mock('next-auth/react', () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));
vi.mock('applicationinsights', () => ({
  useAzureMonitor: useAzureMonitorMock,
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) }),
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));

async function loadRootLayout() {
  return import('@/app/layout');
}

async function loadHomePage() {
  return import('@/app/page');
}

async function loadProviders() {
  return import('@/app/providers');
}

async function loadSitemap() {
  return import('@/app/sitemap');
}

async function loadInstrumentation() {
  return import('@/instrumentation');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      results: [{ service: { id: 'svc-1' } }],
    }),
  });
  useAzureMonitorMock.mockReturnValue(undefined);
  delete process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  delete process.env.NEXT_RUNTIME;
});

describe('platform shell', () => {
  it('wraps children with the session provider', async () => {
    const { Providers } = await loadProviders();

    const element = Providers({ children: 'Child' }) as React.ReactElement<any, any>;
    const toastProvider = element.props.children as React.ReactElement<any, any>;

    // ToastProvider now wraps CrisisProvider which wraps children
    const inner = toastProvider.props.children;
    const child = typeof inner === 'string' ? inner : inner?.props?.children;
    expect(child).toBe('Child');
  });

  it('builds the root layout with skip link and metadata exports', async () => {
    const { default: RootLayout, metadata, viewport } = await loadRootLayout();

    const layout = await RootLayout({ children: 'Child' }) as React.ReactElement<any, any>;
    const body = React.Children.only(layout.props.children) as React.ReactElement<any, any>;
    const bodyChildren = React.Children.toArray(body.props.children) as React.ReactElement<any, any>[];
    const skipLink = bodyChildren.find((child) => child?.props?.href === '#main-content');

    expect(layout.props.lang).toBe('en');
    expect(skipLink?.props.href).toBe('#main-content');
    expect(metadata.title && typeof metadata.title).toBe('object');
    expect(viewport.initialScale).toBe(1);
  });

  it('builds the home page shell and exports landing metadata', async () => {
    const { default: Home, metadata } = await loadHomePage();

    const element = Home() as React.ReactElement<any, any>;
    const children = React.Children.toArray(element.props.children) as React.ReactElement<any, any>[];
    const main = children.find((child) => child?.props?.id === 'main-content') as React.ReactElement<any, any>;

    expect(metadata.title).toBe('ORAN — Open Resource Access Network');
    expect(main.props.id).toBe('main-content');
  });

  it('builds a sitemap including fetched service detail pages', async () => {
    const { default: sitemap } = await loadSitemap();

    const result = await sitemap();

    expect(result).toHaveLength(5);
    expect(result.at(-1)?.url).toBe('https://openresourceaccessnetwork.com/service/svc-1');
  });

  it('returns only static pages when the sitemap fetch fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));
    const { default: sitemap } = await loadSitemap();

    const result = await sitemap();

    expect(result).toHaveLength(4);
  });

  it('skips instrumentation outside the node runtime', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { register } = await loadInstrumentation();

    await register();

    expect(useAzureMonitorMock).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('logs and skips instrumentation when no connection string is configured', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { register } = await loadInstrumentation();

    await register();

    expect(logSpy).toHaveBeenCalledWith(
      '[instrumentation] APPLICATIONINSIGHTS_CONNECTION_STRING not set — skipping Azure Monitor.',
    );
    expect(useAzureMonitorMock).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('initializes Azure Monitor when instrumentation is configured', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.APPLICATIONINSIGHTS_CONNECTION_STRING = 'InstrumentationKey=test';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { register } = await loadInstrumentation();

    await register();

    expect(useAzureMonitorMock).toHaveBeenCalledOnce();
    expect(logSpy).toHaveBeenCalledWith('[instrumentation] Azure Monitor initialized.');
    logSpy.mockRestore();
  });
});
