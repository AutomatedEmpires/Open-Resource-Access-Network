import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useStateMock = vi.hoisted(() => vi.fn());
const useRefMock = vi.hoisted(() => vi.fn());
const useEffectMock = vi.hoisted(() => vi.fn());
const useCallbackMock = vi.hoisted(() => vi.fn());

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: useStateMock,
    useRef: useRefMock,
    useEffect: useEffectMock,
    useCallback: useCallbackMock,
  };
});
vi.mock('@/components/ui/button', () => ({
  Button: 'button',
}));
vi.mock('@/components/chat/ChatServiceCard', () => ({
  ChatServiceCard: 'chat-service-card',
}));
vi.mock('lucide-react', () => ({
  Send: 'svg',
  AlertTriangle: 'svg',
  Phone: 'svg',
}));

async function loadChatWindow() {
  return import('../ChatWindow');
}

function collectElements(
  node: React.ReactNode,
  predicate: (element: React.ReactElement<any, any>) => boolean,
): React.ReactElement<any, any>[] {
  const elements: React.ReactElement<any, any>[] = [];

  const visit = (value: React.ReactNode) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!React.isValidElement(value)) {
      return;
    }

    const element = value as React.ReactElement<any, any>;
    if (predicate(element)) {
      elements.push(element);
    }
    visit(element.props.children);
  };

  visit(node);
  return elements;
}

function mockStateSequence(values: unknown[]) {
  values.forEach((value) => {
    useStateMock.mockImplementationOnce(() => [value, vi.fn()]);
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  useStateMock.mockImplementation((initial: unknown) => [initial, vi.fn()]);
  useRefMock.mockImplementation(() => ({ current: null }));
  useEffectMock.mockImplementation(() => undefined);
  useCallbackMock.mockImplementation((fn: unknown) => fn);
});

describe('ChatWindow', () => {
  it('renders the empty-state chat shell with the always-on eligibility disclaimer', async () => {
    mockStateSequence([
      [],
      '',
      false,
      50,
      false,
      false,
      new Set<string>(),
    ]);
    useRefMock
      .mockImplementationOnce(() => ({ current: null }))
      .mockImplementationOnce(() => ({ current: { focus: vi.fn() } }));
    const { ChatWindow } = await loadChatWindow();

    const element = ChatWindow({ sessionId: 'session-1' }) as React.ReactElement<any, any>;
    const logs = collectElements(element, (child) => child.props.role === 'log');
    const notes = collectElements(element, (child) => child.props.role === 'note');
    const sendButton = collectElements(
      element,
      (child) => child.type === 'button' && child.props['aria-label'] === 'Send message',
    )[0];
    const alerts = collectElements(element, (child) => child.props.role === 'alert');

    expect(logs).toHaveLength(1);
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(sendButton.props.disabled).toBe(true);
    expect(alerts).toHaveLength(0);
  });

  it('renders crisis, result cards, loading state, and quota exhaustion when populated', async () => {
    mockStateSequence([
      [
        {
          role: 'assistant',
          content: 'Here are some services you can contact.',
          timestamp: new Date('2026-01-01T00:00:00.000Z'),
          services: [
            {
              serviceId: 'svc-1',
              serviceName: 'Food Pantry',
              organizationName: 'Helping Hands',
              confidenceBand: 'HIGH',
              eligibilityHint: 'You may qualify.',
            },
          ],
          isCrisis: true,
        },
      ],
      'need food',
      true,
      0,
      true,
      true,
      new Set<string>(['svc-1']),
    ]);
    useRefMock
      .mockImplementationOnce(() => ({ current: null }))
      .mockImplementationOnce(() => ({ current: { focus: vi.fn() } }));
    const { ChatWindow } = await loadChatWindow();

    const element = ChatWindow({ sessionId: 'session-1', userId: 'user-1' }) as React.ReactElement<any, any>;
    const serviceCards = collectElements(element, (child) => child.type === 'chat-service-card');
    const alerts = collectElements(element, (child) => child.props.role === 'alert');
    const statuses = collectElements(element, (child) => child.props.role === 'status');
    const notes = collectElements(element, (child) => child.props.role === 'note');
    const sendButton = collectElements(
      element,
      (child) => child.type === 'button' && child.props['aria-label'] === 'Send message',
    )[0];

    expect(serviceCards).toHaveLength(1);
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(statuses).toHaveLength(1);
    expect(notes).toHaveLength(1);
    expect(sendButton.props.disabled).toBe(true);
  });
});
