// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLSpanElement>) => <span {...props}>{children}</span>,
}));

vi.mock('@/components/feedback/FeedbackForm', () => ({
  FeedbackForm: ({
    serviceId,
    sessionId,
    onClose,
  }: {
    serviceId: string;
    sessionId: string;
    onClose: () => void;
  }) => (
    <div data-testid="feedback-form">
      <p>service:{serviceId}</p>
      <p>session:{sessionId}</p>
      <button type="button" onClick={onClose}>
        Close feedback
      </button>
    </div>
  ),
}));

import { ChatServiceCard } from '@/components/chat/ChatServiceCard';

const cardFixture = {
  serviceId: 'svc-1',
  serviceName: 'Food Pantry',
  organizationName: 'Helping Hands',
  confidenceBand: 'HIGH' as const,
  confidenceScore: 92,
  description: 'Emergency grocery assistance.',
  address: '123 Main St, Seattle, WA',
  phone: '555-0100',
  scheduleDescription: 'Mon-Fri 9am-5pm',
  links: [
    { url: 'https://example.org/services/food-pantry', label: 'Website', kind: 'service_page' as const },
    { url: 'https://example.org/apply', label: 'Apply', kind: 'apply' as const },
    { url: 'https://example.org/contact', label: 'Contact', kind: 'contact' as const },
    { url: 'https://example.org/more', label: 'More', kind: 'other' as const },
  ],
  eligibilityHint: 'You may qualify based on your county and household size.',
  matchReasons: ['Offers phone support', 'Does not require ID'],
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('ChatServiceCard interactions', () => {
  it('renders core metadata, truncates action links to three, and toggles save', () => {
    const onToggleSave = vi.fn();
    render(
      <ChatServiceCard
        card={cardFixture}
        isSaved={false}
        onToggleSave={onToggleSave}
      />,
    );

    expect(screen.getByRole('link', { name: 'Food Pantry' })).toHaveAttribute('href', '/service/svc-1');
    expect(screen.getByText('Helping Hands')).toBeInTheDocument();
    expect(screen.getByText('Trust: High')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Call Food Pantry at 555-0100/i })).toHaveAttribute('href', 'tel:555-0100');
    expect(screen.getByText('Why this may fit')).toBeInTheDocument();
    expect(screen.getByText('Offers phone support')).toBeInTheDocument();
    expect(screen.getByText('Does not require ID')).toBeInTheDocument();

    const externalLinks = screen.getAllByRole('link').filter((link: HTMLElement) =>
      link.getAttribute('href')?.startsWith('https://'),
    );
    expect(externalLinks).toHaveLength(2);
    expect(screen.queryByRole('link', { name: 'More' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save this service' }));
    expect(onToggleSave).toHaveBeenCalledWith('svc-1');
  });

  it('preserves canonical discovery context in detail and report links when provided', () => {
    render(
      <ChatServiceCard
        card={cardFixture}
        discoveryContext={{
          text: 'food',
          needId: 'food_assistance',
          confidenceFilter: 'HIGH',
          sortBy: 'name_desc',
          taxonomyTermIds: ['a1000000-4000-4000-8000-000000000001'],
          attributeFilters: { delivery: ['virtual'], access: ['walk_in'] },
          page: 3,
        }}
      />,
    );

    expect(screen.getByRole('link', { name: 'Food Pantry' })).toHaveAttribute(
      'href',
      '/service/svc-1?q=food&confidence=HIGH&sort=name_desc&category=food_assistance&taxonomyIds=a1000000-4000-4000-8000-000000000001&attributes=%7B%22delivery%22%3A%5B%22virtual%22%5D%2C%22access%22%3A%5B%22walk_in%22%5D%7D&page=3',
    );
    expect(screen.getByRole('link', { name: 'Report data issue' })).toHaveAttribute(
      'href',
      '/report?serviceId=svc-1&q=food&confidence=HIGH&sort=name_desc&category=food_assistance&taxonomyIds=a1000000-4000-4000-8000-000000000001&attributes=%7B%22delivery%22%3A%5B%22virtual%22%5D%2C%22access%22%3A%5B%22walk_in%22%5D%7D&page=3',
    );
  });

  it('opens feedback using existing session id and closes back to button state', () => {
    sessionStorage.setItem('oran_chat_session_id', 'existing-session');

    render(<ChatServiceCard card={cardFixture} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rate result' }));
    expect(screen.getByTestId('feedback-form')).toBeInTheDocument();
    expect(screen.getByText('service:svc-1')).toBeInTheDocument();
    expect(screen.getByText('session:existing-session')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close feedback' }));
    expect(screen.queryByTestId('feedback-form')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rate result' })).toBeInTheDocument();
  });

  it('creates and stores a session id when none exists', () => {
    const uuidSpy = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('generated-session-id');

    render(<ChatServiceCard card={{ ...cardFixture, confidenceBand: 'LIKELY' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rate result' }));

    expect(screen.getByText('session:generated-session-id')).toBeInTheDocument();
    expect(sessionStorage.getItem('oran_chat_session_id')).toBe('generated-session-id');
    expect(uuidSpy).toHaveBeenCalledOnce();
    uuidSpy.mockRestore();
  });
});
