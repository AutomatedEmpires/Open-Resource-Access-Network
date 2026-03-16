// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

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
    initialNeedId?: string | null;
    initialTrustFilter?: string;
    initialSortBy?: string;
    initialPage?: number;
    initialTaxonomyTermIds?: string[];
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

describe('ChatPageClient', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    navigationState.searchParams = new URLSearchParams();
    sessionStorage.clear();
  });

  it('reuses an existing chat session id from sessionStorage', () => {
    sessionStorage.setItem('oran_chat_session_id', 'existing-session-id');
    const randomSpy = vi.spyOn(globalThis.crypto, 'randomUUID');

    render(<ChatPage />);

    expect(randomSpy).not.toHaveBeenCalled();
    expect(chatWindowMock).toHaveBeenCalledWith({
      sessionId: 'existing-session-id',
      initialPrompt: '',
      initialNeedId: null,
      initialTrustFilter: undefined,
      initialSortBy: undefined,
      initialPage: 1,
      initialTaxonomyTermIds: [],
      initialAttributeFilters: undefined,
    });
    expect(screen.getByTestId('chat-window')).toHaveTextContent('session:existing-session-id');
    expect(screen.getByRole('link', { name: 'Directory' })).toHaveAttribute('href', '/directory');
    expect(screen.getByRole('link', { name: 'Map' })).toHaveAttribute('href', '/map');

    randomSpy.mockRestore();
  });

  it('preserves canonical discovery intent in directory and map links', () => {
    navigationState.searchParams = new URLSearchParams(
      'category=food&confidence=HIGH&sort=name_desc&taxonomyIds=a1000000-0000-4000-8000-000000000001&attributes=%7B%22delivery%22%3A%5B%22virtual%22%5D%7D&page=3',
    );
    sessionStorage.setItem('oran_chat_session_id', 'existing-session-id');

    render(<ChatPage />);

    expect(screen.getByRole('link', { name: 'Directory' })).toHaveAttribute(
      'href',
      '/directory?q=food&confidence=HIGH&sort=name_desc&category=food_assistance&taxonomyIds=a1000000-0000-4000-8000-000000000001&attributes=%7B%22delivery%22%3A%5B%22virtual%22%5D%7D&page=3',
    );
    expect(screen.getByRole('link', { name: 'Map' })).toHaveAttribute(
      'href',
      '/map?q=food&confidence=HIGH&sort=name_desc&category=food_assistance&taxonomyIds=a1000000-0000-4000-8000-000000000001&attributes=%7B%22delivery%22%3A%5B%22virtual%22%5D%7D&page=3',
    );
    expect(chatWindowMock).toHaveBeenCalledWith({
      sessionId: 'existing-session-id',
      initialPrompt: 'food',
      initialNeedId: 'food_assistance',
      initialTrustFilter: 'HIGH',
      initialSortBy: 'name_desc',
      initialPage: 3,
      initialTaxonomyTermIds: ['a1000000-0000-4000-8000-000000000001'],
      initialAttributeFilters: { delivery: ['virtual'] },
    });
  });

  it('creates and persists a new chat session id when one is missing', () => {
    const randomSpy = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('generated-session-id');

    render(<ChatPage />);

    expect(randomSpy).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('oran_chat_session_id')).toBe('generated-session-id');
    expect(chatWindowMock).toHaveBeenCalledWith({
      sessionId: 'generated-session-id',
      initialPrompt: '',
      initialNeedId: null,
      initialTrustFilter: undefined,
      initialSortBy: undefined,
      initialPage: 1,
      initialTaxonomyTermIds: [],
      initialAttributeFilters: undefined,
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
        initialTaxonomyTermIds: [],
        initialAttributeFilters: {
          delivery: ['phone'],
          access: ['no_id_required', 'same_day'],
        },
      });
    });
    expect(screen.getByRole('link', { name: 'Directory' })).toHaveAttribute(
      'href',
      '/directory?q=housing&category=housing&attributes=%7B%22delivery%22%3A%5B%22phone%22%5D%2C%22access%22%3A%5B%22no_id_required%22%2C%22same_day%22%5D%7D',
    );
    expect(screen.getByRole('link', { name: 'Map' })).toHaveAttribute(
      'href',
      '/map?q=housing&category=housing&attributes=%7B%22delivery%22%3A%5B%22phone%22%5D%2C%22access%22%3A%5B%22no_id_required%22%2C%22same_day%22%5D%7D',
    );
  });
});
