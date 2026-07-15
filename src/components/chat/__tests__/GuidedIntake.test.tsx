// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GuidedIntake } from '@/components/chat/GuidedIntake';

afterEach(() => cleanup());

describe('GuidedIntake', () => {
  it('keeps optional context collapsed and submits a plain-language intake turn', async () => {
    const onSubmit = vi.fn();
    render(<GuidedIntake onSubmit={onSubmit} />);

    expect(screen.getByText('Add details only if they matter')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find my next step' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('What do you need help with right now?'), {
      target: { value: 'I need help with a utility bill' },
    });
    fireEvent.change(screen.getByLabelText('City, state, or ZIP'), {
      target: { value: '48201' },
    });
    fireEvent.change(screen.getByLabelText('How soon?'), {
      target: { value: 'today' },
    });
    fireEvent.change(screen.getByLabelText('How can you reach help?'), {
      target: { value: 'phone' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find my next step' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        'I need help with a utility bill. Near 48201. I need help today. I need help I can reach by phone.',
      );
    });
  });

  it('includes a minimum-necessary privacy reminder', () => {
    render(<GuidedIntake onSubmit={vi.fn()} />);

    expect(screen.getByText(/Do not include a Social Security number/i)).toBeInTheDocument();
  });
});
