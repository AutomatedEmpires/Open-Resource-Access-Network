import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
const headersMock = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({
  headers: headersMock,
}));

vi.mock('@/app/org/[id]/OrgProfileClient', () => ({
  default: 'org-profile-client',
}));

async function loadOrgPage() {
  return import('@/app/org/[id]/page');
}

function collectElements(
  node: React.ReactNode,
  predicate: (element: React.ReactElement<any, any>) => boolean,
): React.ReactElement<any, any>[] {
  const elements: React.ReactElement<any, any>[] = [];

  const visit = (value: React.ReactNode) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!React.isValidElement(value)) {
      return;
    }

    const element = value as React.ReactElement<any, any>;
    if (predicate(element)) {
      elements.push(element);
    }
    visit(element.props.children);
  };

  visit(node);
  return elements;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  global.fetch = fetchMock as unknown as typeof fetch;
  headersMock.mockResolvedValue(
    new Headers([
      ['host', 'oran.test'],
      ['x-forwarded-proto', 'https'],
    ]),
  );

  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      organization: {
        id: 'org-1',
        name: 'Helping Hands',
        description: 'B'.repeat(180),
        url: 'https://helpinghands.example.org',
      },
      serviceCount: 2,
    }),
  });
});

describe('org profile page (server component)', () => {
  it('builds metadata from organization API response', async () => {
    const { generateMetadata } = await loadOrgPage();

    const metadata = await generateMetadata({
      params: Promise.resolve({ id: 'org-1' }),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://oran.test/api/organizations/org-1',
      { next: { revalidate: 3600 } },
    );
    expect(metadata.title).toBe('Helping Hands');
    expect(metadata.description).toBe(`${'B'.repeat(155)}…`);
    expect(metadata.alternates?.canonical).toBe('/org/org-1');
    expect(metadata.openGraph?.url).toBe('https://oran.test/org/org-1');
  });

  it('uses template description when organization description is empty', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        organization: { name: 'No Desc Org', description: '', url: null },
        serviceCount: 1,
      }),
    });

    const { generateMetadata } = await loadOrgPage();
    const metadata = await generateMetadata({
      params: Promise.resolve({ id: 'org-empty' }),
    });

    expect(metadata.description).toBe(
      'No Desc Org offers 1 service through the Open Resource Access Network.',
    );
  });

  it('returns non-index metadata when API lookup fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });

    const { generateMetadata } = await loadOrgPage();
    const metadata = await generateMetadata({
      params: Promise.resolve({ id: 'missing-org' }),
    });

    expect(metadata).toEqual({
      title: 'Organization Profile',
      robots: { index: false },
    });
  });

  it('falls back to canonical base URL when headers lookup fails', async () => {
    headersMock.mockRejectedValueOnce(new Error('headers unavailable'));

    const { generateMetadata } = await loadOrgPage();
    const metadata = await generateMetadata({
      params: Promise.resolve({ id: 'org-1' }),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://openresourceaccessnetwork.com/api/organizations/org-1',
      { next: { revalidate: 3600 } },
    );
    expect(metadata.openGraph?.url).toBe('https://openresourceaccessnetwork.com/org/org-1');
  });

  it('renders JSON-LD script when org metadata is available and escapes unsafe characters', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        organization: {
          name: 'Safety Org',
          description: 'Contains <script>alert(1)</script>',
          url: null,
        },
        serviceCount: 0,
      }),
    });

    const { default: OrgPage } = await loadOrgPage();
    const element = await OrgPage({ params: Promise.resolve({ id: 'org-safe' }) });

    const scripts = collectElements(element, (child) => child.type === 'script');
    const client = collectElements(element, (child) => child.type === 'org-profile-client')[0];

    expect(scripts).toHaveLength(1);
    const jsonLdRaw = scripts[0].props.dangerouslySetInnerHTML.__html as string;
    expect(jsonLdRaw).toContain('\\u003cscript>');

    const jsonLd = JSON.parse(jsonLdRaw) as { name: string; url: string };
    expect(jsonLd.name).toBe('Safety Org');
    expect(jsonLd.url).toBe('https://oran.test/org/org-safe');
    expect(client.props.orgId).toBe('org-safe');
  });

  it('renders only the client component when org metadata cannot be fetched', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const { default: OrgPage } = await loadOrgPage();
    const element = await OrgPage({ params: Promise.resolve({ id: 'org-404' }) });

    const scripts = collectElements(element, (child) => child.type === 'script');
    const client = collectElements(element, (child) => child.type === 'org-profile-client')[0];

    expect(scripts).toHaveLength(0);
    expect(client.props.orgId).toBe('org-404');
  });
});
