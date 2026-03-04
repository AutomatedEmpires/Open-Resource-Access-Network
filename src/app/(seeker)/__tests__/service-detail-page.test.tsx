import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/app/(seeker)/service/[id]/ServiceDetailClient', () => ({
  default: 'service-detail-client',
}));

async function loadServiceDetailPage() {
  return import('@/app/(seeker)/service/[id]/page');
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
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      results: [
        {
          service: {
            id: 'svc-1',
            name: 'Food Pantry',
            description: 'A'.repeat(180),
            url: 'https://example.org/services/food-pantry',
          },
          organization: {
            name: 'Helping Hands',
          },
          location: {
            address: '123 Main St',
          },
          phones: [{ number: '555-0100' }],
        },
      ],
    }),
  });
});

describe('service detail page', () => {
  it('builds rich metadata from the fetched service record', async () => {
    const { generateMetadata } = await loadServiceDetailPage();

    const metadata = await generateMetadata({
      params: Promise.resolve({ id: 'svc-1' }),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://openresourceaccessnetwork.com/api/services?ids=svc-1',
      { next: { revalidate: 3600 } },
    );
    expect(metadata.title).toBe('Food Pantry — Helping Hands');
    expect(metadata.description).toBe(`${'A'.repeat(155)}...`.replace('...', '…'));
    expect(metadata.alternates?.canonical).toBe('/service/svc-1');
    expect(metadata.openGraph?.url).toBe('https://openresourceaccessnetwork.com/service/svc-1');
  });

  it('falls back to non-indexed metadata when the service lookup fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
    });
    const { generateMetadata } = await loadServiceDetailPage();

    const metadata = await generateMetadata({
      params: Promise.resolve({ id: 'missing' }),
    });

    expect(metadata).toEqual({
      title: 'Service Details',
      robots: { index: false },
    });
  });

  it('renders JSON-LD scripts when metadata is available and always includes the client view', async () => {
    const { default: ServiceDetailPage } = await loadServiceDetailPage();

    const element = await ServiceDetailPage({
      params: Promise.resolve({ id: 'svc-1' }),
    });
    const scripts = collectElements(element, (child) => child.type === 'script');
    const client = collectElements(element, (child) => child.type === 'service-detail-client')[0];
    const breadcrumb = JSON.parse(scripts[0].props.dangerouslySetInnerHTML.__html) as {
      itemListElement: Array<{ name: string }>;
    };
    const service = JSON.parse(scripts[1].props.dangerouslySetInnerHTML.__html) as {
      name: string;
      provider: { name: string };
      contactPoint: { telephone: string };
    };

    expect(scripts).toHaveLength(2);
    expect(breadcrumb.itemListElement[2].name).toBe('Food Pantry');
    expect(service.name).toBe('Food Pantry');
    expect(service.provider.name).toBe('Helping Hands');
    expect(service.contactPoint.telephone).toBe('555-0100');
    expect(client.props.serviceId).toBe('svc-1');
  });

  it('omits JSON-LD scripts when the service lookup fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));
    const { default: ServiceDetailPage } = await loadServiceDetailPage();

    const element = await ServiceDetailPage({
      params: Promise.resolve({ id: 'svc-2' }),
    });
    const scripts = collectElements(element, (child) => child.type === 'script');
    const client = collectElements(element, (child) => child.type === 'service-detail-client')[0];

    expect(scripts).toHaveLength(0);
    expect(client.props.serviceId).toBe('svc-2');
  });
});
