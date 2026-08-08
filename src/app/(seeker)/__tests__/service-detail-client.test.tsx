// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());
const navigationState = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));
const PREFS_KEY = 'oran:preferences';

vi.mock('next/navigation', () => ({
  useRouter: () => ({}),
  useSearchParams: () => navigationState.searchParams,
}));

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  SkeletonCard: () => <div data-testid="skeleton-card">Loading…</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    toast: vi.fn(),
  }),
}));

vi.mock('@/components/directory/ServiceCard', () => ({
  ServiceCard: ({
    enriched,
    isSaved,
    onToggleSave,
  }: {
    enriched: { service: { id: string; name: string } };
    isSaved: boolean;
    onToggleSave: (id: string) => void;
  }) => (
    <div data-testid="service-card">
      <p>{enriched.service.name}</p>
      <p>{isSaved ? 'saved' : 'not-saved'}</p>
      <button type="button" onClick={() => onToggleSave(enriched.service.id)}>
        toggle-save
      </button>
    </div>
  ),
}));

import ServiceDetailPage from '@/app/(seeker)/service/[id]/ServiceDetailClient';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  localStorage.clear();
  document.title = 'ORAN';
  navigationState.searchParams = new URLSearchParams();
  global.fetch = fetchMock as unknown as typeof fetch;
});

function makeService(id = 'svc-1', name = 'Food Pantry') {
  return {
    service: {
      id,
      name,
      description: 'Provides weekly groceries',
      url: 'https://example.org/service',
    },
    organization: {
      id: 'org-1',
      name: 'Helping Hands',
    },
    phones: [{ id: 'phone-1', number: '555-0100', extension: '9' }],
    schedules: [{ id: 'schedule-1', description: 'Mon-Fri 9am-5pm' }],
    eligibility: [{ description: 'Adults 18+', minimumAge: 18, maximumAge: null }],
    requiredDocuments: [{ document: 'Photo ID' }],
    languages: [{ id: 'lang-1', language: 'English' }],
    accessibility: [{ id: 'acc-1', accessibility: 'Wheelchair accessible' }],
    contacts: [{ id: 'contact-1', name: 'Case Manager', title: 'Intake', email: 'help@example.org' }],
    serviceAreas: [{ id: 'area-1', name: 'Seattle', extentType: 'city' }],
    attributes: [{ id: 'attr-1', tag: 'walk_in', taxonomy: 'access' }],
    taxonomyTerms: [{ id: 'tax-1', term: 'Food Pantry' }],
  };
}

describe('ServiceDetailClient', () => {
  it('marks not found immediately when serviceId is missing', async () => {
    render(<ServiceDetailPage serviceId="" />);

    await screen.findByText('Service not found');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows not found UI when the API returns 404', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    render(<ServiceDetailPage serviceId="missing-service" />);

    await screen.findByText('Service not found');
    expect(screen.getAllByRole('link', { name: 'Browse directory' })[0]).toHaveAttribute('href', '/directory');
  });

  it('renders a fetched service and toggles saved state with local + server sync', async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ serverSyncEnabled: true }));
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [makeService()] }),
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });

    render(<ServiceDetailPage serviceId="svc-1" />);

    await screen.findByTestId('service-card');
    expect(screen.getAllByText('Food Pantry').length).toBeGreaterThan(0);
    expect(document.title).toBe('Food Pantry | ORAN');
    expect(screen.getByText('not-saved')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Record confidence and eligibility' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Access and availability' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Contact and next steps' })).toBeInTheDocument();
    expect(screen.getByText('555-0100 ext. 9')).toBeInTheDocument();
    expect(screen.getByText('Adults 18+ · Age 18 or older')).toBeInTheDocument();
    expect(screen.getByText(/Wheelchair accessible/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to browse' })).toHaveAttribute(
      'href',
      '/directory?taxonomyIds=tax-1&attributes=%7B%22access%22%3A%5B%22walk_in%22%5D%7D',
    );
    expect(screen.getByRole('link', { name: 'Ask chat for alternatives' })).toHaveAttribute(
      'href',
      '/chat?taxonomyIds=tax-1&attributes=%7B%22access%22%3A%5B%22walk_in%22%5D%7D',
    );
    expect(screen.getByRole('link', { name: 'See nearby options on the map' })).toHaveAttribute(
      'href',
      '/map?taxonomyIds=tax-1&attributes=%7B%22access%22%3A%5B%22walk_in%22%5D%7D',
    );

    fireEvent.click(screen.getByRole('button', { name: 'toggle-save' }));

    await waitFor(() => {
      expect(screen.getByText('saved')).toBeInTheDocument();
      expect(localStorage.getItem('oran:saved-service-ids')).toBe('["svc-1"]');
      expect(fetchMock).toHaveBeenCalledWith('/api/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId: 'svc-1' }),
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'toggle-save' }));

    await waitFor(() => {
      expect(screen.getByText('not-saved')).toBeInTheDocument();
      expect(localStorage.getItem('oran:saved-service-ids')).toBe('[]');
      expect(fetchMock).toHaveBeenCalledWith('/api/saved', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId: 'svc-1' }),
      });
    });
  });

  it('renders structured hours and type-correct contact actions', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{
          ...makeService(),
          phones: [
            { id: 'sms-1', number: '555-0101', type: 'sms' },
            { id: 'fax-1', number: '555-0102', type: 'fax' },
            { id: 'voice-1', number: '555-0103', type: 'voice', locationId: 'loc-1' },
          ],
          schedules: [
            { id: 'mon', locationId: 'loc-1', days: ['MO'], opensAt: '09:00', closesAt: '17:00' },
            { id: 'tue', locationId: 'loc-1', days: ['TU'], opensAt: '09:00', closesAt: '17:00' },
          ],
        }],
      }),
    });

    render(<ServiceDetailPage serviceId="svc-1" />);

    await screen.findByTestId('service-card');
    expect(screen.getByText('Mon, Tue · 9:00 AM–5:00 PM')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Text Food Pantry: 555-0101' })).toHaveAttribute('href', 'sms:555-0101');
    expect(screen.getByRole('link', { name: 'Call Food Pantry: 555-0103' })).toHaveAttribute('href', 'tel:555-0103');
    expect(screen.getByText('555-0102')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /555-0102/ })).not.toBeInTheDocument();
  });

  it('keeps saves local-only when cross-device sync is off', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [makeService()] }),
    });

    render(<ServiceDetailPage serviceId="svc-1" />);

    await screen.findByTestId('service-card');

    fireEvent.click(screen.getByRole('button', { name: 'toggle-save' }));

    await waitFor(() => {
      expect(screen.getByText('saved')).toBeInTheDocument();
      expect(localStorage.getItem('oran:saved-service-ids')).toBe('["svc-1"]');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'toggle-save' }));

    await waitFor(() => {
      expect(screen.getByText('not-saved')).toBeInTheDocument();
      expect(localStorage.getItem('oran:saved-service-ids')).toBe('[]');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows error state on server failures and renders breadcrumb navigation', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    render(<ServiceDetailPage serviceId="svc-error" />);

    await screen.findByText('Could not load service');
    expect(screen.getByText('Failed to fetch service')).toBeInTheDocument();
    // Breadcrumb renders a Directory crumb for orientation
    expect(screen.getByText('Directory')).toBeInTheDocument();
  });

  it('renders provenance with source, corroboration, and honest review state', async () => {
    const service = {
      ...makeService(),
      provenance: {
        serviceId: 'svc-1',
        origin: 'official_feed',
        sourceName: '211 National Data Platform',
        sourceCount: 2,
        firstSeenAt: '2026-01-05T00:00:00.000Z',
        informationUpdatedAt: '2026-07-01T00:00:00.000Z',
        lastHumanReviewAt: null,
      },
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [service] }),
    });

    render(<ServiceDetailPage serviceId="svc-1" />);

    await screen.findByTestId('service-card');
    expect(screen.getByText('Where this information comes from')).toBeInTheDocument();
    expect(screen.getByText('An official publisher feed — 211 National Data Platform')).toBeInTheDocument();
    expect(screen.getByText('Combined from 2 independent sources')).toBeInTheDocument();
    expect(screen.getByText('Jul 1, 2026')).toBeInTheDocument();
    expect(screen.getByText('Jan 5, 2026')).toBeInTheDocument();
    // No review evidence => no review claim.
    expect(screen.getByText('No independent review date is recorded for this record')).toBeInTheDocument();
  });

  it('renders provider-submission provenance with the reviewer approval date', async () => {
    const service = {
      ...makeService(),
      provenance: {
        serviceId: 'svc-1',
        origin: 'provider_submission',
        sourceName: 'The provider organization, through the ORAN host portal',
        sourceCount: null,
        firstSeenAt: null,
        informationUpdatedAt: '2026-06-20T00:00:00.000Z',
        lastHumanReviewAt: '2026-06-20T00:00:00.000Z',
      },
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [service] }),
    });

    render(<ServiceDetailPage serviceId="svc-1" />);

    await screen.findByTestId('service-card');
    expect(screen.getByText(/Submitted by the provider organization/)).toBeInTheDocument();
    expect(screen.getByText('Approved by an ORAN reviewer on Jun 20, 2026')).toBeInTheDocument();
  });

  it('states unknown origin honestly and omits the section when attribution is unavailable', async () => {
    const unknownService = {
      ...makeService(),
      provenance: {
        serviceId: 'svc-1',
        origin: 'unknown',
        sourceName: null,
        sourceCount: null,
        firstSeenAt: null,
        informationUpdatedAt: null,
        lastHumanReviewAt: null,
      },
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [unknownService] }),
    });

    render(<ServiceDetailPage serviceId="svc-1" />);
    await screen.findByTestId('service-card');
    expect(screen.getByText('Not recorded for this record')).toBeInTheDocument();
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(0);

    cleanup();

    // provenance null (lookup unavailable) => section absent, nothing implied.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ ...makeService(), provenance: null }] }),
    });
    render(<ServiceDetailPage serviceId="svc-1" />);
    await screen.findByTestId('service-card');
    expect(screen.queryByText('Where this information comes from')).not.toBeInTheDocument();
  });

  it('preserves incoming canonical discovery state in browse links', async () => {
    const taxonomyId = 'a1000000-4000-4000-8000-000000000001';
    navigationState.searchParams = new URLSearchParams(
      `q=food&category=food_assistance&confidence=HIGH&sort=name_desc&taxonomyIds=${taxonomyId}&attributes=%7B%22delivery%22%3A%5B%22virtual%22%5D%7D&page=2`,
    );
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [makeService()] }),
    });

    render(<ServiceDetailPage serviceId="svc-1" />);

    await screen.findByTestId('service-card');
    expect(screen.getByText('Current browse scope')).toBeInTheDocument();
    expect(screen.getByText('Need: Food')).toBeInTheDocument();
    expect(screen.getByText('Record confidence: High confidence only')).toBeInTheDocument();
    expect(screen.getByText('Sort: Name (Z-A)')).toBeInTheDocument();
    expect(screen.getByText('Delivery: Virtual')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Back to browse' })).toHaveAttribute(
      'href',
      `/directory?q=food&confidence=HIGH&sort=name_desc&category=food_assistance&taxonomyIds=${taxonomyId}&attributes=%7B%22delivery%22%3A%5B%22virtual%22%5D%7D&page=2`,
    );
    expect(screen.getByRole('link', { name: 'Ask chat for alternatives' })).toHaveAttribute(
      'href',
      `/chat?q=food&confidence=HIGH&sort=name_desc&category=food_assistance&taxonomyIds=${taxonomyId}&attributes=%7B%22delivery%22%3A%5B%22virtual%22%5D%7D&page=2`,
    );
    expect(screen.getByRole('link', { name: 'See nearby options on the map' })).toHaveAttribute(
      'href',
      `/map?q=food&confidence=HIGH&sort=name_desc&category=food_assistance&taxonomyIds=${taxonomyId}&attributes=%7B%22delivery%22%3A%5B%22virtual%22%5D%7D&page=2`,
    );
  });
});
