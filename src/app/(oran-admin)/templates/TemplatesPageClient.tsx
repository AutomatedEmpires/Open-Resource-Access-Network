/**
 * /templates — Content Templates Library
 *
 * ORAN admin view to browse, create, publish/unpublish, and delete
 * content templates. Templates are role-scoped knowledge artifacts
 * for org onboarding, verification, outreach, and training.
 *
 * Wired to GET/POST /api/admin/templates and related endpoints.
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  BookOpen, RefreshCw, Plus, Pencil, Trash2,
  Eye, EyeOff, ChevronLeft, ChevronRight, Filter,
  Loader2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormField } from '@/components/ui/form-field';
import { FormAlert } from '@/components/ui/form-alert';
import { StatusBadge } from '@/components/ui/status-badge';
import { type StatusStyle } from '@/domain/status-styles';
import { useToast } from '@/components/ui/toast';
import { SkeletonCard } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/format';
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_ROLE_SCOPES,
  TemplateCategory,
  TemplateRoleScope,
  ContentTemplate,
} from '@/domain/templates';

// ============================================================
// TYPES
// ============================================================

interface TemplateListResponse {
  templates: ContentTemplate[];
  total: number;
}

// ============================================================
// CONSTANTS
// ============================================================

const LIMIT = 25;

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  faq:                  'FAQ',
  outreach:             'Outreach',
  verification_script:  'Verification Script',
  policy:               'Policy',
  training:             'Training',
  onboarding:           'Onboarding',
  dispute_handling:     'Dispute Handling',
};

const SCOPE_LABELS: Record<TemplateRoleScope, string> = {
  shared:           'Shared (all portals)',
  host_admin:       'Org Admin',
  community_admin:  'Community Admin',
  oran_admin:       'Platform Admin',
};

const SCOPE_BADGE_STYLES: Record<TemplateRoleScope, StatusStyle> = {
  shared:           { color: 'bg-gray-100 text-gray-800 ring-gray-600/20',   label: 'Shared (all portals)' },
  host_admin:       { color: 'bg-blue-100 text-blue-800 ring-blue-600/20',   label: 'Org Admin' },
  community_admin:  { color: 'bg-amber-100 text-amber-800 ring-amber-600/20', label: 'Community Admin' },
  oran_admin:       { color: 'bg-red-100 text-red-800 ring-red-600/20',      label: 'Platform Admin' },
};

const PUBLISHED_BADGE_STYLES: Record<string, StatusStyle> = {
  published: { color: 'bg-green-100 text-green-800 ring-green-600/20', label: 'Published' },
  draft:     { color: 'bg-amber-100 text-amber-800 ring-amber-600/20', label: 'Draft' },
};

// ============================================================
// CREATE / EDIT FORM
// ============================================================

interface TemplateFormProps {
  initial?: ContentTemplate;
  onSave: (tpl: ContentTemplate) => void;
  onCancel: () => void;
}

function TemplateForm({ initial, onSave, onCancel }: TemplateFormProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [roleScope, setRoleScope] = useState<TemplateRoleScope>(initial?.role_scope ?? 'shared');
  const [category, setCategory] = useState<TemplateCategory>(initial?.category ?? 'faq');
  const [content, setContent] = useState(initial?.content_markdown ?? '');
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [language, setLanguage] = useState(initial?.language ?? 'en');
  const [isPublished, setIsPublished] = useState(initial?.is_published ?? false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Auto-generate slug from title when creating
  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (!initial) {
      setSlug(
        val
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .trim()
          .replace(/\s+/g, '-')
          .slice(0, 80),
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    const body = {
      title: title.trim(),
      slug: slug.trim(),
      role_scope:        roleScope,
      category,
      content_markdown:  content.trim(),
      tags:              tags.split(',').map((t) => t.trim()).filter(Boolean),
      language:          language.trim() || 'en',
      is_published:      isPublished,
    };

    try {
      const url = initial
        ? `/api/admin/templates/${initial.id}`
        : '/api/admin/templates';
      const method = initial ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json() as { template?: ContentTemplate; error?: unknown };
      if (!res.ok) {
        setFormError(typeof json.error === 'string' ? json.error : 'Failed to save template.');
        return;
      }
      toast('success', initial ? 'Template updated.' : 'Template created.');
      onSave(json.template!);
    } catch {
      setFormError('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 p-4 border border-gray-200 rounded-xl bg-gray-50">
      <h3 className="font-semibold text-gray-900">
        {initial ? 'Edit Template' : 'New Template'}
      </h3>

      {formError && <FormAlert variant="error" message={formError} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField id="tpl-title" label="Title">
          <input
            id="tpl-title"
            type="text"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            required
            maxLength={300}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action"
          />
        </FormField>
        <FormField id="tpl-slug" label="Slug" hint="Lowercase, hyphens only">
          <input
            id="tpl-slug"
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            maxLength={200}
            pattern="[a-z0-9-]+"
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action"
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <FormField id="tpl-scope" label="Role Scope">
          <select
            id="tpl-scope"
            value={roleScope}
            onChange={(e) => setRoleScope(e.target.value as TemplateRoleScope)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action"
          >
            {TEMPLATE_ROLE_SCOPES.map((s) => (
              <option key={s} value={s}>{SCOPE_LABELS[s]}</option>
            ))}
          </select>
        </FormField>
        <FormField id="tpl-category" label="Category">
          <select
            id="tpl-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as TemplateCategory)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action"
          >
            {TEMPLATE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </FormField>
        <FormField id="tpl-lang" label="Language" hint="2-letter code, e.g. en">
          <input
            id="tpl-lang"
            type="text"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            maxLength={2}
            pattern="[a-z]{2}"
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action"
          />
        </FormField>
      </div>

      <FormField id="tpl-tags" label="Tags" hint="Comma-separated">
        <input
          id="tpl-tags"
          type="text"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          maxLength={500}
          placeholder="e.g. onboarding, verification, admin"
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action"
        />
      </FormField>

      <FormField
        id="tpl-content"
        label="Content (Markdown)"
        charCount={content.length}
        maxChars={100_000}
      >
        <textarea
          id="tpl-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
          rows={12}
          maxLength={100_000}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-action"
        />
      </FormField>

      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={isPublished}
          onChange={(e) => setIsPublished(e.target.checked)}
          className="rounded"
        />
        Publish immediately (visible in template library)
      </label>

      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" disabled={isSubmitting} className="gap-1">
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {initial ? 'Save Changes' : 'Create Template'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ============================================================
// MAIN PAGE
// ============================================================

function TemplatesPageInner() {
  const { toast } = useToast();
  const [data, setData] = useState<TemplateListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState<TemplateCategory | ''>('');
  const [showForm, setShowForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ContentTemplate | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchTemplates = useCallback(
    async (p: number, cat: TemplateCategory | '') => {
      setIsLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          limit:  String(LIMIT),
          offset: String((p - 1) * LIMIT),
        });
        if (cat) qs.set('category', cat);
        const res = await fetch(`/api/admin/templates?${qs.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as TemplateListResponse;
        setData(json);
        setPage(p);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load templates.');
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void fetchTemplates(1, categoryFilter);
  }, [fetchTemplates, categoryFilter]);

  const handleFormSave = () => {
    setShowForm(false);
    setEditingTemplate(null);
    void fetchTemplates(page, categoryFilter);
  };

  const handleTogglePublish = async (tpl: ContentTemplate) => {
    try {
      const res = await fetch(`/api/admin/templates/${tpl.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_published: !tpl.is_published }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast('success', tpl.is_published ? 'Template unpublished.' : 'Template published.');
      void fetchTemplates(page, categoryFilter);
    } catch {
      toast('error', 'Failed to update template.');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this template? This action cannot be undone.')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/templates/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
      toast('success', 'Template deleted.');
      void fetchTemplates(page, categoryFilter);
    } catch {
      toast('error', 'Failed to delete template.');
    } finally {
      setDeletingId(null);
    }
  };

  const totalPages = data ? Math.ceil(data.total / LIMIT) : 0;

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-action" aria-hidden="true" />
          <h1 className="text-xl font-bold text-gray-900">Content Templates</h1>
          {data && (
            <span className="text-sm text-gray-500 ml-1">({data.total} total)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchTemplates(page, categoryFilter)}
            disabled={isLoading}
            className="gap-1"
            aria-label="Refresh templates list"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => { setEditingTemplate(null); setShowForm(true); }}
            className="gap-1"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New Template
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Filter className="h-4 w-4 text-gray-400 shrink-0" aria-hidden="true" />
        <button
          onClick={() => setCategoryFilter('')}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            categoryFilter === ''
              ? 'bg-action text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          All
        </button>
        {TEMPLATE_CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              categoryFilter === cat
                ? 'bg-action text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Create/edit form */}
      {(showForm || editingTemplate) && (
        <div className="mb-6">
          <TemplateForm
            initial={editingTemplate ?? undefined}
            onSave={handleFormSave}
            onCancel={() => { setShowForm(false); setEditingTemplate(null); }}
          />
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="space-y-2">
          <FormAlert
            variant="error"
            message={error}
          />
          <Button size="sm" variant="outline" onClick={() => void fetchTemplates(page, categoryFilter)}>Retry</Button>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && !data && (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && data?.templates.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-30" aria-hidden="true" />
          <p className="font-medium">No templates yet.</p>
          <p className="text-sm mt-1">Create your first template to populate the library.</p>
        </div>
      )}

      {/* Templates table */}
      {data && data.templates.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm" aria-label="Content templates">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600 w-1/3">Title</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Category</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Scope</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Updated</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.templates.map((tpl) => (
                <tr key={tpl.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{tpl.title}</div>
                    <div className="text-xs text-gray-400 font-mono mt-0.5">{tpl.slug}</div>
                    {tpl.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {tpl.tags.map((tag) => (
                          <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {CATEGORY_LABELS[tpl.category]}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      status={tpl.role_scope}
                      overrides={SCOPE_BADGE_STYLES}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      status={tpl.is_published ? 'published' : 'draft'}
                      overrides={PUBLISHED_BADGE_STYLES}
                    />
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {formatDate(tpl.updated_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => void handleTogglePublish(tpl)}
                        title={tpl.is_published ? 'Unpublish' : 'Publish'}
                        className="p-1.5 rounded text-gray-500 hover:text-action hover:bg-action/10 transition-colors"
                        aria-label={tpl.is_published ? `Unpublish ${tpl.title}` : `Publish ${tpl.title}`}
                      >
                        {tpl.is_published
                          ? <EyeOff className="h-4 w-4" aria-hidden="true" />
                          : <Eye className="h-4 w-4" aria-hidden="true" />
                        }
                      </button>
                      <button
                        onClick={() => { setEditingTemplate(tpl); setShowForm(false); }}
                        title="Edit template"
                        className="p-1.5 rounded text-gray-500 hover:text-action hover:bg-action/10 transition-colors"
                        aria-label={`Edit ${tpl.title}`}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        onClick={() => void handleDelete(tpl.id)}
                        disabled={deletingId === tpl.id}
                        title="Delete template"
                        className="p-1.5 rounded text-gray-500 hover:text-error-base hover:bg-error-subtle transition-colors disabled:opacity-40"
                        aria-label={`Delete ${tpl.title}`}
                      >
                        {deletingId === tpl.id
                          ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          : <Trash2 className="h-4 w-4" aria-hidden="true" />
                        }
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {data && data.total > LIMIT && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <p className="text-gray-500">
            Page {page} of {totalPages} &middot; {data.total} total
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchTemplates(page - 1, categoryFilter)}
              disabled={page <= 1 || isLoading}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchTemplates(page + 1, categoryFilter)}
              disabled={page >= totalPages || isLoading}
              className="gap-1"
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

export default function TemplatesPage() {
  return (
    <ErrorBoundary>
      <TemplatesPageInner />
    </ErrorBoundary>
  );
}
