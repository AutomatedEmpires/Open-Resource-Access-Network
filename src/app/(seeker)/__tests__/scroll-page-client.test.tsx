// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock('@/components/directory/ServiceCard', () => ({
  ServiceCard: ({ enriched }: { enriched: { service: { name: string } } }) => (
    <article>{enriched.service.name}</article>
  ),
}));
vi.mock('@/components/ui/skeleton', () => ({ SkeletonCard: () => <div>Loading card</div> }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock('@/services/profile/syncPreference', () => ({ isServerSyncEnabledOnDevice: () => false }));
vi.mock('@/services/saved/client', () => ({
  addServerSaved: vi.fn(),
  readStoredSavedServiceIdSet: () => new Set<string>(),
  removeServerSaved: vi.fn(),
  writeStoredSavedServiceIds: vi.fn(),
}));

import ScrollPageClient from '@/app/(seeker)/scroll/ScrollPageClient';

function serviceResult(id: string, name: string, description: string) {
  return {
    service: {
      service: { id, name, description },
      organization: { name: 'Provider' },
      phones: [],
      schedules: [],
      taxonomyTerms: [],
    },
  };
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => cleanup());

describe('ScrollPageClient', () => {
  it('uses saved profile needs and requests the standalone-only feed', async () => {
    localStorage.setItem('oran:seeker-context', JSON.stringify({
      serviceInterests: ['housing'],
      onboardingProfileConsent: true,
    }));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [serviceResult('svc-1', 'Housing navigation', 'Help finding emergency housing.')],
        total: 1,
        page: 1,
        limit: 8,
        hasMore: false,
      }),
    });

    render(<ScrollPageClient />);

    expect(await screen.findByText('Housing navigation')).toBeInTheDocument();
    expect(screen.getByText('Personalization active')).toBeInTheDocument();
    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl).toContain('standaloneOnly=true');
    expect(requestUrl).toContain('q=');
  });

  it('does not render a retailer-only record even if it appears in a response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [
          serviceResult(
            'retailer-1',
            'SNAP/EBT accepted here',
            'Source: USDA FNS SNAP Retailer Locator. This is a place to SPEND SNAP benefits (not a free-food or food-bank site).',
          ),
        ],
        total: 1,
        page: 1,
        limit: 8,
        hasMore: false,
      }),
    });

    render(<ScrollPageClient />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(await screen.findByText('No direct services found yet')).toBeInTheDocument();
    expect(screen.queryByText('SNAP/EBT accepted here')).not.toBeInTheDocument();
  });

  it('has no detectable accessibility violations in its loaded empty state', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [], total: 0, page: 1, limit: 8, hasMore: false }),
    });

    const { container } = render(<ScrollPageClient />);
    expect(await screen.findByText('No direct services found yet')).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });
});
