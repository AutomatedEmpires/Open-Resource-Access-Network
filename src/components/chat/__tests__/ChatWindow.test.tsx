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
  ArrowRight: 'svg',
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
import { readGuidedIntakeRetry } from '@/services/chat/guidedIntakeHandoff';

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
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: vi.fn().mockResolvedValue({ state: 'prompt' }) },
  });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: vi.fn() },
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
    expect(screen.getByText('Tell ORAN what is wrong.')).toBeInTheDocument();

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
    expect(body.sessionContext).not.toHaveProperty('preferredDeliveryModes');
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

  it('sends structured retrieval context once while preserving the full safety message', async () => {
    const prompt = 'Utility bill help. Near 48201. I need help today. I need help I can reach by phone.';
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/chat/quota') {
        return { ok: true, json: async () => ({ remaining: 50, resetAt: null }) } as Response;
      }
      if (url === '/api/chat') {
        return {
          ok: true,
          json: async () => makeChatResponse({
            quotaRemaining: 5,
            effectiveSearchText: 'utility assistance',
            intent: {
              category: 'utility_assistance',
              rawQuery: prompt,
              urgencyQualifier: 'urgent',
            },
            sessionContext: {
              activeNeedId: 'utility_assistance',
              activeLocation: { postalCode: '48201' },
              urgency: 'urgent',
              urgencyWindow: 'today',
              preferredDeliveryModes: ['phone'],
              attributeFilters: { delivery: ['phone'] },
              profileShapingEnabled: true,
            },
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({ terms: [] }) } as Response;
    });
    render(
      <ChatWindow
        sessionId="11111111-1111-4111-8111-111111111111"
        initialPrompt={prompt}
        initialGuidedIntake={{
          prompt,
          searchText: 'Utility bill help',
          location: '48201',
          urgency: 'today',
          accessMode: 'phone',
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(getChatCalls()).toHaveLength(1));

    const firstBody = JSON.parse(String((getChatCalls()[0]?.[1] as { body: string }).body));
    expect(firstBody.message).toBe(prompt);
    expect(firstBody.guidedIntake).toEqual({
      searchText: 'Utility bill help',
      location: '48201',
      urgency: 'today',
      accessMode: 'phone',
    });
    expect(firstBody.guidedIntake).not.toHaveProperty('prompt');
    await waitFor(() => {
      const transcript = JSON.parse(sessionStorage.getItem('oran:chat-transcript:11111111-1111-4111-8111-111111111111') ?? '[]');
      expect(transcript[1]?.discoveryContext).toMatchObject({
        text: 'utility assistance',
        needId: 'utility_assistance',
        attributeFilters: { delivery: ['phone'] },
      });
    });
    const directoryHref = screen.getByRole('link', { name: 'Open Directory' }).getAttribute('href');
    const mapHref = screen.getByRole('link', { name: 'Open Map' }).getAttribute('href');
    expect(new URL(directoryHref ?? '', 'https://oran.test').searchParams.get('q')).toBeNull();
    expect(new URL(mapHref ?? '', 'https://oran.test').searchParams.get('q')).toBeNull();
    expect(new URL(directoryHref ?? '', 'https://oran.test').searchParams.get('category')).toBe('utility_assistance');
    expect(new URL(mapHref ?? '', 'https://oran.test').searchParams.get('category')).toBe('utility_assistance');
    expect(directoryHref).not.toContain('48201');
    expect(mapHref).not.toContain('48201');

    fireEvent.change(screen.getByRole('textbox', { name: 'Chat message input' }), {
      target: { value: 'Show me another option' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(getChatCalls()).toHaveLength(2));

    const secondBody = JSON.parse(String((getChatCalls()[1]?.[1] as { body: string }).body));
    expect(secondBody.message).toBe('Show me another option');
    expect(secondBody).not.toHaveProperty('guidedIntake');
  });

  it('never places typed chat text in low-budget handoff URLs while a safety response is pending', async () => {
    let resolveChat: (response: Response) => void = () => {};
    const pendingChatResponse = new Promise<Response>((resolve) => {
      resolveChat = resolve;
    });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/chat/quota') {
        return { ok: true, json: async () => ({ remaining: 5, resetAt: null }) } as Response;
      }
      if (url === '/api/chat') return pendingChatResponse;
      return { ok: true, json: async () => ({ terms: [] }) } as Response;
    });

    render(<ChatWindow sessionId="11111111-1111-4111-8111-111111111111" />);
    await screen.findByText('Low message budget');

    const sensitiveMessage = 'I don’t see a way out and my case number is 12345';
    fireEvent.change(screen.getByRole('textbox', { name: 'Chat message input' }), {
      target: { value: sensitiveMessage },
    });

    for (const name of ['Open Directory', 'Open Map']) {
      const href = screen.getByRole('link', { name }).getAttribute('href') ?? '';
      expect(new URL(href, 'https://oran.test').searchParams.get('q')).toBeNull();
      expect(decodeURIComponent(href)).not.toContain(sensitiveMessage);
    }

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(getChatCalls()).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Clear conversation' })).toBeDisabled();
    for (const name of ['Open Directory', 'Open Map']) {
      const href = screen.getByRole('link', { name }).getAttribute('href') ?? '';
      expect(new URL(href, 'https://oran.test').searchParams.get('q')).toBeNull();
    }

    resolveChat({
      ok: true,
      json: async () => makeChatResponse({
        message: 'Please use emergency resources now.',
        isCrisis: true,
        quotaRemaining: 5,
      }),
    } as Response);
    await screen.findByText('Immediate Help Available');
    expect(screen.queryByRole('link', { name: 'Open Directory' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Map' })).not.toBeInTheDocument();
  });

  it('makes restored chat discovery links private and removes the legacy persistent index', async () => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const sensitiveText = 'Shelter after leaving an abusive partner';
    localStorage.setItem('oran:chat-session-index', JSON.stringify([{
      sessionId,
      title: sensitiveText,
      preview: sensitiveText,
      updatedAt: '2026-07-21T12:00:00.000Z',
      messageCount: 1,
      saved: false,
      seeded: false,
    }]));
    sessionStorage.setItem(`oran:chat-transcript:${sessionId}`, JSON.stringify([{
      role: 'assistant',
      content: 'Here is an option.',
      timestamp: '2026-07-21T12:00:00.000Z',
      services: [{ serviceId: 'svc-1', serviceName: 'Safe Shelter' }],
      discoveryContext: { text: sensitiveText, needId: 'housing' },
    }]));

    render(<ChatWindow sessionId={sessionId} />);
    await screen.findByTestId('chat-card-svc-1');

    expect(localStorage.getItem('oran:chat-session-index')).toBeNull();
    expect(chatServiceCardMock).toHaveBeenCalledWith(expect.objectContaining({
      discoveryContext: expect.objectContaining({
        text: sensitiveText,
        needId: 'housing',
        omitTextFromUrl: true,
      }),
    }));
  });

  it('does not send device location or prior seeker constraints for embedded non-self intake', async () => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    sessionStorage.setItem(`oran:chat-session-context:${sessionId}`, JSON.stringify({
      activeNeedId: 'housing',
      activeRetrievalText: 'private housing need',
      activeGeo: { lat: 47.61, lng: -122.33, radiusMiles: 10 },
      urgency: 'urgent',
      urgencyWindow: 'today',
      accessMode: 'phone',
      preferredDeliveryModes: ['phone'],
      taxonomyTermIds: ['a1000000-4000-4000-8000-000000000001'],
      attributeFilters: { delivery: ['phone'], population: ['pregnant'] },
      profileShapingEnabled: true,
    }));

    render(<ChatWindow sessionId={sessionId} />);
    fireEvent.change(screen.getByLabelText('What do you need help with right now?'), {
      target: { value: 'Food help' },
    });
    fireEvent.change(screen.getByLabelText('Who is this for?'), {
      target: { value: 'someone_else' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search stored provider records' }));

    await waitFor(() => expect(getChatCalls()).toHaveLength(1));
    const body = JSON.parse(String((getChatCalls()[0]?.[1] as { body: string }).body));
    expect(body.guidedIntake).toMatchObject({ searchText: 'Food help', audience: 'someone_else' });
    for (const key of [
      'activeNeedId',
      'activeRetrievalText',
      'activeCity',
      'activeLocation',
      'activeGeo',
      'urgency',
      'urgencyWindow',
      'accessMode',
      'taxonomyTermIds',
      'attributeFilters',
    ]) {
      expect(body.sessionContext?.[key]).toBeUndefined();
    }
    expect(body.sessionContext?.preferredDeliveryModes).toEqual([]);
    expect(body.filters).toBeUndefined();
  });

  it('ignores automatic geolocation that completes after a non-self guided submit', async () => {
    let positionSuccess: PositionCallback | undefined;
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      positionSuccess = success;
    });
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: vi.fn().mockResolvedValue({ state: 'granted' }) },
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });

    render(<ChatWindow sessionId="11111111-1111-4111-8111-111111111111" />);
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('What do you need help with right now?'), {
      target: { value: 'Food help' },
    });
    fireEvent.change(screen.getByLabelText('Who is this for?'), {
      target: { value: 'someone_else' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search stored provider records' }));
    await waitFor(() => expect(getChatCalls()).toHaveLength(1));

    positionSuccess?.({
      coords: {
        latitude: 47.61,
        longitude: -122.33,
        accuracy: 100,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        toJSON: () => ({}),
      },
      timestamp: Date.now(),
      toJSON: () => ({}),
    });

    expect(screen.queryByText(/Nearby:/)).not.toBeInTheDocument();
    const storedContext = JSON.parse(
      sessionStorage.getItem('oran:chat-session-context:11111111-1111-4111-8111-111111111111') ?? '{}',
    );
    expect(storedContext.activeGeo).toBeUndefined();
  });

  it('clears exact retrieval text on category changes and clears text location with all filters', async () => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    sessionStorage.setItem(`oran:chat-session-context:${sessionId}`, JSON.stringify({
      activeNeedId: 'food_assistance',
      activeRetrievalText: 'food help for a private circumstance',
      activeCity: 'Detroit',
      activeLocation: { city: 'Detroit', stateProvince: 'MI' },
      profileShapingEnabled: true,
    }));
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/chat/quota') {
        return { ok: true, json: async () => ({ remaining: 50, resetAt: null }) } as Response;
      }
      if (url === '/api/chat') {
        const requestBody = JSON.parse(String(init?.body ?? '{}'));
        return {
          ok: true,
          json: async () => makeChatResponse({ sessionContext: requestBody.sessionContext }),
        } as Response;
      }
      return { ok: true, json: async () => ({ terms: [] }) } as Response;
    });

    render(<ChatWindow sessionId={sessionId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Housing' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Chat message input' }), {
      target: { value: 'Show options' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(getChatCalls()).toHaveLength(1));
    const firstBody = JSON.parse(String((getChatCalls()[0]?.[1] as { body: string }).body));
    expect(firstBody.sessionContext.activeNeedId).toBe('housing');
    expect(firstBody.sessionContext.activeRetrievalText).toBeUndefined();
    expect(firstBody.sessionContext.activeLocation).toEqual({ city: 'Detroit', stateProvince: 'MI' });

    await screen.findByText('Here are options');
    fireEvent.click(screen.getByRole('button', { name: 'Open chat filters' }));
    expect(screen.getByText(/Using Detroit, MI from this chat/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear all' })[0]!);
    fireEvent.click(screen.getAllByRole('button', { name: 'Done' })[0]!);

    fireEvent.change(screen.getByRole('textbox', { name: 'Chat message input' }), {
      target: { value: 'Start a broader search' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(getChatCalls()).toHaveLength(2));
    const secondBody = JSON.parse(String((getChatCalls()[1]?.[1] as { body: string }).body));
    expect(secondBody.sessionContext).toBeUndefined();
  });

  it('persists location opt-out and ignores a late automatic geolocation result', async () => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    let positionSuccess: PositionCallback | undefined;
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      positionSuccess = success;
    });
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: vi.fn().mockResolvedValue({ state: 'granted' }) },
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });

    render(<ChatWindow sessionId={sessionId} />);
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

    positionSuccess?.({
      coords: {
        latitude: 47.61,
        longitude: -122.33,
        accuracy: 100,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        toJSON: () => ({}),
      },
      timestamp: Date.now(),
      toJSON: () => ({}),
    });
    expect(sessionStorage.getItem(`oran:chat-location-dismissed:${sessionId}`)).toBe('true');
    expect(screen.queryByText(/Nearby:/)).not.toBeInTheDocument();

    cleanup();
    render(<ChatWindow sessionId={sessionId} />);
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Use location for nearby results')).not.toBeInTheDocument();
  });

  it('keeps a fresh guided handoff structured across a reload before the first send', async () => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const prompt = 'Food help. Near Tacoma, WA.';
    render(
      <ChatWindow
        sessionId={sessionId}
        initialPrompt={prompt}
        initialGuidedIntake={{
          prompt,
          searchText: 'Food help',
          location: 'Tacoma, WA',
        }}
      />,
    );

    await waitFor(() => {
      expect(readGuidedIntakeRetry(sessionId)).toMatchObject({ searchText: 'Food help' });
    });
    cleanup();

    render(<ChatWindow sessionId={sessionId} />);
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Chat message input' })).toHaveValue(prompt);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(getChatCalls()).toHaveLength(1));

    const body = JSON.parse(String((getChatCalls()[0]?.[1] as { body: string }).body));
    expect(body.guidedIntake).toEqual({
      searchText: 'Food help',
      location: 'Tacoma, WA',
    });
  });

  it('keeps a guided can-travel answer cleared across the next chat turn', async () => {
    const prompt = 'Food help. I can travel to a provider.';
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/chat/quota') {
        return { ok: true, json: async () => ({ remaining: 50, resetAt: null }) } as Response;
      }
      if (url === '/api/chat') {
        return {
          ok: true,
          json: async () => makeChatResponse({
            sessionContext: {
              activeNeedId: 'food_assistance',
              preferredDeliveryModes: [],
              profileShapingEnabled: true,
            },
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({ terms: [] }) } as Response;
    });

    render(
      <ChatWindow
        sessionId="11111111-1111-4111-8111-111111111111"
        initialPrompt={prompt}
        initialAttributeFilters={{ delivery: ['in_person'] }}
        initialGuidedIntake={{
          prompt,
          searchText: 'Food help',
          accessMode: 'can_travel',
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(getChatCalls()).toHaveLength(1));
    await waitFor(() => {
      const transcript = JSON.parse(sessionStorage.getItem('oran:chat-transcript:11111111-1111-4111-8111-111111111111') ?? '[]');
      expect(transcript[1]?.discoveryContext?.attributeFilters).toBeUndefined();
      expect(transcript[1]?.discoveryContext?.needId).toBe('food_assistance');
    });

    fireEvent.change(screen.getByRole('textbox', { name: 'Chat message input' }), {
      target: { value: 'Show me another option' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(getChatCalls()).toHaveLength(2));

    const secondBody = JSON.parse(String((getChatCalls()[1]?.[1] as { body: string }).body));
    expect(secondBody).not.toHaveProperty('guidedIntake');
    expect(secondBody.filters?.attributeFilters).toBeUndefined();
    expect(secondBody.sessionContext).toMatchObject({
      activeNeedId: 'food_assistance',
      preferredDeliveryModes: [],
    });
    expect(secondBody.sessionContext.attributeFilters).toBeUndefined();
  });

  it('drops structured intake when the seeker edits the handed-off prompt', async () => {
    const prompt = 'Food help. Near Tacoma, WA.';
    render(
      <ChatWindow
        sessionId="11111111-1111-4111-8111-111111111111"
        initialPrompt={prompt}
        initialGuidedIntake={{
          prompt,
          searchText: 'Food help',
          location: 'Tacoma, WA',
        }}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Chat message input' }), {
      target: { value: 'I need housing help instead' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(getChatCalls()).toHaveLength(1));

    const body = JSON.parse(String((getChatCalls()[0]?.[1] as { body: string }).body));
    expect(body.message).toBe('I need housing help instead');
    expect(body).not.toHaveProperty('guidedIntake');
  });

  it('restores structured intake for a safe retry after a request failure', async () => {
    const prompt = 'Food help. Near Tacoma, WA.';
    let chatAttempts = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/chat/quota') {
        return { ok: true, json: async () => ({ remaining: 50, resetAt: null }) } as Response;
      }
      if (url === '/api/chat') {
        chatAttempts += 1;
        if (chatAttempts === 1) {
          return {
            ok: false,
            json: async () => ({ error: 'Search is temporarily unavailable.' }),
          } as Response;
        }
        return { ok: true, json: async () => makeChatResponse() } as Response;
      }
      return { ok: true, json: async () => ({ terms: [] }) } as Response;
    });

    render(
      <ChatWindow
        sessionId="11111111-1111-4111-8111-111111111111"
        initialPrompt={prompt}
        initialGuidedIntake={{
          prompt,
          searchText: 'Food help',
          location: 'Tacoma, WA',
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('Search is temporarily unavailable.');
    expect(screen.getByRole('textbox', { name: 'Chat message input' })).toHaveValue(prompt);

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(getChatCalls()).toHaveLength(2));
    const retryBody = JSON.parse(String((getChatCalls()[1]?.[1] as { body: string }).body));
    expect(retryBody.guidedIntake).toEqual({
      searchText: 'Food help',
      location: 'Tacoma, WA',
    });
  });

  it('restores structured intake when retrieval returns a temporary-unavailability response', async () => {
    const prompt = 'Food help. Near Tacoma, WA.';
    let chatAttempts = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/chat/quota') {
        return { ok: true, json: async () => ({ remaining: 50, resetAt: null }) } as Response;
      }
      if (url === '/api/chat') {
        chatAttempts += 1;
        return {
          ok: true,
          json: async () => chatAttempts === 1
            ? makeChatResponse({
                message: 'Search is temporarily unavailable. Try again.',
                retrievalStatus: 'temporarily_unavailable',
              })
            : makeChatResponse(),
        } as Response;
      }
      return { ok: true, json: async () => ({ terms: [] }) } as Response;
    });

    render(
      <ChatWindow
        sessionId="11111111-1111-4111-8111-111111111111"
        initialPrompt={prompt}
        initialGuidedIntake={{
          prompt,
          searchText: 'Food help',
          location: 'Tacoma, WA',
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('Search is temporarily unavailable. Try again.');
    expect(screen.getByRole('textbox', { name: 'Chat message input' })).toHaveValue(prompt);
    expect(readGuidedIntakeRetry('11111111-1111-4111-8111-111111111111')).toMatchObject({
      prompt,
      searchText: 'Food help',
      location: 'Tacoma, WA',
    });

    cleanup();
    render(<ChatWindow sessionId="11111111-1111-4111-8111-111111111111" />);
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Chat message input' })).toHaveValue(prompt);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(getChatCalls()).toHaveLength(2));
    const retryBody = JSON.parse(String((getChatCalls()[1]?.[1] as { body: string }).body));
    expect(retryBody.guidedIntake).toEqual({
      searchText: 'Food help',
      location: 'Tacoma, WA',
    });
    await waitFor(() => {
      expect(readGuidedIntakeRetry('11111111-1111-4111-8111-111111111111')).toBeNull();
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
    expect(screen.getAllByText('Record confidence: High confidence only').length).toBeGreaterThan(0);
    expect(chatServiceCardMock).toHaveBeenCalledWith({
      card: expect.objectContaining({ serviceId: 'svc-1' }),
      discoveryContext: {
        text: 'food',
        omitTextFromUrl: true,
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
          json: async () => ({
            error: 'Daily message limit reached.',
            quotaRemaining: 0,
            quotaResetAt: '2099-01-01T00:00:00.000Z',
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

    await screen.findByText('Daily message limit reached.');
    expect(screen.getByText(/Daily discovery limit reached/)).toBeInTheDocument();
    expect(screen.getByLabelText('Chat message input')).toBeEnabled();
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
    expect(screen.getByText(/Daily discovery limit reached/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Directory' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Map' })).not.toBeInTheDocument();

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
