// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EnrichedService } from '@/domain/types';
import { SavedServiceComparison } from '@/components/seeker/SavedServiceComparison';

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

function savedService(
  id: string,
  name: string,
  organizationName: string,
  overrides: Partial<EnrichedService> = {},
): EnrichedService {
  return {
    service: {
      id,
      organizationId: `org-${id}`,
      name,
      description: `${name} description`,
      status: 'active',
      capacityStatus: 'available',
      applicationProcess: 'Call for an intake appointment',
      waitTime: 'Usually within two business days',
      updatedAt: new Date('2026-07-20T12:00:00Z'),
      createdAt: new Date('2026-07-01T12:00:00Z'),
    },
    organization: {
      id: `org-${id}`,
      name: organizationName,
      status: 'active',
      verifiedAt: '2026-07-19T12:00:00Z',
      updatedAt: new Date('2026-07-20T12:00:00Z'),
      createdAt: new Date('2026-07-01T12:00:00Z'),
    },
    address: {
      id: `address-${id}`,
      locationId: `location-${id}`,
      address1: '100 Main Street',
      city: 'Spokane',
      stateProvince: 'WA',
      postalCode: '99201',
      createdAt: new Date('2026-07-01T12:00:00Z'),
      updatedAt: new Date('2026-07-20T12:00:00Z'),
    },
    phones: [],
    schedules: [],
    taxonomyTerms: [],
    eligibility: [{
      id: `eligibility-${id}`,
      serviceId: id,
      description: 'Open to residents of Spokane County',
      createdAt: new Date('2026-07-01T12:00:00Z'),
      updatedAt: new Date('2026-07-20T12:00:00Z'),
    }],
    requiredDocuments: [{
      id: `document-${id}`,
      serviceId: id,
      document: 'Photo ID if available',
      createdAt: new Date('2026-07-01T12:00:00Z'),
      updatedAt: new Date('2026-07-20T12:00:00Z'),
    }],
    confidenceScore: {
      id: `confidence-${id}`,
      serviceId: id,
      score: 88,
      verificationConfidence: 92,
      eligibilityMatch: 70,
      constraintFit: 80,
      computedAt: new Date('2026-07-20T12:00:00Z'),
      createdAt: new Date('2026-07-20T12:00:00Z'),
      updatedAt: new Date('2026-07-20T12:00:00Z'),
    },
    provenance: {
      serviceId: id,
      origin: 'provider_submission',
      sourceName: organizationName,
      sourceCount: 1,
      firstSeenAt: '2026-07-01T12:00:00Z',
      informationUpdatedAt: '2026-07-20T12:00:00Z',
      lastHumanReviewAt: '2026-07-19T12:00:00Z',
    },
    attributes: [{
      id: `attribute-${id}`,
      serviceId: id,
      taxonomy: 'delivery',
      tag: 'in_person',
      createdAt: new Date('2026-07-01T12:00:00Z'),
      updatedAt: new Date('2026-07-20T12:00:00Z'),
    }],
    ...overrides,
  };
}

const buildServiceHref = (service: EnrichedService) => `/service/${service.service.id}`;

afterEach(() => cleanup());

describe('SavedServiceComparison', () => {
  it('compares stored trust, eligibility, document, location, and access evidence without promising outcomes', () => {
    render(
      <SavedServiceComparison
        services={[
          savedService('service-1', 'Family Shelter', 'Community Housing'),
          savedService('service-2', 'Housing Navigator', 'Regional Support'),
        ]}
        buildServiceHref={buildServiceHref}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Add Family Shelter to comparison' }));
    expect(screen.getByRole('status')).toHaveTextContent('One selected');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add Housing Navigator to comparison' }));

    const table = screen.getByRole('table', {
      name: 'Comparison of selected saved services using stored ORAN information',
    });
    expect(within(table).getByRole('rowheader', { name: 'Trust and freshness' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Eligibility on record' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Documents to prepare' })).toBeInTheDocument();
    expect(within(table).getAllByText('Open to residents of Spokane County')).toHaveLength(2);
    expect(within(table).getAllByText('Photo ID if available')).toHaveLength(2);
    expect(within(table).getAllByText('Stored capacity: Available — confirm with the provider')).toHaveLength(2);
    expect(screen.getByText(/not an eligibility or availability decision/i)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Review full details' })[0]).toHaveAttribute('href', '/service/service-1');
  });

  it('uses explicit uncertainty copy when provider evidence is incomplete', () => {
    render(
      <SavedServiceComparison
        services={[
          savedService('service-1', 'Family Shelter', 'Community Housing'),
          savedService('service-2', 'Housing Navigator', 'Regional Support', {
            address: null,
            eligibility: [],
            requiredDocuments: [],
            confidenceScore: null,
            provenance: null,
            attributes: [],
            serviceAreas: [],
            organization: {
              id: 'org-service-2',
              name: 'Regional Support',
              status: 'active',
              updatedAt: new Date('2026-07-20T12:00:00Z'),
              createdAt: new Date('2026-07-01T12:00:00Z'),
            },
          }),
        ]}
        buildServiceHref={buildServiceHref}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Add Family Shelter to comparison' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add Housing Navigator to comparison' }));

    expect(screen.getByText('No recent human review is recorded')).toBeInTheDocument();
    expect(screen.getByText('Location or service area is not recorded')).toBeInTheDocument();
    expect(screen.getByText('Eligibility criteria are not recorded; ask the provider')).toBeInTheDocument();
    expect(screen.getByText('No document requirements are recorded; confirm before applying')).toBeInTheDocument();
  });

  it('limits a comparison to three services and recovers after clearing the selection', () => {
    render(
      <SavedServiceComparison
        services={[
          savedService('service-1', 'Service One', 'Provider One'),
          savedService('service-2', 'Service Two', 'Provider Two'),
          savedService('service-3', 'Service Three', 'Provider Three'),
          savedService('service-4', 'Service Four', 'Provider Four'),
        ]}
        buildServiceHref={buildServiceHref}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Add Service One to comparison' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add Service Two to comparison' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add Service Three to comparison' }));

    expect(screen.getByRole('checkbox', { name: 'Add Service Four to comparison' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Remove one before choosing another');

    fireEvent.click(screen.getByRole('button', { name: 'Clear comparison' }));

    expect(screen.getByRole('checkbox', { name: 'Add Service Four to comparison' })).not.toBeDisabled();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
