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
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    MapPin: 'svg',
    Phone: 'svg',
    Clock: 'svg',
    ExternalLink: 'svg',
    Tag: 'svg',
    Globe2: 'svg',
    Accessibility: 'svg',
    FileText: 'svg',
    Heart: 'svg',
    Bookmark: 'svg',
    BookmarkCheck: 'svg',
    AlertCircle: 'svg',
    Utensils: 'svg',
    Navigation: 'svg',
    Bus: 'svg',
    Users: 'svg',
    Layers: 'svg',
    MessageSquare: 'svg',
  };
});

async function loadServiceCard() {
  return import('../ServiceCard');
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

function collectText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(collectText).join(' ');
  }
  if (!React.isValidElement(node)) {
    return '';
  }
  return collectText((node as React.ReactElement<any, any>).props.children);
}

const enrichedFixture = {
  service: {
    id: 'svc-1',
    name: 'Food Pantry',
    url: 'https://example.org/services/food-pantry',
    capacityStatus: 'available',
    estimatedWaitDays: 2,
    description: 'Emergency grocery assistance for local residents.',
    fees: 'Free',
  },
  organization: {
    name: 'Helping Hands',
  },
  address: {
    address1: '123 Main St',
    city: 'Seattle',
    stateProvince: 'WA',
    postalCode: '98101',
  },
  phones: [{ number: '555-0100', extension: '42' }],
  schedules: [{ description: 'Mon-Fri 9am-5pm' }],
  confidenceScore: {
    verificationConfidence: 92,
    eligibilityMatch: 80,
    constraintFit: 70,
  },
  taxonomyTerms: [
    { id: 'tag-1', term: 'Food' },
    { id: 'tag-2', term: 'Pantry' },
    { id: 'tag-3', term: 'Groceries' },
    { id: 'tag-4', term: 'Emergency' },
    { id: 'tag-5', term: 'Community' },
    { id: 'tag-6', term: 'Local' },
  ],
  eligibility: [
    { description: 'Must live in the county', minimumAge: 18, maximumAge: 64 },
    { description: 'Income-qualified', minimumAge: null, maximumAge: null },
    { description: 'Bring proof of address', minimumAge: null, maximumAge: null },
  ],
  requiredDocuments: [{ document: 'Photo ID' }, { document: 'Proof of address' }],
  languages: [{ language: 'English' }, { language: 'Spanish' }],
  accessibility: [{ accessibility: 'Wheelchair accessible' }],
  attributes: [{ id: 'attr-1', tag: 'Walk-in', details: 'No appointment required' }],
  adaptations: [{ id: 'adapt-1', adaptationTag: 'Pet-friendly', details: 'Service animals welcome' }],
  dietaryOptions: [{ id: 'diet-1', dietaryType: 'Vegetarian', availability: 'weekdays', details: 'Most days' }],
  distanceMeters: 1400,
  contacts: [
    { id: 'contact-1', name: 'Jane Doe', title: 'Coordinator', email: 'jane@example.org' },
    { id: 'contact-2', name: 'John Roe', title: 'Volunteer', email: 'john@example.org' },
  ],
  serviceAreas: [{ name: 'King County' }],
  program: { name: 'Food Access Program' },
  location: {
    transitAccess: ['bus_stop'],
    parkingAvailable: 'street',
  },
} as const;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  useStateMock.mockImplementation((initial: unknown) => [initial, vi.fn()]);
});

describe('ServiceCard', () => {
  it('renders the fully populated service card with badges and expanded metadata', async () => {
    useStateMock.mockReturnValueOnce([false, vi.fn()]);
    const { ServiceCard } = await loadServiceCard();

    const element = ServiceCard({
      enriched: enrichedFixture as never,
      isSaved: true,
      onToggleSave: vi.fn(),
      href: '/service/svc-1',
    }) as React.ReactElement<any, any>;
    const badges = collectElements(element, (child) => child.type === 'badge');
    const buttons = collectElements(element, (child) => child.type === 'button');
    const feedbackForms = collectElements(element, (child) => child.type === 'feedback-form');
    const articles = collectElements(element, (child) => child.type === 'article');

    expect(articles[0].props['aria-label']).toBe('Service: Food Pantry');
    expect(badges).toHaveLength(2);
    expect(buttons.length).toBeGreaterThan(1);
    expect(feedbackForms).toHaveLength(0);
  });

  it('renders the inline feedback form and external-link branch when feedback is open', async () => {
    useStateMock.mockReturnValueOnce([true, vi.fn()]);
    const { ServiceCard } = await loadServiceCard();

    const element = ServiceCard({
      enriched: enrichedFixture as never,
      compact: false,
      isSaved: false,
      onToggleSave: vi.fn(),
    }) as React.ReactElement<any, any>;
    const anchors = collectElements(element, (child) => child.type === 'a');
    const feedbackForm = collectElements(element, (child) => child.type === 'feedback-form')[0];

    expect(anchors.some((child) => child.props.href === 'https://example.org/services/food-pantry')).toBe(true);
    expect(feedbackForm.props.serviceId).toBe('svc-1');
    expect(typeof feedbackForm.props.sessionId).toBe('string');
  });

  it('renders stored structured schedule days and times without an availability claim', async () => {
    const { ServiceCard } = await loadServiceCard();
    const element = ServiceCard({
      enriched: {
        ...enrichedFixture,
        schedules: [{
          description: null,
          days: ['MO', 'Tuesday'],
          opensAt: '09:00:00',
          closesAt: '17:00:00',
        }],
      } as never,
    }) as React.ReactElement<any, any>;

    const text = collectText(element);
    expect(text).toContain('Mon, Tue · 9:00 AM–5:00 PM');
    expect(text).not.toContain('Open now');
  });

  it('uses only a callable phone for the tel action', async () => {
    const { ServiceCard } = await loadServiceCard();
    const element = ServiceCard({
      enriched: {
        ...enrichedFixture,
        phones: [
          { number: '555-0199', extension: null, type: 'sms' },
          { number: '555-0100', extension: null, type: 'voice' },
        ],
      } as never,
    }) as React.ReactElement<any, any>;
    const anchors = collectElements(element, (child) => child.type === 'a');

    expect(anchors.some((anchor) => anchor.props.href === 'tel:555-0100')).toBe(true);
    expect(anchors.some((anchor) => anchor.props.href === 'tel:555-0199')).toBe(false);
  });

  it('does not render a tel action when the record has only an SMS number', async () => {
    const { ServiceCard } = await loadServiceCard();
    const element = ServiceCard({
      enriched: {
        ...enrichedFixture,
        phones: [{ number: '555-0199', extension: null, type: 'sms' }],
      } as never,
    }) as React.ReactElement<any, any>;
    const anchors = collectElements(element, (child) => child.type === 'a');

    expect(anchors.some((anchor) => String(anchor.props.href).startsWith('tel:'))).toBe(false);
  });

  it('uses a hotline for the tel action instead of an earlier SMS number', async () => {
    const { ServiceCard } = await loadServiceCard();
    const element = ServiceCard({
      enriched: {
        ...enrichedFixture,
        phones: [
          { number: '555-0199', extension: null, type: 'sms' },
          { number: '555-0111', extension: null, type: 'hotline' },
        ],
      } as never,
    }) as React.ReactElement<any, any>;
    const anchors = collectElements(element, (child) => child.type === 'a');

    expect(anchors.some((anchor) => anchor.props.href === 'tel:555-0111')).toBe(true);
    expect(anchors.some((anchor) => anchor.props.href === 'tel:555-0199')).toBe(false);
  });
});
