/**
 * Templates service unit tests.
 *
 * All DB calls are mocked via vi.mock('@/services/db/postgres').
 * No real database is used.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);

import {
  listTemplates,
  getTemplate,
  getTemplateBySlug,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  recordTemplateUsage,
  getTemplateUsageSummary,
  listAllTemplates,
} from '../templates';
import type { ContentTemplate } from '@/domain/templates';

// ============================================================
// HELPERS
// ============================================================

function makeTemplate(overrides: Partial<ContentTemplate> = {}): ContentTemplate {
  return {
    id:                'tpl-1',
    title:             'How Verification Works',
    slug:              'how-verification-works',
    role_scope:        'shared',
    category:          'training',
    content_markdown:  '# Verification\n\nContent here.',
    tags:              ['verification', 'training'],
    language:          'en',
    jurisdiction_scope: null,
    version:           1,
    is_published:      true,
    created_by:        'admin-1',
    updated_by:        'admin-1',
    created_at:        '2025-01-01T00:00:00Z',
    updated_at:        '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// ============================================================
// SETUP
// ============================================================

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.executeQuery.mockResolvedValue([]);
});

// ============================================================
// listTemplates
// ============================================================

describe('listTemplates', () => {
  it('returns empty result when visibleScopes is empty', async () => {
    const result = await listTemplates({ visibleScopes: [] });
    expect(result).toEqual({ templates: [], total: 0 });
    expect(dbMocks.executeQuery).not.toHaveBeenCalled();
  });

  it('queries with role_scope and is_published filters by default', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ count: '2' }])
      .mockResolvedValueOnce([makeTemplate(), makeTemplate({ id: 'tpl-2', slug: 'tpl-2' })]);

    const result = await listTemplates({
      visibleScopes: ['shared', 'host_admin'],
    });

    expect(result.total).toBe(2);
    expect(result.templates).toHaveLength(2);
    const [sql] = dbMocks.executeQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('role_scope = ANY($1::text[])');
    expect(sql).toContain('is_published = true');
  });

  it('adds category clause when provided', async () => {
    dbMocks.executeQuery.mockResolvedValue([{ count: '0' }]);
    await listTemplates({ visibleScopes: ['shared'], category: 'faq' });
    const [sql] = dbMocks.executeQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('category = $');
  });

  it('adds tags overlap clause when tags provided', async () => {
    dbMocks.executeQuery.mockResolvedValue([{ count: '0' }]);
    await listTemplates({ visibleScopes: ['shared'], tags: ['onboarding'] });
    const [sql] = dbMocks.executeQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('tags &&');
  });

  it('skips is_published filter when publishedOnly is false', async () => {
    dbMocks.executeQuery.mockResolvedValue([{ count: '0' }]);
    await listTemplates({ visibleScopes: ['shared'], publishedOnly: false });
    const [sql] = dbMocks.executeQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain('is_published');
  });
});

// ============================================================
// getTemplate
// ============================================================

describe('getTemplate', () => {
  it('returns null when visibleScopes is empty', async () => {
    const result = await getTemplate('tpl-1', []);
    expect(result).toBeNull();
    expect(dbMocks.executeQuery).not.toHaveBeenCalled();
  });

  it('returns the template when found', async () => {
    const tpl = makeTemplate();
    dbMocks.executeQuery.mockResolvedValueOnce([tpl]);
    const result = await getTemplate('tpl-1', ['shared']);
    expect(result).toEqual(tpl);
    const [sql, params] = dbMocks.executeQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE id = $1');
    expect(params[0]).toBe('tpl-1');
  });

  it('returns null when not found', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);
    const result = await getTemplate('missing', ['shared']);
    expect(result).toBeNull();
  });
});

// ============================================================
// getTemplateBySlug
// ============================================================

describe('getTemplateBySlug', () => {
  it('queries by slug', async () => {
    const tpl = makeTemplate();
    dbMocks.executeQuery.mockResolvedValueOnce([tpl]);
    const result = await getTemplateBySlug('how-verification-works', ['shared']);
    expect(result).toEqual(tpl);
    const [sql, params] = dbMocks.executeQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE slug = $1');
    expect(params[0]).toBe('how-verification-works');
  });
});

// ============================================================
// createTemplate
// ============================================================

describe('createTemplate', () => {
  it('inserts and returns the template', async () => {
    const created = makeTemplate();
    dbMocks.executeQuery.mockResolvedValueOnce([created]);

    const result = await createTemplate({
      title:            'How Verification Works',
      slug:             'how-verification-works',
      role_scope:       'shared',
      category:         'training',
      content_markdown: '# Verification',
      created_by:       'admin-1',
    });

    expect(result).toEqual(created);
    const [sql] = dbMocks.executeQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO content_templates');
    expect(sql).toContain('RETURNING *');
  });

  it('defaults tags to [] and language to en', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([makeTemplate()]);
    await createTemplate({
      title:            'Template',
      slug:             'template',
      role_scope:       'shared',
      category:         'faq',
      content_markdown: 'Content',
    });
    const [, params] = dbMocks.executeQuery.mock.calls[0] as [string, unknown[]];
    // params[5] = tags (array default), params[6] = language
    expect(params).toContain('en'); // language default
    expect(params).toEqual(expect.arrayContaining([[]])); // tags default is []
  });
});

// ============================================================
// updateTemplate
// ============================================================

describe('updateTemplate', () => {
  it('returns null when template does not exist', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);
    const result = await updateTemplate('missing-id', { title: 'New Title' });
    expect(result).toBeNull();
  });

  it('returns the updated template', async () => {
    const updated = makeTemplate({ title: 'Updated', version: 2 });
    dbMocks.executeQuery.mockResolvedValueOnce([updated]);
    const result = await updateTemplate('tpl-1', { title: 'Updated' });
    expect(result).toEqual(updated);
    const [sql] = dbMocks.executeQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE content_templates');
    expect(sql).toContain('version = version + 1');
    expect(sql).toContain('RETURNING *');
  });

  it('only updates fields that are provided', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([makeTemplate()]);
    await updateTemplate('tpl-1', { is_published: true });
    const [sql] = dbMocks.executeQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('is_published');
    expect(sql).not.toContain('title =');
  });
});

// ============================================================
// deleteTemplate
// ============================================================

describe('deleteTemplate', () => {
  it('returns true when a row is deleted', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'tpl-1' }]);
    expect(await deleteTemplate('tpl-1')).toBe(true);
  });

  it('returns false when no row is deleted', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);
    expect(await deleteTemplate('missing')).toBe(false);
  });
});

// ============================================================
// recordTemplateUsage
// ============================================================

describe('recordTemplateUsage', () => {
  it('inserts a usage event', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);
    await recordTemplateUsage('tpl-1', 'copy', 'host_admin');
    const [sql, params] = dbMocks.executeQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO template_usage_events');
    expect(params).toEqual(['tpl-1', 'copy', 'host_admin']);
  });

  it('silently ignores DB errors', async () => {
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('DB down'));
    await expect(recordTemplateUsage('tpl-1', 'view', 'oran_admin')).resolves.not.toThrow();
  });
});

// ============================================================
// getTemplateUsageSummary
// ============================================================

describe('getTemplateUsageSummary', () => {
  it('returns zero counts when no events exist', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);
    const summary = await getTemplateUsageSummary('tpl-1');
    expect(summary).toEqual({ view: 0, copy: 0, use: 0 });
  });

  it('aggregates counts by action', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([
      { action: 'view', count: '10' },
      { action: 'copy', count: '4' },
    ]);
    const summary = await getTemplateUsageSummary('tpl-1');
    expect(summary).toEqual({ view: 10, copy: 4, use: 0 });
  });
});

// ============================================================
// listAllTemplates
// ============================================================

describe('listAllTemplates', () => {
  it('returns all templates without scope filter', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ count: '3' }])
      .mockResolvedValueOnce([makeTemplate(), makeTemplate({ id: 'tpl-2', slug: 'tpl-2', is_published: false })]);

    const result = await listAllTemplates({});
    expect(result.total).toBe(3);
    // SQL should NOT contain role_scope filter
    const [sql] = dbMocks.executeQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain('role_scope');
    expect(sql).not.toContain('is_published');
  });
});
