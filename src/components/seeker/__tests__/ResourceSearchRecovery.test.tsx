// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ResourceSearchRecovery } from '@/components/seeker/ResourceSearchRecovery';

afterEach(cleanup);

describe('ResourceSearchRecovery', () => {
  it('offers a clearly external Washington 211 search and phone handoff', () => {
    render(<ResourceSearchRecovery />);

    expect(screen.getByRole('region', { name: 'Other ways to find help' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Search Washington 211/ })).toHaveAttribute(
      'href',
      'https://search.wa211.org/',
    );
    expect(screen.getByRole('link', { name: 'Call 211' })).toHaveAttribute('href', 'tel:211');
    expect(screen.getByText(/Washington 211 is outside ORAN/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Browse all ORAN listings' })).not.toBeInTheDocument();
  });

  it('optionally offers the complete publication-gated ORAN catalog', () => {
    render(<ResourceSearchRecovery showOranBrowse />);

    expect(screen.getByRole('link', { name: 'Browse all ORAN listings' })).toHaveAttribute(
      'href',
      '/directory',
    );
  });

  it('describes a temporary outage without claiming that search completed', () => {
    render(<ResourceSearchRecovery reason="temporarily_unavailable" />);

    expect(screen.getByText(/could not complete this search right now/i)).toBeInTheDocument();
    expect(screen.getByText(/use Washington 211 while search recovers/i)).toBeInTheDocument();
    expect(screen.queryByText(/will not substitute an unrelated listing/i)).not.toBeInTheDocument();
  });
});
