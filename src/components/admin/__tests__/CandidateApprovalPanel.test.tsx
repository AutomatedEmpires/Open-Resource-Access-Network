// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CandidateApprovalPanel } from '../CandidateApprovalPanel';

const fetchMock = vi.hoisted(() => vi.fn());
const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111';
const ASSIGNMENT_ID = '22222222-2222-4222-8222-222222222222';

function response(body: unknown, ok = true, status = 200) {
  return { ok, status, json: vi.fn().mockResolvedValue(body) };
}

function detail(
  status: 'pending' | 'claimed' | 'completed',
  websiteUrl = 'https://example.org/housing',
) {
  return {
    candidate: {
      fields: {
        organizationName: 'Community Bridge',
        serviceName: 'Emergency housing',
        description: 'Short-term placement and navigation.',
        websiteUrl,
      },
      review: { status: 'in_review' },
    },
    currentUserAssignment: {
      id: ASSIGNMENT_ID,
      status,
      outcome: status === 'completed' ? 'verified' : null,
      expires_at: null,
    },
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('CandidateApprovalPanel', () => {
  it('loads the current reviewer assignment and claims it', async () => {
    const changed = vi.fn();
    fetchMock
      .mockResolvedValueOnce(response(detail('pending')))
      .mockResolvedValueOnce(response({ success: true, status: 'claimed' }))
      .mockResolvedValueOnce(response(detail('claimed')));

    render(
      <CandidateApprovalPanel candidateId={CANDIDATE_ID} onClose={vi.fn()} onChanged={changed} />,
    );

    await screen.findByText('Emergency housing');
    fireEvent.click(screen.getByRole('button', { name: 'Claim review' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        `/api/admin/ingestion/candidates/${CANDIDATE_ID}/approval`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'claim', assignmentId: ASSIGNMENT_ID }),
        }),
      );
      expect(changed).toHaveBeenCalledOnce();
    });
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('submits notes and an approval only after the assignment is claimed', async () => {
    fetchMock
      .mockResolvedValueOnce(response(detail('claimed')))
      .mockResolvedValueOnce(response({
        success: true,
        status: 'in_review',
        approvalCount: 1,
        rejectionCount: 0,
      }))
      .mockResolvedValueOnce(response(detail('completed')));

    render(<CandidateApprovalPanel candidateId={CANDIDATE_ID} onClose={vi.fn()} />);

    const notes = await screen.findByLabelText('Review notes (optional)');
    fireEvent.change(notes, { target: { value: ' Verified source and current intake. ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        `/api/admin/ingestion/candidates/${CANDIDATE_ID}/approval`,
        expect.objectContaining({
          body: JSON.stringify({
            action: 'decide',
            assignmentId: ASSIGNMENT_ID,
            decision: 'approved',
            notes: 'Verified source and current intake.',
          }),
        }),
      );
    });
    expect(await screen.findByText(/Your independent decision is complete/)).toBeInTheDocument();
  });

  it('does not display raw server failures', async () => {
    fetchMock
      .mockResolvedValueOnce(response(detail('pending')))
      .mockResolvedValueOnce(response({ error: 'postgres://secret-host/internal details' }, false, 500));

    render(<CandidateApprovalPanel candidateId={CANDIDATE_ID} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Claim review' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The review action could not be completed.',
    );
    expect(screen.queryByText(/secret-host/)).not.toBeInTheDocument();
  });

  it('requires a substantive note and explicit confirmation for rejection', async () => {
    fetchMock
      .mockResolvedValueOnce(response(detail('claimed')))
      .mockResolvedValueOnce(response({ success: true, status: 'escalated' }))
      .mockResolvedValueOnce(response(detail('completed')));

    render(<CandidateApprovalPanel candidateId={CANDIDATE_ID} onClose={vi.fn()} />);
    const notes = await screen.findByLabelText('Review notes (optional)');

    fireEvent.change(notes, { target: { value: 'too short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 20 characters');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.change(notes, { target: { value: 'The source no longer offers this stated service.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Confirm rejection');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm rejection' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        `/api/admin/ingestion/candidates/${CANDIDATE_ID}/approval`,
        expect.objectContaining({
          body: JSON.stringify({
            action: 'decide',
            assignmentId: ASSIGNMENT_ID,
            decision: 'rejected',
            notes: 'The source no longer offers this stated service.',
          }),
        }),
      );
    });
  });

  it.each([
    'javascript:alert(document.domain)',
    'data:text/html,<script>alert(1)</script>',
    'https://user:password@example.org/private',
  ])('never renders an unsafe extracted source URL: %s', async (websiteUrl) => {
    fetchMock.mockResolvedValueOnce(response(detail('claimed', websiteUrl)));

    render(<CandidateApprovalPanel candidateId={CANDIDATE_ID} onClose={vi.fn()} />);
    await screen.findByText('Emergency housing');

    expect(screen.queryByRole('link', { name: 'Review source page' })).not.toBeInTheDocument();
  });
});
