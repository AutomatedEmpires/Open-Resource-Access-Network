// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { createEmptyResourceSubmissionDraft } from '@/domain/resourceSubmission';
import { previewResourceSubmissionAssist } from '@/services/resourceSubmissions/assistShared';

const fetchMock = vi.hoisted(() => vi.fn());
const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => toastMocks,
}));

vi.mock('@/components/ui/PageHeader', () => ({
  PageHeader: ({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
      {actions}
    </div>
  ),
  PageHeaderBadge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/components/ui/category-picker', () => ({
  CategoryPicker: () => <div data-testid="category-picker" />,
}));

vi.mock('@/components/resource-submissions/CoTagSuggestionPanel', () => ({
  CoTagSuggestionPanel: () => <div data-testid="co-tag-suggestions" />,
}));

vi.mock('@/components/ui/phone-editor', () => ({
  PhoneEditor: () => <div data-testid="phone-editor" />,
}));

vi.mock('@/components/ui/schedule-editor', () => ({
  ScheduleEditor: () => <div data-testid="schedule-editor" />,
}));

import { ResourceSubmissionWorkspace } from '@/components/resource-submissions/ResourceSubmissionWorkspace';

function makeDetail(options: {
  status?: string;
  variant?: 'listing' | 'claim';
} = {}) {
  const status = options.status ?? 'draft';
  const variant = options.variant ?? 'listing';
  const draft = createEmptyResourceSubmissionDraft(variant, 'host');
  draft.evidence.sourceUrl = 'https://example.org/pantry';

  return {
    instance: {
      id: 'entry-1',
      submission_id: 'submission-1',
      submission_type: variant === 'claim' ? 'org_claim' : 'new_service',
      status,
      created_at: '2026-03-17T12:00:00.000Z',
    },
    draft,
    cards: [],
    reviewMeta: {
      status,
      submittedAt: null,
      reviewedAt: null,
      resolvedAt: null,
      reverifyAt: null,
      reviewerNotes: null,
      assignedToUserId: null,
      assignedToLabel: null,
      submittedByUserId: null,
      submittedByLabel: null,
      reviewedByUserId: null,
      reviewedByLabel: null,
      sourceRecordId: null,
      confidenceScore: null,
    },
    transitions: [],
  };
}

describe('ResourceSubmissionWorkspace assist flow', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('analyzes a source URL and applies suggestions into the canonical draft', async () => {
    const detail = makeDetail();
    const patch = {
      organization: {
        name: 'Helping Hands',
        description: 'A nonprofit coordinating weekly pantry and delivery support.',
      },
      service: {
        name: 'Helping Hands Pantry',
        description: 'Weekly grocery pickup and referral support for county residents.',
      },
      taxonomy: {
        categories: ['food'],
      },
      evidence: {
        notes: 'Verified from the official provider site.',
      },
    };
    const preview = previewResourceSubmissionAssist(detail.draft, patch);

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ detail }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          assist: {
            patch,
            changedFields: preview.changedFields,
            cardsBefore: preview.cardsBefore,
            cardsAfter: preview.cardsAfter,
            source: {
              requestedUrl: 'https://example.org/pantry',
              canonicalUrl: 'https://example.org/pantry',
              title: 'Helping Hands Pantry',
              metaDescription: 'Weekly grocery support.',
              wordCount: 124,
            },
            summary: {
              llmUsed: false,
              confidence: 72,
              categoriesSuggested: ['food'],
              warnings: ['LLM assist is not configured. Applied source-based suggestions only.'],
            },
          },
        }),
      });

    render(
      <ResourceSubmissionWorkspace
        portal="host"
        initialVariant="listing"
        initialChannel="host"
        pageTitle="Resource studio"
        pageEyebrow="Host"
        pageSubtitle="Create or refine a resource record"
        entryId="entry-1"
      />,
    );

    await screen.findByLabelText('Source URL');

    fireEvent.click(screen.getByRole('button', { name: 'Analyze source' }));

    await screen.findByText('Analysis summary');
    expect(screen.getByText('Source-only fallback')).toBeInTheDocument();
    expect(screen.getByText('service.name')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/resource-submissions/entry-1/assist', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('https://example.org/pantry'),
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Apply suggestions' }));

    await waitFor(() => {
      expect((document.getElementById('resource-org-name') as HTMLInputElement | null)?.value).toBe('Helping Hands');
      expect((document.getElementById('resource-service-name') as HTMLInputElement | null)?.value).toBe('Helping Hands Pantry');
      expect((document.getElementById('resource-evidence-notes') as HTMLTextAreaElement | null)?.value).toBe('Verified from the official provider site.');
    });

    expect(screen.queryByText('Analysis summary')).not.toBeInTheDocument();
    expect(toastMocks.success).toHaveBeenCalledWith('Applied source suggestions to the canonical form.');
  });

  it('shows a recoverable error state when initialization fails before any draft loads', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Database not configured.' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ detail: makeDetail(), publicAccessToken: 'public-token' }),
      });

    render(
      <ResourceSubmissionWorkspace
        portal="public"
        initialVariant="listing"
        initialChannel="public"
        pageTitle="Submit a Resource"
        pageEyebrow="Community contribution"
        pageSubtitle="Share a resource"
        backHref="/submit-resource"
        backLabel="Back to submission home"
      />,
    );

    await screen.findByText('Resource workspace unavailable');
    expect(screen.getByText('Database not configured.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry workspace' }));

    expect((await screen.findAllByText('Listing basics')).length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('announces that a first claim approval still requires another administrator', async () => {
    const needsReview = makeDetail({ status: 'needs_review', variant: 'claim' });
    const pending = makeDetail({ status: 'pending_second_approval', variant: 'claim' });
    fetchMock.mockImplementation(async (_url: string, options?: RequestInit) => (
      options?.method === 'PUT' ? {
        ok: true,
        json: async () => ({ detail: pending, pendingSecondApproval: true, projection: null }),
      } : {
        ok: true,
        json: async () => ({ detail: needsReview }),
      }
    ));

    render(
      <ResourceSubmissionWorkspace
        portal="oran_admin"
        initialVariant="claim"
        initialChannel="host"
        pageTitle="Claim review"
        pageEyebrow="ORAN Admin"
        pageSubtitle="Review organization ownership evidence."
        entryId="entry-1"
      />,
    );

    await screen.findByRole('button', { name: 'Approve' });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(toastMocks.info).toHaveBeenCalledWith(
        'First approval recorded. A different administrator must provide final approval.',
      );
    });
    expect(screen.queryByRole('button', { name: 'Start review' })).not.toBeInTheDocument();
  });

  it('retries approved projection without resubmitting immutable draft content', async () => {
    const approved = makeDetail({ status: 'approved', variant: 'claim' });
    fetchMock.mockImplementation(async (_url: string, options?: RequestInit) => (
      options?.method === 'PUT' ? {
        ok: true,
        json: async () => ({
          detail: approved,
          projectionRepair: true,
          projection: { organizationId: 'org-1', serviceId: null },
        }),
      } : {
        ok: true,
        json: async () => ({ detail: approved }),
      }
    ));

    render(
      <ResourceSubmissionWorkspace
        portal="oran_admin"
        initialVariant="claim"
        initialChannel="host"
        pageTitle="Claim review"
        pageEyebrow="ORAN Admin"
        pageSubtitle="Review organization ownership evidence."
        entryId="entry-1"
      />,
    );

    await screen.findByRole('button', { name: 'Approve' });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(toastMocks.success).toHaveBeenCalledWith('Approved resource projection verified.');
    });
    const putCall = fetchMock.mock.calls.find((call) => call[1]?.method === 'PUT');
    const requestBody = JSON.parse(putCall?.[1]?.body as string) as Record<string, unknown>;
    expect(requestBody).toMatchObject({ action: 'approve' });
    expect(requestBody).not.toHaveProperty('draft');
    expect(requestBody).not.toHaveProperty('notes');
  });
});
