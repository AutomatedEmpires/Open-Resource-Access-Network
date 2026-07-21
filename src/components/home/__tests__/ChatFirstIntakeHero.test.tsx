// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GuidedIntakeSubmission } from '@/domain/resourceNavigator';

const pushMock = vi.hoisted(() => vi.fn());
const submission: GuidedIntakeSubmission = {
  prompt: 'Utility bill help. Near 48201. I need help today. I need help I can reach by phone.',
  searchText: 'Utility bill help',
  location: '48201',
  urgency: 'today',
  accessMode: 'phone',
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/components/chat/GuidedIntake', () => ({
  GuidedIntake: ({ onSubmit }: { onSubmit: (value: GuidedIntakeSubmission) => void }) => (
    <button type="button" onClick={() => onSubmit(submission)}>Submit guided intake</button>
  ),
}));

import { ChatFirstIntakeHero } from '../ChatFirstIntakeHero';
import { GUIDED_INTAKE_HANDOFF_KEY } from '@/services/chat/guidedIntakeHandoff';

beforeEach(() => {
  cleanup();
  pushMock.mockClear();
  sessionStorage.clear();
});

describe('ChatFirstIntakeHero', () => {
  it('hands intake to chat without putting need or location details in the URL', () => {
    render(<ChatFirstIntakeHero />);

    fireEvent.click(screen.getByRole('button', { name: 'Submit guided intake' }));

    expect(JSON.parse(sessionStorage.getItem(GUIDED_INTAKE_HANDOFF_KEY) ?? 'null')).toEqual(submission);
    expect(pushMock).toHaveBeenCalledWith('/chat?from=guided');
    expect(pushMock.mock.calls[0]?.[0]).not.toContain('48201');
    expect(pushMock.mock.calls[0]?.[0]).not.toContain('Utility');
  });

  it('keeps answers in place when a private handoff cannot be stored', () => {
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    render(<ChatFirstIntakeHero />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit guided intake' }));

    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('could not be opened safely');
    storageSpy.mockRestore();
  });
});
