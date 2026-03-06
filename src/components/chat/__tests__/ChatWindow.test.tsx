// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());
const trackInteractionMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

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
    <div data-testid={`chat-card-${card.serviceId}`}>
      <span>{card.serviceName}</span>
      <button type="button" onClick={() => onToggleSave(card.serviceId)}>
        {isSaved ? 'Unsave' : 'Save'}
      </button>
    </div>
  ),
}));

vi.mock('lucide-react', () => ({
  Send: 'svg',
  AlertTriangle: 'svg',
  Phone: 'svg',
}));

vi.mock('@/services/telemetry/sentry', () => ({
  trackInteraction: trackInteractionMock,
}));

vi.mock('@/components/ui/dialog', () => {
  const DialogContext = React.createContext<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }>({
    open: false,
    onOpenChange: () => {},
  });

  return {
    Dialog: ({
      children,
      open = false,
      onOpenChange = () => {},
    }: {
      children: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }) => (
      <DialogContext.Provider value={{ open, onOpenChange }}>
        <div>{children}</div>
      </DialogContext.Provider>
    ),
    DialogTrigger: ({ children }: { children: React.ReactNode }) => {
      const ctx = React.useContext(DialogContext);
      if (React.isValidElement(children)) {
        const child = children as React.ReactElement<{ onClick?: () => void }>;
        return React.cloneElement(child, {
          onClick: () => {
            child.props.onClick?.();
            ctx.onOpenChange(true);
          },
        });
      }
      return <button type="button" onClick={() => ctx.onOpenChange(true)}>{children}</button>;
    },
    DialogContent: ({ children }: { children: React.ReactNode }) => {
      const ctx = React.useContext(DialogContext);
      if (!ctx.open) return null;
      return <div>{children}</div>;
    },
    DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  };
});

import { ChatWindow } from '../ChatWindow';

function makeChatResponse(overrides: Record<string, unknown> = {}) {
  return {
    message: 'Here are options',
    services: [],
    isCrisis: false,
    sessionId: '11111111-1111-4111-8111-111111111111',
    quotaRemaining: 49,
    eligibilityDisclaimer: 'You may qualify for this service. Please confirm eligibility with the provider.',
    llmSummarized: false,
    intent: {
      category: 'food_assistance',
      rawQuery: 'food',
      urgencyQualifier: 'standard',
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
  localStorage.clear();
  global.fetch = fetchMock as unknown as typeof fetch;
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/chat')) {
      return {
        ok: true,
        json: async () => makeChatResponse(),
      } as Response;
    }
    if (url.includes('/api/taxonomy/terms')) {
      return {
        ok: true,
        json: async () => ({ terms: [] }),
      } as Response;
    }
    return {
      ok: true,
      json: async () => ({}),
    } as Response;
  });
});

describe('ChatWindow', () => {
  it('renders empty state + disclaimer and sends a suggestion chip prompt', async () => {
    render(<ChatWindow sessionId="11111111-1111-4111-8111-111111111111" />);

    expect(screen.getByRole('note', { name: 'Eligibility disclaimer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(screen.getByText('What do you need help with?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Food pantry near me' }));

    await screen.findByText('Here are options');
    expect(trackInteractionMock).toHaveBeenCalledWith('chat_message_sent', expect.any(Object));

    const chatCall = fetchMock.mock.calls.find((call) => String(call[0]).includes('/api/chat'));
    const body = JSON.parse(String((chatCall?.[1] as { body: string }).body));
    expect(body.message).toContain('food pantry');
  });

  it('loads taxonomy tags, filters them, applies valid tag IDs, and sends trust filter payload', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/taxonomy/terms')) {
        return {
          ok: true,
          json: async () => ({
            terms: [
              {
                id: 'not-a-uuid',
                term: 'Invalid Tag',
                description: null,
                parentId: null,
                taxonomy: 'demo',
                serviceCount: 1,
              },
              {
                id: 'a1000000-4000-4000-8000-000000000001',
                term: 'Food Assistance',
                description: 'Food help',
                parentId: null,
                taxonomy: 'demo',
                serviceCount: 4,
              },
            ],
          }),
        } as Response;
      }
      if (url.includes('/api/chat')) {
        return {
          ok: true,
          json: async () => makeChatResponse(),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    render(<ChatWindow sessionId="11111111-1111-4111-8111-111111111111" />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Tags' })[0]);
    await screen.findByRole('heading', { name: 'Filter by service tags' });

    fireEvent.click(screen.getByRole('button', { name: 'Invalid Tag' }));

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search service tags' }), {
      target: { value: 'zzzz' },
    });
    expect(screen.getByText('No matching tags.')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search service tags' }), {
      target: { value: 'food' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Food Assistance' }));
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'High confidence only' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Chat message input' }), {
      target: { value: 'food' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await screen.findByText('Here are options');

    const chatCall = fetchMock.mock.calls.find((call) => String(call[0]).includes('/api/chat'));
    const body = JSON.parse(String((chatCall?.[1] as { body: string }).body));
    expect(body.filters).toEqual({
      trust: 'HIGH',
      taxonomyTermIds: ['a1000000-4000-4000-8000-000000000001'],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Chat message input' }), {
      target: { value: 'rent help' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      const chatCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/api/chat'));
      const secondBody = JSON.parse(String((chatCalls.at(-1)?.[1] as { body: string }).body));
      expect(secondBody.filters).toEqual({ trust: 'HIGH' });
    });
  });

  it('shows taxonomy fetch failure and chat fallback when chat response is non-ok', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/taxonomy/terms')) {
        return {
          ok: false,
          json: async () => ({ error: 'taxonomy offline' }),
        } as Response;
      }
      if (url.includes('/api/chat')) {
        return {
          ok: false,
          json: async () => ({ error: 'upstream down' }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    render(<ChatWindow sessionId="11111111-1111-4111-8111-111111111111" />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Tags' })[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('taxonomy offline');

    fireEvent.change(screen.getByRole('textbox', { name: 'Chat message input' }), {
      target: { value: 'help' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await screen.findByText('Something went wrong. Please try again.');
  });

  it('handles crisis responses, quota exhaustion, and saved toggles', async () => {
    localStorage.setItem('oran:saved-service-ids', '{not-json');

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/chat')) {
        return {
          ok: true,
          json: async () =>
            makeChatResponse({
              isCrisis: true,
              quotaRemaining: 0,
              services: [
                {
                  serviceId: 'svc-1',
                  serviceName: 'Food Pantry',
                  organizationName: 'Helping Hands',
                  confidenceBand: 'HIGH',
                  confidenceScore: 90,
                  eligibilityHint: 'You may qualify',
                  description: 'Food support',
                },
              ],
            }),
        } as Response;
      }
      if (url.includes('/api/saved') && init?.method === 'POST') {
        return { ok: true, json: async () => ({}) } as Response;
      }
      if (url.includes('/api/saved') && init?.method === 'DELETE') {
        return { ok: true, json: async () => ({}) } as Response;
      }
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    render(<ChatWindow sessionId="11111111-1111-4111-8111-111111111111" userId="user-1" />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Chat message input' }), {
      target: { value: 'urgent shelter' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Chat message input' }), {
      key: 'Enter',
      code: 'Enter',
    });

    await screen.findByText('Immediate Help Available');
    expect(
      screen.getAllByRole('alert').some((el) =>
        String(el.textContent).includes('Message limit reached. Start a new session to continue.'),
      ),
    ).toBe(true);

    const card = await screen.findByTestId('chat-card-svc-1');
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/saved',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    fireEvent.click(within(card).getByRole('button', { name: 'Unsave' }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/saved',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });
});
