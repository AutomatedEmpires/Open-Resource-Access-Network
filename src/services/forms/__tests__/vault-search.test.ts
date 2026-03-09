import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeQueryMock = vi.hoisted(() => vi.fn());
const withTransactionMock = vi.hoisted(() => vi.fn());
const getCommunityAdminScopeMock = vi.hoisted(() => vi.fn());
const buildCommunitySubmissionScopeMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => ({
  executeQuery: executeQueryMock,
  withTransaction: withTransactionMock,
}));

vi.mock('@/services/community/scope', () => ({
  getCommunityAdminScope: getCommunityAdminScopeMock,
  buildCommunitySubmissionScope: buildCommunitySubmissionScopeMock,
}));

function makeTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
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
    updated_by_user_id: 'user-1',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('listFormTemplates with search', () => {
  it('adds ILIKE clause when search is provided', async () => {
    executeQueryMock
      .mockResolvedValueOnce([{ count: '1' }])
      .mockResolvedValueOnce([makeTemplate()]);

    const { listFormTemplates } = await import('@/services/forms/vault');
    const result = await listFormTemplates({
      visibleAudiences: ['shared', 'host_member'],
      search: 'intake',
    });

    expect(result.templates).toHaveLength(1);
    expect(result.total).toBe(1);

    // Verify the count query includes the search ILIKE
    const countCall = executeQueryMock.mock.calls[0];
    expect(countCall[0]).toContain('ILIKE');
    expect(countCall[1]).toContain('%intake%');
  });

  it('does not add ILIKE clause when search is not provided', async () => {
    executeQueryMock
      .mockResolvedValueOnce([{ count: '2' }])
      .mockResolvedValueOnce([makeTemplate(), makeTemplate({ id: '22222222-2222-4222-8222-222222222222' })]);

    const { listFormTemplates } = await import('@/services/forms/vault');
    const result = await listFormTemplates({
      visibleAudiences: ['shared'],
    });

    expect(result.templates).toHaveLength(2);
    const countQuery = executeQueryMock.mock.calls[0][0] as string;
    expect(countQuery).not.toContain('ILIKE');
  });

  it('searches across title, description, and slug', async () => {
    executeQueryMock
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([]);

    const { listFormTemplates } = await import('@/services/forms/vault');
    await listFormTemplates({
      visibleAudiences: ['shared'],
      search: 'test',
    });

    const countQuery = executeQueryMock.mock.calls[0][0] as string;
    expect(countQuery).toContain('title ILIKE');
    expect(countQuery).toContain('description ILIKE');
    expect(countQuery).toContain('slug ILIKE');
  });

  it('combines search with category filter', async () => {
    executeQueryMock
      .mockResolvedValueOnce([{ count: '1' }])
      .mockResolvedValueOnce([makeTemplate()]);

    const { listFormTemplates } = await import('@/services/forms/vault');
    const result = await listFormTemplates({
      visibleAudiences: ['shared', 'host_member'],
      category: 'operations',
      search: 'intake',
    });

    expect(result.total).toBe(1);
    const countCall = executeQueryMock.mock.calls[0];
    expect(countCall[0]).toContain('category');
    expect(countCall[0]).toContain('ILIKE');
  });

  it('returns empty when no audiences are visible', async () => {
    const { listFormTemplates } = await import('@/services/forms/vault');
    const result = await listFormTemplates({
      visibleAudiences: [],
      search: 'anything',
    });

    expect(result.templates).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(executeQueryMock).not.toHaveBeenCalled();
  });
});
