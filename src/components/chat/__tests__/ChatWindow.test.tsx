// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());
const trackInteractionMock = vi.hoisted(() => vi.fn());
const chatServiceCardMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const createSeekerPlanMock = vi.hoisted(() => vi.fn(() => ({
  plan: {
    id: 'plan-1',
    title: 'Current plan',
    items: [],
  },
})));
const addServicePlanItemMock = vi.hoisted(() => vi.fn());
const updateSeekerPlanItemMock = vi.hoisted(() => vi.fn());
const getActiveSeekerPlanMock = vi.hoisted(() => vi.fn(() => null));
const readStoredSeekerPlansStateMock = vi.hoisted(() => vi.fn(() => ({ plans: [], activePlanId: null, archivedPlans: [] })));
const setActiveSeekerPlanMock = vi.hoisted(() => vi.fn());
const buildPlanSnapshotMock = vi.hoisted(() => vi.fn((card, href) => ({
  serviceId: card.serviceId,
  serviceName: card.serviceName,
  organizationName: card.organizationName,
  trustBand: card.confidenceBand,
  capturedAt: '2026-03-17T12:00:00.000Z',
  href,
})));
const PREFS_KEY = 'oran:preferences';

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/chat/ChatServiceCard', () => ({
  ChatServiceCard: ({
    card,
    discoveryContext,
    isSaved,
    onToggleSave,
  }: {
    card: { serviceId: string; serviceName: string };
    discoveryContext?: Record<string, unknown>;
    isSaved: boolean;
    onToggleSave: (serviceId: string) => void;
  }) => {
    chatServiceCardMock({ card, discoveryContext, isSaved });
    return (
      <div data-testid={`chat-card-${card.serviceId}`}>
        <span>{card.serviceName}</span>
        <button type="button" onClick={() => onToggleSave(card.serviceId)}>
          {isSaved ? 'Unsave' : 'Save'}
        </button>
      </div>
    );
  },
}));

vi.mock('lucide-react', () => ({
  Send: 'svg',
  AlertTriangle: 'svg',
  Phone: 'svg',
  RotateCcw: 'svg',
  Trash2: 'svg',
  Plus: 'svg',
  Clock: 'svg',
  SlidersHorizontal: 'svg',
  Bookmark: 'svg',
  BookmarkCheck: 'svg',
  MapPin: 'svg',
  BellRing: 'svg',
  ListTodo: 'svg',
}));

vi.mock('@/components/seeker/SeekerFeatureFlags', () => ({
  useSeekerFeatureFlags: () => ({
    planEnabled: true,
    reminderEnabled: true,
    dashboardEnabled: true,
  }),
}));

vi.mock('@/services/plans/client', () => ({
  addServicePlanItem: addServicePlanItemMock,
  createSeekerPlan: createSeekerPlanMock,
  getActiveSeekerPlan: getActiveSeekerPlanMock,
  readStoredSeekerPlansState: readStoredSeekerPlansStateMock,
  setActiveSeekerPlan: setActiveSeekerPlanMock,
  updateSeekerPlanItem: updateSeekerPlanItemMock,
}));

vi.mock('@/services/plans/snapshots', () => ({
  buildPlanServiceSnapshotFromChatCard: buildPlanSnapshotMock,
}));

vi.mock('@/services/telemetry/sentry', () => ({
  trackInteraction: trackInteractionMock,
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

function getChatCalls() {
  return fetchMock.mock.calls.filter((call) => String(call[0]) === '/api/chat');
}

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
  sessionStorage.clear();
  global.fetch = fetchMock as unknown as typeof fetch;
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
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
  getActiveSeekerPlanMock.mockReset();
  getActiveSeekerPlanMock.mockReturnValue(null);
  createSeekerPlanMock.mockClear();
  addServicePlanItemMock.mockClear();
  updateSeekerPlanItemMock.mockClear();
  readStoredSeekerPlansStateMock.mockClear();
  readStoredSeekerPlansStateMock.mockReturnValue({ plans: [], activePlanId: null, archivedPlans: [] });
  setActiveSeekerPlanMock.mockClear();
  buildPlanSnapshotMock.mockClear();
});

describe('ChatWindow', () => {
  it('renders empty state + disclaimer and sends a suggestion chip prompt', async () => {
    render(<ChatWindow sessionId="11111111-1111-4111-8111-111111111111" />);

    expect(screen.getByRole('note', { name: 'Eligibility disclaimer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(screen.getByText('What verified help do you need?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Food' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Chat message input' }), {
      target: { value: 'Need food support' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await screen.findByText('Here are options');
    expect(trackInteractionMock).toHaveBeenCalledWith('chat_message_sent', expect.any(Object));

    const chatCall = getChatCalls()[0];
    const body = JSON.parse(String((chatCall?.[1] as { body: string }).body));
    expect(body.message).toBe('Need food support');
    expect(body.sessionContext.activeNeedId).toBe('food_assistance');
    expect(body.profileMode).toBe('use');
  });

  it('hydrates seeded browse context into the draft and outgoing chat filters', async () => {
    render(
      <ChatWindow
        sessionId="11111111-1111-4111-8111-111111111111"
        initialPrompt="food"
        initialNeedId="food_assistance"
        initialTrustFilter="HIGH"
        initialSortBy="name_desc"
        initialPage={3}
        initialAttributeFilters={{ delivery: ['virtual'], access: ['walk_in'] }}
      />,
    );

    expect(screen.getAllByText('Active chat context').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Chat message input')).toHaveValue('food');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await screen.findByText('Here are options');

    const chatCall = getChatCalls()[0];
    const body = JSON.parse(String((chatCall?.[1] as { body: string }).body));
    expect(body).toMatchObject({
      message: 'food',
      profileMode: 'use',
      filters: {
        trust: 'HIGH',
        attributeFilters: {
          delivery: ['virtual'],
          access: ['walk_in'],
        },
      },
    });
  });

  it('freezes seeded discovery context onto assistant result cards', async () => {
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
          json: async () => makeChatResponse({
            services: [{
              serviceId: 'svc-1',
              serviceName: 'Food Pantry',
              organizationName: 'Helping Hands',
              confidenceBand: 'HIGH',
              confidenceScore: 92,
              eligibilityHint: 'You may qualify.',
            }],
          }),
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

    render(
      <ChatWindow
        sessionId="11111111-1111-4111-8111-111111111111"
        initialPrompt="food"
        initialNeedId="food_assistance"
        initialTrustFilter="HIGH"
        initialSortBy="name_desc"
        initialPage={3}
        initialAttributeFilters={{ delivery: ['virtual'] }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await screen.findAllByTestId('chat-card-svc-1');
    expect(screen.getAllByText('Search scope used for these results').length).toBeGreaterThan(0);
    expect(screen.getByText('Need: Food')).toBeInTheDocument();
    expect(screen.getAllByText('Trust: High confidence only').length).toBeGreaterThan(0);
    expect(chatServiceCardMock).toHaveBeenCalledWith({
      card: expect.objectContaining({ serviceId: 'svc-1' }),
      discoveryContext: {
        text: 'food',
        needId: 'food_assistance',
        confidenceFilter: 'HIGH',
        sortBy: 'name_desc',
        attributeFilters: { delivery: ['virtual'] },
        page: 3,
      },
      isSaved: false,
    });
  });

  it('sends trust and canonical attribute filters without taxonomy-term filters', async () => {
    render(
      <ChatWindow
        sessionId="11111111-1111-4111-8111-111111111111"
        initialTrustFilter="HIGH"
        initialAttributeFilters={{ delivery: ['virtual'] }}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Chat message input' }), {
      target: { value: 'food' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await screen.findByText('Here are options');

    const chatCall = getChatCalls()[0];
    const body = JSON.parse(String((chatCall?.[1] as { body: string }).body));
    expect(body.filters).toEqual({
      trust: 'HIGH',
      attributeFilters: { delivery: ['virtual'] },
    });
  });

  it('lets the user clear seeded browse context before starting chat', () => {
    render(
      <ChatWindow
        sessionId="11111111-1111-4111-8111-111111111111"
        initialPrompt="food"
        initialTrustFilter="HIGH"
        initialAttributeFilters={{ delivery: ['virtual'] }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));

    expect(screen.getByLabelText('Chat message input')).toHaveValue('food');
    expect(screen.queryByText('Virtual')).not.toBeInTheDocument();
  });

  it('shows chat fallback when the chat response is non-ok', async () => {
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
      if (url === '/api/chat/quota') {
        return {
          ok: true,
          json: async () => ({ remaining: 50, resetAt: null }),
        } as Response;
      }
      if (url === '/api/chat') {
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

    localStorage.setItem(PREFS_KEY, JSON.stringify({ serverSyncEnabled: true }));

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
      screen.getAllByRole('alert').some((el: HTMLElement) =>
        String(el.textContent).includes('Message limit reached.'),
      ),
    ).toBe(true);

    const [card] = await screen.findAllByTestId('chat-card-svc-1');
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

  it('shows interpretation details and lets signed-in users disable saved profile shaping', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/chat/quota') {
        return {
          ok: true,
          json: async () => ({ remaining: 50, resetAt: null }),
        } as Response;
      }
      if (url === '/api/chat') {
        const body = JSON.parse(String((init as { body?: string } | undefined)?.body ?? '{}'));
        const ignoredProfileShaping = body.profileMode === 'ignore';

        return {
          ok: true,
          json: async () =>
            makeChatResponse({
              message: ignoredProfileShaping
                ? 'Searching without saved profile signals.'
                : 'Searching with saved profile signals.',
              retrievalStatus: ignoredProfileShaping ? 'no_match' : 'results',
              searchInterpretation: {
                summary: ignoredProfileShaping
                  ? 'Used your message and active filters only.'
                  : 'Used your message plus saved profile signals to shape the search.',
                query: 'food pantry',
                categoryLabel: 'Food assistance',
                urgencyLabel: 'Standard',
                actionLabel: 'Browse',
                usedProfileShaping: !ignoredProfileShaping,
                ignoredProfileShaping,
                profileSignals: ignoredProfileShaping ? [] : ['city: Denver', 'interest: housing'],
              },
            }),
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

    render(<ChatWindow sessionId="11111111-1111-4111-8111-111111111111" userId="user-1" />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Chat message input' }), {
      target: { value: 'food pantry' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await screen.findByText('How this was interpreted');
    expect(screen.getByText('Used your message plus saved profile signals to shape the search.')).toBeInTheDocument();
    expect(screen.getByText('Saved profile signals affected the search order.')).toBeInTheDocument();
    expect(screen.getByText('city: Denver')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ignore saved profile next time' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Chat message input' }), {
      target: { value: 'food pantry tonight' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await screen.findByText('Saved profile shaping is off for this session.');
    await screen.findByText('Status: No close match was found in the current catalog.');

    const chatCalls = getChatCalls();
    const firstBody = JSON.parse(String((chatCalls[0]?.[1] as { body: string }).body));
    const secondBody = JSON.parse(String((chatCalls[1]?.[1] as { body: string }).body));
    expect(firstBody.profileMode).toBe('use');
    expect(secondBody.profileMode).toBe('ignore');
  });

  it('renders clarification suggestions and active session context from the response', async () => {
    let chatRequestCount = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/chat/quota') {
        return {
          ok: true,
          json: async () => ({ remaining: 50, resetAt: null }),
        } as Response;
      }
      if (url === '/api/chat') {
        chatRequestCount += 1;
        if (chatRequestCount === 1) {
          return {
            ok: true,
            json: async () => makeChatResponse({
              message: 'I can search once I know the kind of help you want.',
              retrievalStatus: 'clarification_required',
              clarification: {
                reason: 'weak_query',
                prompt: 'I can search once I know the kind of help you want.',
                suggestions: ['Help paying rent', 'Food pantry near me'],
              },
              sessionContext: {
                activeNeedId: 'housing',
                activeCity: 'Denver',
                profileShapingEnabled: true,
              },
              activeContextUsed: true,
              searchInterpretation: {
                category: 'general',
                categoryLabel: 'general help',
                urgencyQualifier: 'standard',
                summary: 'Interpreted as general help',
                usedSessionContext: true,
                sessionSignals: ['Need: housing', 'City: Denver'],
                usedProfileShaping: false,
                ignoredProfileShaping: false,
                profileSignals: [],
              },
            }),
          } as Response;
        }

        return {
          ok: true,
          json: async () => makeChatResponse({
            message: 'Here are options',
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    render(<ChatWindow sessionId="11111111-1111-4111-8111-111111111111" />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Chat message input' }), {
      target: { value: 'help' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await screen.findByText('Refine this search');
    expect(screen.getByText('Active chat context')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Need: Housing ×' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'City: Denver ×' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Help paying rent' }));

    await waitFor(() => {
      expect(getChatCalls()).toHaveLength(2);
    });
  });

  it('renders result summaries and adaptive follow-up chips for successful result sets', async () => {
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
          json: async () => makeChatResponse({
            resultSummary: 'Showing 2 services from 2 organizations. Prioritized for Denver. Kept the set varied across organizations.',
            followUpSuggestions: ['Open today', 'Phone support only', 'No ID required food help'],
            services: [
              {
                serviceId: 'svc-1',
                serviceName: 'Food Pantry One',
                organizationName: 'Helping Hands',
                confidenceBand: 'HIGH',
                confidenceScore: 92,
                eligibilityHint: 'You may qualify.',
              },
            ],
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    render(<ChatWindow sessionId="11111111-1111-4111-8111-111111111111" />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Chat message input' }), {
      target: { value: 'food pantry' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await screen.findByText('Next refinements');
    expect(screen.getByText('Showing 2 services from 2 organizations. Prioritized for Denver. Kept the set varied across organizations.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open today' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Phone support only' })).toBeInTheDocument();
  });

  it('proposes and applies a local add-to-plan command without calling the chat API again', async () => {
    let chatRequestCount = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/chat/quota') {
        return {
          ok: true,
          json: async () => ({ remaining: 50, resetAt: null }),
        } as Response;
      }
      if (url === '/api/chat') {
        chatRequestCount += 1;
        return {
          ok: true,
          json: async () => makeChatResponse({
            services: [{
              serviceId: 'svc-1',
              serviceName: 'Food Pantry One',
              organizationName: 'Helping Hands',
              confidenceBand: 'HIGH',
              confidenceScore: 92,
              eligibilityHint: 'You may qualify.',
            }],
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    render(<ChatWindow sessionId="11111111-1111-4111-8111-111111111111" />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Chat message input' }), {
      target: { value: 'food pantry' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await screen.findByTestId('chat-card-svc-1');

    fireEvent.change(screen.getByRole('textbox', { name: 'Chat message input' }), {
      target: { value: 'add the first result to my plan tomorrow' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await screen.findByText('Execution proposal');
    expect(chatRequestCount).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Add to plan' }));

    expect(createSeekerPlanMock).toHaveBeenCalled();
    expect(addServicePlanItemMock).toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith('Food Pantry One added to your local plan.');
    expect(trackInteractionMock).toHaveBeenCalledWith('chat_execution_command_proposed', { action: 'add_to_plan' });
  });
});
