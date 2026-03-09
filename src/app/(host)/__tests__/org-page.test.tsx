// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  SkeletonCard: () => <div data-testid="org-skeleton">Loading…</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/toast', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => ({
    toast: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

import OrgDashboardPage from '@/app/(host)/org/page';

function makeListResponse(overrides: Record<string, unknown> = {}) {
  return {
    results: [
      {
        id: 'org-1',
        name: 'Helping Hands',
        description: 'Community org',
        url: 'https://helpinghands.example.org',
        email: 'info@helpinghands.example.org',
      },
    ],
    total: 1,
    page: 1,
    hasMore: false,
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('host org dashboard page', () => {
  it('loads organizations and exposes Studio-first actions', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeListResponse(),
    });

    render(<OrgDashboardPage />);

    await screen.findByText('Helping Hands');
    expect(screen.getByText('Community org')).toBeInTheDocument();
    expect(screen.getByText('Page 1 · 1 total')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/host/organizations?page=1&limit=12');
    expect(screen.getByRole('link', { name: 'Resource Studio' })).toHaveAttribute(
      'href',
      '/resource-studio?compose=listing',
    );
    expect(screen.getByRole('link', { name: 'Claim' })).toHaveAttribute(
      'href',
      '/resource-studio?compose=claim',
    );
    expect(screen.getByRole('link', { name: 'Edit in Studio' })).toHaveAttribute(
      'href',
      '/resource-studio?compose=listing&organizationId=org-1',
    );
  });

  it('applies search queries through the list endpoint', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => makeListResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => makeListResponse() });

    render(<OrgDashboardPage />);
    await screen.findByText('Helping Hands');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search organizations' }), {
      target: { value: 'helping' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith('/api/host/organizations?page=1&limit=12&q=helping');
    });
  });

  it('shows the Studio-first empty state when no organizations exist', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeListResponse({ results: [], total: 0 }),
    });

    render(<OrgDashboardPage />);

    await screen.findByText('No organizations found');
    expect(screen.getByRole('link', { name: 'Claim an organization' })).toHaveAttribute(
      'href',
      '/resource-studio?compose=claim',
    );
  });

  it('does not expose a direct archive action on organization cards', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => makeListResponse() });

    render(<OrgDashboardPage />);
    await screen.findByText('Helping Hands');
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('renders API load failures from organization listing', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'host organizations unavailable' }),
    });

    render(<OrgDashboardPage />);

    await screen.findByRole('alert');
    expect(screen.getByText('host organizations unavailable')).toBeInTheDocument();
  });

  it('supports pagination without a direct archive mutation path', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeListResponse({ total: 13, hasMore: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeListResponse({
            page: 2,
            total: 13,
            hasMore: false,
            results: [
              {
                id: 'org-2',
                name: 'Neighborhood Hub',
                description: 'Second page org',
                url: null,
                email: null,
              },
            ],
          }),
      });

    render(<OrgDashboardPage />);
    await screen.findByText('Helping Hands');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Neighborhood Hub');
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/host/organizations?page=2&limit=12');
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});
