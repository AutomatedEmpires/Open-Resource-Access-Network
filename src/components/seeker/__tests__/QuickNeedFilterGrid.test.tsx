// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QuickNeedFilterGrid } from '@/components/seeker/QuickNeedFilterGrid';

afterEach(cleanup);

describe('QuickNeedFilterGrid', () => {
  it('keeps an active need visible when the grid is limited', () => {
    render(
      <QuickNeedFilterGrid
        activeNeedId="transportation"
        onSelect={vi.fn()}
        ariaLabel="Limited needs"
        limit={4}
      />,
    );

    const group = screen.getByRole('group', { name: 'Limited needs' });
    expect(within(group).getAllByRole('button')).toHaveLength(4);
    expect(within(group).getByRole('button', { name: 'Transportation' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('preserves a non-quick active need and exposes every category in full-filter mode', () => {
    const { rerender } = render(
      <QuickNeedFilterGrid
        activeNeedId="utility_assistance"
        onSelect={vi.fn()}
        ariaLabel="Limited needs"
        limit={4}
      />,
    );

    const limitedGroup = screen.getByRole('group', { name: 'Limited needs' });
    expect(within(limitedGroup).getAllByRole('button')).toHaveLength(4);
    expect(within(limitedGroup).getByRole('button', { name: 'Utilities' })).toHaveAttribute('aria-pressed', 'true');

    rerender(
      <QuickNeedFilterGrid
        activeNeedId="utility_assistance"
        onSelect={vi.fn()}
        ariaLabel="All needs"
        includeAll
      />,
    );

    const fullGroup = screen.getByRole('group', { name: 'All needs' });
    expect(within(fullGroup).getAllByRole('button')).toHaveLength(12);
    expect(within(fullGroup).getByRole('button', { name: 'Utilities' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(fullGroup).getByRole('button', { name: 'Education' })).toBeInTheDocument();
  });
});
