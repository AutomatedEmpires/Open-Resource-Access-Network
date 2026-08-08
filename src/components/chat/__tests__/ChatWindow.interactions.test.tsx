// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
const scrollIntoViewMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const PREFS_KEY = 'oran:preferences';

vi.mock('@/components/chat/ChatServiceCard', () => ({
  ChatServiceCard: ({
    card,
    isSaved,
    onToggleSave,
  }: {
    card: { serviceId: string; serviceName: string };
    isSaved: boolean;
    onToggleSave: (serviceId: string) => void;
  }) => (
    <div data-testid={`service-${card.serviceId}`}>
      <span>{card.serviceName}</span>
      <button type="button" onClick={() => onToggleSave(card.serviceId)}>
        {isSaved ? 'Unsave' : 'Save'}
      </button>
    </div>
  ),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    toast: vi.fn(),
  }),
}));

import { ChatWindow } from '@/components/chat/ChatWindow';

function getChatCalls() {
  return fetchMock.mock.calls.filter((call) => String(call[0]) === '/api/chat');
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  localStorage.clear();
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoViewMock,
  });
});

afterEach(() => {
  cleanup();
});

describe('ChatWindow interactions', () => {
  it('keeps the initial intake at the top and scrolls as conversation messages arrive', async () => {
    let resolveChat!: (response: Response) => void;
    const pendingChatResponse = new Promise<Response>((resolve) => {
      resolveChat = resolve;
    });

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/chat/quota') {
        return {
          ok: true,
          json: async () => ({ remaining: 50, resetAt: null }),
        } as Response;
      }
      if (url === '/api/chat') {
        return pendingChatResponse;
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    render(<ChatWindow sessionId="scroll-session" />);

    expect(screen.getByRole('heading', { name: 'How can ORAN help?' })).toBeInTheDocument();
    expect(scrollIntoViewMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Chat message input'), {
      target: { value: 'Need food support' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(scrollIntoViewMock.mock.calls.length).toBeGreaterThan(0);
    });
    const callsAfterUserMessage = scrollIntoViewMock.mock.calls.length;

    resolveChat({
      ok: true,
      json: async () => ({
        message: 'Here are food support options.',
        services: [],
        isCrisis: false,
        sessionId: 'scroll-session',
        quotaRemaining: 49,
        intent: { category: 'food_assistance', rawQuery: 'food', urgencyQualifier: 'standard' },
        eligibilityDisclaimer: 'Always verify eligibility before visiting.',
        llmSummarized: false,
      }),
    } as Response);

    await screen.findByText('Here are food support options.');
    await waitFor(() => {
      expect(scrollIntoViewMock.mock.calls.length).toBeGreaterThan(callsAfterUserMessage);
    });
    expect(scrollIntoViewMock).toHaveBeenLastCalledWith({ behavior: 'smooth' });

    const messageLog = screen.getByRole('log', { name: 'Chat messages' });
    messageLog.scrollTop = 320;
    fireEvent.scroll(messageLog);
    fireEvent.click(screen.getByRole('button', { name: 'Clear conversation' }));

    expect(messageLog.scrollTop).toBe(0);
    expect(screen.getByRole('heading', { name: 'How can ORAN help?' })).toBeInTheDocument();
  });

  it('sends chat messages, renders service cards, and toggles save/unsave', async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ serverSyncEnabled: true }));
    localStorage.setItem('oran:saved-service-ids', JSON.stringify(['existing-service']));

    fetchMock.mockImplementation(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/chat/quota') {
        return {
          ok: true,
          json: async () => ({ remaining: 50, resetAt: null }),
        } as Response;
      }
      if (url === '/api/chat') {
        return {
          ok: true,
          json: async () => ({
            message: 'Here are options near you.',
            services: [
              {
                serviceId: 'svc-1',
                serviceName: 'Food Pantry One',
                organizationName: 'Helping Hands',
                confidenceBand: 'HIGH',
                confidenceScore: 90,
                eligibilityHint: 'You may qualify.',
              },
            ],
            isCrisis: false,
            sessionId: 'session-1',
            quotaRemaining: 25,
            intent: { category: 'food_assistance', rawQuery: 'food', urgencyQualifier: 'standard' },
            eligibilityDisclaimer: 'Always verify eligibility before visiting.',
            llmSummarized: false,
          }),
        } as Response;
      }

      if (url === '/api/saved') {
        return {
          ok: true,
          json: async () => ({}),
        } as Response;
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    render(<ChatWindow sessionId="session-1" userId="user-1" />);

    fireEvent.change(screen.getByLabelText('Chat message input'), {
      target: { value: 'Need food support' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByText('Here are options near you.')).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/chat', expect.objectContaining({
      method: 'POST',
    }));
    const chatCall = fetchMock.mock.calls.find((call) => String(call[0]) === '/api/chat');
    const body = JSON.parse(String((chatCall?.[1] as { body: string }).body));
    expect(body.profileMode).toBe('use');
    expect(screen.getByRole('note', { name: 'Verification tip' })).toBeInTheDocument();
    expect(screen.getByText('25 left today')).toBeInTheDocument();
    expect(screen.getByTestId('service-svc-1')).toBeInTheDocument();
    expect(screen.queryByText('Immediate Help Available')).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId('service-svc-1')).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/saved', expect.objectContaining({
        method: 'POST',
      }));
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('Saved to this device and your synced account');
    expect(screen.getByRole('button', { name: 'Unsave' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Unsave' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/saved', expect.objectContaining({
        method: 'DELETE',
      }));
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('Removed from this device and your synced account');
  });

  it('keeps chat save actions local-only when cross-device sync is off', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/chat/quota') {
        return {
          ok: true,
          json: async () => ({ remaining: 50, resetAt: null }),
        } as Response;
      }
      if (url === '/api/chat') {
        return {
          ok: true,
          json: async () => ({
            message: 'Here are options near you.',
            services: [
              {
                serviceId: 'svc-1',
                serviceName: 'Food Pantry One',
                organizationName: 'Helping Hands',
                confidenceBand: 'HIGH',
                confidenceScore: 90,
              },
            ],
            isCrisis: false,
            sessionId: 'session-1',
            quotaRemaining: 25,
            intent: { category: 'food_assistance', rawQuery: 'food', urgencyQualifier: 'standard' },
            eligibilityDisclaimer: 'Always verify eligibility before visiting.',
            llmSummarized: false,
          }),
        } as Response;
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    render(<ChatWindow sessionId="session-1" userId="user-1" />);

    fireEvent.change(screen.getByLabelText('Chat message input'), {
      target: { value: 'Need food support' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await screen.findAllByTestId('service-svc-1');

    fireEvent.click(within(screen.getAllByTestId('service-svc-1')[0]).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Unsave' }).length).toBeGreaterThan(0);
      expect(localStorage.getItem('oran:saved-service-ids')).toBe('["svc-1"]');
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('Saved on this device');
    expect(getChatCalls()).toHaveLength(1);
    expect(fetchMock.mock.calls.some((call) => String(call[0]) === '/api/saved')).toBe(false);
  });

  it('keeps crisis messaging available after the daily discovery quota reaches 0', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ remaining: 50, resetAt: null }),
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: 'Please use emergency resources immediately.',
        services: [],
        isCrisis: true,
        sessionId: 'session-2',
        quotaRemaining: 0,
        intent: { category: 'housing', rawQuery: 'shelter', urgencyQualifier: 'urgent' },
        eligibilityDisclaimer: 'Always verify eligibility before visiting.',
        llmSummarized: false,
      }),
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: 'Call 911 now if you are in immediate danger.',
        services: [],
        isCrisis: true,
        sessionId: 'session-2',
        quotaRemaining: 0,
        intent: { category: 'housing', rawQuery: 'danger', urgencyQualifier: 'urgent' },
        eligibilityDisclaimer: 'Always verify eligibility before visiting.',
        llmSummarized: false,
      }),
    });

    render(<ChatWindow sessionId="session-2" />);

    fireEvent.click(screen.getByRole('button', { name: 'Housing' }));
    fireEvent.change(screen.getByLabelText('Chat message input'), {
      target: { value: 'Need shelter tonight' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByText('Immediate Help Available')).toBeInTheDocument();
    });

    expect(screen.queryByRole('note', { name: 'Verification tip' })).not.toBeInTheDocument();
    expect(screen.getByText(/Daily discovery limit reached/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Directory' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Map' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New chat' }).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Chat message input')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Food' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Chat message input'), {
      target: { value: 'I am in immediate danger' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await screen.findByText('Call 911 now if you are in immediate danger.');
    expect(getChatCalls()).toHaveLength(2);
  });

  it('handles Enter key submission and network failures gracefully', async () => {
    localStorage.setItem('oran:saved-service-ids', '{bad-json');
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/chat/quota') {
        return {
          ok: true,
          json: async () => ({ remaining: 50, resetAt: null }),
        } as Response;
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    render(<ChatWindow sessionId="session-3" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/chat/quota', expect.objectContaining({ method: 'GET' }));
    });
    fetchMock.mockClear();

    const input = screen.getByLabelText('Chat message input');
    fireEvent.change(input, { target: { value: 'Need assistance' } });

    fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(getChatCalls()).toHaveLength(0);

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(getChatCalls()).toHaveLength(0);

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument();
    });
    expect(getChatCalls()).toHaveLength(1);
  });
});
