// @vitest-environment jsdom

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';

import type { EnrichedService, Organization, Service } from '@/domain/types';
import { ServiceCard } from '@/components/directory/ServiceCard';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('a11y: ServiceCard', () => {
  function makeEnrichedService(overrides: Partial<EnrichedService> = {}): EnrichedService {
    const now = new Date();
    return {
      service: {
        id: 's-1',
        organizationId: 'org-1',
        name: 'Test Service',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      } as Service,
      organization: {
        id: 'org-1',
        name: 'Test Org',
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

  it('passes axe scan (compact=false)', async () => {
    const enriched = makeEnrichedService();

    const { container } = render(
      <ServiceCard enriched={enriched} compact={false} href="/service/s-1" />,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('passes axe scan (compact=true)', async () => {
    const enriched = makeEnrichedService();

    const { container } = render(
      <ServiceCard enriched={enriched} compact href="/service/s-1" />,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
