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
  SkeletonCard: () => <div data-testid="locations-skeleton">Loading…</div>,
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

import LocationsPage from '@/app/(host)/locations/page';

function orgsResponse() {
  return {
    results: [{ id: 'org-1', name: 'Helping Hands' }],
  };
}

function locationsResponse(overrides: Record<string, unknown> = {}) {
  return {
    results: [
      {
        id: 'loc-1',
        organization_id: 'org-1',
        organization_name: 'Helping Hands',
        name: 'Downtown Office',
        address_1: '123 Main St',
        city: 'Seattle',
        state_province: 'WA',
        postal_code: '98101',
        latitude: 47.61,
        longitude: -122.33,
        primary_service_id: 'svc-1',
        primary_service_name: 'Food Pantry',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
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

describe('host locations page', () => {
  it('loads org options and location cards on mount', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => orgsResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => locationsResponse() });

    render(<LocationsPage />);

    await screen.findByText('Downtown Office');
    expect(screen.getByText('123 Main St, Seattle, WA, 98101')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/host/organizations?limit=100');
    expect(fetchMock).toHaveBeenCalledWith('/api/host/locations?page=1&limit=12');
    expect(screen.getByRole('link', { name: 'Add Location' })).toHaveAttribute(
      'href',
      '/resource-studio?compose=listing&organizationId=org-1',
    );
    expect(screen.getByRole('link', { name: 'Open in Studio' })).toHaveAttribute(
      'href',
      '/resource-studio?compose=listing&serviceId=svc-1',
    );
  });

  it('falls back to organization-based Studio links when no primary service exists', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => orgsResponse() })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => locationsResponse({
          results: [
            {
              id: 'loc-2',
              organization_id: 'org-1',
              organization_name: 'Helping Hands',
              name: 'North Office',
              address_1: null,
              city: null,
              state_province: null,
              postal_code: null,
              latitude: null,
              longitude: null,
              primary_service_id: null,
              primary_service_name: null,
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        }),
      });

    render(<LocationsPage />);

    await screen.findByText('North Office');
    expect(screen.getByRole('link', { name: 'Open in Studio' })).toHaveAttribute(
      'href',
      '/resource-studio?compose=listing&organizationId=org-1',
    );
  });

  it('shows the studio-first empty state when no locations exist', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => orgsResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => locationsResponse({ results: [], total: 0 }) });

    render(<LocationsPage />);

    await screen.findByText('No locations found');
    expect(screen.getByRole('link', { name: 'Resource Studio' })).toHaveAttribute(
      'href',
      '/resource-studio?compose=listing&organizationId=org-1',
    );
  });

  it('does not expose a direct delete action on location cards', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => orgsResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => locationsResponse() });

    render(<LocationsPage />);
    await screen.findByText('Downtown Office');
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('applies organization filters and paginates results', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => orgsResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => locationsResponse({ total: 13, hasMore: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => locationsResponse({ total: 13, hasMore: true }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => locationsResponse({ page: 2, total: 13, hasMore: false }),
      });

    render(<LocationsPage />);
    await screen.findByText('Downtown Office');

    fireEvent.change(screen.getByLabelText('Filter by organization'), {
      target: { value: 'org-1' },
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/host/locations?page=1&limit=12&organizationId=org-1');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/host/locations?page=2&limit=12&organizationId=org-1');
    });
  });

  it('keeps location cards studio-only during refresh flows', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => orgsResponse() })
      .mockResolvedValueOnce({ ok: true, json: async () => locationsResponse() });

    render(<LocationsPage />);
    await screen.findByText('Downtown Office');
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in Studio' })).toHaveAttribute(
      'href',
      '/resource-studio?compose=listing&serviceId=svc-1',
    );
  });

  it('handles org-list failures non-fatally and disables the add action', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('orgs unavailable'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          locationsResponse({
            results: [
              {
                id: 'loc-unnamed',
                organization_id: 'org-x',
                organization_name: null,
                name: null,
                address_1: null,
                city: null,
                state_province: null,
                postal_code: null,
                latitude: null,
                longitude: null,
                primary_service_id: null,
                primary_service_name: null,
                created_at: '2026-01-01T00:00:00.000Z',
                updated_at: '2026-01-01T00:00:00.000Z',
              },
            ],
          }),
      });

    render(<LocationsPage />);

    await screen.findByText('Unnamed Location');
    expect(screen.getByRole('button', { name: 'Add Location' })).toBeDisabled();
    expect(screen.queryByText(/Seattle|WA|98101/)).not.toBeInTheDocument();
  });

  it('falls back to generic list-load error when response body is not JSON', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => orgsResponse() })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => {
          throw new Error('bad json');
        },
      });

    render(<LocationsPage />);

    await screen.findByRole('alert');
    expect(screen.getByText('Failed to load locations')).toBeInTheDocument();
  });
});
