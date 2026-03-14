/**
 * /zone-management — Coverage Zone Administration
 *
 * ORAN admin CRUD for coverage zones and community admin assignments.
 * Enhanced with FormField, FormAlert, toast notifications, and form wrappers.
 * Wired to GET/POST /api/admin/zones and PUT/DELETE /api/admin/zones/[id].
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  MapPin, RefreshCw, Plus,
  ChevronLeft, ChevronRight,
  Pencil, Trash2, Filter, Users, Loader2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormField } from '@/components/ui/form-field';
import { FormAlert } from '@/components/ui/form-alert';
import { FormSection } from '@/components/ui/form-section';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/toast';
import { SkeletonCard } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { formatDate } from '@/lib/format';

// ============================================================
// TYPES
// ============================================================

type ZoneStatus = 'active' | 'inactive';

interface ZoneRow {
  id: string;
  name: string;
  description: string | null;
  assigned_user_id: string | null;
  status: ZoneStatus;
  created_at: string;
  updated_at: string;
}

interface ZoneResponse {
  results: ZoneRow[];
  total: number;
  page: number;
  hasMore: boolean;
}

// ============================================================
// CONSTANTS
// ============================================================

const LIMIT = 20;

const STATUS_TABS: { value: '' | ZoneStatus; label: string }[] = [
  { value: '',         label: 'All' },
  { value: 'active',   label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

// ============================================================
// PAGE
// ============================================================

function ZoneManagementInner() {
  const [data, setData] = useState<ZoneResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<'' | ZoneStatus>('');
  const [actionResult, setActionResult] = useState<{ success: boolean; message: string } | null>(null);
  const toast = useToast();

  // Create dialog
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createAssigned, setCreateAssigned] = useState('');
  const [createStatus, setCreateStatus] = useState<ZoneStatus>('active');
  const [isCreating, setIsCreating] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editAssigned, setEditAssigned] = useState('');
  const [editStatus, setEditStatus] = useState<ZoneStatus>('active');
  const [isSaving, setIsSaving] = useState(false);

  // Delete confirmation
  const [deletingZone, setDeletingZone] = useState<ZoneRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // ── Fetch zones ──
  const fetchZones = useCallback(async (p: number, status: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
      if (status) params.set('status', status);

      const res = await fetch(`/api/admin/zones?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to load zones');
      }
      const json = (await res.json()) as ZoneResponse;
      setData(json);
      setPage(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load zones');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchZones(1, statusFilter);
  }, [fetchZones, statusFilter]);

  // ── Create zone ──
  const handleCreate = useCallback(async () => {
    setIsCreating(true);
    setActionResult(null);
    try {
      const res = await fetch('/api/admin/zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          description: createDesc.trim() || undefined,
          assignedUserId: createAssigned.trim() || undefined,
          status: createStatus,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Create failed');
      }
      const json = (await res.json()) as { message: string };
      setActionResult({ success: true, message: json.message });
      toast.success('Coverage zone created successfully');
      setShowCreate(false);
      setCreateName(''); setCreateDesc(''); setCreateAssigned(''); setCreateStatus('active');
      void fetchZones(page, statusFilter);
    } catch (e) {
      setActionResult({ success: false, message: e instanceof Error ? e.message : 'Create failed' });
    } finally {
      setIsCreating(false);
    }
  }, [createName, createDesc, createAssigned, createStatus, page, statusFilter, fetchZones, toast]);

  // ── Start editing ──
  const startEditing = useCallback((zone: ZoneRow) => {
    setEditingId(zone.id);
    setEditName(zone.name);
    setEditDesc(zone.description ?? '');
    setEditAssigned(zone.assigned_user_id ?? '');
    setEditStatus(zone.status);
    setActionResult(null);
  }, []);

  // ── Save zone ──
  const handleSave = useCallback(async () => {
    if (!editingId) return;
    setIsSaving(true);
    setActionResult(null);
    try {
      const res = await fetch(`/api/admin/zones/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDesc.trim() || undefined,
          assignedUserId: editAssigned.trim() || null,
          status: editStatus,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Update failed');
      }
      const json = (await res.json()) as { message: string };
      setActionResult({ success: true, message: json.message });
      toast.success('Zone updated successfully');
      setEditingId(null);
      void fetchZones(page, statusFilter);
    } catch (e) {
      setActionResult({ success: false, message: e instanceof Error ? e.message : 'Update failed' });
    } finally {
      setIsSaving(false);
    }
  }, [editingId, editName, editDesc, editAssigned, editStatus, page, statusFilter, fetchZones, toast]);

  // ── Delete zone ──
  const handleDelete = useCallback(async () => {
    if (!deletingZone) return;
    setIsDeleting(true);
    setActionResult(null);
    try {
      const res = await fetch(`/api/admin/zones/${deletingZone.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Delete failed');
      }
      const json = (await res.json()) as { message: string };
      setActionResult({ success: true, message: json.message });
      toast.success('Coverage zone deleted');
      setDeletingZone(null);
      void fetchZones(page, statusFilter);
    } catch (e) {
      setActionResult({ success: false, message: e instanceof Error ? e.message : 'Delete failed' });
    } finally {
      setIsDeleting(false);
    }
  }, [deletingZone, page, statusFilter, fetchZones, toast]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;

  return (
    <>
      <PageHeader
        eyebrow="ORAN Admin"
        title="Coverage Zone Administration"
        icon={<MapPin className="h-6 w-6 text-action-base" aria-hidden="true" />}
        subtitle="Manage coverage zones and community admin assignments across the platform."
        badges={
          <>
            <PageHeaderBadge tone="trust">Zone changes alter downstream review routing</PageHeaderBadge>
            <PageHeaderBadge tone="accent">Assignments stay visible across communities</PageHeaderBadge>
            <PageHeaderBadge>{data ? `${data.total} zones` : 'Loading zones'}</PageHeaderBadge>
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => void fetchZones(page, statusFilter)}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
            <Button
              size="sm"
              className="gap-1"
              onClick={() => setShowCreate(true)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New Zone
            </Button>
          </div>
        }
      />

      {/* Action result */}
      {actionResult && (
        <div className="mb-4">
          <FormAlert
            variant={actionResult.success ? 'success' : 'error'}
            message={actionResult.message}
            onDismiss={() => setActionResult(null)}
          />
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1" role="tablist" aria-label="Filter by zone status">
        <Filter className="h-4 w-4 text-gray-400 mr-1 shrink-0" aria-hidden="true" />
        {STATUS_TABS.map(({ value, label }) => (
          <button
            key={value}
            role="tab"
            aria-selected={statusFilter === value}
            onClick={() => { setStatusFilter(value); setPage(1); }}
            className={`inline-flex min-h-[44px] items-center px-3 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
              statusFilter === value
                ? 'bg-info-muted text-action-deep'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <FormAlert variant="error" message={error} onDismiss={() => setError(null)} className="mb-4" />
      )}

      {/* Loading state */}
      {isLoading && !data && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && data && data.results.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-gray-200 bg-white p-12 text-center">
          <MapPin className="h-10 w-10 text-gray-300 mb-3" aria-hidden="true" />
          <p className="text-gray-500 font-medium">No coverage zones found</p>
          <p className="text-gray-400 text-sm mt-1">
            {statusFilter
              ? `No zones with status "${statusFilter}".`
              : 'Create a zone to get started.'}
          </p>
        </div>
      )}

      {/* Zones table */}
      {data && data.results.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Coverage zones with status, assigned admin, creation date, and management actions.</caption>
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Zone</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Assigned Admin</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Created</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.results.map((zone) => {
                  const isEditing = editingId === zone.id;
                  return (
                    <React.Fragment key={zone.id}>
                      <tr className={`hover:bg-gray-50 ${isEditing ? 'bg-info-subtle/50' : ''}`}>
                        <td className="px-4 py-3">
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 truncate">{zone.name}</p>
                            {zone.description && (
                              <p className="text-xs text-gray-500 truncate max-w-xs">{zone.description}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                            zone.status === 'active'
                              ? 'bg-green-100 text-green-800 ring-green-600/20'
                              : 'bg-gray-100 text-gray-700 ring-gray-300'
                          }`}>
                            {zone.status === 'active' ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {zone.assigned_user_id ? (
                            <span className="inline-flex items-center gap-1 text-xs">
                              <Users className="h-3 w-3 text-gray-400" aria-hidden="true" />
                              <span
                                className="font-mono truncate max-w-[120px]"
                                title={zone.assigned_user_id}
                              >
                                {zone.assigned_user_id.slice(0, 8)}&hellip;
                              </span>
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">Unassigned</span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600 text-xs">
                          {formatDate(zone.created_at)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {!isEditing && (
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => startEditing(zone)}
                                aria-label={`Edit ${zone.name}`}
                              >
                                <Pencil className="h-4 w-4" aria-hidden="true" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeletingZone(zone)}
                                aria-label={`Delete ${zone.name}`}
                                className="text-error-base hover:text-error-strong hover:bg-error-subtle"
                              >
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </div>
                          )}
                          {isEditing && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingId(null)}
                            >
                              Cancel
                            </Button>
                          )}
                        </td>
                      </tr>

                      {/* Edit panel */}
                      {isEditing && (
                        <tr>
                          <td colSpan={5} className="px-4 py-4 bg-info-subtle/30 border-t border-info-muted">
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                void handleSave();
                              }}
                              className="max-w-lg space-y-3"
                            >
                              <FormSection
                                title="Zone details"
                                description="Update the coverage-zone name and summary used across assignment and review flows."
                                contentClassName="space-y-3"
                              >
                                <FormField id={`edit-name-${zone.id}`} label="Zone name" required>
                                  <input
                                    id={`edit-name-${zone.id}`}
                                    type="text"
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action"
                                    maxLength={500}
                                  />
                                </FormField>
                                <FormField id={`edit-desc-${zone.id}`} label="Description">
                                  <textarea
                                    id={`edit-desc-${zone.id}`}
                                    value={editDesc}
                                    onChange={(e) => setEditDesc(e.target.value)}
                                    rows={2}
                                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action"
                                    maxLength={5000}
                                  />
                                </FormField>
                              </FormSection>
                              <FormSection
                                title="Assignment and status"
                                description="Control who owns the zone and whether it is active in the operations queue."
                                contentClassName="space-y-0"
                              >
                                <div className="grid grid-cols-2 gap-3">
                                  <FormField
                                    id={`edit-assigned-${zone.id}`}
                                    label="Assigned admin ID"
                                    hint="Leave empty to unassign"
                                  >
                                    <input
                                      id={`edit-assigned-${zone.id}`}
                                      type="text"
                                      value={editAssigned}
                                      onChange={(e) => setEditAssigned(e.target.value)}
                                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action"
                                      placeholder="Leave empty to unassign"
                                      maxLength={500}
                                    />
                                  </FormField>
                                  <FormField id={`edit-status-${zone.id}`} label="Status">
                                    <select
                                      id={`edit-status-${zone.id}`}
                                      value={editStatus}
                                      onChange={(e) => setEditStatus(e.target.value as ZoneStatus)}
                                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action"
                                    >
                                      <option value="active">Active</option>
                                      <option value="inactive">Inactive</option>
                                    </select>
                                  </FormField>
                                </div>
                              </FormSection>
                              <div className="flex items-center gap-2">
                                <Button
                                  type="submit"
                                  size="sm"
                                  disabled={isSaving || !editName.trim()}
                                  className="gap-1"
                                >
                                  {isSaving ? (
                                    <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Saving…</>
                                  ) : (
                                    'Save'
                                  )}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEditingId(null)}
                                  disabled={isSaving}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </form>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
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
              onClick={() => void fetchZones(page - 1, statusFilter)}
              disabled={page <= 1 || isLoading}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchZones(page + 1, statusFilter)}
              disabled={!data.hasMore || isLoading}
              className="gap-1"
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Create Zone Dialog ── */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Coverage Zone</DialogTitle>
            <DialogDescription>
              Add a new coverage zone and optionally assign a community admin.
            </DialogDescription>
          </DialogHeader>
          <form
            id="create-zone-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate();
            }}
            className="space-y-3 py-2"
          >
            <FormSection
              title="Zone details"
              description="Create the coverage-zone record that community admins and ORAN operators will manage."
              contentClassName="space-y-3"
            >
              <FormField id="create-name" label="Zone name" required>
                <input
                  id="create-name"
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action"
                  placeholder="e.g. Downtown Portland"
                  maxLength={500}
                />
              </FormField>
              <FormField id="create-desc" label="Description">
                <textarea
                  id="create-desc"
                  value={createDesc}
                  onChange={(e) => setCreateDesc(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action"
                  maxLength={5000}
                />
              </FormField>
            </FormSection>
            <FormSection
              title="Assignment and status"
              description="Optionally assign an admin now and decide whether the zone is immediately active."
              contentClassName="space-y-0"
            >
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  id="create-assigned"
                  label="Assigned admin ID"
                  hint="Paste a user UUID or leave empty"
                >
                  <input
                    id="create-assigned"
                    type="text"
                    value={createAssigned}
                    onChange={(e) => setCreateAssigned(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action"
                    placeholder="Optional"
                    maxLength={500}
                  />
                </FormField>
                <FormField id="create-status" label="Status">
                  <select
                    id="create-status"
                    value={createStatus}
                    onChange={(e) => setCreateStatus(e.target.value as ZoneStatus)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </FormField>
              </div>
            </FormSection>
          </form>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCreate(false)}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="create-zone-form"
              size="sm"
              disabled={isCreating || !createName.trim()}
            >
              {isCreating ? (
                <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Creating…</>
              ) : (
                'Create Zone'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation Dialog ── */}
      <Dialog open={!!deletingZone} onOpenChange={(open) => { if (!open) setDeletingZone(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Coverage Zone</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deletingZone?.name}&rdquo;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeletingZone(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void handleDelete()}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function OranAdminCoveragePage() {
  return (
    <ErrorBoundary>
      <ZoneManagementInner />
    </ErrorBoundary>
  );
}
