// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ServiceCard } from '@/components/directory/ServiceCard';
import type { EnrichedService, Organization, Service } from '@/domain/types';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@/components/seeker/AddToPlanDialog', () => ({
  AddToPlanDialog: () => null,
}));

vi.mock('@/components/seeker/SavedCollectionsDialog', () => ({
  SavedCollectionsDialog: () => null,
}));

vi.mock('@/components/feedback/FeedbackForm', () => ({
  FeedbackForm: () => null,
}));

vi.mock('@/components/feedback/ReportProblemDialog', () => ({
  ReportProblemDialog: () => null,
}));

vi.mock('@/components/host/OrgProfileCard', () => ({
  OrgProfileCard: () => null,
}));

const now = new Date('2026-08-05T12:00:00.000Z');

function makeEnrichedService(overrides: Partial<EnrichedService> = {}): EnrichedService {
  return {
    service: {
      id: 'service-1',
      organizationId: 'org-1',
      name: 'Community Food Support',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    } as Service,
    organization: {
      id: 'org-1',
      name: 'Community Partner',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    } as Organization,
    phones: [],
    schedules: [],
    taxonomyTerms: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('ServiceCard listing clarity', () => {
  it('puts stored service scope and eligibility near the top without inferring qualification', () => {
    render(
      <ServiceCard
        compact
        enriched={makeEnrichedService({
          service: {
            id: 'service-1',
            organizationId: 'org-1',
            name: 'Community Food Support',
            description: 'Provides weekly groceries and emergency food boxes.',
            status: 'active',
            createdAt: now,
            updatedAt: now,
          } as Service,
          taxonomyTerms: [
            { id: 'term-1', term: 'Food assistance' },
            { id: 'term-2', term: 'Emergency groceries' },
          ] as EnrichedService['taxonomyTerms'],
          eligibility: [{
            id: 'eligibility-1',
            serviceId: 'service-1',
            description: 'Must live in the listed service area',
            minimumAge: 18,
            maximumAge: 64,
            createdAt: now,
            updatedAt: now,
          }],
        })}
      />,
    );

    expect(screen.getByText('What this helps with')).toBeInTheDocument();
    expect(screen.getByText('Provides weekly groceries and emergency food boxes.')).toBeInTheDocument();
    expect(screen.getByText('Categories: Food assistance, Emergency groceries')).toBeInTheDocument();
    expect(screen.getByText('Who may qualify')).toBeInTheDocument();
    expect(screen.getByText(/Record confidence:/)).toBeInTheDocument();
    expect(screen.getByText(/Must live in the listed service area · Ages 18–64/)).toBeInTheDocument();
    expect(screen.getByText('Confirm current requirements with the provider.')).toBeInTheDocument();
    expect(screen.queryByText(/You qualify/i)).not.toBeInTheDocument();
  });

  it('uses stored categories when a description is not listed', () => {
    render(
      <ServiceCard
        compact
        enriched={makeEnrichedService({
          taxonomyTerms: [
            { id: 'term-1', term: 'Food assistance' },
            { id: 'term-2', term: 'Grocery access' },
          ] as EnrichedService['taxonomyTerms'],
        })}
      />,
    );

    expect(screen.getByText('Categories: Food assistance, Grocery access')).toBeInTheDocument();
  });

  it('states both evidence gaps and directs the seeker to confirm', () => {
    render(<ServiceCard compact enriched={makeEnrichedService({
      eligibility: [],
      cardDataStatus: 'loaded',
    })} />);

    expect(
      screen.getByText('This record does not list what the service helps with. Confirm the service scope with the provider.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('No eligibility requirements are stored for this listing. Confirm current requirements with the provider.'),
    ).toBeInTheDocument();
  });

  it('distinguishes temporarily unavailable card facts from a known-empty record', () => {
    render(<ServiceCard compact enriched={makeEnrichedService({
      cardDataStatus: 'unavailable',
    })} />);

    expect(
      screen.getByText('Service categories could not be loaded. Open the listing or confirm the service scope with the provider.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Eligibility details could not be loaded. Open the listing or confirm current requirements with the provider.'),
    ).toBeInTheDocument();
  });
});
