// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { GuidedIntakeSubmission } from '@/domain/resourceNavigator';

const chatWindowMock = vi.hoisted(() => vi.fn());
const navigationState = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => navigationState.searchParams,
}));

vi.mock('@/components/chat/ChatWindow', () => ({
  ChatWindow: (props: {
    sessionId: string;
    initialPrompt?: string;
    initialGuidedIntake?: GuidedIntakeSubmission;
    initialNeedId?: string | null;
    initialTrustFilter?: string;
    initialSortBy?: string;
    initialPage?: number;
    initialAttributeFilters?: Record<string, string[]>;
  }) => {
    chatWindowMock(props);
    return <div data-testid="chat-window">session:{props.sessionId}</div>;
  },
}));

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import ChatPage from '@/app/(seeker)/chat/ChatPageClient';
import { GUIDED_INTAKE_HANDOFF_KEY } from '@/services/chat/guidedIntakeHandoff';
import { ONBOARDING_CHAT_HANDOFF_KEY } from '@/services/profile/onboardingHandoff';

describe('ChatPageClient', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    navigationState.searchParams = new URLSearchParams();
    sessionStorage.clear();
  });

  it('reuses an existing chat session id from sessionStorage', async () => {
    sessionStorage.setItem('oran_chat_session_id', 'existing-session-id');
    const randomSpy = vi.spyOn(globalThis.crypto, 'randomUUID');

    render(<ChatPage />);

    expect(randomSpy).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(chatWindowMock).toHaveBeenCalledWith({
        sessionId: 'existing-session-id',
        initialPrompt: '',
        initialNeedId: null,
        initialTrustFilter: undefined,
        initialSortBy: undefined,
        initialPage: 1,
        initialAttributeFilters: undefined,
      });
    });
    expect(screen.getByTestId('chat-window')).toHaveTextContent('session:existing-session-id');
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeInTheDocument();

    randomSpy.mockRestore();
  });

  it('preserves canonical discovery intent in directory and map links', async () => {
    navigationState.searchParams = new URLSearchParams(
      'category=food&confidence=HIGH&sort=name_desc&taxonomyIds=a1000000-0000-4000-8000-000000000001&attributes=%7B%22delivery%22%3A%5B%22virtual%22%5D%7D&page=3',
    );
    sessionStorage.setItem('oran_chat_session_id', 'existing-session-id');

    render(<ChatPage />);

    await waitFor(() => {
      expect(chatWindowMock).toHaveBeenCalledWith({
        sessionId: 'existing-session-id',
        initialPrompt: 'food',
        initialNeedId: 'food_assistance',
        initialTrustFilter: 'HIGH',
        initialSortBy: 'name_desc',
        initialPage: 3,
        initialAttributeFilters: { delivery: ['virtual'] },
      });
    });
  });

  it('creates and persists a new chat session id when one is missing', async () => {
    const randomSpy = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('generated-session-id');

    render(<ChatPage />);

    expect(randomSpy).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('oran_chat_session_id')).toBe('generated-session-id');
    await waitFor(() => {
      expect(chatWindowMock).toHaveBeenCalledWith({
        sessionId: 'generated-session-id',
        initialPrompt: '',
        initialNeedId: null,
        initialTrustFilter: undefined,
        initialSortBy: undefined,
        initialPage: 1,
        initialAttributeFilters: undefined,
      });
    });
    expect(screen.getAllByRole('heading', { name: 'Chat' }).length).toBeGreaterThan(0);

    randomSpy.mockRestore();
  });

  it('seeds blank chat entry from the stored seeker discovery preference', async () => {
    localStorage.setItem('oran:seeker-context', JSON.stringify({
      serviceInterests: ['housing'],
      preferredDeliveryModes: ['phone'],
      documentationBarriers: ['no_id'],
      urgencyWindow: 'same_day',
    }));
    sessionStorage.setItem('oran_chat_session_id', 'existing-session-id');

    render(<ChatPage />);

    await waitFor(() => {
      expect(chatWindowMock).toHaveBeenLastCalledWith({
        sessionId: 'existing-session-id',
        initialPrompt: 'housing',
        initialNeedId: 'housing',
        initialTrustFilter: undefined,
        initialSortBy: undefined,
        initialPage: 1,
        initialAttributeFilters: undefined,
      });
    });
  });

  it('consumes the one-time onboarding handoff without putting personal context in the URL', async () => {
    navigationState.searchParams = new URLSearchParams('from=onboarding');
    sessionStorage.setItem('oran_chat_session_id', 'existing-session-id');
    sessionStorage.setItem(ONBOARDING_CHAT_HANDOFF_KEY, JSON.stringify({
      prompt: 'I need housing help near Tacoma. My household has 3 people.',
      needId: 'housing',
    }));

    render(<ChatPage />);

    await waitFor(() => {
      expect(chatWindowMock).toHaveBeenLastCalledWith({
        sessionId: 'existing-session-id',
        initialPrompt: 'I need housing help near Tacoma. My household has 3 people.',
        initialNeedId: 'housing',
        initialTrustFilter: undefined,
        initialSortBy: undefined,
        initialPage: 1,
        initialAttributeFilters: undefined,
      });
    });
    expect(navigationState.searchParams.toString()).toBe('from=onboarding');
    expect(sessionStorage.getItem(ONBOARDING_CHAT_HANDOFF_KEY)).toBeNull();
  });

  it('opens a valid guided intake in a fresh chat without putting answers in the URL', async () => {
    navigationState.searchParams = new URLSearchParams('from=guided');
    sessionStorage.setItem('oran_chat_session_id', 'existing-session-id');
    const guidedIntake: GuidedIntakeSubmission = {
      prompt: 'Utility bill help. Near 48201. I need help today. I need help I can reach by phone.',
      searchText: 'Utility bill help',
      location: '48201',
      urgency: 'today',
      accessMode: 'phone',
    };
    sessionStorage.setItem(GUIDED_INTAKE_HANDOFF_KEY, JSON.stringify(guidedIntake));
    const randomSpy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('fresh-guided-session-id');

    render(<React.StrictMode><ChatPage /></React.StrictMode>);

    await waitFor(() => {
      expect(chatWindowMock).toHaveBeenLastCalledWith(expect.objectContaining({
        sessionId: 'fresh-guided-session-id',
        initialPrompt: guidedIntake.prompt,
        initialGuidedIntake: guidedIntake,
        initialNeedId: undefined,
      }));
    });
    expect(sessionStorage.getItem('oran_chat_session_id')).toBe('fresh-guided-session-id');
    expect(sessionStorage.getItem(GUIDED_INTAKE_HANDOFF_KEY)).toBeNull();
    expect(navigationState.searchParams.toString()).toBe('from=guided');
    randomSpy.mockRestore();
  });

  it('preserves the active chat when a guided handoff is missing or already consumed', async () => {
    navigationState.searchParams = new URLSearchParams('from=guided');
    sessionStorage.setItem('oran_chat_session_id', 'existing-session-id');
    const randomSpy = vi.spyOn(globalThis.crypto, 'randomUUID');

    render(<ChatPage />);

    await waitFor(() => {
      expect(chatWindowMock).toHaveBeenLastCalledWith(expect.objectContaining({
        sessionId: 'existing-session-id',
      }));
    });
    expect(randomSpy).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });
});
