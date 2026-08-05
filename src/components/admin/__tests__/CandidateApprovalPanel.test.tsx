// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CandidateApprovalPanel } from '../CandidateApprovalPanel';

const fetchMock = vi.hoisted(() => vi.fn());
const CANDIDATE_ID = '11111111-1111-4111-8111-111111111111';
const ASSIGNMENT_ID = '22222222-2222-4222-8222-222222222222';
const CONFIRMATION_ID = '33333333-3333-4333-8333-333333333333';
const SUGGESTION_ID = '44444444-4444-4444-8444-444444444444';

function response(body: unknown, ok = true, status = 200) {
  return { ok, status, json: vi.fn().mockResolvedValue(body) };
}

function detail(
  status: 'pending' | 'claimed' | 'completed',
  websiteUrl = 'https://example.org/housing',
  extra: Record<string, unknown> = {},
) {
  return {
    candidate: {
      fields: {
        organizationName: 'Community Bridge',
        serviceName: 'Emergency housing',
        description: 'Short-term placement and navigation.',
        websiteUrl,
        phone: '208-555-0100',
        address: {
          line1: '100 Main Street',
          city: 'Coeur d’Alene',
          region: 'ID',
          postalCode: '83814',
          country: 'US',
        },
        isRemoteService: false,
      },
      review: { status: 'in_review' },
    },
    tags: [
      { id: 'tag-1', tagType: 'category', tagValue: 'housing', tagConfidence: 92 },
      { id: 'tag-2', tagType: 'geographic', tagValue: 'us_id_kootenai', tagConfidence: 100 },
    ],
    checks: [{
      checkId: 'check-1',
      checkType: 'domain_allowlist',
      severity: 'critical',
      status: 'pass',
      details: { message: 'Official source domain matched.' },
      evidenceRefs: ['evidence-domain'],
    }],
    links: [{
      id: 'link-1',
      url: 'https://example.org/apply',
      label: 'Application page',
      linkType: 'application',
      isVerified: true,
      isLinkAlive: true,
      evidenceId: 'evidence-application',
    }],
    tagConfirmations: [],
    suggestions: [],
    reviewReadiness: {
      canApprove: true,
      hasRequiredFields: true,
      hasRequiredTags: true,
      tagsConfirmed: true,
      meetsScoreThreshold: true,
      passesVerification: true,
      blockers: [],
    },
    canMutateEvidence: status === 'claimed',
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
    ...extra,
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
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Confirm approval');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approval' }));

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

    expect(screen.queryByRole('link', { name: 'Candidate website' })).not.toBeInTheDocument();
  });

  it('renders contact, access, tags, verification, and source evidence without peer outcomes', async () => {
    fetchMock.mockResolvedValueOnce(response(detail('claimed', undefined, {
      assignments: [{ outcome: 'rejected', notes: 'Peer-only rejection evidence' }],
      assignmentProgress: {
        completedReviewCount: 1,
        openReviewCount: 1,
        requiredMatchingReviewCount: 2,
      },
    })));

    render(<CandidateApprovalPanel candidateId={CANDIDATE_ID} onClose={vi.fn()} />);

    expect(await screen.findByText('208-555-0100')).toBeInTheDocument();
    expect(screen.getByText(/100 Main Street, Coeur d’Alene, ID, 83814, US/)).toBeInTheDocument();
    expect(screen.getByText((_: string, element: Element | null) => (
      element?.tagName === 'LI' && element.textContent === 'Category: Housing · 92%'
    ))).toBeInTheDocument();
    expect(screen.getByText('Domain Allowlist')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Application page' })).toHaveAttribute('href', 'https://example.org/apply');
    expect(screen.getByText('Verified link')).toBeInTheDocument();
    expect(screen.queryByText('Peer-only rejection evidence')).not.toBeInTheDocument();
    expect(screen.queryByText(/1 completed/)).not.toBeInTheDocument();
  });

  it('submits a candidate-scoped tag confirmation and reloads canonical detail', async () => {
    const withPendingTag = detail('claimed', undefined, {
      tagConfirmations: [{
        id: CONFIRMATION_ID,
        tagType: 'category',
        suggestedValue: 'housing',
        suggestedConfidence: 74,
        confirmationStatus: 'pending',
        agentReasoning: 'The source describes emergency shelter navigation.',
        evidenceRefs: ['evidence-tag'],
      }],
      reviewReadiness: {
        canApprove: false,
        hasRequiredFields: true,
        hasRequiredTags: true,
        tagsConfirmed: false,
        meetsScoreThreshold: true,
        passesVerification: true,
        blockers: ['pending_tag_confirmation'],
      },
    });
    fetchMock
      .mockResolvedValueOnce(response(withPendingTag))
      .mockResolvedValueOnce(response({ success: true }))
      .mockResolvedValueOnce(response(detail('claimed')));

    render(<CandidateApprovalPanel candidateId={CANDIDATE_ID} onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Decision note (optional)'), {
      target: { value: 'Confirmed from the provider source.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm tag' }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent('Confirm tag confirmation');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Category: Housing');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel evidence decision' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm tag' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm evidence decision' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        `/api/admin/ingestion/candidates/${CANDIDATE_ID}/tags`,
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            confirmationId: CONFIRMATION_ID,
            status: 'confirmed',
            notes: 'Confirmed from the provider source.',
          }),
        }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        `/api/admin/ingestion/candidates/${CANDIDATE_ID}`,
        { signal: undefined },
      );
    });
  });

  it('submits a corrected AI suggestion and explains that pending AI text is excluded', async () => {
    const withSuggestion = detail('claimed', undefined, {
      suggestions: [{
        id: SUGGESTION_ID,
        fieldName: 'intake_process',
        suggestedValue: 'Walk in during business hours.',
        llmConfidence: 61,
        suggestionStatus: 'pending',
        sourceEvidenceRefs: ['evidence-intake'],
      }],
    });
    fetchMock
      .mockResolvedValueOnce(response(withSuggestion))
      .mockResolvedValueOnce(response({ success: true }))
      .mockResolvedValueOnce(response(detail('claimed')));

    render(<CandidateApprovalPanel candidateId={CANDIDATE_ID} onClose={vi.fn()} />);
    expect(await screen.findByText(/Pending suggestions are excluded from publication/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Corrected value'), {
      target: { value: ' Call first to confirm same-day intake. ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save corrected value' }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent('Confirm correction');
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Corrected value: Call first to confirm same-day intake.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm evidence decision' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        `/api/admin/ingestion/candidates/${CANDIDATE_ID}/suggestions`,
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            suggestionId: SUGGESTION_ID,
            status: 'modified',
            acceptedValue: 'Call first to confirm same-day intake.',
          }),
        }),
      );
    });
  });

  it('fails closed and explains blockers when the server readiness gate is not clear', async () => {
    fetchMock.mockResolvedValueOnce(response(detail('claimed', undefined, {
      reviewReadiness: {
        canApprove: false,
        hasRequiredFields: true,
        hasRequiredTags: false,
        tagsConfirmed: true,
        meetsScoreThreshold: true,
        passesVerification: true,
        blockers: ['missing_required_tags'],
      },
    })));

    render(<CandidateApprovalPanel candidateId={CANDIDATE_ID} onClose={vi.fn()} />);

    expect(await screen.findByText('A category and geographic tag are required.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
