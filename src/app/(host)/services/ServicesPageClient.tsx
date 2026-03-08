/**
 * /services — Service Management
 *
 * Full CRUD for services under the host's organizations.
 * Lists services with org filter, inline create + edit modals, delete with confirmation.
 * Enhanced with FormField, FormAlert, PhoneEditor, ScheduleEditor, CategoryPicker,
 * SuccessCelebration, and toast notifications.
 * Wired to /api/host/services and /api/host/organizations.
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Briefcase, Plus, Pencil, Trash2, Search,
  ArrowLeft, ArrowRight, Check, ExternalLink, Loader2,
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
import { FormField } from '@/components/ui/form-field';
import { FormAlert } from '@/components/ui/form-alert';
import { SuccessCelebration } from '@/components/ui/success-celebration';
import { PhoneEditor, type PhoneEntry } from '@/components/ui/phone-editor';
import { ScheduleEditor, EMPTY_WEEK, type WeekSchedule } from '@/components/ui/schedule-editor';
import { CategoryPicker } from '@/components/ui/category-picker';
import { useToast } from '@/components/ui/toast';
import { useUnsavedChanges } from '@/lib/hooks/useUnsavedChanges';
import type { Organization, ServiceStatus } from '@/domain/types';

// ============================================================
// TYPES
// ============================================================

interface ServiceRow {
  id: string;
  organization_id: string;
  name: string;
  alternate_name?: string | null;
  description?: string | null;
  url?: string | null;
  email?: string | null;
  status: ServiceStatus;
  interpretation_services?: string | null;
  application_process?: string | null;
  fees?: string | null;
  wait_time?: string | null;
  accreditations?: string | null;
  licenses?: string | null;
  organization_name?: string | null;
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  results: ServiceRow[];
  total: number;
  page: number;
  hasMore: boolean;
}

interface OrgOption { id: string; name: string }

interface ServiceForm {
  id?: string;
  organizationId: string;
  name: string;
  description: string;
  url: string;
  email: string;
  status: ServiceStatus;
  interpretationServices: string;
  applicationProcess: string;
  fees: string;
  waitTime: string;
  accreditations: string;
  licenses: string;
  phones: PhoneEntry[];
  schedule: WeekSchedule;
  categories: string[];
}

const EMPTY_FORM: ServiceForm = {
  organizationId: '',
  name: '',
  description: '',
  url: '',
  email: '',
  status: 'active',
  interpretationServices: '',
  applicationProcess: '',
  fees: '',
  waitTime: '',
  accreditations: '',
  licenses: '',
  phones: [],
  schedule: EMPTY_WEEK,
  categories: [],
};

const LIMIT = 12;

const STATUS_LABELS: Record<ServiceStatus, { label: string; color: string }> = {
  active:   { label: 'Active',   color: 'bg-green-100 text-green-800' },
  inactive: { label: 'Inactive', color: 'bg-yellow-100 text-yellow-800' },
  defunct:  { label: 'Defunct',   color: 'bg-error-muted text-error-deep' },
};

// ============================================================
// COMPONENT
// ============================================================

export default function ServicesPage() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [orgFilter, setOrgFilter] = useState('');

  // Org options for selectors
  const [orgs, setOrgs] = useState<OrgOption[]>([]);

  // Modal
  const [form, setForm] = useState<ServiceForm | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const isCreating = form !== null && !form.id;

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Toast + unsaved changes
  const toast = useToast();
  const formDirty = form !== null;
  useUnsavedChanges(formDirty);

  const closeFormDialog = useCallback(() => {
    setForm(null);
    setSaveError(null);
  }, []);

  const closeDeleteDialog = useCallback(() => {
    setDeletingId(null);
  }, []);

  // ── Load org options ──
  useEffect(() => {
    const loadOrgs = async () => {
      try {
        const res = await fetch('/api/host/organizations?limit=100');
        if (res.ok) {
          const json = (await res.json()) as { results: Organization[] };
          setOrgs(json.results.map((o) => ({ id: o.id, name: o.name })));
        }
      } catch {
        // Non-fatal — org filter just won't work
      }
    };
    void loadOrgs();
  }, []);

  // ── Fetch services ──
  const fetchServices = useCallback(async (p: number, q: string, orgId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
      if (q.trim()) params.set('q', q.trim());
      if (orgId) params.set('organizationId', orgId);

      const res = await fetch(`/api/host/services?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to load services');
      }
      const json = (await res.json()) as ListResponse;
      setData(json);
      setPage(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load services');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchServices(1, '', '');
  }, [fetchServices]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void fetchServices(1, query, orgFilter);
  };

  // ── Save (create or update) ──
  const handleSave = useCallback(async () => {
    if (!form || !form.name.trim()) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const isUpdate = Boolean(form.id);
      const endpoint = isUpdate
        ? `/api/host/services/${form.id}`
        : '/api/host/services';

      const payload: Record<string, unknown> = {
        name: form.name,
        status: form.status,
      };
      if (!isUpdate) payload.organizationId = form.organizationId;
      if (form.description) payload.description = form.description;
      if (form.url) payload.url = form.url;
      if (form.email) payload.email = form.email;
      if (form.applicationProcess) payload.applicationProcess = form.applicationProcess;
      if (form.fees) payload.fees = form.fees;
      if (form.waitTime) payload.waitTime = form.waitTime;
      if (form.interpretationServices) payload.interpretationServices = form.interpretationServices;
      if (form.accreditations) payload.accreditations = form.accreditations;
      if (form.licenses) payload.licenses = form.licenses;
      // Phones: include if any numbers have been entered
      if (form.phones.length > 0) payload.phones = form.phones;
      // Schedule: always include so the API can reset hours on each save
      payload.schedule = form.schedule;

      const res = await fetch(endpoint, {
        method: isUpdate ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Save failed');
      }

      setForm(null);
      setShowSuccess(true);
      toast.success(isUpdate ? 'Service updated successfully' : 'Service created successfully');
      void fetchServices(page, query, orgFilter);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  }, [form, page, query, orgFilter, fetchServices, toast]);

  // ── Delete ──
  const handleDelete = useCallback(async (id: string) => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/host/services/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Delete failed');
      }
      setDeletingId(null);
      toast.success('Service archived');
      void fetchServices(page, query, orgFilter);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
      setDeletingId(null);
    } finally {
      setIsDeleting(false);
    }
  }, [page, query, orgFilter, fetchServices, toast]);

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Briefcase className="h-6 w-6 text-action-base" aria-hidden="true" />
            Services
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Manage service listings across your organizations.
          </p>
        </div>
        <Button
          size="sm"
          className="gap-1"
          onClick={() => setForm({ ...EMPTY_FORM, organizationId: orgs[0]?.id ?? '' })}
          disabled={orgs.length === 0}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add Service
        </Button>
      </div>

      <ErrorBoundary>
        {/* Search + org filter */}
        <form onSubmit={handleSearch} className="flex flex-wrap gap-2 items-center mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search services"
              className="w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action min-h-[44px]"
              aria-label="Search services"
            />
          </div>
          <select
            value={orgFilter}
            onChange={(e) => {
              setOrgFilter(e.target.value);
              void fetchServices(1, query, e.target.value);
            }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm min-h-[44px]"
            aria-label="Filter by organization"
          >
            <option value="">All organizations</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <Button type="submit" disabled={isLoading}>Search</Button>
        </form>

        {/* Error */}
        {error && (
          <FormAlert variant="error" message={error} onDismiss={() => setError(null)} className="mb-4" />
        )}

        {/* Success celebration */}
        {showSuccess && (
          <SuccessCelebration
            title="Service saved!"
            message="Your changes are live."
            onDismiss={() => setShowSuccess(false)}
          />
        )}

        {/* Loading */}
        {isLoading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={`sk-${i}`} />)}
          </div>
        )}

        {/* Empty */}
        {!isLoading && data && data.results.length === 0 && (
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
            <p className="text-gray-700 font-medium">No services found</p>
            <p className="mt-1 text-sm text-gray-500">
              Add a service to one of your{' '}
              <Link href="/org" className="text-action-base hover:underline">organizations</Link>.
            </p>
          </div>
        )}

        {/* Results */}
        {!isLoading && data && data.results.length > 0 && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.results.map((svc) => {
                const st = STATUS_LABELS[svc.status];
                return (
                  <div key={svc.id} className="rounded-lg border border-gray-200 bg-white p-4 flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="font-semibold text-gray-900 text-sm">{svc.name}</h2>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${st.color}`}>
                          {st.label}
                        </span>
                      </div>
                      {svc.organization_name && (
                        <p className="mt-0.5 text-xs text-gray-500">{svc.organization_name}</p>
                      )}
                      {svc.description && (
                        <p className="mt-1 text-xs text-gray-600 line-clamp-2">{svc.description}</p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                        {svc.url && (
                          <a href={svc.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-action-base hover:underline">
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            Website
                          </a>
                        )}
                        {svc.fees && <span>Fees: {svc.fees}</span>}
                        {svc.wait_time && <span>Wait: {svc.wait_time}</span>}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        onClick={() => setForm({
                          id: svc.id,
                          organizationId: svc.organization_id,
                          name: svc.name,
                          description: svc.description ?? '',
                          url: svc.url ?? '',
                          email: svc.email ?? '',
                          status: svc.status,
                          interpretationServices: svc.interpretation_services ?? '',
                          applicationProcess: svc.application_process ?? '',
                          fees: svc.fees ?? '',
                          waitTime: svc.wait_time ?? '',
                          accreditations: svc.accreditations ?? '',
                          licenses: svc.licenses ?? '',
                          phones: [],
                          schedule: EMPTY_WEEK,
                          categories: [],
                        })}
                      >
                        <Pencil className="h-3 w-3" aria-hidden="true" />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 text-error-base hover:text-error-strong hover:border-error-accent"
                        onClick={() => setDeletingId(svc.id)}
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                        Delete
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-gray-600" role="status">
                Page {data.page} · {data.total} total
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => void fetchServices(page - 1, query, orgFilter)} disabled={page <= 1 || isLoading} className="gap-1">
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Prev
                </Button>
                <Button variant="outline" size="sm" onClick={() => void fetchServices(page + 1, query, orgFilter)} disabled={!data.hasMore || isLoading} className="gap-1">
                  Next <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </>
        )}
      </ErrorBoundary>

      {/* ── Create / Edit Modal ── */}
      <Dialog
        open={Boolean(form)}
        onOpenChange={(open) => {
          if (!open) closeFormDialog();
        }}
      >
        {form && (
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{isCreating ? 'Add Service' : 'Edit Service'}</DialogTitle>
              <DialogDescription>Update service details visible to seekers.</DialogDescription>
            </DialogHeader>

            {saveError && (
              <FormAlert variant="error" message={saveError} onDismiss={() => setSaveError(null)} />
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSave();
              }}
              className="space-y-4"
            >
              {/* Organization selector (only for create) */}
              {isCreating && (
                <FormField id="svc-org" label="Organization" required>
                  <select
                    id="svc-org"
                    value={form.organizationId}
                    onChange={(e) => setForm({ ...form, organizationId: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm min-h-[44px]"
                    required
                  >
                    <option value="">Select organization…</option>
                    {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </FormField>
              )}

              <FormField id="svc-name" label="Service Name" required charCount={form.name.length} maxChars={500}>
                <input
                  id="svc-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action min-h-[44px]"
                  required
                  maxLength={500}
                />
              </FormField>

              <FormField id="svc-desc" label="Description" hint="Describe what this service provides to seekers." charCount={form.description.length} maxChars={5000}>
                <textarea
                  id="svc-desc"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action"
                  maxLength={5000}
                />
              </FormField>

              {/* Service Categories */}
              <CategoryPicker
                selected={form.categories}
                onChange={(categories) => setForm({ ...form, categories })}
                maxSelections={5}
              />

              <div className="grid grid-cols-2 gap-3">
                <FormField id="svc-url" label="Website">
                  <input
                    id="svc-url"
                    type="url"
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    placeholder="https://…"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action min-h-[44px]"
                  />
                </FormField>
                <FormField id="svc-email" label="Email">
                  <input
                    id="svc-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="contact@example.org"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action min-h-[44px]"
                  />
                </FormField>
              </div>

              {/* Phone numbers */}
              <PhoneEditor
                phones={form.phones}
                onChange={(phones) => setForm({ ...form, phones })}
              />

              <FormField id="svc-status" label="Status">
                <select
                  id="svc-status"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as ServiceStatus })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm min-h-[44px]"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="defunct">Defunct</option>
                </select>
              </FormField>

              <FormField id="svc-fees" label="Fees" hint="e.g., Free, Sliding scale, $20/visit">
                <input
                  id="svc-fees"
                  type="text"
                  value={form.fees}
                  onChange={(e) => setForm({ ...form, fees: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action min-h-[44px]"
                  maxLength={1000}
                />
              </FormField>

              <FormField id="svc-process" label="Application Process" hint="How do seekers access this service?">
                <textarea
                  id="svc-process"
                  value={form.applicationProcess}
                  onChange={(e) => setForm({ ...form, applicationProcess: e.target.value })}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action"
                  maxLength={2000}
                />
              </FormField>

              <FormField id="svc-wait" label="Wait Time" hint="e.g., Same day, 1-2 weeks, 30 days">
                <input
                  id="svc-wait"
                  type="text"
                  value={form.waitTime}
                  onChange={(e) => setForm({ ...form, waitTime: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action min-h-[44px]"
                  maxLength={500}
                />
              </FormField>

              {/* Operating Hours */}
              <ScheduleEditor
                schedule={form.schedule}
                onChange={(schedule) => setForm({ ...form, schedule })}
              />

              <FormField id="svc-interpretation" label="Interpretation Services" hint="Languages available or how to request interpretation.">
                <textarea
                  id="svc-interpretation"
                  value={form.interpretationServices}
                  onChange={(e) => setForm({ ...form, interpretationServices: e.target.value })}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action"
                  maxLength={1000}
                />
              </FormField>

              <div className="grid grid-cols-2 gap-3">
                <FormField id="svc-accreditations" label="Accreditations">
                  <input
                    id="svc-accreditations"
                    type="text"
                    value={form.accreditations}
                    onChange={(e) => setForm({ ...form, accreditations: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action min-h-[44px]"
                    maxLength={1000}
                  />
                </FormField>
                <FormField id="svc-licenses" label="Licenses">
                  <input
                    id="svc-licenses"
                    type="text"
                    value={form.licenses}
                    onChange={(e) => setForm({ ...form, licenses: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action min-h-[44px]"
                    maxLength={1000}
                  />
                </FormField>
              </div>

              <DialogFooter className="mt-2">
                <Button type="button" variant="outline" onClick={closeFormDialog} disabled={isSaving}>Cancel</Button>
                <Button
                  type="submit"
                  disabled={isSaving || !form.name.trim() || (isCreating && !form.organizationId)}
                  className="gap-1"
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  )}
                  {isSaving ? 'Saving…' : isCreating ? 'Create' : 'Save'}
                </Button>
              </DialogFooter>
            </form>
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
              <DialogTitle>Archive service?</DialogTitle>
              <DialogDescription>
                This marks the service as defunct so it no longer appears in host lists.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={closeDeleteDialog} disabled={isDeleting}>Cancel</Button>
              <Button onClick={() => void handleDelete(deletingId)} disabled={isDeleting} className="bg-error-base hover:bg-error-strong text-white">
                {isDeleting ? 'Archiving…' : 'Archive'}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
