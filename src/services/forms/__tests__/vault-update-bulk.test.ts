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

const advanceMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/community/scope', () => communityMocks);
vi.mock('@/services/workflow/engine', () => ({
  advance: advanceMock,
}));

const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111';
const INSTANCE_ID_1 = '22222222-2222-4222-8222-222222222222';
const INSTANCE_ID_2 = '33333333-3333-4333-8333-333333333333';

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
    schema_json: {},
    ui_schema_json: {},
    instructions_markdown: null,
    version: 1,
    is_published: true,
    blob_storage_prefix: null,
    created_by_user_id: 'user-1',
    updated_by_user_id: 'user-admin-1',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    ...overrides,
  };
}

function makeInstance(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    submission_id: `sub-${id}`,
    template_id: TEMPLATE_ID,
    template_slug: 'host-intake',
    template_title: 'Host intake',
    template_description: null,
    template_category: 'operations',
    template_version: 1,
    storage_scope: 'organization',
    owner_organization_id: null,
    coverage_zone_id: null,
    recipient_role: 'community_admin',
    recipient_user_id: null,
    recipient_organization_id: null,
    blob_storage_prefix: null,
    form_data: {},
    attachment_manifest: [],
    last_saved_at: '2026-03-09T00:00:00.000Z',
    submission_type: 'managed_form',
    status: 'needs_review',
    target_type: 'form_template',
    target_id: TEMPLATE_ID,
    submitted_by_user_id: 'user-submitter',
    assigned_to_user_id: null,
    title: 'Test form',
    notes: null,
    reviewer_notes: null,
    priority: 0,
    sla_deadline: null,
    sla_breached: false,
    submitted_at: '2026-03-09T00:00:00.000Z',
    reviewed_at: null,
    resolved_at: null,
    created_at: '2026-03-09T00:00:00.000Z',
    updated_at: '2026-03-09T00:00:00.000Z',
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

// ── updateFormTemplate ────────────────────────────

describe('updateFormTemplate', () => {
  it('updates title and returns updated template', async () => {
    const updated = makeTemplate({ title: 'New Title', version: 1 });
    dbMocks.executeQuery.mockResolvedValue([updated]);
    const { updateFormTemplate } = await loadVault();
    const result = await updateFormTemplate(TEMPLATE_ID, {
      title: 'New Title',
      updated_by_user_id: 'user-admin-1',
    });
    expect(result).toEqual(updated);
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(1);
    const [sql] = dbMocks.executeQuery.mock.calls[0];
    expect(sql).toContain('UPDATE form_templates');
    expect(sql).toContain('RETURNING *');
  });

  it('bumps version when schema_json is updated', async () => {
    const updated = makeTemplate({ version: 2 });
    dbMocks.executeQuery.mockResolvedValue([updated]);
    const { updateFormTemplate } = await loadVault();
    const result = await updateFormTemplate(TEMPLATE_ID, {
      schema_json: { fields: [{ key: 'a', label: 'A', type: 'text' }] },
      updated_by_user_id: 'user-admin-1',
    });
    expect(result?.version).toBe(2);
    const [sql] = dbMocks.executeQuery.mock.calls[0];
    expect(sql).toContain('version = version + 1');
  });

  it('returns null when template not found', async () => {
    dbMocks.executeQuery.mockResolvedValue([]);
    const { updateFormTemplate } = await loadVault();
    const result = await updateFormTemplate(TEMPLATE_ID, {
      title: 'Nope',
      updated_by_user_id: 'user-admin-1',
    });
    expect(result).toBeNull();
  });

  it('handles multiple field updates', async () => {
    const updated = makeTemplate({ title: 'X', category: 'intake', is_published: false });
    dbMocks.executeQuery.mockResolvedValue([updated]);
    const { updateFormTemplate } = await loadVault();
    await updateFormTemplate(TEMPLATE_ID, {
      title: 'X',
      category: 'intake',
      is_published: false,
      description: 'New desc',
      updated_by_user_id: 'user-admin-1',
    });
    const [, params] = dbMocks.executeQuery.mock.calls[0];
    expect(params).toContain('X');
    expect(params).toContain('intake');
    expect(params).toContain(false);
    expect(params).toContain('New desc');
  });
});

// ── bulkUpdateInstanceStatus ──────────────────────

describe('bulkUpdateInstanceStatus', () => {
  it('approves multiple instances', async () => {
    // First call: getAccessibleFormInstance for instance 1
    // Second call: setFormSubmissionReviewerNotes (skipped if null)
    // Third call: getAccessibleFormInstance for instance 2
    dbMocks.executeQuery
      .mockResolvedValueOnce([makeInstance(INSTANCE_ID_1)]) // getAccessibleFormInstance 1
      .mockResolvedValueOnce([makeInstance(INSTANCE_ID_2)]); // getAccessibleFormInstance 2

    advanceMock.mockResolvedValue({
      success: true,
      submissionId: '',
      fromStatus: 'needs_review',
      toStatus: 'approved',
      transitionId: 't-1',
      gateResults: [],
    });

    const { bulkUpdateInstanceStatus } = await loadVault();
    const ctx = makeAuthCtx('oran_admin');
    const results = await bulkUpdateInstanceStatus(
      ctx,
      [INSTANCE_ID_1, INSTANCE_ID_2],
      'approve',
      null,
    );

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
    expect(advanceMock).toHaveBeenCalledTimes(2);
  });

  it('reports failure for inaccessible instance', async () => {
    dbMocks.executeQuery.mockResolvedValue([]); // not found

    const { bulkUpdateInstanceStatus } = await loadVault();
    const ctx = makeAuthCtx('oran_admin');
    const results = await bulkUpdateInstanceStatus(ctx, [INSTANCE_ID_1], 'approve', null);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('Not found');
  });

  it('reports failure for wrong status', async () => {
    dbMocks.executeQuery.mockResolvedValue([makeInstance(INSTANCE_ID_1, { status: 'draft' })]);

    const { bulkUpdateInstanceStatus } = await loadVault();
    const ctx = makeAuthCtx('oran_admin');
    const results = await bulkUpdateInstanceStatus(ctx, [INSTANCE_ID_1], 'approve', null);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('Cannot approve');
  });

  it('sets reviewer notes before transitioning when provided', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([makeInstance(INSTANCE_ID_1)]) // getAccessibleFormInstance
      .mockResolvedValueOnce([]); // setFormSubmissionReviewerNotes

    advanceMock.mockResolvedValue({
      success: true,
      submissionId: '',
      fromStatus: 'needs_review',
      toStatus: 'denied',
      transitionId: 't-1',
      gateResults: [],
    });

    const { bulkUpdateInstanceStatus } = await loadVault();
    const ctx = makeAuthCtx('oran_admin');
    await bulkUpdateInstanceStatus(ctx, [INSTANCE_ID_1], 'deny', 'Missing docs.');

    // Verify reviewer notes were set (second executeQuery call)
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(2);
    const [sql, params] = dbMocks.executeQuery.mock.calls[1];
    expect(sql).toContain('reviewer_notes');
    expect(params).toContain('Missing docs.');
  });

  it('handles transition failure gracefully', async () => {
    dbMocks.executeQuery.mockResolvedValue([makeInstance(INSTANCE_ID_1)]);
    advanceMock.mockResolvedValue({
      success: false,
      submissionId: '',
      fromStatus: 'needs_review',
      toStatus: 'approved',
      transitionId: '',
      gateResults: [],
      error: 'Gate blocked',
    });

    const { bulkUpdateInstanceStatus } = await loadVault();
    const ctx = makeAuthCtx('oran_admin');
    const results = await bulkUpdateInstanceStatus(ctx, [INSTANCE_ID_1], 'approve', null);

    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('Gate blocked');
  });
});
