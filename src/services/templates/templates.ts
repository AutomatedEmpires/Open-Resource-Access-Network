/**
 * Content Templates service — CRUD + list with role-visibility filtering.
 *
 * Security contract:
 *   - Callers MUST pass visibleScopes derived from the authenticated user's
 *     role via TEMPLATE_VISIBLE_SCOPES before calling listTemplates / getTemplate.
 *   - Mutations (create/update/delete) are restricted to oran_admin at the
 *     API layer; this service enforces no role checks of its own (separation of
 *     concerns — guards belong in route handlers).
 *   - No user PII is stored in usage events — only actor_role.
 */

import {
  executeQuery,
} from '@/services/db/postgres';
import {
  ContentTemplate,
  TemplateRoleScope,
  TemplateCategory,
  TemplateUsageAction,
} from '@/domain/templates';

// ============================================================
// INPUT TYPES
// ============================================================

export interface ListTemplatesOptions {
  /** Only return templates whose role_scope is in this array */
  visibleScopes: TemplateRoleScope[];
  category?:    TemplateCategory;
  language?:    string;
  tags?:        string[];
  publishedOnly?: boolean;
  limit?:       number;
  offset?:      number;
}

export interface CreateTemplateInput {
  title:             string;
  slug:              string;
  role_scope:        TemplateRoleScope;
  category:          TemplateCategory;
  content_markdown:  string;
  tags?:             string[];
  language?:         string;
  jurisdiction_scope?: string | null;
  is_published?:     boolean;
  created_by?:       string | null;
}

export interface UpdateTemplateInput {
  title?:            string;
  role_scope?:       TemplateRoleScope;
  category?:         TemplateCategory;
  content_markdown?: string;
  tags?:             string[];
  language?:         string;
  jurisdiction_scope?: string | null;
  is_published?:     boolean;
  updated_by?:       string | null;
}

// ============================================================
// QUERIES
// ============================================================

/**
 * List templates visible to the caller's role, with optional filters.
 * Returns published-only results unless publishedOnly === false.
 */
export async function listTemplates(
  opts: ListTemplatesOptions,
): Promise<{ templates: ContentTemplate[]; total: number }> {
  const {
    visibleScopes,
    category,
    language,
    tags,
    publishedOnly = true,
    limit = 50,
    offset = 0,
  } = opts;

  if (visibleScopes.length === 0) {
    return { templates: [], total: 0 };
  }

  const params: unknown[] = [visibleScopes];
  const clauses: string[] = ['role_scope = ANY($1::text[])'];

  if (publishedOnly) {
    clauses.push('is_published = true');
  }
  if (category) {
    params.push(category);
    clauses.push(`category = $${params.length}`);
  }
  if (language) {
    params.push(language);
    clauses.push(`language = $${params.length}`);
  }
  if (tags && tags.length > 0) {
    params.push(tags);
    clauses.push(`tags && $${params.length}::text[]`);
  }

  const where = clauses.join(' AND ');

  // Count
  const countRows = await executeQuery<{ count: string }>(
    `SELECT COUNT(*) AS count FROM content_templates WHERE ${where}`,
    params,
  );
  const total = parseInt(countRows[0]?.count ?? '0', 10);

  // Page
  params.push(limit, offset);
  const templates = await executeQuery<ContentTemplate>(
    `SELECT * FROM content_templates
     WHERE ${where}
     ORDER BY updated_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { templates, total };
}

/**
 * Fetch a single template by ID, respecting role-visibility.
 * Returns null if not found or outside visibleScopes.
 */
export async function getTemplate(
  id: string,
  visibleScopes: TemplateRoleScope[],
): Promise<ContentTemplate | null> {
  if (visibleScopes.length === 0) return null;
  const rows = await executeQuery<ContentTemplate>(
    `SELECT * FROM content_templates
     WHERE id = $1 AND role_scope = ANY($2::text[])`,
    [id, visibleScopes],
  );
  return rows[0] ?? null;
}

/**
 * Fetch a single template by slug, respecting role-visibility.
 */
export async function getTemplateBySlug(
  slug: string,
  visibleScopes: TemplateRoleScope[],
): Promise<ContentTemplate | null> {
  if (visibleScopes.length === 0) return null;
  const rows = await executeQuery<ContentTemplate>(
    `SELECT * FROM content_templates
     WHERE slug = $1 AND role_scope = ANY($2::text[])`,
    [slug, visibleScopes],
  );
  return rows[0] ?? null;
}

// ============================================================
// MUTATIONS (oran_admin only — callers enforce auth)
// ============================================================

export async function createTemplate(
  input: CreateTemplateInput,
): Promise<ContentTemplate> {
  const {
    title,
    slug,
    role_scope,
    category,
    content_markdown,
    tags = [],
    language = 'en',
    jurisdiction_scope = null,
    is_published = false,
    created_by = null,
  } = input;

  const rows = await executeQuery<ContentTemplate>(
    `INSERT INTO content_templates
       (title, slug, role_scope, category, content_markdown, tags, language,
        jurisdiction_scope, is_published, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9, $10, $10)
     RETURNING *`,
    [title, slug, role_scope, category, content_markdown, tags, language,
     jurisdiction_scope, is_published, created_by],
  );

  return rows[0]!;
}

/**
 * Update a template by ID.
 * Only non-undefined fields are updated. Increments `version` atomically.
 * Returns null if the template does not exist.
 */
export async function updateTemplate(
  id: string,
  input: UpdateTemplateInput,
): Promise<ContentTemplate | null> {
  const setClauses: string[] = ['version = version + 1', 'updated_at = now()'];
  const params: unknown[] = [];

  function addField(col: string, val: unknown) {
    params.push(val);
    setClauses.push(`${col} = $${params.length}`);
  }

  if (input.title             !== undefined) addField('title',             input.title);
  if (input.role_scope        !== undefined) addField('role_scope',        input.role_scope);
  if (input.category          !== undefined) addField('category',          input.category);
  if (input.content_markdown  !== undefined) addField('content_markdown',  input.content_markdown);
  if (input.tags              !== undefined) addField('tags',              input.tags);
  if (input.language          !== undefined) addField('language',          input.language);
  if (input.jurisdiction_scope !== undefined) addField('jurisdiction_scope', input.jurisdiction_scope);
  if (input.is_published      !== undefined) addField('is_published',      input.is_published);
  if (input.updated_by        !== undefined) addField('updated_by',        input.updated_by);

  params.push(id);
  const rows = await executeQuery<ContentTemplate>(
    `UPDATE content_templates
     SET ${setClauses.join(', ')}
     WHERE id = $${params.length}
     RETURNING *`,
    params,
  );

  return rows[0] ?? null;
}

/**
 * Hard-delete a template by ID. Returns true if a row was deleted.
 */
export async function deleteTemplate(id: string): Promise<boolean> {
  const rows = await executeQuery<{ id: string }>(
    `DELETE FROM content_templates WHERE id = $1 RETURNING id`,
    [id],
  );
  return rows.length > 0;
}

// ============================================================
// USAGE TRACKING (no PII — records role only)
// ============================================================

/**
 * Record that a template was viewed, copied, or used.
 * Failures are silently discarded — usage tracking must never block the caller.
 */
export async function recordTemplateUsage(
  templateId: string,
  action: TemplateUsageAction,
  actorRole: string,
): Promise<void> {
  try {
    await executeQuery(
      `INSERT INTO template_usage_events (template_id, action, actor_role)
       VALUES ($1, $2, $3)`,
      [templateId, action, actorRole],
    );
  } catch {
    // Non-critical — silently ignore
  }
}

/**
 * Return aggregate usage counts for a template.
 */
export async function getTemplateUsageSummary(
  templateId: string,
): Promise<Record<TemplateUsageAction, number>> {
  const rows = await executeQuery<{ action: TemplateUsageAction; count: string }>(
    `SELECT action, COUNT(*) AS count
     FROM template_usage_events
     WHERE template_id = $1
     GROUP BY action`,
    [templateId],
  );
  const summary: Record<string, number> = { view: 0, copy: 0, use: 0 };
  for (const row of rows) {
    summary[row.action] = parseInt(row.count, 10);
  }
  return summary as Record<TemplateUsageAction, number>;
}

// ============================================================
// ADMIN: list ALL templates including unpublished
// ============================================================

export async function listAllTemplates(opts: {
  limit?: number;
  offset?: number;
  category?: TemplateCategory;
}): Promise<{ templates: ContentTemplate[]; total: number }> {
  const { limit = 100, offset = 0, category } = opts;
  const params: unknown[] = [];
  const clauses: string[] = [];

  if (category) {
    params.push(category);
    clauses.push(`category = $${params.length}`);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const countRows = await executeQuery<{ count: string }>(
    `SELECT COUNT(*) AS count FROM content_templates ${where}`,
    params,
  );
  const total = parseInt(countRows[0]?.count ?? '0', 10);

  params.push(limit, offset);
  const templates = await executeQuery<ContentTemplate>(
    `SELECT * FROM content_templates
     ${where}
     ORDER BY updated_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { templates, total };
}
