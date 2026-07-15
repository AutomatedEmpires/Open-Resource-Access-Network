// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());
const resourceWorkspaceSpy = vi.hoisted(() => vi.fn());
const navigationState = vi.hoisted(() => ({
  searchParams: new URLSearchParams('id=q-1'),
}));
const authState = vi.hoisted(() => ({
  role: 'community_admin' as 'community_admin' | 'oran_admin',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => navigationState.searchParams,
}));

vi.mock('@/services/auth/client', () => ({
  useSession: () => ({
    data: {
      user: {
        id: 'current-user',
        role: authState.role,
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

const FRESHNESS_FINDING_ID = '11111111-1111-4111-8111-111111111111';
const FRESHNESS_SCHEDULE_ID = '22222222-2222-4222-8222-222222222222';
const FRESHNESS_SERVICE_ID = '33333333-3333-4333-8333-333333333333';

function makeQueueDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'q-1',
    service_id: 'svc-1',
    status: 'under_review',
    submitted_by_user_id: 'submitter-1',
    assigned_to_user_id: 'current-user',
    assigned_to_display_name: 'Current Reviewer',
    is_locked: true,
    locked_by_user_id: 'current-user',
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
    payload: {},
    schedules: [],
    transitions: [],
    ...overrides,
  };
}

function makeFreshnessPacket() {
  return {
    schemaVersion: 1,
    findingId: FRESHNESS_FINDING_ID,
    signal: 'explicit_expiry',
    requiredAction: 'correct_expired_schedule',
    hold: {
      actor: 'system:resource-freshness-scan',
      reason: `resource_freshness:explicit_expiry:${FRESHNESS_FINDING_ID}`,
    },
    observed: {
      detectedAsOf: '2026-07-01T12:00:00.000Z',
      signalObservedAt: '2026-07-01T12:00:00.000Z',
      freshnessThresholdDays: null,
      serviceUpdatedAt: '2026-01-01T12:00:00.000Z',
      lastSourceRefreshAt: '2026-01-02T12:00:00.000Z',
      lastCandidateVerifiedAt: null,
      lastManualVerificationAt: null,
      reverifyAt: null,
      schedule: {
        totalCount: 1,
        datedCount: 1,
        maxValidTo: '2026-06-30',
      },
    },
    reviewRequirements: {
      evidenceRequired: true,
      scheduleCorrectionRequiredBeforeApproval: true,
    },
  };
}

function makeFreshnessSchedule() {
  return {
    id: FRESHNESS_SCHEDULE_ID,
    service_id: FRESHNESS_SERVICE_ID,
    location_id: null,
    location_name: null,
    valid_from: '2026-01-01',
    valid_to: '2026-06-30',
    days: ['monday'],
    opens_at: '09:00',
    closes_at: '17:00',
    description: 'Direct service intake hours',
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  navigationState.searchParams = new URLSearchParams('id=q-1');
  authState.role = 'community_admin';
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

  it.each([
    ['submitted', 'Submitted', '/queue?status=submitted'],
    ['needs_review', 'Needs Review', '/queue?status=needs_review'],
  ])('locks terminal decisions for %s work until it is claimed', async (status, label, queueHref) => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueDetail({ status }),
      });

    render(<VerifyPage />);

    expect(await screen.findByRole('heading', { name: 'Claim required before decision' })).toBeInTheDocument();
    expect(screen.getByText(`This item is currently ${label.toLowerCase()}.`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit Decision' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to queue and claim' })).toHaveAttribute('href', queueHref);
  });

  it.each([
    {
      name: 'another reviewer owns the assignment and lock',
      overrides: {
        assigned_to_user_id: 'reviewer-2',
        assigned_to_display_name: 'Reviewer Two',
        is_locked: true,
        locked_by_user_id: 'reviewer-2',
      },
    },
    {
      name: 'the assignment matches but the lock does not',
      overrides: {
        assigned_to_user_id: 'current-user',
        assigned_to_display_name: 'Current Reviewer',
        is_locked: true,
        locked_by_user_id: 'reviewer-2',
        payload: { resourceFreshness: makeFreshnessPacket() },
        schedules: [makeFreshnessSchedule()],
      },
    },
  ])('keeps decision controls read-only when $name', async ({ overrides }) => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueDetail(overrides),
      });

    render(<VerifyPage />);

    expect(await screen.findByRole('heading', { name: 'Review ownership required' })).toBeInTheDocument();
    expect(screen.getByText(/Decision controls are read-only until you hold both/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit Decision' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit freshness review' })).not.toBeInTheDocument();
  });

  it('routes escalated freshness work to ORAN without presenting it as already reviewed', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueDetail({
          status: 'escalated',
          payload: { resourceFreshness: makeFreshnessPacket() },
          schedules: [makeFreshnessSchedule()],
        }),
      });

    const communityView = render(<VerifyPage />);

    expect(await screen.findByRole('heading', { name: 'Waiting for ORAN review' })).toBeInTheDocument();
    expect(screen.getByText(/Only an ORAN admin can claim this escalation/i)).toBeInTheDocument();
    expect(screen.queryByText(/already been reviewed/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit freshness review' })).not.toBeInTheDocument();

    communityView.unmount();
    fetchMock.mockReset();
    authState.role = 'oran_admin';
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueDetail({
          status: 'escalated',
          payload: { resourceFreshness: makeFreshnessPacket() },
          schedules: [makeFreshnessSchedule()],
        }),
      });

    render(<VerifyPage />);

    expect(await screen.findByRole('heading', { name: 'ORAN claim required before decision' })).toBeInTheDocument();
    expect(screen.getByText(/An ORAN admin must claim this escalation/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to queue and claim' })).toHaveAttribute(
      'href',
      '/queue?status=escalated',
    );
    expect(screen.queryByText(/already been reviewed/i)).not.toBeInTheDocument();
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
        json: async () => makeQueueDetail({ status: 'under_review' }),
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

  it('submits valid scanner-created work through the structured freshness contract', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueDetail({
          service_id: FRESHNESS_SERVICE_ID,
          status: 'under_review',
          payload: { resourceFreshness: makeFreshnessPacket() },
          schedules: [makeFreshnessSchedule()],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: 'Freshness review resolved' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueDetail({
          service_id: FRESHNESS_SERVICE_ID,
          status: 'approved',
          payload: { resourceFreshness: makeFreshnessPacket() },
          schedules: [{ ...makeFreshnessSchedule(), valid_to: '2026-12-31' }],
        }),
      });

    render(<VerifyPage />);

    await screen.findByRole('heading', { name: 'Resource freshness review' });
    fireEvent.click(screen.getByRole('radio', { name: 'Corrected and reverified' }));
    fireEvent.change(screen.getByLabelText('Corrected end date'), {
      target: { value: '2026-12-31' },
    });
    fireEvent.change(screen.getByLabelText(/Verification method/i), {
      target: { value: 'provider_website' },
    });
    fireEvent.change(screen.getByLabelText('Evidence URL'), {
      target: { value: 'https://provider.example.org/current-hours' },
    });
    fireEvent.change(screen.getByLabelText(/Reviewer summary/i), {
      target: { value: 'Corrected the direct schedule and verified the provider website.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit freshness review' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    const request = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/community/queue/q-1',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(JSON.parse(String(request.body))).toEqual({
      freshnessReview: {
        schemaVersion: 1,
        outcome: 'corrected',
        verificationMethod: 'provider_website',
        checkedAt: expect.any(String),
        evidenceUrl: 'https://provider.example.org/current-hours',
        scheduleCorrections: [{
          scheduleId: FRESHNESS_SCHEDULE_ID,
          validFrom: '2026-01-01',
          validTo: '2026-12-31',
        }],
        reviewerSummary: 'Corrected the direct schedule and verified the provider website.',
      },
    });
    expect(await screen.findByText('Freshness review resolved')).toBeInTheDocument();
  });

  it('fails closed when resourceFreshness is present but malformed', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueDetail({
          status: 'under_review',
          payload: { resourceFreshness: { schemaVersion: 99 } },
        }),
      });

    render(<VerifyPage />);

    expect(await screen.findByRole('heading', { name: 'Freshness review packet is invalid' })).toBeInTheDocument();
    expect(screen.getByText(/No decision can be recorded from this page/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit Decision' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit freshness review' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rebuild review packet' })).not.toBeInTheDocument();
    expect(screen.getByText(/An ORAN administrator can rebuild only the packet/i)).toBeInTheDocument();
  });

  it('lets an ORAN admin rebuild an invalid packet from authoritative evidence', async () => {
    authState.role = 'oran_admin';
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueDetail({
          payload: { keep: 'unrelated', resourceFreshness: { schemaVersion: 99 } },
          requires_structured_freshness_review: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, id: 'q-1', findingId: FRESHNESS_FINDING_ID }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueDetail({
          payload: { keep: 'unrelated', resourceFreshness: makeFreshnessPacket() },
          requires_structured_freshness_review: true,
          schedules: [makeFreshnessSchedule()],
        }),
      });

    render(<VerifyPage />);

    expect(await screen.findByRole('heading', { name: 'Freshness review packet is invalid' })).toBeInTheDocument();
    const repairButton = screen.getByRole('button', { name: 'Rebuild review packet' });
    expect(repairButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Repair reason/i), {
      target: { value: '  Restore the packet after detecting a malformed scanner payload.  ' },
    });
    expect(repairButton).toBeEnabled();
    fireEvent.click(repairButton);

    await screen.findByRole('heading', { name: 'Resource freshness review' });
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/admin/resource-freshness/q-1/repair',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: 'Restore the packet after detecting a malformed scanner payload.',
        }),
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/resource-submissions/q-1');
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/community/queue/q-1');
    expect(screen.getByText(/rebuilt from the authoritative finding/i)).toBeInTheDocument();
  });

  it('fails closed when the database finding remains open but its packet key is missing', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'not found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeQueueDetail({
          status: 'under_review',
          payload: {},
          requires_structured_freshness_review: true,
        }),
      });

    render(<VerifyPage />);

    expect(await screen.findByRole('heading', { name: 'Freshness review packet is invalid' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit Decision' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit freshness review' })).not.toBeInTheDocument();
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
