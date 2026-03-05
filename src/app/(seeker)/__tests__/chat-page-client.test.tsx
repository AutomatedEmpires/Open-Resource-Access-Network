// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const chatWindowMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/chat/ChatWindow', () => ({
  ChatWindow: (props: { sessionId: string }) => {
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
    sessionStorage.clear();
  });

  it('reuses an existing chat session id from sessionStorage', () => {
    sessionStorage.setItem('oran_chat_session_id', 'existing-session-id');
    const randomSpy = vi.spyOn(globalThis.crypto, 'randomUUID');

    render(<ChatPage />);

    expect(randomSpy).not.toHaveBeenCalled();
    expect(chatWindowMock).toHaveBeenCalledWith({ sessionId: 'existing-session-id' });
    expect(screen.getByTestId('chat-window')).toHaveTextContent('session:existing-session-id');
    expect(screen.getByRole('link', { name: 'Directory' })).toHaveAttribute('href', '/directory');
    expect(screen.getByRole('link', { name: 'Map' })).toHaveAttribute('href', '/map');

    randomSpy.mockRestore();
  });

  it('creates and persists a new chat session id when one is missing', () => {
    const randomSpy = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('generated-session-id');

    render(<ChatPage />);

    expect(randomSpy).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('oran_chat_session_id')).toBe('generated-session-id');
    expect(chatWindowMock).toHaveBeenCalledWith({ sessionId: 'generated-session-id' });
    expect(screen.getAllByRole('heading', { name: 'Find Services' }).length).toBeGreaterThan(0);

    randomSpy.mockRestore();
  });
});
