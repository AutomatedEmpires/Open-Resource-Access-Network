import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  buildLegacyRetailerExclusionPredicate,
  buildPublishedOrganizationPredicate,
  buildPublishedServicePredicate,
  buildPublishableSourcePredicate,
  resolvePublicationSafetyMode,
} from '../publication';

describe('seeker publication predicates', () => {
  const originalSafetyMode = process.env.ORAN_PUBLICATION_SAFETY_MODE;

  beforeEach(() => {
    delete process.env.ORAN_PUBLICATION_SAFETY_MODE;
  });

  afterAll(() => {
    if (originalSafetyMode === undefined) {
      delete process.env.ORAN_PUBLICATION_SAFETY_MODE;
    } else {
      process.env.ORAN_PUBLICATION_SAFETY_MODE = originalSafetyMode;
    }
  });

  it('excludes the historical nationwide SNAP retailer import from every public path', () => {
    const predicate = buildLegacyRetailerExclusionPredicate('service');

    expect(predicate).toContain("service.name = 'SNAP/EBT accepted here'");
    expect(predicate).toContain('USDA FNS SNAP Retailer Locator');
    expect(predicate).toContain('place to SPEND SNAP benefits');
  });

  it('requires accepted, published provenance from the winning canonical source', () => {
    const predicate = buildPublishableSourcePredicate('resource', 'positive_authority');

    expect(predicate).toContain('public.canonical_services publication_source');
    expect(predicate).toContain('public.canonical_provenance publication_provenance');
    expect(predicate).toContain("publication_provenance.decision_status = 'accepted'");
    expect(predicate).toContain('public.source_records publication_record');
    expect(predicate).toContain("publication_record.processing_status = 'published'");
    expect(predicate).toContain('public.source_feeds publication_feed');
    expect(predicate).toContain('publication_feed.is_active IS TRUE');
    expect(predicate).toContain('publication_system.id = publication_source.winning_source_system_id');
    expect(predicate).toContain("publication_source.lifecycle_status = 'active'");
    expect(predicate).toContain("publication_source.publication_status = 'published'");
    expect(predicate).toContain(
      "publication_system.resource_purpose IN ('service_catalog', 'program_navigation')",
    );
    expect(predicate).not.toContain('supporting_reference');
    expect(predicate).not.toContain('excluded');
    expect(predicate).not.toContain('NOT EXISTS');
  });

  it('requires an approved manual projection with matching snapshot, assertion, and transition', () => {
    const predicate = buildPublishableSourcePredicate('resource', 'positive_authority');

    expect(predicate).toContain('public.hsds_export_snapshots publication_snapshot');
    expect(predicate).toContain('public.submissions publication_submission');
    expect(predicate).toContain("publication_submission.status = 'approved'");
    expect(predicate).toContain("payload ->> 'projectionSourceRecordId'");
    expect(predicate).toContain("publication_record.source_record_type = 'mixed_bundle'");
    expect(predicate).toContain("publication_record.parsed_payload #>> '{projection,serviceId}' = resource.id::text");
    expect(predicate).toContain("publication_feed.feed_type = 'manual_entry'");
    expect(predicate).toContain("publication_system.family = 'manual'");
    expect(predicate).toContain("= 'host_submission'");
    expect(predicate).toContain("publication_system.trust_tier = 'trusted_partner'");
    expect(predicate).toContain("= 'community_review'");
    expect(predicate).toContain("publication_system.trust_tier = 'community'");
    expect(predicate).toContain('public.submission_transitions publication_approval');
    expect(predicate).toContain("publication_approval.to_status = 'approved'");
    expect(predicate).toContain('publication_approval.gates_passed IS TRUE');
  });

  it('supports only a fail-closed emergency override', () => {
    expect(resolvePublicationSafetyMode()).toBe('positive_authority');
    expect(resolvePublicationSafetyMode('positive_authority')).toBe('positive_authority');
    expect(resolvePublicationSafetyMode('deny_all')).toBe('deny_all');
    expect(resolvePublicationSafetyMode('legacy_allow')).toBe('deny_all');
    expect(resolvePublicationSafetyMode('typo')).toBe('deny_all');
    expect(buildPublishableSourcePredicate('resource', 'deny_all')).toBe(
      'FALSE /* ORAN_PUBLICATION_SAFETY_MODE deny_all */',
    );

    process.env.ORAN_PUBLICATION_SAFETY_MODE = 'deny_all';
    expect(buildPublishedServicePredicate('resource', 'organization')).toContain(
      'FALSE /* ORAN_PUBLICATION_SAFETY_MODE deny_all */',
    );

    process.env.ORAN_PUBLICATION_SAFETY_MODE = 'legacy_allow';
    expect(buildPublishedServicePredicate('resource', 'organization')).toContain(
      'FALSE /* ORAN_PUBLICATION_SAFETY_MODE deny_all */',
    );
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

  it('ships read-only supporting indexes for both positive authority lanes', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'db/migrations/0064_positive_publication_authority.sql'),
      'utf8',
    );

    expect(migration).toContain('idx_canonical_services_positive_publication');
    expect(migration).toContain('idx_canonical_provenance_accepted_service_source');
    expect(migration).toContain('idx_source_records_published_feed');
    expect(migration).toContain('idx_source_feeds_active_system');
    expect(migration).toContain('idx_hsds_current_manual_publication');
    expect(migration).toContain('idx_submissions_approved_projection');
    expect(migration).toContain('idx_submission_transitions_approved_passed');
    expect(migration).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/im);
  });
});
