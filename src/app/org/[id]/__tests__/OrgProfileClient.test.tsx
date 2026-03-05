// @vitest-environment jsdom

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('lucide-react', () => ({
  ArrowLeft: (props: React.SVGProps<SVGSVGElement>) => <svg data-testid="arrow-left" {...props} />,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  SkeletonCard: () => <div data-testid="skeleton-card">Loading...</div>,
}));

vi.mock('@/components/ui/trust-badge', () => ({
  TrustBadge: ({ level }: { level: string }) => <div data-testid="trust-level">{level}</div>,
}));

import OrgProfileClient from '@/app/org/[id]/OrgProfileClient';

interface OrgDataOverrides {
  organization?: Partial<{
    id: string;
    name: string;
    description: string | null;
    url: string | null;
    email: string | null;
    status: string;
    year_incorporated: number | null;
    logo_url: string | null;
    updated_at: string;
  }>;
  services?: Array<Record<string, unknown>>;
  serviceCount?: number;
}

function makeOrgData(overrides: OrgDataOverrides = {}) {
  const baseServices = [
    {
      id: 'svc-1',
      name: 'Food Pantry',
      description: 'Weekly food distribution',
      url: 'https://helpinghands.example.org/food',
      status: 'active',
      capacity_status: 'available',
      locations: [{ city: 'Seattle', state: 'WA', address: null, postal_code: null }],
    },
    {
      id: 'svc-2',
      name: 'Legal Clinic',
      description: null,
      url: null,
      status: 'active',
      capacity_status: null,
      locations: [],
    },
  ];
  const services = overrides.services ?? baseServices;

  return {
    organization: {
      id: 'org-1',
      name: 'Helping Hands',
      description: 'Community support services',
      url: 'https://helpinghands.example.org',
      email: 'hello@helpinghands.example.org',
      status: 'active',
      year_incorporated: 2010,
      logo_url: 'https://cdn.example.org/logo.png',
      updated_at: '2026-02-15T00:00:00.000Z',
      ...overrides.organization,
    },
    services,
    serviceCount: overrides.serviceCount ?? services.length,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-01T00:00:00.000Z').getTime());
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OrgProfileClient', () => {
  it('shows loading skeletons before API response resolves', async () => {
    fetchMock.mockImplementationOnce(
      () => new Promise(() => {
        // Intentionally unresolved to keep loading state active.
      }),
    );

    render(<OrgProfileClient orgId="org-loading" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('skeleton-card').length).toBeGreaterThanOrEqual(1);
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/organizations/org-loading');
  });

  it('renders organization details, trust badge, and services list on success', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => makeOrgData(),
    });

    render(<OrgProfileClient orgId="org-1" />);

    await screen.findByRole('heading', { name: 'Helping Hands' });
    expect(screen.getByTestId('trust-level')).toHaveTextContent('verified');
    expect(screen.getByText('Community support services')).toBeInTheDocument();
    expect(screen.getByText('https://helpinghands.example.org')).toBeInTheDocument();
    expect(screen.getByText('Email: hello@helpinghands.example.org')).toBeInTheDocument();
    expect(screen.getByText('Founded: 2010')).toBeInTheDocument();
    expect(screen.getByAltText('Helping Hands logo')).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Services (2)' })).toBeInTheDocument();
    expect(screen.getByText('Food Pantry')).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(screen.getByText('Seattle, WA')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Food Pantry/ })).toHaveAttribute('href', '/service/svc-1');

    expect(screen.getByRole('link', { name: /Back to directory/i })).toHaveAttribute('href', '/directory');
  });

  it('shows API-provided error when fetch returns non-OK response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Organization not found in registry' }),
    });

    render(<OrgProfileClient orgId="missing-org" />);

    await screen.findByRole('heading', { name: 'Organization Not Found' });
    expect(screen.getByText('Organization not found in registry')).toBeInTheDocument();
  });

  it('shows status-based error fallback when error payload is not JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('invalid json');
      },
    });

    render(<OrgProfileClient orgId="bad-json" />);

    await screen.findByRole('heading', { name: 'Organization Not Found' });
    expect(screen.getByText('Organization not found (500)')).toBeInTheDocument();
  });

  it('shows no-services state when organization has no active services', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        makeOrgData({
          services: [],
          serviceCount: 0,
        }),
    });

    render(<OrgProfileClient orgId="org-empty-services" />);

    await screen.findByRole('heading', { name: 'Helping Hands' });
    expect(screen.getByText('No active services listed.')).toBeInTheDocument();
  });

  it('maps older updated timestamps to community and unverified trust levels', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeOrgData({
            organization: { updated_at: '2025-10-15T00:00:00.000Z' },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeOrgData({
            organization: { updated_at: '2024-01-01T00:00:00.000Z' },
          }),
      });

    const { rerender } = render(<OrgProfileClient orgId="org-community" />);

    await screen.findByRole('heading', { name: 'Helping Hands' });
    expect(screen.getByTestId('trust-level')).toHaveTextContent('community_verified');

    rerender(<OrgProfileClient orgId="org-unverified" />);
    await screen.findByRole('heading', { name: 'Helping Hands' });
    expect(screen.getByTestId('trust-level')).toHaveTextContent('unverified');
  });
});
