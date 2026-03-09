// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

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

import SubmitResourcePageClient from '@/app/(seeker)/submit-resource/SubmitResourcePageClient';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  replaceSpy.mockReset();
  workspacePropsSpy.mockReset();
  navigationState.searchParams = new URLSearchParams();
  window.localStorage.clear();
});

describe('submit resource page', () => {
  it('renders the start state and surfaces any saved local draft', async () => {
    window.localStorage.setItem('oran:public-resource-submission', JSON.stringify({ id: 'form-4', token: 'secret' }));

    render(<SubmitResourcePageClient />);

    expect(screen.getByRole('link', { name: 'Start submission' })).toHaveAttribute(
      'href',
      '/submit-resource?compose=listing',
    );
    expect(screen.getByRole('link', { name: 'Continue saved draft' })).toHaveAttribute(
      'href',
      '/submit-resource?entryId=form-4',
    );
  });

  it('opens the shared workspace and normalizes to the created entry id', async () => {
    navigationState.searchParams = new URLSearchParams('compose=listing');

    render(<SubmitResourcePageClient />);

    expect(screen.getByText('resource submission workspace')).toBeInTheDocument();
    expect(workspacePropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        portal: 'public',
        initialVariant: 'listing',
        initialChannel: 'public',
        backHref: '/submit-resource',
      }),
    );

    const props = workspacePropsSpy.mock.calls[0][0] as {
      onEntryReady: (entry: { instanceId: string; submissionId: string; status: string }) => void;
    };
    props.onEntryReady({ instanceId: 'form-8', submissionId: 'sub-8', status: 'draft' });

    await waitFor(() => {
      expect(replaceSpy).toHaveBeenCalledWith('/submit-resource?entryId=form-8', { scroll: false });
    });
  });
});
