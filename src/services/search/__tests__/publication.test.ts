import { describe, expect, it } from 'vitest';

import {
  buildLegacyRetailerExclusionPredicate,
  buildPublishedOrganizationPredicate,
  buildPublishedServicePredicate,
  buildPublishableSourcePredicate,
} from '../publication';

describe('seeker publication predicates', () => {
  it('excludes the historical nationwide SNAP retailer import from every public path', () => {
    const predicate = buildLegacyRetailerExclusionPredicate('service');

    expect(predicate).toContain("service.name = 'SNAP/EBT accepted here'");
    expect(predicate).toContain('USDA FNS SNAP Retailer Locator');
    expect(predicate).toContain('place to SPEND SNAP benefits');
  });

  it('fails closed for canonical services with missing or non-publishable source purpose', () => {
    const predicate = buildPublishableSourcePredicate('resource');

    expect(predicate).toContain('canonical_services publication_source');
    expect(predicate).toContain('source_systems publication_system');
    expect(predicate).toContain('publication_source.winning_source_system_id IS NULL');
    expect(predicate).toContain('publication_system.id IS NULL');
    expect(predicate).toContain('publication_system.resource_purpose IS NULL');
    expect(predicate).toContain(
      "publication_system.resource_purpose NOT IN ('service_catalog', 'program_navigation')",
    );
    expect(predicate).not.toContain('supporting_reference');
    expect(predicate).not.toContain('excluded');
  });

  it('keeps active status, organization status, and integrity hold in the shared service gate', () => {
    const predicate = buildPublishedServicePredicate('svc', 'org');

    expect(predicate).toContain("svc.status = 'active'");
    expect(predicate).toContain('svc.integrity_hold_at IS NULL');
    expect(predicate).toContain("org.status = 'active'");
    expect(predicate).toContain('publication_source.published_service_id = svc.id');
  });

  it('requires an organization to have at least one publishable service', () => {
    const predicate = buildPublishedOrganizationPredicate('org');

    expect(predicate).toContain('EXISTS');
    expect(predicate).toContain('FROM services published_service');
    expect(predicate).toContain('published_service.organization_id = org.id');
    expect(predicate).toContain('publication_source.published_service_id = published_service.id');
  });
});
