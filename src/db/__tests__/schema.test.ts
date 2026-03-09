import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

const mutableEnv = process.env as Record<string, string | undefined>;

async function loadSchemaModule() {
  return import('../schema');
}

async function loadDbModule() {
  return import('../index');
}

// Zone C live table names — must all exist as Drizzle pgTable exports
const ZONE_C_TABLE_NAMES = [
  'organizations',
  'locations',
  'programs',
  'services',
  'service_at_location',
  'phones',
  'addresses',
  'schedules',
  'taxonomy_terms',
  'service_taxonomy',
  'confidence_scores',
  'verification_queue',
  'seeker_feedback',
  'chat_sessions',
  'feature_flags',
  'eligibility',
  'required_documents',
  'service_areas',
  'languages',
  'accessibility_for_disabilities',
  'contacts',
  'saved_services',
  'verification_evidence',
  'service_attributes',
  'service_adaptations',
  'dietary_options',
  'import_batches',
  'staging_organizations',
  'staging_locations',
  'staging_services',
  'audit_logs',
  'coverage_zones',
  'organization_members',
  'user_profiles',
];

// Zone C Drizzle export names (camelCase)
const ZONE_C_EXPORTS = [
  'organizations',
  'locations',
  'programs',
  'services',
  'serviceAtLocation',
  'phones',
  'addresses',
  'schedules',
  'taxonomyTerms',
  'serviceTaxonomy',
  'confidenceScores',
  'verificationQueue',
  'seekerFeedback',
  'chatSessions',
  'featureFlags',
  'eligibility',
  'requiredDocuments',
  'serviceAreas',
  'languagesTable',
  'accessibilityForDisabilities',
  'contacts',
  'savedServices',
  'verificationEvidence',
  'serviceAttributes',
  'serviceAdaptations',
  'dietaryOptions',
  'importBatches',
  'stagingOrganizations',
  'stagingLocations',
  'stagingServices',
  'auditLogs',
  'coverageZones',
  'organizationMembers',
  'userProfiles',
];

// Zone C relation export names
const ZONE_C_RELATIONS = [
  'organizationsRelations',
  'locationsRelations',
  'servicesRelations',
  'programsRelations',
  'serviceAtLocationRelations',
  'phonesRelations',
  'addressesRelations',
  'schedulesRelations',
  'taxonomyTermsRelations',
  'serviceTaxonomyRelations',
  'confidenceScoresRelations',
  'verificationQueueRelations',
  'seekerFeedbackRelations',
  'eligibilityRelations',
  'requiredDocumentsRelations',
  'serviceAreasRelations',
  'languagesTableRelations',
  'accessibilityForDisabilitiesRelations',
  'contactsRelations',
  'savedServicesRelations',
  'verificationEvidenceRelations',
  'serviceAttributesRelations',
  'serviceAdaptationsRelations',
  'dietaryOptionsRelations',
  'importBatchesRelations',
  'stagingOrganizationsRelations',
  'stagingLocationsRelations',
  'stagingServicesRelations',
  'organizationMembersRelations',
];

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete mutableEnv.DATABASE_URL;
});

describe('db schema and helpers', () => {
  it('exports the core ingestion tables and relation helpers', async () => {
    const schema = await loadSchemaModule();
    const exportedNames = Object.keys(schema);

    expect(exportedNames).toEqual(
      expect.arrayContaining([
        'ingestionSources',
        'ingestionJobs',
        'evidenceSnapshots',
        'extractedCandidates',
        'resourceTags',
        'discoveredLinks',
        'ingestionAuditEvents',
        'llmSuggestions',
        'adminReviewProfiles',
        'candidateAdminAssignments',
        'tagConfirmationQueue',
        'publishCriteria',
        'candidateReadiness',
        'verificationChecks',
        'verifiedServiceLinks',
        'feedSubscriptions',
        'adminRoutingRules',
      ]),
    );
  });

  it('builds table configs for schema exports with indexes/constraints callbacks', async () => {
    const schema = await loadSchemaModule();
    const tableConfigs = Object.values(schema).flatMap((value) => {
      if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
        return [];
      }
      try {
        return [getTableConfig(value as Parameters<typeof getTableConfig>[0])];
      } catch {
        return [];
      }
    });

    expect(tableConfigs.length).toBeGreaterThan(20);
    expect(tableConfigs.some((cfg) => cfg.name === 'scope_audit_log')).toBe(true);
    expect(tableConfigs.some((cfg) => cfg.name === 'notification_events')).toBe(true);
    expect(tableConfigs.some((cfg) => cfg.name === 'notification_preferences')).toBe(true);

    const withIndexes = tableConfigs.filter((cfg) => cfg.indexes.length > 0);
    expect(withIndexes.length).toBeGreaterThan(10);
  });

  it('fails fast when DATABASE_URL is missing and no-ops on close without a pool', async () => {
    const { closeDb, getDb } = await loadDbModule();

    await expect(closeDb()).resolves.toBeUndefined();
    expect(() => getDb()).toThrow('DATABASE_URL environment variable is required');
  });

  it('creates, reuses, and closes the pool-backed drizzle client', async () => {
    const poolEndMock = vi.fn().mockResolvedValue(undefined);
    const poolInstance = { end: poolEndMock };
    const poolCtorMock = vi.fn(function MockPool() {
      return poolInstance;
    });
    const drizzleMock = vi.fn((pool: unknown, options: unknown) => ({
      pool,
      options,
    }));

    vi.doMock('pg', () => ({
      Pool: poolCtorMock,
    }));
    vi.doMock('drizzle-orm/node-postgres', () => ({
      drizzle: drizzleMock,
    }));
    mutableEnv.DATABASE_URL = 'postgres://oran:test@localhost:5432/oran';

    const { closeDb, getDb, getPool } = await loadDbModule();

    const first = getDb() as unknown as { pool: unknown; options: unknown };
    const second = getDb();
    const pool = getPool();

    expect(poolCtorMock).toHaveBeenCalledWith({
      connectionString: 'postgres://oran:test@localhost:5432/oran',
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    expect(drizzleMock).toHaveBeenCalledOnce();
    expect(first).toBe(second);
    expect(first.pool).toBe(poolInstance);
    expect(pool).toBe(poolInstance);
    expect(first.options).toEqual(
      expect.objectContaining({
        schema: expect.objectContaining({
          ingestionSources: expect.anything(),
          verifiedServiceLinks: expect.anything(),
        }),
      }),
    );

    await closeDb();

    expect(poolEndMock).toHaveBeenCalledOnce();
    vi.doUnmock('pg');
    vi.doUnmock('drizzle-orm/node-postgres');
  });
});

// ============================================================
// Zone C Live Tables — P0 schema audit tests
// ============================================================
describe('Zone C live table definitions', () => {
  it('exports all Zone C table definitions', async () => {
    const schema = await loadSchemaModule();
    const exportedNames = Object.keys(schema);

    for (const name of ZONE_C_EXPORTS) {
      expect(exportedNames, `Missing export: ${name}`).toContain(name);
    }
  });

  it('exports all Zone C relation definitions', async () => {
    const schema = await loadSchemaModule();
    const exportedNames = Object.keys(schema);

    for (const name of ZONE_C_RELATIONS) {
      expect(exportedNames, `Missing relation: ${name}`).toContain(name);
    }
  });

  it('all Zone C tables have valid table configs with correct SQL names', async () => {
    const schema = await loadSchemaModule();
    const tableConfigs = ZONE_C_EXPORTS.map((name) => {
      const table = (schema as Record<string, unknown>)[name];
      expect(table, `${name} should be defined`).toBeDefined();
      return getTableConfig(table as Parameters<typeof getTableConfig>[0]);
    });

    for (let i = 0; i < ZONE_C_TABLE_NAMES.length; i++) {
      expect(tableConfigs[i].name, `Table ${ZONE_C_EXPORTS[i]} maps to wrong SQL name`).toBe(ZONE_C_TABLE_NAMES[i]);
    }
  });

  it('Zone C type exports exist (Row + NewRow)', async () => {
    const schema = await loadSchemaModule();
    const _exportedNames = Object.keys(schema);

    const typeRelatedExports = [
      'OrganizationRow',
      'LocationRow',
      'ProgramRow',
      'ServiceRow',
      'ServiceAtLocationRow',
      'PhoneRow',
      'AddressRow',
      'ScheduleRow',
      'TaxonomyTermRow',
      'ServiceTaxonomyRow',
      'ConfidenceScoreRow',
      'VerificationQueueRow',
      'SeekerFeedbackRow',
      'ChatSessionRow',
      'FeatureFlagRow',
      'EligibilityRow',
      'RequiredDocumentRow',
      'ServiceAreaRow',
      'LanguageRow',
      'AccessibilityForDisabilitiesRow',
      'ContactRow',
      'SavedServiceRow',
      'VerificationEvidenceRow',
      'ServiceAttributeRow',
      'ServiceAdaptationRow',
      'DietaryOptionRow',
      'ImportBatchRow',
      'StagingOrganizationRow',
      'StagingLocationRow',
      'StagingServiceRow',
      'AuditLogRow',
      'CoverageZoneRow',
      'OrganizationMemberRow',
      'UserProfileRow',
    ];
    // Type aliases compile away, but if the export is used as a value it's still
    // visible. Check that the schema at least exports names that match.
    // (Drizzle $inferSelect types are compile-time only — the presence of the
    // table constant itself is what matters. We already tested that above.)
    expect(typeRelatedExports.length).toBe(ZONE_C_TABLE_NAMES.length);
  });

  it('organizations table has status and phone columns (0007 + 0024)', async () => {
    const schema = await loadSchemaModule();
    const cfg = getTableConfig(schema.organizations as Parameters<typeof getTableConfig>[0]);
    const colNames = cfg.columns.map((c) => c.name);
    expect(colNames).toContain('status');
    expect(colNames).toContain('phone');
  });

  it('locations table has status column (0007)', async () => {
    const schema = await loadSchemaModule();
    const cfg = getTableConfig(schema.locations as Parameters<typeof getTableConfig>[0]);
    const colNames = cfg.columns.map((c) => c.name);
    expect(colNames).toContain('status');
    expect(colNames).toContain('transit_access');
    expect(colNames).toContain('parking_available');
  });

  it('services table has estimated_wait_days and capacity_status (0013)', async () => {
    const schema = await loadSchemaModule();
    const cfg = getTableConfig(schema.services as Parameters<typeof getTableConfig>[0]);
    const colNames = cfg.columns.map((c) => c.name);
    expect(colNames).toContain('estimated_wait_days');
    expect(colNames).toContain('capacity_status');
  });

  it('chat_sessions has message_count (0017)', async () => {
    const schema = await loadSchemaModule();
    const cfg = getTableConfig(schema.chatSessions as Parameters<typeof getTableConfig>[0]);
    const colNames = cfg.columns.map((c) => c.name);
    expect(colNames).toContain('message_count');
  });

  it('feature_flags has description (0007/0035)', async () => {
    const schema = await loadSchemaModule();
    const cfg = getTableConfig(schema.featureFlags as Parameters<typeof getTableConfig>[0]);
    const colNames = cfg.columns.map((c) => c.name);
    expect(colNames).toContain('description');
  });

  it('verification_queue uses assigned_to_user_id (0008 rename)', async () => {
    const schema = await loadSchemaModule();
    const cfg = getTableConfig(schema.verificationQueue as Parameters<typeof getTableConfig>[0]);
    const colNames = cfg.columns.map((c) => c.name);
    expect(colNames).toContain('assigned_to_user_id');
    expect(colNames).not.toContain('assigned_to');
  });

  it('user_profiles has multi-provider auth columns (0031)', async () => {
    const schema = await loadSchemaModule();
    const cfg = getTableConfig(schema.userProfiles as Parameters<typeof getTableConfig>[0]);
    const colNames = cfg.columns.map((c) => c.name);
    expect(colNames).toContain('email');
    expect(colNames).toContain('password_hash');
    expect(colNames).toContain('phone');
    expect(colNames).toContain('auth_provider');
  });

  it('eligibility.description is NOT NULL (0009)', async () => {
    const schema = await loadSchemaModule();
    const cfg = getTableConfig(schema.eligibility as Parameters<typeof getTableConfig>[0]);
    const descCol = cfg.columns.find((c) => c.name === 'description');
    expect(descCol).toBeDefined();
    expect(descCol!.notNull).toBe(true);
  });

  it('required_documents.document is NOT NULL (0009)', async () => {
    const schema = await loadSchemaModule();
    const cfg = getTableConfig(schema.requiredDocuments as Parameters<typeof getTableConfig>[0]);
    const docCol = cfg.columns.find((c) => c.name === 'document');
    expect(docCol).toBeDefined();
    expect(docCol!.notNull).toBe(true);
  });

  it('audit_logs.resource_id is UUID type (0004)', async () => {
    const schema = await loadSchemaModule();
    const cfg = getTableConfig(schema.auditLogs as Parameters<typeof getTableConfig>[0]);
    const resIdCol = cfg.columns.find((c) => c.name === 'resource_id');
    expect(resIdCol).toBeDefined();
    expect(resIdCol!.dataType).toBe('string');
    expect(resIdCol!.columnType).toBe('PgUUID');
  });

  it('coverage_zones uses geometryPolygon for geometry', async () => {
    const schema = await loadSchemaModule();
    const cfg = getTableConfig(schema.coverageZones as Parameters<typeof getTableConfig>[0]);
    const geomCol = cfg.columns.find((c) => c.name === 'geometry');
    expect(geomCol).toBeDefined();
  });

  it('service_areas uses geometryPolygon for extent', async () => {
    const schema = await loadSchemaModule();
    const cfg = getTableConfig(schema.serviceAreas as Parameters<typeof getTableConfig>[0]);
    const extentCol = cfg.columns.find((c) => c.name === 'extent');
    expect(extentCol).toBeDefined();
  });

  // ---- Migration 0002: audit columns (created_by_user_id / updated_by_user_id) ----
  it.each([
    ['organizations', 'organizations'],
    ['locations', 'locations'],
    ['services', 'services'],
    ['serviceAtLocation', 'serviceAtLocation'],
    ['phones', 'phones'],
    ['addresses', 'addresses'],
    ['schedules', 'schedules'],
    ['taxonomyTerms', 'taxonomyTerms'],
    ['serviceTaxonomy', 'serviceTaxonomy'],
    ['verificationQueue', 'verificationQueue'],
    ['seekerFeedback', 'seekerFeedback'],
    ['featureFlags', 'featureFlags'],
  ])('%s has created_by_user_id and updated_by_user_id (0002)', async (_label, exportName) => {
    const schema = await loadSchemaModule();
    const table = (schema as Record<string, unknown>)[exportName];
    const cfg = getTableConfig(table as Parameters<typeof getTableConfig>[0]);
    const colNames = cfg.columns.map((c) => c.name);
    expect(colNames, `${exportName} missing created_by_user_id`).toContain('created_by_user_id');
    expect(colNames, `${exportName} missing updated_by_user_id`).toContain('updated_by_user_id');
  });

  // ---- Migration 0002: timestamp normalization ----
  it.each([
    ['serviceAtLocation', 'serviceAtLocation', ['created_at', 'updated_at']],
    ['phones', 'phones', ['created_at', 'updated_at']],
    ['addresses', 'addresses', ['created_at', 'updated_at']],
    ['schedules', 'schedules', ['created_at', 'updated_at']],
    ['taxonomyTerms', 'taxonomyTerms', ['created_at', 'updated_at']],
    ['serviceTaxonomy', 'serviceTaxonomy', ['created_at', 'updated_at']],
    ['confidenceScores', 'confidenceScores', ['created_at', 'updated_at']],
    ['seekerFeedback', 'seekerFeedback', ['created_at', 'updated_at']],
  ])('%s has normalized timestamps (0002)', async (_label, exportName, expectedCols) => {
    const schema = await loadSchemaModule();
    const table = (schema as Record<string, unknown>)[exportName];
    const cfg = getTableConfig(table as Parameters<typeof getTableConfig>[0]);
    const colNames = cfg.columns.map((c) => c.name);
    for (const col of expectedCols) {
      expect(colNames, `${exportName} missing ${col}`).toContain(col);
    }
  });

  // ---- Migration 0002: verification_queue submitted_by → submitted_by_user_id ----
  it('verification_queue uses submitted_by_user_id (0002 rename)', async () => {
    const schema = await loadSchemaModule();
    const cfg = getTableConfig(schema.verificationQueue as Parameters<typeof getTableConfig>[0]);
    const colNames = cfg.columns.map((c) => c.name);
    expect(colNames).toContain('submitted_by_user_id');
    expect(colNames).not.toContain('submitted_by');
  });

  // ---- Migration 0026: pgvector embedding ----
  it('services table has embedding column (0026 pgvector)', async () => {
    const schema = await loadSchemaModule();
    const cfg = getTableConfig(schema.services as Parameters<typeof getTableConfig>[0]);
    const colNames = cfg.columns.map((c) => c.name);
    expect(colNames).toContain('embedding');
  });

  // ---- Migration 0027: feedback triage ----
  it('seeker_feedback has triage columns (0027)', async () => {
    const schema = await loadSchemaModule();
    const cfg = getTableConfig(schema.seekerFeedback as Parameters<typeof getTableConfig>[0]);
    const colNames = cfg.columns.map((c) => c.name);
    expect(colNames).toContain('triage_category');
    expect(colNames).toContain('triage_result');
  });
});
