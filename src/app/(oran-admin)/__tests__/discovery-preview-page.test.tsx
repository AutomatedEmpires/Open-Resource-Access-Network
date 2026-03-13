// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.hoisted(() => vi.fn());
const navigationState = vi.hoisted(() => ({
  pathname: '/discovery-preview',
  searchParams: new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigationState.pathname,
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => navigationState.searchParams,
}));

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

import DiscoveryPreviewPageClient from '@/app/(oran-admin)/discovery-preview/DiscoveryPreviewPageClient';

function makePreviewResponse(overrides: Record<string, unknown> = {}) {
  return {
    results: [
      {
        service: {
          service: {
            id: 'service-1',
            name: 'Food Pantry',
            description: 'Groceries and pantry support.',
          },
          organization: {
            id: 'org-1',
            name: 'Helping Hands',
          },
          confidenceScore: {
            id: 'confidence-1',
            serviceId: 'service-1',
            score: 91,
            verificationConfidence: 93,
          },
        },
      },
    ],
    total: 1,
    hasMore: false,
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  replaceMock.mockReset();
  navigationState.pathname = '/discovery-preview';
  navigationState.searchParams = new URLSearchParams();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('oran admin discovery preview page', () => {
  it('auto-previews canonical discovery state from the URL and rewrites legacy aliases', async () => {
    navigationState.searchParams = new URLSearchParams('category=food&confidence=HIGH');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makePreviewResponse(),
    });

    render(<DiscoveryPreviewPageClient />);

    await screen.findByText('Food Pantry');

    expect(fetchMock).toHaveBeenCalledWith('/api/search?page=1&limit=8&q=food&minConfidenceScore=80');
    expect(replaceMock).toHaveBeenCalledWith(
      '/discovery-preview?q=food&confidence=HIGH&category=food_assistance',
      { scroll: false },
    );
    expect(screen.getByText('Need: Food')).toBeInTheDocument();
  });

  it('compiles manual selector changes into the shared discovery grammar', async () => {
    render(<DiscoveryPreviewPageClient />);
    await screen.findByText('Set a need, text query, trust floor, taxonomy term, or attribute filter to preview the seeker-visible match universe.');

    fireEvent.change(screen.getByLabelText('Primary need'), { target: { value: 'housing' } });
    fireEvent.change(screen.getByLabelText('Trust floor'), { target: { value: 'LIKELY' } });
    fireEvent.change(screen.getByLabelText('Sort order'), { target: { value: 'name_asc' } });
    fireEvent.change(screen.getByLabelText('Taxonomy term IDs'), {
      target: { value: '11111111-1111-4111-8111-111111111111' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Virtual' }));
    await waitFor(() => {
      expect(screen.getByText(/\/api\/search\?page=1&limit=8&q=housing/)).toBeInTheDocument();
    });

    expect(screen.getByText('/api/search?page=1&limit=8&q=housing&taxonomyIds=11111111-1111-4111-8111-111111111111&attributes=%7B%22delivery%22%3A%5B%22virtual%22%5D%7D&minConfidenceScore=60&sortBy=name_asc')).toBeInTheDocument();
    expect(screen.getByText(/"minConfidenceScore": 60/)).toBeInTheDocument();
  });

  it('resets the preview back to a blank grammar state', async () => {
    navigationState.searchParams = new URLSearchParams('category=housing');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makePreviewResponse(),
    });

    render(<DiscoveryPreviewPageClient />);

    await screen.findByText('Food Pantry');
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/discovery-preview', { scroll: false });
    });

    expect(screen.queryByText('Food Pantry')).not.toBeInTheDocument();
  });
});
