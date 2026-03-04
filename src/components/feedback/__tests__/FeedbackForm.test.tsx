import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useStateMock = vi.hoisted(() => vi.fn());
const useCallbackMock = vi.hoisted(() => vi.fn());
const useEffectMock = vi.hoisted(() => vi.fn());

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: useStateMock,
    useCallback: useCallbackMock,
    useEffect: useEffectMock,
  };
});
vi.mock('lucide-react', () => ({
  Star: 'svg',
  X: 'svg',
  Check: 'svg',
  AlertTriangle: 'svg',
}));
vi.mock('@/components/ui/button', () => ({
  Button: 'button',
}));

async function loadFeedbackForm() {
  return import('../FeedbackForm');
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
  useCallbackMock.mockImplementation((fn: unknown) => fn);
  useEffectMock.mockImplementation(() => undefined);
});

describe('FeedbackForm', () => {
  it('renders the default feedback form with a disabled submit button', async () => {
    mockStateSequence([null, null, null, '', 'idle', null]);
    const { FeedbackForm } = await loadFeedbackForm();

    const element = FeedbackForm({
      serviceId: 'svc-1',
      sessionId: 'session-1',
      onClose: vi.fn(),
    }) as React.ReactElement<any, any>;
    const stars = collectElements(
      element,
      (child) => child.type === 'button' && typeof child.props['aria-label'] === 'string' && child.props['aria-label'].startsWith('Rate '),
    );
    const submitButton = collectElements(
      element,
      (child) => child.type === 'button' && child.props.className === 'w-full',
    )[0];

    expect(stars).toHaveLength(5);
    expect(submitButton.props.disabled).toBe(true);
  });

  it('renders the success acknowledgement state after submission', async () => {
    mockStateSequence([5, null, true, 'Great help', 'success', null]);
    const { FeedbackForm } = await loadFeedbackForm();

    const element = FeedbackForm({
      serviceId: 'svc-1',
      sessionId: 'session-1',
      onClose: vi.fn(),
    }) as React.ReactElement<any, any>;
    const buttons = collectElements(element, (child) => child.type === 'button');

    expect(element.props.className).toContain('border-green-200');
    expect(buttons).toHaveLength(0);
  });

  it('renders the error state and keeps submission enabled when a rating exists', async () => {
    mockStateSequence([4, 5, false, 'Needs follow-up', 'error', 'Submission failed']);
    const { FeedbackForm } = await loadFeedbackForm();

    const element = FeedbackForm({
      serviceId: 'svc-1',
      sessionId: 'session-1',
      onClose: vi.fn(),
    }) as React.ReactElement<any, any>;
    const alerts = collectElements(element, (child) => child.props.className?.includes('border-red-200'));
    const submitButton = collectElements(
      element,
      (child) => child.type === 'button' && child.props.className === 'w-full',
    )[0];

    expect(alerts).toHaveLength(1);
    expect(submitButton.props.disabled).toBe(false);
  });
});
