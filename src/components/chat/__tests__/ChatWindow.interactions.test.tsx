// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.getByText('25 msgs left')).toBeInTheDocument();
    expect(screen.getByTestId('service-svc-1')).toBeInTheDocument();
    expect(screen.queryByText('Immediate Help Available')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
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

    await screen.findByTestId('service-svc-1');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Unsave' })).toBeInTheDocument();
      expect(localStorage.getItem('oran:saved-service-ids')).toBe('["svc-1"]');
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('Saved on this device');
    expect(getChatCalls()).toHaveLength(1);
    expect(fetchMock.mock.calls.some((call) => String(call[0]) === '/api/saved')).toBe(false);
  });

  it('submits suggestion chips, renders crisis banner, and disables input at quota 0', async () => {
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
    });

    render(<ChatWindow sessionId="session-2" />);

    fireEvent.click(screen.getByRole('button', { name: 'Shelter tonight' }));

    await waitFor(() => {
      expect(screen.getByText('Immediate Help Available')).toBeInTheDocument();
    });

    expect(screen.queryByRole('note', { name: 'Verification tip' })).not.toBeInTheDocument();
    expect(screen.getByText('Message limit reached.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Directory' })).toHaveAttribute('href', '/directory?q=I+need+a+shelter+or+safe+place+to+stay+tonight');
    expect(screen.getByRole('link', { name: 'Open Map' })).toHaveAttribute('href', '/map?q=I+need+a+shelter+or+safe+place+to+stay+tonight');
    expect(screen.getByRole('button', { name: 'Start new chat session' })).toBeInTheDocument();
    expect(screen.getByLabelText('Chat message input')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Help paying rent' })).not.toBeInTheDocument();
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

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(getChatCalls()).toHaveLength(0);

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument();
    });
    expect(getChatCalls()).toHaveLength(1);
  });
});
