// @vitest-environment jsdom

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const workspacePropsSpy = vi.hoisted(() => vi.fn());

vi.mock('@/components/resource-submissions/ResourceSubmissionWorkspace', () => ({
  ResourceSubmissionWorkspace: (props: Record<string, unknown>) => {
    workspacePropsSpy(props);
    return <div>resource submission workspace</div>;
  },
}));

import ClaimPage from '@/app/(host)/claim/page';

describe('host claim page', () => {
  it('routes organization claims into the shared resource submission workspace', () => {
    render(<ClaimPage />);

    expect(screen.getByText('resource submission workspace')).toBeInTheDocument();
    expect(workspacePropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        portal: 'host',
        initialVariant: 'claim',
        initialChannel: 'host',
        pageTitle: 'Claim an Organization',
      }),
    );
  });
});
