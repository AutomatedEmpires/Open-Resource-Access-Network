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

    expect(screen.getByText('Add timing or access needs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find help' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('What do you need help with?'), {
      target: { value: 'I need help with a utility bill' },
    });
    fireEvent.change(screen.getByLabelText(/City or ZIP/), {
      target: { value: '48201' },
    });
    fireEvent.change(screen.getByLabelText('How soon?'), {
      target: { value: 'today' },
    });
    fireEvent.change(screen.getByLabelText('How can you reach help?'), {
      target: { value: 'phone' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find help' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        prompt: 'I need help with a utility bill. Near 48201. I need help today. I need help I can reach by phone.',
        searchText: 'I need help with a utility bill',
        location: '48201',
        urgency: 'today',
        audience: undefined,
        accessMode: 'phone',
      });
    });
  });

  it('includes a minimum-necessary privacy reminder', () => {
    render(<GuidedIntake onSubmit={vi.fn()} />);

    expect(screen.getByText(/Do not include Social Security numbers/i)).toBeInTheDocument();
  });

  it('keeps the first action compact while preserving optional location details', () => {
    render(<GuidedIntake compact onSubmit={vi.fn()} />);

    const needInput = screen.getByLabelText('What do you need help with?');
    const locationInput = screen.getByLabelText(/City or ZIP/);
    const submitButton = screen.getByRole('button', { name: 'Find help' });

    expect(needInput).toHaveAttribute('rows', '2');
    expect(needInput).toHaveClass('min-h-24');
    expect(locationInput.closest('details')).toBeInTheDocument();
    expect(screen.getByText('Filters: location, timing, access')).toBeInTheDocument();
    expect(submitButton).toHaveClass('disabled:opacity-100');
  });

  it('keeps the required need field controlled when a seeker clears and rewrites it', () => {
    render(<GuidedIntake initialNeed="food help" onSubmit={vi.fn()} />);
    const needInput = screen.getByLabelText('What do you need help with?');

    fireEvent.change(needInput, { target: { value: '' } });
    expect(needInput).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Find help' })).toBeDisabled();

    fireEvent.change(needInput, { target: { value: 'housing help' } });
    expect(needInput).toHaveValue('housing help');
    expect(screen.getByRole('button', { name: 'Find help' })).toBeEnabled();
  });

  it('does not submit punctuation-only need text', () => {
    const onSubmit = vi.fn();
    render(<GuidedIntake onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('What do you need help with?'), {
      target: { value: '!!!' },
    });

    expect(screen.getByRole('button', { name: 'Find help' })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('explains invalid location detail without dropping the seeker into a generic handoff error', () => {
    const onSubmit = vi.fn();
    render(<GuidedIntake onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('What do you need help with?'), {
      target: { value: 'food help' },
    });
    fireEvent.change(screen.getByLabelText(/City or ZIP/), {
      target: { value: 'Detroit, Michigan' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find help' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Use a city, City, ST, or 5-digit ZIP code.',
    );
    expect(screen.getByLabelText(/City or ZIP/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('does not let invalid optional location data suppress a crisis turn', async () => {
    const onSubmit = vi.fn();
    render(<GuidedIntake onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('What do you need help with?'), {
      target: { value: 'I want to kill myself' },
    });
    fireEvent.change(screen.getByLabelText(/City or ZIP/), {
      target: { value: 'Main Street, WA' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find help' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        prompt: 'I want to kill myself.',
        searchText: 'I want to kill myself',
        location: undefined,
        urgency: undefined,
        audience: undefined,
        accessMode: undefined,
      });
    });
  });

  it('does not let invalid optional location data suppress indirect distress language', async () => {
    const onSubmit = vi.fn();
    render(<GuidedIntake onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('What do you need help with?'), {
      target: { value: 'I do not see a way out' },
    });
    fireEvent.change(screen.getByLabelText(/City or ZIP/), {
      target: { value: 'Main Street, WA' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find help' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        prompt: 'I do not see a way out.',
        searchText: 'I do not see a way out',
        location: undefined,
        urgency: undefined,
        audience: undefined,
        accessMode: undefined,
      });
    });
  });

  it('preserves a non-self audience when invalid location data is removed from a crisis turn', async () => {
    const onSubmit = vi.fn();
    render(<GuidedIntake onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('What do you need help with?'), {
      target: { value: 'They want to die' },
    });
    fireEvent.change(screen.getByLabelText(/City or ZIP/), {
      target: { value: 'Main Street, WA' },
    });
    fireEvent.change(screen.getByLabelText('Who is this for?'), {
      target: { value: 'someone_else' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find help' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
        prompt: 'They want to die. This is for someone else.',
        audience: 'someone_else',
        location: undefined,
      }));
    });
  });
});
