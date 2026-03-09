import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OranRole } from '@/domain/types';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  withTransaction: vi.fn(),
}));

const communityMocks = vi.hoisted(() => ({
  getCommunityAdminScope: vi.fn(),
  buildCommunitySubmissionScope: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/community/scope', () => communityMocks);

const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111';

function makeAuthCtx(role: OranRole = 'oran_admin', userId = 'user-admin-1') {
  return {
    userId,
    role,
    orgIds: [] as string[],
    orgRoles: new Map<string, 'host_member' | 'host_admin'>(),
  };
}

function makeTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: TEMPLATE_ID,
    slug: 'host-intake',
    title: 'Host intake',
    description: 'Collect host intake details.',
    category: 'operations',
    audience_scope: 'host_member',
    storage_scope: 'organization',
    default_target_role: 'community_admin',
    schema_json: { fields: [{ key: 'summary', label: 'Summary', type: 'textarea' }] },
    ui_schema_json: {},
    instructions_markdown: 'Complete the intake details.',
    version: 1,
    is_published: true,
    blob_storage_prefix: null,
    created_by_user_id: 'user-1',
    updated_by_user_id: 'user-1',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  communityMocks.getCommunityAdminScope.mockResolvedValue({ zoneIds: [] });
  communityMocks.buildCommunitySubmissionScope.mockReturnValue('');
});

async function loadVault() {
  return import('../vault');
}

// ── getFormAnalytics ──────────────────────────────────────

describe('getFormAnalytics', () => {
  it('returns aggregate analytics with by-status breakdown', async () => {
    // Status query
    dbMocks.executeQuery
      .mockResolvedValueOnce([
        { status: 'submitted', count: '5' },
        { status: 'under_review', count: '3' },
        { status: 'approved', count: '2' },
      ])
      // Timing query
      .mockResolvedValueOnce([
        {
          avg_review_hours: '12.5',
          avg_resolve_hours: '48.3',
          sla_compliance_rate: '0.850',
          overdue_count: '1',
        },
      ]);

    const { getFormAnalytics } = await loadVault();
    const result = await getFormAnalytics(makeAuthCtx());

    expect(result.totalInstances).toBe(10);
    expect(result.byStatus).toEqual({
      submitted: 5,
      under_review: 3,
      approved: 2,
    });
    expect(result.avgTimeToReview).toBe(12.5);
    expect(result.avgTimeToResolve).toBe(48.3);
    expect(result.slaComplianceRate).toBe(0.85);
    expect(result.overdueCount).toBe(1);
  });

  it('scopes to templateId when provided', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ status: 'draft', count: '1' }])
      .mockResolvedValueOnce([
        {
          avg_review_hours: null,
          avg_resolve_hours: null,
          sla_compliance_rate: null,
          overdue_count: '0',
        },
      ]);

    const { getFormAnalytics } = await loadVault();
    await getFormAnalytics(makeAuthCtx(), TEMPLATE_ID);

    // Both queries should include the templateId param
    const statusCall = dbMocks.executeQuery.mock.calls[0];
    expect(statusCall[1]).toContain(TEMPLATE_ID);
    const timingCall = dbMocks.executeQuery.mock.calls[1];
    expect(timingCall[1]).toContain(TEMPLATE_ID);
  });

  it('returns null for timing when no data exists', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          avg_review_hours: null,
          avg_resolve_hours: null,
          sla_compliance_rate: null,
          overdue_count: null,
        },
      ]);

    const { getFormAnalytics } = await loadVault();
    const result = await getFormAnalytics(makeAuthCtx());

    expect(result.totalInstances).toBe(0);
    expect(result.byStatus).toEqual({});
    expect(result.avgTimeToReview).toBeNull();
    expect(result.avgTimeToResolve).toBeNull();
    expect(result.slaComplianceRate).toBeNull();
    expect(result.overdueCount).toBe(0);
  });

  it('applies community_admin access scoping', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ status: 'submitted', count: '2' }])
      .mockResolvedValueOnce([
        {
          avg_review_hours: '5.0',
          avg_resolve_hours: '10.0',
          sla_compliance_rate: '1.000',
          overdue_count: '0',
        },
      ]);
    communityMocks.getCommunityAdminScope.mockResolvedValue({ zoneIds: ['zone-1'] });
    communityMocks.buildCommunitySubmissionScope.mockReturnValue(`s.coverage_zone_id = ANY($3::uuid[])`);

    const { getFormAnalytics } = await loadVault();
    const result = await getFormAnalytics(
      makeAuthCtx('community_admin', 'ca-user-1'),
    );

    expect(result.totalInstances).toBe(2);
    expect(communityMocks.getCommunityAdminScope).toHaveBeenCalledWith('ca-user-1');
  });
});

// ── duplicateFormTemplate ─────────────────────────────────

describe('duplicateFormTemplate', () => {
  it('copies source template with new slug and unpublished status', async () => {
    const source = makeTemplate();
    const copy = makeTemplate({
      id: '22222222-2222-4222-8222-222222222222',
      slug: 'host-intake-copy',
      title: 'Host intake (copy)',
      is_published: false,
    });

    dbMocks.executeQuery
      .mockResolvedValueOnce([source]) // SELECT source
      .mockResolvedValueOnce([copy]); // INSERT copy

    const { duplicateFormTemplate } = await loadVault();
    const result = await duplicateFormTemplate(
      TEMPLATE_ID,
      'host-intake-copy',
      'user-admin-1',
    );

    expect(result.slug).toBe('host-intake-copy');
    expect(result.title).toBe('Host intake (copy)');
    expect(result.is_published).toBe(false);

    // Verify INSERT was called with correct params
    const insertCall = dbMocks.executeQuery.mock.calls[1];
    expect(insertCall[1]).toContain('host-intake-copy');
    expect(insertCall[1]).toContain('Host intake (copy)');
    expect(insertCall[1]).toContain('user-admin-1');
  });

  it('throws when source template does not exist', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]); // no source found

    const { duplicateFormTemplate } = await loadVault();
    await expect(
      duplicateFormTemplate(TEMPLATE_ID, 'new-slug', 'user-1'),
    ).rejects.toThrow('Source template not found.');
  });

  it('preserves schema_json and ui_schema_json from source', async () => {
    const schema = { fields: [{ key: 'a', label: 'A', type: 'text' }] };
    const uiSchema = { layout: 'vertical' };
    const source = makeTemplate({ schema_json: schema, ui_schema_json: uiSchema });

    dbMocks.executeQuery
      .mockResolvedValueOnce([source])
      .mockResolvedValueOnce([makeTemplate({ slug: 'copy-slug' })]);

    const { duplicateFormTemplate } = await loadVault();
    await duplicateFormTemplate(TEMPLATE_ID, 'copy-slug', 'user-1');

    const insertCall = dbMocks.executeQuery.mock.calls[1];
    const params = insertCall[1] as unknown[];
    // schema_json should be stringified in INSERT
    expect(params).toContain(JSON.stringify(schema));
    expect(params).toContain(JSON.stringify(uiSchema));
  });
});
