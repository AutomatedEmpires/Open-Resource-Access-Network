// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());
const resourceWorkspaceSpy = vi.hoisted(() => vi.fn());
const navigationState = vi.hoisted(() => ({
  searchParams: new URLSearchParams('id=q-1'),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => navigationState.searchParams,
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: {
      user: {
        id: 'current-user',
      },
    },
  }),
}));

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="verify-skeleton" className={className}>
      Loading...
    </div>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    asChild: _asChild,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => (
    <button {...props}>{children}</button>
  ),
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

vi.mock('@/components/resource-submissions/ResourceSubmissionWorkspace', () => ({
  ResourceSubmissionWorkspace: (props: Record<string, unknown>) => {
    resourceWorkspaceSpy(props);
    return <div>resource review workspace</div>;
  },
}));

import VerifyPage from '@/app/(community-admin)/verify/page';

function makeQueueDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'q-1',
    service_id: 'svc-1',
    status: 'submitted',
    submitted_by_user_id: 'submitter-1',
    assigned_to_user_id: null,
    notes: 'Needs normal verification',
    created_at: '2026-02-01T10:00:00.000Z',
    updated_at: '2026-02-03T10:00:00.000Z',
    service_name: 'Housing Navigator',
    service_description: 'Helps people find emergency housing.',
    service_url: 'https://housing.example.org',
    service_email: 'support@housing.example.org',
    service_status: 'active',
    organization_id: 'org-1',
    organization_name: 'Helping Hands',
    organization_url: 'https://helpinghands.example.org',
    organization_email: 'info@helpinghands.example.org',
    organization_description: 'Regional nonprofit',
    locations: [
      {
        id: 'loc-1',
        name: 'Downtown Office',
        address_1: '123 Main St',
        city: 'Austin',
        state_province: 'TX',
        postal_code: '78701',
        latitude: 30.2672,
        longitude: -97.7431,
      },
    ],
    phones: [
      {
        id: 'ph-1',
        number: '555-1212',
        type: 'voice',
        description: 'Main line',
      },
    ],
    confidenceScore: {
      score: 82,
      verification_confidence: 90,
      eligibility_match: 80,
      constraint_fit: 76,
      computed_at: '2026-02-03T11:00:00.000Z',
    },
    eligibility: [
      {
        id: 'el-1',
        description: 'Adults experiencing homelessness',
        minimum_age: 18,
        maximum_age: null,
        eligible_values: ['homeless'],
      },
    ],
    required_documents: [
      {
        id: 'doc-1',
        document: 'Photo ID',
        type: 'identity',
        uri: 'https://example.org/doc/id',
      },
    ],
    languages: [
      {
        id: 'lang-1',
        language: 'en',
        note: 'primary',
      },
    ],
    accessibility: [
      {
        id: 'acc-1',
        accessibility: 'wheelchair_accessible',
        details: 'Ramp entrance',
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  navigationState.searchParams = new URLSearchParams('id=q-1');
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('community admin verify page', () => {
  it('shows a no-selection state when no queue entry id is provided', () => {
    navigationState.searchParams = new URLSearchParams();

    render(<VerifyPage />);

    expect(screen.getByText('No entry selected')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'review queue' })).toHaveAttribute('href', '/queue');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows fetch errors and retries successfully', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'not found' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'entry lookup failed' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueDetail(),
      });

    render(<VerifyPage />);

    await screen.findByText('entry lookup failed');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/resource-submissions/q-1');
      expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/community/queue/q-1');
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/resource-submissions/q-1');
      expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/community/queue/q-1');
      expect(screen.getByRole('heading', { name: 'Housing Navigator' })).toBeInTheDocument();
    });
  });

  it('renders loaded details, fallback hostname text, and reviewed-state panel', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeQueueDetail({
            status: 'approved',
            service_url: 'not-a-valid-url',
            confidenceScore: null,
            assigned_to_user_id: 'reviewer-1',
            assigned_to_display_name: 'reviewer-1',
          }),
      });

    render(<VerifyPage />);

    await screen.findByRole('heading', { name: 'Housing Navigator' });
    expect(screen.getByText('not-a-valid-url')).toBeInTheDocument();
    expect(screen.getByText('No confidence score yet')).toBeInTheDocument();
    expect(screen.getByText('This entry has already been reviewed (Approved).')).toBeInTheDocument();
    expect(screen.getByText('reviewer-1')).toBeInTheDocument();
  });

  it('submits a rejection decision, trims notes, and refreshes entry data', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueDetail(),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Decision recorded' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueDetail({ status: 'denied' }),
      });

    render(<VerifyPage />);
    await screen.findByRole('heading', { name: 'Housing Navigator' });

    fireEvent.click(screen.getByLabelText(/Reject/));
    const submitButton = screen.getByRole('button', { name: 'Submit Decision' });
    expect(submitButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Notes/), {
      target: { value: '  Missing required docs  ' },
    });
    expect(submitButton).toBeEnabled();

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/community/queue/q-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'denied',
          notes: 'Missing required docs',
        }),
      });
      expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/resource-submissions/q-1');
      expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/community/queue/q-1');
      expect(screen.getByText('Decision recorded')).toBeInTheDocument();
      expect(screen.getByText('This entry has already been reviewed (Denied).')).toBeInTheDocument();
    });
  });

  it('shows decision submission failures from the API', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueDetail(),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'review lock conflict' }),
      });

    render(<VerifyPage />);
    await screen.findByRole('heading', { name: 'Housing Navigator' });

    fireEvent.click(screen.getByLabelText(/Verify/));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Decision' }));

    await screen.findByRole('alert');
    expect(screen.getByText('review lock conflict')).toBeInTheDocument();
  });

  it('renders compact detail state when optional fields are absent and status is unknown', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () =>
          makeQueueDetail({
            status: 'unknown_status',
            service_description: null,
            service_url: null,
            service_email: null,
            organization_description: null,
            organization_url: null,
            organization_email: null,
            notes: null,
            assigned_to_user_id: null,
            locations: [],
            phones: [],
            eligibility: [],
            required_documents: [],
            languages: [],
            accessibility: [],
            confidenceScore: null,
          }),
      });

    render(<VerifyPage />);

    await screen.findByRole('heading', { name: 'Housing Navigator' });
    expect(screen.getByText('No confidence score yet')).toBeInTheDocument();
    expect(screen.queryByText(/Locations \(/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Phone Numbers \(/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Eligibility Criteria \(/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Required Documents \(/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Languages \(/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Accessibility \(/i)).not.toBeInTheDocument();
    expect(screen.getByText(/already been reviewed/i)).toBeInTheDocument();
  });

  it('submits an approval decision without notes and omits notes from payload', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueDetail({ status: 'under_review' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Approved successfully' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueDetail({ status: 'approved' }),
      });

    render(<VerifyPage />);
    await screen.findByRole('heading', { name: 'Housing Navigator' });

    fireEvent.click(screen.getByLabelText(/Verify/));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Decision' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/community/queue/q-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'approved',
          notes: undefined,
        }),
      });
      expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/resource-submissions/q-1');
      expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/community/queue/q-1');
      expect(screen.getByText('Approved successfully')).toBeInTheDocument();
    });
  });

  it('requires notes for escalation and submits once notes are provided', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueDetail({ status: 'needs_review' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Escalated to ORAN' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueDetail({ status: 'escalated' }),
      });

    render(<VerifyPage />);
    await screen.findByRole('heading', { name: 'Housing Navigator' });

    fireEvent.click(screen.getByLabelText(/Escalate/));
    const submitButton = screen.getByRole('button', { name: 'Submit Decision' });
    expect(submitButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Notes/), {
      target: { value: '  Needs second-level review  ' },
    });
    expect(submitButton).toBeEnabled();
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/community/queue/q-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: 'escalated',
          notes: 'Needs second-level review',
        }),
      });
      expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/resource-submissions/q-1');
      expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/community/queue/q-1');
      expect(screen.getByText('Escalated to ORAN')).toBeInTheDocument();
    });
  });

  it('shows fallback message when detail fetch throws a non-Error value', async () => {
    fetchMock.mockRejectedValueOnce('network-down');

    render(<VerifyPage />);

    await screen.findByText('Failed to load entry');
  });

  it('shows fallback decision error when API failure has no JSON body', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueDetail(),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => {
          throw new Error('bad-json');
        },
      });

    render(<VerifyPage />);
    await screen.findByRole('heading', { name: 'Housing Navigator' });

    fireEvent.click(screen.getByLabelText(/Verify/));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Decision' }));

    await screen.findByRole('alert');
    expect(screen.getByText('Decision submission failed')).toBeInTheDocument();
  });

  it('renders the shared resource workspace when the submission is form-backed', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        detail: {
          instance: { id: 'form-1' },
        },
      }),
    });

    render(<VerifyPage />);

    await screen.findByText('resource review workspace');
    expect(resourceWorkspaceSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        portal: 'community_admin',
        entryId: 'q-1',
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/resource-submissions/q-1');
  });
});
