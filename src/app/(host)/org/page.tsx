/**
 * /org — Organization Dashboard
 *
 * Lists the host's organizations with edit-in-place capability.
 * Fetches from GET /api/host/organizations, supports search + pagination.
 * Edit modal PUTs to /api/host/organizations/[id].
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Building2, Pencil, Trash2, Plus, Search, AlertTriangle,
  ExternalLink, Mail, ArrowLeft, ArrowRight, Check,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { SkeletonCard } from '@/components/ui/skeleton';
import type { Organization } from '@/domain/types';

// ============================================================
// TYPES
// ============================================================

interface OrgListResponse {
  results: Organization[];
  total: number;
  page: number;
  hasMore: boolean;
}

type EditingOrg = Pick<Organization, 'id' | 'name' | 'description' | 'url' | 'email'>;

const LIMIT = 12;

// ============================================================
// COMPONENT
// ============================================================

export default function OrgDashboardPage() {
  const [data, setData] = useState<OrgListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');

  // Edit modal
  const [editing, setEditing] = useState<EditingOrg | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const closeEditDialog = useCallback(() => {
    setEditing(null);
    setSaveError(null);
  }, []);

  const closeDeleteDialog = useCallback(() => {
    setDeletingId(null);
  }, []);

  // ── Fetch orgs ──
  const fetchOrgs = useCallback(async (p: number, q: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
      if (q) params.set('q', q);
      const res = await fetch(`/api/host/organizations?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to load organizations');
      }
      const json = (await res.json()) as OrgListResponse;
      setData(json);
      setPage(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load organizations');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOrgs(1, '');
  }, [fetchOrgs]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void fetchOrgs(1, query);
  };

  // ── Save edit ──
  const handleSave = useCallback(async () => {
    if (!editing) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/host/organizations/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editing.name,
          description: editing.description || undefined,
          url: editing.url || undefined,
          email: editing.email || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Update failed');
      }
      setEditing(null);
      void fetchOrgs(page, query);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setIsSaving(false);
    }
  }, [editing, page, query, fetchOrgs]);

  // ── Delete ──
  const handleDelete = useCallback(async (id: string) => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/host/organizations/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Delete failed');
      }
      setDeletingId(null);
      void fetchOrgs(page, query);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
      setDeletingId(null);
    } finally {
      setIsDeleting(false);
    }
  }, [page, query, fetchOrgs]);

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Building2 className="h-6 w-6 text-blue-600" aria-hidden="true" />
            Organizations
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Manage your organizations.{' '}
            <Link href="/claim" className="text-blue-600 hover:underline">
              Claim a new organization
            </Link>
          </p>
        </div>
        <Link href="/claim">
          <Button size="sm" className="gap-1">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Claim
          </Button>
        </Link>
      </div>

      <ErrorBoundary>
        {/* Search */}
        <form onSubmit={handleSearch} className="flex gap-2 items-center mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search organizations"
              className="w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
              aria-label="Search organizations"
            />
          </div>
          <Button type="submit" disabled={isLoading}>Search</Button>
        </form>

        {/* Error */}
        {error && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <p>{error}</p>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={`sk-${i}`} />
            ))}
          </div>
        )}

        {/* Empty */}
        {!isLoading && data && data.results.length === 0 && (
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
            <p className="text-gray-700 font-medium">No organizations found</p>
            <p className="mt-1 text-sm text-gray-500">
              <Link href="/claim" className="text-blue-600 hover:underline">
                Claim an organization
              </Link>{' '}
              to get started.
            </p>
          </div>
        )}

        {/* Results */}
        {!isLoading && data && data.results.length > 0 && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.results.map((org) => (
                <div
                  key={org.id}
                  className="rounded-lg border border-gray-200 bg-white p-4 flex flex-col justify-between"
                >
                  <div>
                    <h2 className="font-semibold text-gray-900 text-sm">{org.name}</h2>
                    {org.description && (
                      <p className="mt-1 text-xs text-gray-600 line-clamp-2">{org.description}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                      {org.url && (
                        <a
                          href={org.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          Website
                        </a>
                      )}
                      {org.email && (
                        <span className="inline-flex items-center gap-1">
                          <Mail className="h-3 w-3" aria-hidden="true" />
                          {org.email}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() => setEditing({
                        id: org.id,
                        name: org.name,
                        description: org.description ?? '',
                        url: org.url ?? '',
                        email: org.email ?? '',
                      })}
                    >
                      <Pencil className="h-3 w-3" aria-hidden="true" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-red-600 hover:text-red-700 hover:border-red-300"
                      onClick={() => setDeletingId(org.id)}
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-gray-600" role="status">
                Page {data.page} · {data.total} total
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchOrgs(page - 1, query)}
                  disabled={page <= 1 || isLoading}
                  className="gap-1"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchOrgs(page + 1, query)}
                  disabled={!data.hasMore || isLoading}
                  className="gap-1"
                >
                  Next
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </>
        )}
      </ErrorBoundary>

      {/* ── Edit Modal ── */}
      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) closeEditDialog();
        }}
      >
        {editing && (
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Organization</DialogTitle>
              <DialogDescription>Update organization name and contact info.</DialogDescription>
            </DialogHeader>

            {saveError && (
              <div role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                {saveError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label htmlFor="edit-name" className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  id="edit-name"
                  type="text"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  required
                />
              </div>
              <div>
                <label htmlFor="edit-desc" className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  id="edit-desc"
                  value={editing.description ?? ''}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="edit-url" className="block text-sm font-medium text-gray-700 mb-1">Website</label>
                <input
                  id="edit-url"
                  type="url"
                  value={editing.url ?? ''}
                  onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                />
              </div>
              <div>
                <label htmlFor="edit-email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  id="edit-email"
                  type="email"
                  value={editing.email ?? ''}
                  onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                />
              </div>
            </div>

            <DialogFooter className="mt-2">
              <Button variant="outline" onClick={closeEditDialog} disabled={isSaving}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isSaving || !editing.name.trim()} className="gap-1">
                <Check className="h-4 w-4" aria-hidden="true" />
                {isSaving ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      {/* ── Delete confirmation ── */}
      <Dialog
        open={Boolean(deletingId)}
        onOpenChange={(open) => {
          if (!open) closeDeleteDialog();
        }}
      >
        {deletingId && (
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Archive organization?</DialogTitle>
              <DialogDescription>
                This marks the organization as defunct so it no longer appears in host lists.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={closeDeleteDialog} disabled={isDeleting}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleDelete(deletingId)}
                disabled={isDeleting}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {isDeleting ? 'Archiving…' : 'Archive'}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
