import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const manropeMock = vi.hoisted(() => vi.fn(() => ({ variable: '--font-manrope' })));
const spaceGroteskMock = vi.hoisted(() => vi.fn(() => ({ variable: '--font-space-grotesk' })));
const fetchMock = vi.hoisted(() => vi.fn());
const sentryInitMock = vi.hoisted(() => vi.fn());

vi.mock('next/font/google', () => ({
  Manrope: manropeMock,
  Space_Grotesk: spaceGroteskMock,
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
vi.mock('@/services/auth/client', () => ({
  OranAuthProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));
vi.mock('@clerk/nextjs', () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));
vi.mock('@sentry/nextjs', () => ({
  init: sentryInitMock,
  captureRequestError: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
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

async function loadManifest() {
  return import('@/app/manifest');
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
  delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  delete process.env.NEXT_RUNTIME;
});

describe('platform shell', () => {
  it('wraps children with the session provider', async () => {
    const { Providers } = await loadProviders();

    const element = Providers({
      locale: 'en',
      dir: 'ltr',
      messages: {},
      children: 'Child',
    }) as React.ReactElement<any, any>;
    const sessionProvider = element.props.children as React.ReactElement<any, any>;
    const toastProvider = sessionProvider.props.children as React.ReactElement<any, any>;
    const crisisProvider = toastProvider.props.children as React.ReactElement<any, any>;
    const child = crisisProvider.props.children;
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

    expect(result).toHaveLength(21);
    expect(result.at(-1)?.url).toBe('https://openresourceaccessnetwork.com/service/svc-1');
    expect(result.some((entry) => entry.url === 'https://openresourceaccessnetwork.com/trust')).toBe(true);
  });

  it('returns only static pages when the sitemap fetch fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));
    const { default: sitemap } = await loadSitemap();

    const result = await sitemap();

    expect(result).toHaveLength(20);
  });

  it('exports a web manifest for ORAN discovery surfaces', async () => {
    const { default: manifest } = await loadManifest();

    const result = manifest();

    expect(result.short_name).toBe('ORAN');
    expect(result.start_url).toBe('/');
    expect(result.icons?.[0]?.src).toBe('/globe.svg');
  });

  it('skips instrumentation outside server runtimes', async () => {
    const { register } = await loadInstrumentation();

    await register();

    expect(sentryInitMock).not.toHaveBeenCalled();
  });

  it('initializes disabled Sentry instrumentation when no DSN is configured', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    const { register } = await loadInstrumentation();

    await register();

    expect(sentryInitMock).toHaveBeenCalledWith(expect.objectContaining({
      enabled: false,
      sendDefaultPii: false,
    }));
  });

  it('initializes privacy-filtered Sentry when instrumentation is configured', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
    const { register } = await loadInstrumentation();

    await register();

    expect(sentryInitMock).toHaveBeenCalledWith(expect.objectContaining({
      dsn: 'https://public@example.ingest.sentry.io/1',
      enabled: true,
      sendDefaultPii: false,
    }));
  });
});
