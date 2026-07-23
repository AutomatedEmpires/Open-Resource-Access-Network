// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock('@/components/ui/skeleton', () => ({
  SkeletonCard: () => <div role="status">Loading candidate reviews…</div>,
}));

import CandidateReviewsPage from '@/app/(community-admin)/candidate-reviews/page';

const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111';
const ASSIGNMENT_ID = '22222222-2222-4222-8222-222222222222';

function response(body: unknown) {
  return { ok: true, status: 200, json: vi.fn().mockResolvedValue(body) };
}

function inbox(assignmentStatus: 'pending' | 'claimed') {
  return {
    results: [{
      candidate_id: CANDIDATE_ID,
      assignment_status: assignmentStatus,
      expires_at: null,
      candidate_review_status: assignmentStatus === 'pending' ? 'pending' : 'in_review',
      organization_name: 'Community Bridge',
      service_name: 'Emergency housing',
      description: 'Short-term placement and navigation.',
      website_url: 'https://example.org/housing',
      jurisdiction_state: 'WA',
      jurisdiction_county: 'King',
      jurisdiction_city: 'Seattle',
      confidence_tier: 'green',
      confidence_score: 91,
    }],
    total: 1,
    page: 1,
    hasMore: false,
  };
}

function detail(status: 'pending' | 'claimed' | 'completed') {
  return {
    candidate: {
      fields: {
        organizationName: 'Community Bridge',
        serviceName: 'Emergency housing',
        description: 'Short-term placement and navigation.',
        websiteUrl: 'https://example.org/housing',
      },
      review: { status: status === 'pending' ? 'pending' : 'in_review' },
    },
    currentUserAssignment: {
      id: ASSIGNMENT_ID,
      status,
      outcome: status === 'completed' ? 'verified' : null,
      expires_at: null,
    },
    assignmentProgress: {
      completedReviewCount: status === 'completed' ? 1 : 0,
      openReviewCount: status === 'completed' ? 1 : 2,
      requiredMatchingReviewCount: 2,
    },
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('community candidate review inbox', () => {
  it('lets an assigned community admin discover, claim, and decide without out-of-band IDs', async () => {
    fetchMock
      .mockResolvedValueOnce(response(inbox('pending')))
      .mockResolvedValueOnce(response(detail('pending')))
      .mockResolvedValueOnce(response({ success: true, status: 'claimed' }))
      .mockResolvedValueOnce(response(detail('claimed')))
      .mockResolvedValueOnce(response(inbox('claimed')))
      .mockResolvedValueOnce(response({
        success: true,
        status: 'in_review',
        approvalCount: 1,
        rejectionCount: 0,
      }))
      .mockResolvedValueOnce(response(detail('completed')))
      .mockResolvedValueOnce(response({ results: [], total: 0, page: 1, hasMore: false }));

    render(<CandidateReviewsPage />);

    expect(await screen.findByText('Emergency housing')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }));

    expect(await screen.findByRole('button', { name: 'Claim review' })).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/api/admin/ingestion/candidates/${CANDIDATE_ID}`,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Claim review' }));

    const approve = await screen.findByRole('button', { name: 'Approve' });
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      `/api/admin/ingestion/candidates/${CANDIDATE_ID}/approval`,
    );
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      action: 'claim',
      assignmentId: ASSIGNMENT_ID,
    });

    fireEvent.click(approve);

    await waitFor(() => {
      expect(fetchMock.mock.calls[5]?.[0]).toBe(
        `/api/admin/ingestion/candidates/${CANDIDATE_ID}/approval`,
      );
    });
    expect(JSON.parse(String(fetchMock.mock.calls[5]?.[1]?.body))).toEqual({
      action: 'decide',
      assignmentId: ASSIGNMENT_ID,
      decision: 'approved',
    });
    expect(await screen.findByText(/Your independent decision is complete/)).toBeInTheDocument();
  });
});
