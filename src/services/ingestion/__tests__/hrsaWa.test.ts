import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { publishSite } from '../../../../scripts/import/hrsa-wa-release';

import {
  HRSA_RELEASE_ACTOR,
  HRSA_SITE_CSV_URL,
  HRSA_SOURCE_LICENSE,
  assertExpectedHrsaWaCohort,
  buildHrsaOrganizationFacts,
  buildHrsaSnapshotMetadata,
  buildHrsaSourceAssertion,
  canonicalHrsaIds,
  hrsaHoldReason,
  hrsaWithdrawalReason,
  isHrsaManagedHold,
  legacyHrsaIds,
  parseCsv,
  parseHrsaWaSnapshot,
  sourceProvidedHttpUrl,
  uuidV5,
} from '../hrsaWa';

const headers = [
  'Health Center Number',
  'BPHC Assigned Number',
  'Site Name',
  'Site Address',
  'Site City',
  'Site State Abbreviation',
  'Site Postal Code',
  'Site Telephone Number',
  'Site Web Address',
  'Operating Hours per Week',
  'Site Status Description',
  'Health Center Type Description',
  'Health Center Name',
  'Geocoding Artifact Address Primary X Coordinate',
  'Geocoding Artifact Address Primary Y Coordinate',
  'Complete County Name',
  'Data Warehouse Record Create Date',
];

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function fixtureRow(overrides: Partial<Record<(typeof headers)[number], string>> = {}): string {
  const defaults: Record<(typeof headers)[number], string> = {
    'Health Center Number': 'H80CS00001',
    'BPHC Assigned Number': 'BPS-H80-000001',
    'Site Name': 'Rainier Community Clinic',
    'Site Address': '100 Main St',
    'Site City': 'Seattle',
    'Site State Abbreviation': 'WA',
    'Site Postal Code': '98101-1234',
    'Site Telephone Number': '206-555-0100',
    'Site Web Address': 'https://clinic.example/services',
    'Operating Hours per Week': '40.00',
    'Site Status Description': 'Active',
    'Health Center Type Description': 'Service Delivery Site',
    'Health Center Name': 'Community Health Organization',
    'Geocoding Artifact Address Primary X Coordinate': '-122.3321',
    'Geocoding Artifact Address Primary Y Coordinate': '47.6062',
    'Complete County Name': 'King County',
    'Data Warehouse Record Create Date': '07/21/2026',
  };
  const row = { ...defaults, ...overrides };
  return headers.map((header) => csvCell(row[header] ?? '')).join(',');
}

function fixtureCsv(...rows: string[]): string {
  return `${headers.join(',')}\n${rows.join('\n')}\n`;
}

describe('HRSA WA regional release parser', () => {
  it('includes only active WA service-delivery site types and isolates admin-only rows', () => {
    const cohort = parseHrsaWaSnapshot(
      fixtureCsv(
        fixtureRow(),
        fixtureRow({
          'BPHC Assigned Number': 'BPS-H80-000002',
          'Site Name': 'Combined Administration and Clinic',
          'Health Center Type Description': 'Administrative/Service Delivery Site',
          'Site Web Address': 'www.source-without-scheme.example',
        }),
        fixtureRow({
          'BPHC Assigned Number': 'BPS-H80-000003',
          'Site Name': 'Administrative Office',
          'Health Center Type Description': 'Administrative',
        }),
        fixtureRow({
          'BPHC Assigned Number': 'BPS-H80-000004',
          'Site State Abbreviation': 'OR',
        }),
      ),
    );

    expect(cohort.included.map((site) => site.siteId)).toEqual([
      'BPS-H80-000001',
      'BPS-H80-000002',
    ]);
    expect(cohort.adminOnly.map((site) => site.siteId)).toEqual(['BPS-H80-000003']);
    expect(cohort.included[1]?.explicitUrl).toBeNull();
    expect(cohort.totalWashingtonRows).toBe(3);
    expect(cohort.unexpectedActiveSiteTypes).toEqual([]);
    assertExpectedHrsaWaCohort(cohort, 2, 1);
  });

  it('fails closed on cohort drift, inactive WA rows, and unexpected active types', () => {
    const inactive = parseHrsaWaSnapshot(
      fixtureCsv(fixtureRow({ 'Site Status Description': 'Inactive' })),
    );
    expect(() => assertExpectedHrsaWaCohort(inactive, 0, 0)).toThrow(
      'inactive cohort drift',
    );
    expect(inactive.inactiveWashingtonSites.map((site) => site.siteId)).toEqual([
      'BPS-H80-000001',
    ]);
    expect(() => assertExpectedHrsaWaCohort(inactive, 0, 0, 1)).not.toThrow();
    const inactiveAssertion = buildHrsaSourceAssertion(
      inactive.inactiveWashingtonSites[0]!,
      buildHrsaSnapshotMetadata({
        bytes: Buffer.from(fixtureCsv(fixtureRow({ 'Site Status Description': 'Inactive' }))),
        retrievedAt: '2026-07-22T18:00:00Z',
      }),
    );
    expect(inactiveAssertion.parsedPayload).toMatchObject({
      services: [{ status: 'inactive' }],
    });
    expect(JSON.stringify(inactiveAssertion.parsedPayload)).not.toContain(
      'as an active service delivery site',
    );

    const unexpected = parseHrsaWaSnapshot(
      fixtureCsv(fixtureRow({ 'Health Center Type Description': 'Mobile Administration' })),
    );
    expect(() => assertExpectedHrsaWaCohort(unexpected, 0, 0)).toThrow(
      'unexpected active site types',
    );
  });

  it('requires complete contact, location, coordinate, and operating-hour source facts', () => {
    expect(() =>
      parseHrsaWaSnapshot(fixtureCsv(fixtureRow({ 'Site Telephone Number': '' }))),
    ).toThrow('Site Telephone Number');
    expect(() =>
      parseHrsaWaSnapshot(
        fixtureCsv(
          fixtureRow({ 'Geocoding Artifact Address Primary Y Coordinate': '0' }),
        ),
      ),
    ).toThrow('invalid coordinate');
    expect(() =>
      parseHrsaWaSnapshot(fixtureCsv(fixtureRow({ 'Operating Hours per Week': '0' }))),
    ).toThrow('invalid positive number');
  });

  it('never infers a URL scheme', () => {
    expect(sourceProvidedHttpUrl('www.example.org')).toBeNull();
    expect(sourceProvidedHttpUrl('example.org/path')).toBeNull();
    expect(sourceProvidedHttpUrl('javascript:alert(1)')).toBeNull();
    expect(sourceProvidedHttpUrl('https://example.org/path')).toBe('https://example.org/path');
  });

  it('never promotes a site-scoped URL to the organization entity', () => {
    const cohort = parseHrsaWaSnapshot(
      fixtureCsv(
        fixtureRow({ 'Site Web Address': 'https://clinic.example/first' }),
        fixtureRow({
          'BPHC Assigned Number': 'BPS-H80-000002',
          'Site Web Address': 'https://clinic.example/second',
        }),
      ),
    );

    expect(buildHrsaOrganizationFacts(cohort)).toEqual([
      {
        healthCenterNumber: 'H80CS00001',
        name: 'Community Health Organization',
        url: null,
      },
    ]);
  });

  it('recognizes only HRSA-owned administrative and withdrawal holds', () => {
    const adminReason = hrsaHoldReason('a'.repeat(64));
    const withdrawalReason = hrsaWithdrawalReason('b'.repeat(64));
    for (const integrityHoldReason of [adminReason, withdrawalReason]) {
      expect(isHrsaManagedHold({
        status: 'inactive',
        integrityHoldReason,
        integrityHeldByUserId: HRSA_RELEASE_ACTOR,
      })).toBe(true);
    }
    expect(isHrsaManagedHold({
      status: 'inactive',
      integrityHoldReason: adminReason,
      integrityHeldByUserId: 'user:reviewer',
    })).toBe(false);
    expect(isHrsaManagedHold({
      status: 'active',
      integrityHoldReason: withdrawalReason,
      integrityHeldByUserId: HRSA_RELEASE_ACTOR,
    })).toBe(false);
  });

  it('preserves raw source data and snapshot-level provenance', () => {
    const bytes = Buffer.from(fixtureCsv(fixtureRow({ 'Site Web Address': 'www.example.org' })));
    const snapshot = buildHrsaSnapshotMetadata({
      bytes,
      retrievedAt: '2026-07-21T18:05:53.000Z',
      expectedSha256: undefined,
      etag: '"snapshot-etag"',
      lastModified: '2026-07-21T11:05:53Z',
    });
    const site = parseHrsaWaSnapshot(bytes.toString('utf8')).included[0]!;
    const assertion = buildHrsaSourceAssertion(site, snapshot);

    expect(assertion.rawPayload['Site Web Address']).toBe('www.example.org');
    expect(assertion.canonicalSourceUrl).toBe(HRSA_SITE_CSV_URL);
    expect(assertion.sourceLicense).toBe(HRSA_SOURCE_LICENSE);
    expect(assertion.sourceConfidenceSignals).toMatchObject({
      trustTier: 'verified_publisher',
      snapshot: {
        sha256: snapshot.sha256,
        retrievedAt: '2026-07-21T18:05:53.000Z',
        etag: '"snapshot-etag"',
        lastModified: '2026-07-21T11:05:53Z',
        sourceLicense: HRSA_SOURCE_LICENSE,
      },
    });
    expect(assertion.parsedPayload).toMatchObject({
      services: [{ url: null, status: 'active' }],
      contacts: { website: null },
      sourceFacts: { operatingHoursPerWeek: 40 },
    });
    expect(assertion.payloadSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('uses the exact legacy importer IDs while separating canonical identities', () => {
    const site = parseHrsaWaSnapshot(fixtureCsv(fixtureRow())).included[0]!;
    const legacy = legacyHrsaIds(site);
    const canonical = canonicalHrsaIds(site);

    expect(legacy.serviceId).toBe(uuidV5(`svc:hrsa:${site.siteId}`));
    expect(legacy.organizationId).toBe(
      uuidV5(`org:hrsa:${site.healthCenterNumber}`),
    );
    expect(legacy.locationId).toBe(uuidV5(`loc:hrsa:${site.siteId}`));
    expect(canonical.serviceId).not.toBe(legacy.serviceId);
    expect(canonical.locationId).not.toBe(legacy.locationId);
  });

  it('handles quoted commas, escaped quotes, and embedded newlines', () => {
    expect(parseCsv('a,b\n"one, two","line 1\nline ""2"""\n')).toEqual([
      ['a', 'b'],
      ['one, two', 'line 1\nline "2"'],
    ]);
  });
});

describe('HRSA canonical identifier migration and release safeguards', () => {
  const migration = readFileSync(
    resolve(process.cwd(), 'db/migrations/0073_canonical_entity_identifiers.sql'),
    'utf8',
  );
  const releaseScript = readFileSync(
    resolve(process.cwd(), 'scripts/import/hrsa-wa-release.ts'),
    'utf8',
  );

  it('widens identifiers only for canonical entities and enforces active source identity uniqueness', () => {
    expect(migration).toContain("'canonical_organization'");
    expect(migration).toContain("'canonical_service'");
    expect(migration).toContain("'canonical_location'");
    expect(migration).toContain('VALIDATE CONSTRAINT entity_identifiers_entity_type_v2_check');
    expect(migration).toContain('idx_entity_ids_canonical_source_identity');
    expect(migration).toContain("AND status = 'active'");
    expect(migration).not.toMatch(/GRANT\s+/iu);
  });

  it('requires positive publication authority and reversible admin-only containment', () => {
    expect(releaseScript).toContain("record.processing_status = 'published'");
    expect(releaseScript).toContain("provenance.decision_status = 'accepted'");
    expect(releaseScript).toContain("canonical.publication_status = 'published'");
    expect(releaseScript).toContain('integrity_hold_reason = $2');
    expect(releaseScript).toContain('original_integrity_hold_reason');
    expect(releaseScript).toContain("status = 'rolled_back'");
    expect(releaseScript).toContain('Excluded from seeker publication: HRSA site type is Administrative only.');
  });

  it('preserves emergency pause and manages cross-snapshot withdrawal explicitly', () => {
    expect(releaseScript).toContain('SELECT emergency_pause');
    expect(releaseScript).toContain('FOR UPDATE');
    expect(releaseScript).toContain('source feed is emergency-paused; release refused');
    expect(releaseScript).not.toContain('emergency_pause = false,');
    expect(releaseScript).toContain("publication_status = 'retracted'");
    expect(releaseScript).toContain("SET status = 'withdrawn', withdrawn_at = NOW()");
    expect(releaseScript).toContain("decision_status = 'superseded'");
    expect(releaseScript).toContain('releasedManagedHolds');
    expect(releaseScript).toContain('withdrawnServices');
  });

  it('cannot turn a lower-ranked HRSA refresh into accepted authority for host fields', async () => {
    const bytes = Buffer.from(fixtureCsv(fixtureRow()));
    const site = parseHrsaWaSnapshot(bytes.toString('utf8')).included[0]!;
    const snapshot = buildHrsaSnapshotMetadata({
      bytes,
      retrievedAt: '2026-07-21T18:05:53.000Z',
    });
    const live = legacyHrsaIds(site);
    const statements: string[] = [];
    const client = {
      async query(sql: string) {
        statements.push(sql);
        if (sql.includes('SELECT id FROM public.services')) {
          return { rows: [{ id: live.serviceId }], rowCount: 1 };
        }
        if (sql.includes('FROM hsds_export_snapshots')) {
          return {
            rows: [
              {
                hsds_payload: {
                  meta: {
                    generatedBy: 'oran-resource-submission-projection',
                    publicationSourceKind: 'host_submission',
                    sourceSubmissionId: uuidV5('host-submission'),
                  },
                },
                generated_at: '2026-07-21T19:00:00.000Z',
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    } as unknown as Parameters<typeof publishSite>[0];

    const outcome = await publishSite(client, {
      site,
      snapshot,
      sourceSystemId: uuidV5('source-system:hrsa-test'),
      sourceRecordId: uuidV5('source-record:hrsa-test'),
      actorId: HRSA_RELEASE_ACTOR,
    });

    const sql = statements.join('\n');
    expect(outcome).toBe('authority-preserved');
    expect(sql).toContain("SET publication_status = 'retracted'");
    expect(sql).toContain("SET decision_status = 'superseded'");
    expect(sql).toContain("SET processing_status = 'normalized'");
    expect(sql).not.toContain('INSERT INTO public.canonical_services');
    expect(sql).not.toContain("90, 'accepted'");
    expect(sql).not.toMatch(/(?:INSERT INTO|UPDATE) public\.hsds_export_snapshots/u);
  });
});
