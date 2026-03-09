// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());
const replaceSpy = vi.hoisted(() => vi.fn());
const workspacePropsSpy = vi.hoisted(() => vi.fn());
const navigationState = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => navigationState.searchParams,
  useRouter: () => ({ replace: replaceSpy }),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@/components/resource-submissions/ResourceSubmissionWorkspace', () => ({
  ResourceSubmissionWorkspace: (props: Record<string, unknown>) => {
    workspacePropsSpy(props);
    return <div>resource submission workspace</div>;
  },
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/skeleton', () => ({
  SkeletonCard: () => <div data-testid="studio-skeleton">Loading…</div>,
}));

import ResourceStudioPageClient from '@/app/(host)/resource-studio/ResourceStudioPageClient';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  replaceSpy.mockReset();
  workspacePropsSpy.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  navigationState.searchParams = new URLSearchParams();
});

describe('host resource studio page', () => {
  it('renders the submission hub and filters to host submissions', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ id: 'org-1', name: 'Helping Hands' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 'form-1',
              submissionId: 'sub-1',
              status: 'draft',
              submissionType: 'new_service',
              channel: 'host',
              variant: 'listing',
              title: 'Food Pantry refresh',
              updatedAt: '2026-03-08T10:00:00.000Z',
              submittedAt: null,
              ownerOrganizationId: 'org-1',
              cards: [
                { id: 'organization', title: 'Organization', description: '', state: 'complete', requiredCompleted: 1, requiredTotal: 1, missing: [] },
                { id: 'service', title: 'Service', description: '', state: 'incomplete', requiredCompleted: 0, requiredTotal: 1, missing: ['Service description'] },
                { id: 'review', title: 'Review', description: '', state: 'recommended', requiredCompleted: 1, requiredTotal: 1, missing: [] },
              ],
              summary: {
                organizationName: 'Helping Hands',
                serviceName: 'Food Pantry',
                sourceName: '',
              },
              reviewMeta: {
                submissionId: 'sub-1',
                status: 'draft',
                submissionType: 'new_service',
                targetType: 'organization',
                targetId: 'org-1',
                submittedByUserId: 'user-1',
                submittedByLabel: null,
                assignedToUserId: null,
                assignedToLabel: null,
                reviewedAt: null,
                resolvedAt: null,
                submittedAt: null,
                slaDeadline: null,
                confidenceScore: null,
                verificationConfidence: null,
                reverifyAt: null,
                reviewerNotes: null,
                sourceRecordId: null,
              },
            },
            {
              id: 'form-2',
              submissionId: 'sub-2',
              status: 'draft',
              submissionType: 'new_service',
              channel: 'public',
              variant: 'listing',
              title: 'Should be hidden',
              updatedAt: '2026-03-08T10:00:00.000Z',
              submittedAt: null,
              ownerOrganizationId: null,
              cards: [],
              summary: { organizationName: '', serviceName: '', sourceName: '' },
              reviewMeta: {
                submissionId: 'sub-2',
                status: 'draft',
                submissionType: 'new_service',
                targetType: 'system',
                targetId: null,
                submittedByUserId: 'anon',
                submittedByLabel: null,
                assignedToUserId: null,
                assignedToLabel: null,
                reviewedAt: null,
                resolvedAt: null,
                submittedAt: null,
                slaDeadline: null,
                confidenceScore: null,
                verificationConfidence: null,
                reverifyAt: null,
                reviewerNotes: null,
                sourceRecordId: null,
              },
            },
          ],
        }),
      });

    render(<ResourceStudioPageClient />);

    await screen.findByText('Food Pantry refresh');
    expect(screen.queryByText('Should be hidden')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New listing' })).toHaveAttribute(
      'href',
      '/resource-studio?compose=listing&organizationId=org-1',
    );
    expect(screen.getByRole('link', { name: 'Open cards' })).toHaveAttribute(
      'href',
      '/resource-studio?entryId=form-1',
    );
  });

  it('opens the shared workspace in compose mode and normalizes the URL to entryId', async () => {
    navigationState.searchParams = new URLSearchParams('compose=listing&organizationId=org-1');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ id: 'org-1', name: 'Helping Hands' }] }),
    });

    render(<ResourceStudioPageClient />);

    expect(screen.getByText('resource submission workspace')).toBeInTheDocument();
    expect(workspacePropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        portal: 'host',
        initialVariant: 'listing',
        initialChannel: 'host',
        defaultOwnerOrganizationId: 'org-1',
        backHref: '/resource-studio',
      }),
    );

    const props = workspacePropsSpy.mock.calls[0][0] as {
      onEntryReady: (entry: { instanceId: string; submissionId: string; status: string }) => void;
    };
    props.onEntryReady({ instanceId: 'form-9', submissionId: 'sub-9', status: 'draft' });

    await waitFor(() => {
      expect(replaceSpy).toHaveBeenCalledWith('/resource-studio?entryId=form-9', { scroll: false });
    });
  });
});
