import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  withTransaction: vi.fn(),
}));

const vaultMocks = vi.hoisted(() => ({
  createFormInstance: vi.fn(),
  createFormTemplate: vi.fn(),
  getAccessibleFormInstance: vi.fn(),
  listAccessibleFormInstances: vi.fn(),
  setFormSubmissionReviewerNotes: vi.fn(),
  updateFormInstanceDraft: vi.fn(),
}));

const draftFactory = () => ({
  variant: 'listing',
  channel: 'host',
  ownerOrganizationId: null,
  existingServiceId: null,
  organization: {
    name: '',
    description: '',
    url: '',
    email: '',
    phone: '',
    taxStatus: '',
    taxId: '',
    yearIncorporated: '',
    legalStatus: '',
  },
  service: {
    name: '',
    description: '',
    url: '',
    email: '',
    applicationProcess: '',
    fees: '',
    waitTime: '',
    interpretationServices: '',
    accreditations: '',
    licenses: '',
    phones: [] as Array<{ number: string; extension: string; type: 'voice' | 'fax' | 'text' | 'hotline' | 'tty'; description: string }>,
  },
  locations: [{
    id: undefined as string | undefined,
    name: '',
    description: '',
    transportation: '',
    address1: '',
    address2: '',
    city: '',
    region: '',
    stateProvince: '',
    postalCode: '',
    country: 'US',
    latitude: '',
    longitude: '',
    phones: [] as Array<{ number: string; extension: string; type: 'voice' | 'fax' | 'text' | 'hotline' | 'tty'; description: string }>,
    languages: [] as string[],
    accessibility: [] as string[],
    schedule: [
      { day: 'Monday', opens: '09:00', closes: '17:00', closed: true },
      { day: 'Tuesday', opens: '09:00', closes: '17:00', closed: true },
      { day: 'Wednesday', opens: '09:00', closes: '17:00', closed: true },
      { day: 'Thursday', opens: '09:00', closes: '17:00', closed: true },
      { day: 'Friday', opens: '09:00', closes: '17:00', closed: true },
      { day: 'Saturday', opens: '09:00', closes: '17:00', closed: true },
      { day: 'Sunday', opens: '09:00', closes: '17:00', closed: true },
    ] as Array<{ day: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday'; opens: string; closes: string; closed: boolean }>,
  }],
  taxonomy: { categories: [] as string[], customTerms: [] as string[] },
  access: {
    eligibilityDescription: '',
    minimumAge: '',
    maximumAge: '',
    serviceAreas: [] as string[],
    languages: [] as string[],
    requiredDocuments: [] as string[],
  },
  evidence: {
    sourceUrl: '',
    sourceName: '',
    contactEmail: '',
    submitterRelationship: '',
    notes: '',
  },
});

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/forms/vault', () => vaultMocks);
vi.mock('@/domain/resourceSubmission', () => ({
  createEmptyResourceSubmissionDraft: vi.fn((variant: 'listing' | 'claim', channel: 'host' | 'public') => {
    const draft = draftFactory();
    draft.variant = variant;
    draft.channel = channel;
    if (variant === 'claim') {
      draft.locations = [];
    }
    return draft;
  }),
  normalizeResourceSubmissionDraft: vi.fn((value: unknown, variant: 'listing' | 'claim', channel: 'host' | 'public') => {
    if (value && typeof value === 'object' && 'organization' in (value as Record<string, unknown>)) {
      return value;
    }
    const draft = draftFactory();
    draft.variant = variant;
    draft.channel = channel;
    if (variant === 'claim') {
      draft.locations = [];
    }
    return draft;
  }),
  computeResourceSubmissionCards: vi.fn(() => []),
  isResourceSubmissionComplete: vi.fn(() => true),
}));

import { createEmptyResourceSubmissionDraft } from '@/domain/resourceSubmission';
import type { FormInstance, FormTemplate } from '@/domain/forms';
import type { AuthContext } from '@/services/auth/session';
import {
  createResourceSubmission,
  ensureResourceSubmissionTemplate,
  getAccessibleResourceSubmission,
  getResourceSubmissionDetailForActor,
  getResourceSubmissionDetailForPublic,
  isResourceSubmissionStatusEditable,
  listAccessibleResourceSubmissions,
  projectApprovedResourceSubmission,
  saveResourceSubmissionDraft,
  seedResourceSubmissionDraftFromOrganization,
  seedResourceSubmissionDraftFromService,
  setResourceSubmissionPublicAccessToken,
  setResourceSubmissionReviewerNotes,
  submitResourceSubmission,
} from '@/services/resourceSubmissions/service';

function mockTemplate(overrides: Partial<FormTemplate> = {}): FormTemplate {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'resource-listing-host',
    title: 'Template',
    description: null,
    category: 'service_listing',
    audience_scope: 'host_member',
    storage_scope: 'organization',
    default_target_role: 'community_admin',
    schema_json: {},
    ui_schema_json: {},
    instructions_markdown: null,
    version: 1,
    is_published: true,
    blob_storage_prefix: null,
    created_by_user_id: null,
    updated_by_user_id: null,
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockInstance(overrides: Partial<FormInstance> = {}): FormInstance {
  const draft = createEmptyResourceSubmissionDraft('listing', 'host');
  draft.service.name = 'Seed service';
  draft.organization.name = 'Seed org';
  return {
    id: '22222222-2222-4222-8222-222222222222',
    submission_id: '33333333-3333-4333-8333-333333333333',
    template_id: '11111111-1111-4111-8111-111111111111',
    template_slug: 'resource-listing-host',
    template_title: 'Template',
    template_description: null,
    template_category: 'service_listing',
    template_audience_scope: 'host_member',
    template_storage_scope: 'organization',
    template_default_target_role: 'community_admin',
    template_schema_json: {},
    template_ui_schema_json: {},
    template_instructions_markdown: null,
    template_is_published: true,
    template_version: 1,
    storage_scope: 'organization',
    owner_organization_id: null,
    coverage_zone_id: null,
    recipient_role: 'community_admin',
    recipient_user_id: null,
    recipient_organization_id: null,
    blob_storage_prefix: null,
    form_data: { draft },
    attachment_manifest: [],
    last_saved_at: '2026-03-01T00:00:00.000Z',
    submission_type: 'new_service',
    status: 'draft',
    target_type: 'system',
    target_id: null,
    submitted_by_user_id: 'user-1',
    assigned_to_user_id: null,
    title: 'Title',
    notes: null,
    reviewer_notes: null,
    priority: 0,
    sla_deadline: null,
    sla_breached: false,
    submitted_at: null,
    reviewed_at: null,
    resolved_at: null,
    is_locked: false,
    locked_at: null,
    locked_by_user_id: null,
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockDetailSideQueries() {
  dbMocks.executeQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM submission_transitions')) return [];
    if (sql.includes('FROM confidence_scores')) return [];
    if (sql.includes('FROM submissions s') && sql.includes('submitter.display_name')) {
      return [{ payload: {}, submitted_by_label: null, assigned_to_label: null }];
    }
    if (sql.includes('SELECT * FROM form_templates WHERE slug =')) return [mockTemplate()];
    return [];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vaultMocks.createFormTemplate.mockResolvedValue(mockTemplate());
  vaultMocks.createFormInstance.mockResolvedValue({ instance: mockInstance(), reusedExistingDraft: false });
  vaultMocks.getAccessibleFormInstance.mockResolvedValue(null);
  vaultMocks.listAccessibleFormInstances.mockResolvedValue({ instances: [] });
  vaultMocks.updateFormInstanceDraft.mockResolvedValue(undefined);
  vaultMocks.setFormSubmissionReviewerNotes.mockResolvedValue(undefined);
  dbMocks.executeQuery.mockResolvedValue([]);
  dbMocks.withTransaction.mockImplementation(async (fn: (client: { query: ReturnType<typeof vi.fn> }) => unknown) => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    return fn(client);
  });
});

describe('resource submission service', () => {
  it('reuses existing resource template', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([mockTemplate()]);

    const template = await ensureResourceSubmissionTemplate('listing', 'host', 'user-1');
    expect(template.slug).toBe('resource-listing-host');
    expect(vaultMocks.createFormTemplate).not.toHaveBeenCalled();
  });

  it('creates resource template when missing', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);

    const template = await ensureResourceSubmissionTemplate('claim', 'host', 'user-1');
    expect(template.slug).toBe('resource-listing-host');
    expect(vaultMocks.createFormTemplate).toHaveBeenCalledOnce();
    const [input] = vaultMocks.createFormTemplate.mock.calls[0];
    expect(input.slug).toBe('resource-claim-host');
    expect(input.default_target_role).toBe('oran_admin');
  });

  it('sets hashed public token via transaction payload patch', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    dbMocks.withTransaction.mockImplementation(async (fn: (client: { query: typeof query }) => unknown) => fn({ query }));

    await setResourceSubmissionPublicAccessToken('sub-1', 'abc-token');
    expect(query).toHaveBeenCalled();
    const [, params] = query.mock.calls[0];
    expect(String(params[0])).toContain('publicAccessTokenHash');
  });

  it('seeds listing draft from service and normalizes location schedule + sms phone', async () => {
    dbMocks.executeQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM services s')) {
        return [{
          organization_id: 'org-1',
          organization_name: 'Org',
          organization_description: null,
          organization_url: null,
          organization_email: null,
          organization_phone: null,
          organization_tax_status: null,
          organization_tax_id: null,
          organization_year_incorporated: 2020,
          organization_legal_status: null,
          service_name: 'Svc',
          service_description: null,
          service_url: null,
          service_email: null,
          interpretation_services: null,
          application_process: null,
          fees: null,
          wait_time: null,
          accreditations: null,
          licenses: null,
        }];
      }
      if (sql.includes('FROM phones') && sql.includes('service_id')) return [{ number: '1', extension: null, type: 'sms', description: null }];
      if (sql.includes('FROM service_taxonomy')) return [{ term: 'food' }];
      if (sql.includes('FROM languages') && sql.includes('service_id')) return [{ language: 'en' }];
      if (sql.includes('FROM eligibility')) return [{ description: 'desc', minimum_age: 10, maximum_age: 50 }];
      if (sql.includes('FROM required_documents')) return [{ document: 'ID' }];
      if (sql.includes('FROM service_areas')) return [{ name: 'Denver' }];
      if (sql.includes('FROM service_at_location')) {
        return [{
          id: 'loc-1',
          name: 'Loc',
          description: null,
          transportation: null,
          latitude: 1,
          longitude: 2,
          address_1: 'A',
          address_2: null,
          city: 'C',
          region: null,
          state_province: 'CO',
          postal_code: '1',
          country: 'US',
        }];
      }
      if (sql.includes('FROM schedules')) return [{ days: ['mo', 'friday'], opens_at: '08:00', closes_at: '17:00' }];
      if (sql.includes('FROM languages') && sql.includes('location_id')) return [{ language: 'es' }];
      if (sql.includes('FROM accessibility_for_disabilities')) return [{ accessibility: 'wheelchair' }];
      if (sql.includes('FROM phones') && sql.includes('location_id')) return [];
      return [];
    });

    const draft = await seedResourceSubmissionDraftFromService('svc-1');
    expect(draft.ownerOrganizationId).toBe('org-1');
    expect(draft.service.phones[0]?.type).toBe('text');
    expect(draft.locations[0]?.schedule.find((day) => day.day === 'Monday')?.closed).toBe(false);
  });

  it('falls back to empty service draft when service does not exist', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);
    const draft = await seedResourceSubmissionDraftFromService('missing');
    expect(draft.existingServiceId).toBe('missing');
    expect(draft.locations.length).toBeGreaterThan(0);
  });

  it('seeds organization draft when organization exists', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{
      name: 'Org',
      description: 'd',
      url: 'u',
      email: 'e',
      phone: 'p',
      tax_status: '501c3',
      tax_id: '12',
      year_incorporated: 2010,
      legal_status: 'good',
    }]);

    const draft = await seedResourceSubmissionDraftFromOrganization('org-1');
    expect(draft.organization.name).toBe('Org');
    expect(draft.ownerOrganizationId).toBe('org-1');
  });

  it('creates resource submission and resolves detail', async () => {
    mockDetailSideQueries();
    vaultMocks.createFormInstance.mockResolvedValue({ instance: mockInstance(), reusedExistingDraft: false });

    const detail = await createResourceSubmission({
      variant: 'listing',
      channel: 'host',
      submittedByUserId: 'user-1',
      draft: createEmptyResourceSubmissionDraft('listing', 'host'),
      existingServiceId: 'svc-1',
    });

    expect(vaultMocks.createFormInstance).toHaveBeenCalledOnce();
    expect(detail.instance.submission_id).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('saves draft by merging with current payload when no explicit draft is provided', async () => {
    const currentDraft = createEmptyResourceSubmissionDraft('listing', 'host');
    currentDraft.evidence.notes = 'n';
    dbMocks.executeQuery.mockResolvedValueOnce([{ form_data: { draft: currentDraft } }]);

    await saveResourceSubmissionDraft('instance-1', { title: 'T' });
    expect(vaultMocks.updateFormInstanceDraft).toHaveBeenCalledOnce();
    const [, payload] = vaultMocks.updateFormInstanceDraft.mock.calls[0];
    expect(payload.notes).toBe('n');
  });

  it('submits resource draft and updates payload with source assertions', async () => {
    const clientQuery = vi.fn(async (sql: string) => {
      if (sql.includes('FROM form_instances fi') && sql.includes('FOR UPDATE')) {
        return {
          rows: [{
            submission_id: 'sub-1',
            form_data: { draft: createEmptyResourceSubmissionDraft('listing', 'host') },
            template_slug: 'resource-listing-host',
            submission_type: 'new_service',
          }],
        };
      }
      if (sql.includes('INSERT INTO source_systems')) return { rows: [{ id: 'sys-1' }] };
      if (sql.includes('FROM source_feeds')) return { rows: [] };
      if (sql.includes('INSERT INTO source_feeds')) return { rows: [{ id: 'feed-1' }] };
      if (sql.includes('FROM source_records')) return { rows: [] };
      if (sql.includes('INSERT INTO source_records')) return { rows: [{ id: 'sr-1' }] };
      return { rows: [] };
    });
    dbMocks.withTransaction.mockImplementation(async (fn: (_client: { query: typeof clientQuery }) => unknown) => fn({ query: clientQuery }));

    await submitResourceSubmission('instance-1', 'actor-1', 'host_member');
    expect(clientQuery).toHaveBeenCalled();
  });

  it('projects claim submissions into organization membership updates', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'instance-1' }]);
    const clientQuery = vi.fn(async (sql: string) => {
      if (sql.includes('FROM form_instances fi') && sql.includes('FOR UPDATE')) {
        const draft = createEmptyResourceSubmissionDraft('claim', 'host');
        draft.variant = 'claim';
        return {
          rows: [{
            submission_id: 'sub-1',
            submission_type: 'org_claim',
            target_type: 'organization',
            target_id: null,
            submitted_by_user_id: 'submitter-1',
            form_data: { draft },
          }],
        };
      }
      if (sql.includes('INSERT INTO organizations')) return { rows: [{ id: 'org-1' }] };
      if (sql.includes('INSERT INTO source_systems')) return { rows: [{ id: 'sys-1' }] };
      if (sql.includes('FROM source_feeds')) return { rows: [] };
      if (sql.includes('INSERT INTO source_feeds')) return { rows: [{ id: 'feed-1' }] };
      if (sql.includes('FROM source_records')) return { rows: [] };
      if (sql.includes('INSERT INTO source_records')) return { rows: [{ id: 'proj-sr-1' }] };
      return { rows: [] };
    });
    dbMocks.withTransaction.mockImplementation(async (fn: (client: { query: typeof clientQuery }) => unknown) => fn({ query: clientQuery }));

    const result = await projectApprovedResourceSubmission('instance-1', 'actor-1');
    expect(result.organizationId).toBe('org-1');
    expect(result.serviceId).toBeNull();
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO source_records'),
      expect.arrayContaining([
        'feed-1',
        'approved_org_claim_projection',
        'sub-1',
        'oran://resource-submissions/sub-1/projection',
      ]),
    );
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET payload = COALESCE(payload, '{}'::jsonb) ||"),
      [
        JSON.stringify({
          projectionSourceRecordId: 'proj-sr-1',
          projectedOrganizationId: 'org-1',
          projectedServiceId: null,
        }),
        'sub-1',
      ],
    );
  });

  it('projects listing submissions into service + org updates', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'instance-1' }]);
    const clientQuery = vi.fn(async (sql: string) => {
      if (sql.includes('FROM form_instances fi') && sql.includes('FOR UPDATE')) {
        const draft = createEmptyResourceSubmissionDraft('listing', 'host');
        draft.service.name = 'Svc';
        draft.organization.name = 'Org';
        return {
          rows: [{
            submission_id: 'sub-1',
            submission_type: 'new_service',
            target_type: 'system',
            target_id: null,
            submitted_by_user_id: 'submitter-1',
            form_data: { draft },
          }],
        };
      }
      if (sql.includes('INSERT INTO organizations')) return { rows: [{ id: 'org-1' }] };
      if (sql.includes('INSERT INTO services')) return { rows: [{ id: 'svc-1' }] };
      if (sql.includes('SELECT location_id FROM service_at_location')) return { rows: [] };
      if (sql.includes('INSERT INTO source_systems')) return { rows: [{ id: 'sys-1' }] };
      if (sql.includes('FROM source_feeds')) return { rows: [] };
      if (sql.includes('INSERT INTO source_feeds')) return { rows: [{ id: 'feed-1' }] };
      if (sql.includes('FROM source_records')) return { rows: [] };
      if (sql.includes('INSERT INTO source_records')) return { rows: [{ id: 'proj-sr-2' }] };
      return { rows: [] };
    });
    dbMocks.withTransaction.mockImplementation(async (fn: (client: { query: typeof clientQuery }) => unknown) => fn({ query: clientQuery }));

    const result = await projectApprovedResourceSubmission('instance-1', 'actor-1');
    expect(result.organizationId).toBe('org-1');
    expect(result.serviceId).toBe('svc-1');
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO source_records'),
      expect.arrayContaining([
        'feed-1',
        'approved_resource_projection',
        'sub-1',
        'oran://resource-submissions/sub-1/projection',
      ]),
    );
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET payload = COALESCE(payload, '{}'::jsonb) ||"),
      [
        expect.stringContaining('"projectionSourceRecordId":"proj-sr-2"'),
        'sub-1',
      ],
    );
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO confidence_scores'),
      ['svc-1', 92, 92, 0, 0],
    );
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO hsds_export_snapshots'),
      expect.arrayContaining(['service', 'svc-1']),
    );
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO lifecycle_events'),
      expect.arrayContaining(['service', 'svc-1', 'published', 'submission', 'published', 'human', 'actor-1']),
    );
  });

  it('reuses matching active org and service before projecting listing submissions', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'instance-1' }]);
    const clientQuery = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('pg_advisory_xact_lock')) {
        expect(params).toEqual(['live-publication:example.org|existing org|example.org/service|existing service']);
        return { rows: [{ pg_advisory_xact_lock: '' }] };
      }
      if (sql.includes('FROM form_instances fi') && sql.includes('FOR UPDATE')) {
        const draft = createEmptyResourceSubmissionDraft('listing', 'host');
        draft.organization.name = 'Existing Org';
        draft.organization.url = 'https://example.org';
        draft.service.name = 'Existing Service';
        draft.service.url = 'https://example.org/service';
        return {
          rows: [{
            submission_id: 'sub-1',
            submission_type: 'new_service',
            target_type: 'system',
            target_id: null,
            submitted_by_user_id: 'submitter-1',
            form_data: { draft },
          }],
        };
      }
      if (sql.includes('FROM organizations') && sql.includes("regexp_replace(regexp_replace(coalesce(url, ''), '^https?://', ''), '/+$', '')")) {
        expect(params).toEqual(['example.org']);
        return { rows: [{ id: 'org-existing' }] };
      }
      if (sql.includes('FROM services') && sql.includes("regexp_replace(regexp_replace(coalesce(url, ''), '^https?://', ''), '/+$', '')")) {
        expect(params).toEqual(['org-existing', 'example.org/service']);
        return { rows: [{ id: 'svc-existing' }] };
      }
      if (sql.includes('UPDATE organizations')) return { rows: [] };
      if (sql.includes('UPDATE services')) return { rows: [] };
      if (sql.includes('SELECT location_id FROM service_at_location')) return { rows: [] };
      if (sql.includes('INSERT INTO source_systems')) return { rows: [{ id: 'sys-1' }] };
      if (sql.includes('FROM source_feeds')) return { rows: [] };
      if (sql.includes('INSERT INTO source_feeds')) return { rows: [{ id: 'feed-1' }] };
      if (sql.includes('FROM source_records')) return { rows: [] };
      if (sql.includes('INSERT INTO source_records')) return { rows: [{ id: 'proj-sr-3' }] };
      return { rows: [] };
    });
    dbMocks.withTransaction.mockImplementation(async (fn: (client: { query: typeof clientQuery }) => unknown) => fn({ query: clientQuery }));

    const result = await projectApprovedResourceSubmission('instance-1', 'actor-1');

    expect(result.organizationId).toBe('org-existing');
    expect(result.serviceId).toBe('svc-existing');
    expect(clientQuery).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO organizations'), expect.anything());
    expect(clientQuery).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO services'), expect.anything());
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE submissions'),
      ['svc-existing', 'sub-1'],
    );
    expect(
      clientQuery.mock.calls.some(
        ([sql]) => typeof sql === 'string' && sql.includes("name = COALESCE(NULLIF($2, ''), name)") && sql.includes('UPDATE services'),
      ),
    ).toBe(true);
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE hsds_export_snapshots'),
      ['service', 'svc-existing'],
    );
  });

  it('links approved public submissions to host-managed live records without overwriting them', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'instance-1' }]);
    const clientQuery = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [{ pg_advisory_xact_lock: '' }] };
      if (sql.includes('FROM form_instances fi') && sql.includes('FOR UPDATE')) {
        const draft = createEmptyResourceSubmissionDraft('listing', 'public');
        draft.organization.name = 'Existing Org';
        draft.organization.url = 'https://example.org';
        draft.service.name = 'Existing Service';
        draft.service.url = 'https://example.org/service';
        return {
          rows: [{
            submission_id: 'sub-2',
            submission_type: 'new_service',
            target_type: 'system',
            target_id: null,
            submitted_by_user_id: 'submitter-2',
            form_data: { draft },
          }],
        };
      }
      if (sql.includes('FROM organizations') && sql.includes("regexp_replace(regexp_replace(coalesce(url, ''), '^https?://', ''), '/+$', '')")) {
        return { rows: [{ id: 'org-existing' }] };
      }
      if (sql.includes('FROM services') && sql.includes("regexp_replace(regexp_replace(coalesce(url, ''), '^https?://', ''), '/+$', '')")) {
        return { rows: [{ id: 'svc-existing' }] };
      }
      if (sql.includes('FROM hsds_export_snapshots')) {
        return {
          rows: [{
            hsds_payload: {
              meta: {
                generatedBy: 'oran-resource-submission-projection',
                channel: 'host',
                publicationSourceKind: 'host_submission',
              },
            },
            generated_at: '2026-03-16T00:00:00.000Z',
          }],
        };
      }
      if (sql.includes('INSERT INTO source_systems')) return { rows: [{ id: 'sys-1' }] };
      if (sql.includes('FROM source_feeds')) return { rows: [] };
      if (sql.includes('INSERT INTO source_feeds')) return { rows: [{ id: 'feed-1' }] };
      if (sql.includes('FROM source_records')) return { rows: [] };
      if (sql.includes('INSERT INTO source_records')) return { rows: [{ id: 'proj-sr-4' }] };
      return { rows: [] };
    });
    dbMocks.withTransaction.mockImplementation(async (fn: (client: { query: typeof clientQuery }) => unknown) => fn({ query: clientQuery }));

    const result = await projectApprovedResourceSubmission('instance-1', 'actor-2');

    expect(result).toEqual({ organizationId: 'org-existing', serviceId: 'svc-existing' });
    expect(clientQuery).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE organizations'), expect.anything());
    expect(clientQuery).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE services'), expect.anything());
    expect(clientQuery).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO hsds_export_snapshots'), expect.anything());
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO lifecycle_events'),
      expect.arrayContaining(['service', 'svc-existing', 'linked_existing']),
    );
  });

  it('gets, lists, and resolves accessible resource submissions', async () => {
    const auth = { userId: 'u', role: 'oran_admin', accountStatus: 'active', orgIds: [], orgRoles: new Map() } as AuthContext;
    vaultMocks.getAccessibleFormInstance
      .mockResolvedValueOnce(mockInstance({ template_slug: 'resource-listing-host' }))
      .mockResolvedValueOnce(mockInstance({ template_slug: 'resource-listing-host' }));
    vaultMocks.listAccessibleFormInstances.mockResolvedValue({
      instances: [
        mockInstance({ template_slug: 'resource-listing-host' }),
        mockInstance({ id: 'other', template_slug: 'host-intake' }),
      ],
    });
    dbMocks.executeQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("ft.slug LIKE 'resource-%'")) return [{ id: '22222222-2222-4222-8222-222222222222' }];
      if (sql.includes('FROM submission_transitions')) return [];
      if (sql.includes('FROM confidence_scores')) return [];
      if (sql.includes('submitter.display_name')) return [{ payload: {}, submitted_by_label: null, assigned_to_label: null }];
      if (sql.includes("coalesce(s.payload->>'publicAccessTokenHash', '')")) return [mockInstance({ template_slug: 'resource-listing-public' })];
      return [];
    });

    const accessible = await getAccessibleResourceSubmission(auth, 'sub-1');
    expect(accessible?.template_slug).toContain('resource-');

    const list = await listAccessibleResourceSubmissions(auth);
    expect(list).toHaveLength(1);

    const actorDetail = await getResourceSubmissionDetailForActor(auth, 'sub-1');
    expect(actorDetail?.instance.submission_id).toBeTruthy();

    const publicDetail = await getResourceSubmissionDetailForPublic('sub-1', 'token');
    expect(publicDetail?.instance.template_slug).toContain('resource-');
  });

  it('forwards reviewer notes and editable status helper', async () => {
    await setResourceSubmissionReviewerNotes('sub-1', 'notes');
    expect(vaultMocks.setFormSubmissionReviewerNotes).toHaveBeenCalledWith('sub-1', 'notes');

    expect(isResourceSubmissionStatusEditable('draft')).toBe(true);
    expect(isResourceSubmissionStatusEditable('returned')).toBe(true);
    expect(isResourceSubmissionStatusEditable('submitted')).toBe(false);
  });
});
