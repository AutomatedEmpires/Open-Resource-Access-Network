import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useStateMock = vi.hoisted(() => vi.fn());

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: useStateMock,
  };
});
vi.mock('next/link', () => ({
  default: 'a',
}));
vi.mock('@/components/ui/badge', () => ({
  Badge: 'badge',
}));
vi.mock('@/components/feedback/FeedbackForm', () => ({
  FeedbackForm: 'feedback-form',
}));
vi.mock('lucide-react', () => ({
  MapPin: 'svg',
  Phone: 'svg',
  Clock: 'svg',
  ExternalLink: 'svg',
  Bookmark: 'svg',
  BookmarkCheck: 'svg',
  MessageSquare: 'svg',
  Flag: 'svg',
}));

async function loadChatServiceCard() {
  return import('../ChatServiceCard');
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

const cardFixture = {
  serviceId: 'svc-1',
  serviceName: 'Food Pantry',
  organizationName: 'Helping Hands',
  confidenceBand: 'HIGH',
  description: 'Emergency grocery assistance.',
  address: '123 Main St, Seattle, WA',
  phone: '555-0100',
  scheduleDescription: 'Mon-Fri 9am-5pm',
  links: [
    { url: 'https://example.org/services/food-pantry', label: 'Website' },
    { url: 'https://example.org/apply', label: 'Apply' },
    { url: 'https://example.org/contact', label: 'Contact' },
    { url: 'https://example.org/more', label: 'More' },
  ],
  eligibilityHint: 'You may qualify based on your county and household size.',
} as const;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  useStateMock.mockImplementation((initial: unknown) => [initial, vi.fn()]);
});

describe('ChatServiceCard', () => {
  it('renders the compact chat card with save controls and trust badge', async () => {
    useStateMock.mockReturnValueOnce([false, vi.fn()]);
    const { ChatServiceCard } = await loadChatServiceCard();

    const element = ChatServiceCard({
      card: cardFixture as never,
      isSaved: true,
      onToggleSave: vi.fn(),
    }) as React.ReactElement<any, any>;
    const badges = collectElements(element, (child) => child.type === 'badge');
    const buttons = collectElements(element, (child) => child.type === 'button');
    const feedbackForms = collectElements(element, (child) => child.type === 'feedback-form');

    expect(badges).toHaveLength(1);
    expect(buttons.length).toBeGreaterThan(1);
    expect(feedbackForms).toHaveLength(0);
  });

  it('renders the feedback form and trims actionable links to three items when open', async () => {
    useStateMock.mockReturnValueOnce([true, vi.fn()]);
    const { ChatServiceCard } = await loadChatServiceCard();

    const element = ChatServiceCard({
      card: cardFixture as never,
      isSaved: false,
      onToggleSave: vi.fn(),
    }) as React.ReactElement<any, any>;
    const externalLinks = collectElements(
      element,
      (child) => child.type === 'a' && typeof child.props.target === 'string',
    );
    const feedbackForm = collectElements(element, (child) => child.type === 'feedback-form')[0];

    expect(externalLinks).toHaveLength(3);
    expect(feedbackForm.props.serviceId).toBe('svc-1');
    expect(typeof feedbackForm.props.sessionId).toBe('string');
  });
});
