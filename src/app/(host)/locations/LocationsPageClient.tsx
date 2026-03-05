/**
 * /locations — Location Management
 *
 * CRUD for locations under the host's organizations.
 * Create / edit includes address fields; coordinates optional.
 * Enhanced with FormField, FormAlert, PhoneEditor, ScheduleEditor,
 * SuccessCelebration, and toast notifications.
 * Wired to /api/host/locations and /api/host/organizations.
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  MapPin, Plus, Pencil, Trash2, AlertTriangle,
  ArrowLeft, ArrowRight, Check, Loader2,
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
import { useToast } from '@/components/ui/toast';
import { useUnsavedChanges } from '@/lib/hooks/useUnsavedChanges';
import type { Organization } from '@/domain/types';

// ============================================================
// TYPES
// ============================================================

interface LocationRow {
  id: string;
  organization_id: string;
  name: string | null;
  alternate_name?: string | null;
  description?: string | null;
  transportation?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  address_1?: string | null;
  city?: string | null;
  state_province?: string | null;
  postal_code?: string | null;
  organization_name?: string | null;
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  results: LocationRow[];
  total: number;
  page: number;
  hasMore: boolean;
}

interface OrgOption { id: string; name: string }

interface LocationForm {
  id?: string;
  organizationId: string;
  name: string;
  alternateName: string;
  description: string;
  transportation: string;
  latitude: string;
  longitude: string;
  address1: string;
  address2: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  country: string;
  phones: PhoneEntry[];
  schedule: WeekSchedule;
}

const EMPTY_FORM: LocationForm = {
  organizationId: '',
  name: '',
  alternateName: '',
  description: '',
  transportation: '',
  latitude: '',
  longitude: '',
  address1: '',
  address2: '',
  city: '',
  stateProvince: '',
  postalCode: '',
  country: 'US',
  phones: [],
  schedule: EMPTY_WEEK,
};

const LIMIT = 12;

// ============================================================
// COMPONENT
// ============================================================

export default function LocationsPage() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [orgFilter, setOrgFilter] = useState('');

  const [orgs, setOrgs] = useState<OrgOption[]>([]);

  // Modal
  const [form, setForm] = useState<LocationForm | null>(null);
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

  // ── Load orgs ──
  useEffect(() => {
    const loadOrgs = async () => {
      try {
        const res = await fetch('/api/host/organizations?limit=100');
        if (res.ok) {
          const json = (await res.json()) as { results: Organization[] };
          setOrgs(json.results.map((o) => ({ id: o.id, name: o.name })));
        }
      } catch {
        // Non-fatal
      }
    };
    void loadOrgs();
  }, []);

  // ── Fetch locations ──
  const fetchLocations = useCallback(async (p: number, orgId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
      if (orgId) params.set('organizationId', orgId);

      const res = await fetch(`/api/host/locations?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to load locations');
      }
      const json = (await res.json()) as ListResponse;
      setData(json);
      setPage(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load locations');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLocations(1, '');
  }, [fetchLocations]);

  // ── Save ──
  const handleSave = useCallback(async () => {
    if (!form || !form.name.trim()) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      // Client-side coordinate validation before round-trip
      if (form.latitude.trim() !== '') {
        const lat = parseFloat(form.latitude);
        if (isNaN(lat) || lat < -90 || lat > 90) {
          setSaveError('Latitude must be a number between -90 and 90.');
          setIsSaving(false);
          return;
        }
      }
      if (form.longitude.trim() !== '') {
        const lng = parseFloat(form.longitude);
        if (isNaN(lng) || lng < -180 || lng > 180) {
          setSaveError('Longitude must be a number between -180 and 180.');
          setIsSaving(false);
          return;
        }
      }

      const isUpdate = Boolean(form.id);
      const endpoint = isUpdate
        ? `/api/host/locations/${form.id}`
        : '/api/host/locations';

      const payload: Record<string, unknown> = { name: form.name };
      if (!isUpdate) payload.organizationId = form.organizationId;
      if (form.alternateName) payload.alternateName = form.alternateName;
      if (form.description) payload.description = form.description;
      if (form.transportation) payload.transportation = form.transportation;
      if (form.latitude.trim()) payload.latitude = parseFloat(form.latitude);
      if (form.longitude.trim()) payload.longitude = parseFloat(form.longitude);
      if (form.address1) payload.address1 = form.address1;
      if (form.address2) payload.address2 = form.address2;
      if (form.city) payload.city = form.city;
      if (form.stateProvince) payload.stateProvince = form.stateProvince;
      if (form.postalCode) payload.postalCode = form.postalCode;
      if (form.country) payload.country = form.country;

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
      toast.success(isUpdate ? 'Location updated successfully' : 'Location created successfully');
      void fetchLocations(page, orgFilter);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  }, [form, page, orgFilter, fetchLocations]);

  // ── Delete ──
  const handleDelete = useCallback(async (id: string) => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/host/locations/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Delete failed');
      }
      setDeletingId(null);
      toast.success('Location deleted');
      void fetchLocations(page, orgFilter);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
      setDeletingId(null);
    } finally {
      setIsDeleting(false);
    }
  }, [page, orgFilter, fetchLocations, toast]);

  // ── Format address helper ──
  const formatAddress = (loc: LocationRow): string | null => {
    const parts = [loc.address_1, loc.city, loc.state_province, loc.postal_code].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <MapPin className="h-6 w-6 text-blue-600" aria-hidden="true" />
            Locations
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Manage physical and virtual locations for your organizations.
          </p>
        </div>
        <Button
          size="sm"
          className="gap-1"
          onClick={() => setForm({ ...EMPTY_FORM, organizationId: orgs[0]?.id ?? '' })}
          disabled={orgs.length === 0}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add Location
        </Button>
      </div>

      <ErrorBoundary>
        {/* Org filter */}
        <div className="flex gap-2 items-center mb-4">
          <select
            value={orgFilter}
            onChange={(e) => {
              setOrgFilter(e.target.value);
              void fetchLocations(1, e.target.value);
            }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm min-h-[44px]"
            aria-label="Filter by organization"
          >
            <option value="">All organizations</option>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>

        {/* Error */}
        {error && (
          <FormAlert variant="error" message={error} onDismiss={() => setError(null)} className="mb-4" />
        )}

        {/* Success celebration */}
        {showSuccess && (
          <SuccessCelebration
            title="Location saved!"
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
            <p className="text-gray-700 font-medium">No locations found</p>
            <p className="mt-1 text-sm text-gray-500">
              Add a location to one of your{' '}
              <Link href="/org" className="text-blue-600 hover:underline">organizations</Link>.
            </p>
          </div>
        )}

        {/* Results */}
        {!isLoading && data && data.results.length > 0 && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.results.map((loc) => {
                const addr = formatAddress(loc);
                return (
                  <div key={loc.id} className="rounded-lg border border-gray-200 bg-white p-4 flex flex-col justify-between">
                    <div>
                      <h2 className="font-semibold text-gray-900 text-sm">{loc.name ?? 'Unnamed Location'}</h2>
                      {loc.organization_name && (
                        <p className="mt-0.5 text-xs text-gray-500">{loc.organization_name}</p>
                      )}
                      {addr && (
                        <p className="mt-1 text-xs text-gray-600">{addr}</p>
                      )}
                      {loc.latitude != null && loc.longitude != null && (
                        <p className="mt-1 text-xs text-gray-400">
                          {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                        </p>
                      )}
                      {loc.description && (
                        <p className="mt-1 text-xs text-gray-600 line-clamp-2">{loc.description}</p>
                      )}
                    </div>
                    <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        onClick={() => setForm({
                          id: loc.id,
                          organizationId: loc.organization_id,
                          name: loc.name ?? '',
                          alternateName: loc.alternate_name ?? '',
                          description: loc.description ?? '',
                          transportation: loc.transportation ?? '',
                          latitude: loc.latitude != null ? String(loc.latitude) : '',
                          longitude: loc.longitude != null ? String(loc.longitude) : '',
                          address1: loc.address_1 ?? '',
                          address2: '',
                          city: loc.city ?? '',
                          stateProvince: loc.state_province ?? '',
                          postalCode: loc.postal_code ?? '',
                          country: 'US',
                          phones: [],
                          schedule: EMPTY_WEEK,
                        })}
                      >
                        <Pencil className="h-3 w-3" aria-hidden="true" />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 text-red-600 hover:text-red-700 hover:border-red-300"
                        onClick={() => setDeletingId(loc.id)}
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
                <Button variant="outline" size="sm" onClick={() => void fetchLocations(page - 1, orgFilter)} disabled={page <= 1 || isLoading} className="gap-1">
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Prev
                </Button>
                <Button variant="outline" size="sm" onClick={() => void fetchLocations(page + 1, orgFilter)} disabled={!data.hasMore || isLoading} className="gap-1">
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
              <DialogTitle>{isCreating ? 'Add Location' : 'Edit Location'}</DialogTitle>
              <DialogDescription>Update location and address information.</DialogDescription>
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
              {isCreating && (
                <FormField id="loc-org" label="Organization" required>
                  <select
                    id="loc-org"
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

              <FormField id="loc-name" label="Location Name" required charCount={form.name.length} maxChars={500}>
                <input
                  id="loc-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  required
                  maxLength={500}
                />
              </FormField>

              <FormField id="loc-alt" label="Alternate Name" hint="Other names this location is known by.">
                <input
                  id="loc-alt"
                  type="text"
                  value={form.alternateName}
                  onChange={(e) => setForm({ ...form, alternateName: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  maxLength={500}
                />
              </FormField>

              <FormField id="loc-desc" label="Description" charCount={form.description.length} maxChars={5000}>
                <textarea
                  id="loc-desc"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  maxLength={5000}
                />
              </FormField>

              {/* Phone numbers */}
              <PhoneEditor
                phones={form.phones}
                onChange={(phones) => setForm({ ...form, phones })}
              />

              {/* Address */}
              <fieldset className="border border-gray-200 rounded-lg p-3 space-y-3">
                <legend className="text-sm font-medium text-gray-700 px-1">Address</legend>
                <FormField id="loc-addr1" label="Street Address">
                  <input
                    id="loc-addr1"
                    type="text"
                    value={form.address1}
                    onChange={(e) => setForm({ ...form, address1: e.target.value })}
                    className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    maxLength={500}
                  />
                </FormField>
                <FormField id="loc-addr2" label="Address Line 2">
                  <input
                    id="loc-addr2"
                    type="text"
                    value={form.address2}
                    onChange={(e) => setForm({ ...form, address2: e.target.value })}
                    className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    maxLength={500}
                  />
                </FormField>
                <div className="grid grid-cols-3 gap-2">
                  <FormField id="loc-city" label="City">
                    <input
                      id="loc-city"
                      type="text"
                      value={form.city}
                      onChange={(e) => setForm({ ...form, city: e.target.value })}
                      className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      maxLength={200}
                    />
                  </FormField>
                  <FormField id="loc-state" label="State">
                    <input
                      id="loc-state"
                      type="text"
                      value={form.stateProvince}
                      onChange={(e) => setForm({ ...form, stateProvince: e.target.value })}
                      className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      maxLength={200}
                    />
                  </FormField>
                  <FormField id="loc-zip" label="Postal Code">
                    <input
                      id="loc-zip"
                      type="text"
                      value={form.postalCode}
                      onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
                      className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      maxLength={20}
                    />
                  </FormField>
                </div>
              </fieldset>

              {/* Coordinates */}
              <fieldset className="border border-gray-200 rounded-lg p-3 space-y-3">
                <legend className="text-sm font-medium text-gray-700 px-1">Coordinates (optional)</legend>
                <div className="grid grid-cols-2 gap-2">
                  <FormField id="loc-lat" label="Latitude" hint="-90 to 90">
                    <input
                      id="loc-lat"
                      type="number"
                      step="any"
                      min="-90"
                      max="90"
                      value={form.latitude}
                      onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                      className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </FormField>
                  <FormField id="loc-lng" label="Longitude" hint="-180 to 180">
                    <input
                      id="loc-lng"
                      type="number"
                      step="any"
                      min="-180"
                      max="180"
                      value={form.longitude}
                      onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                      className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </FormField>
                </div>
                <p className="text-xs text-gray-500">Approximate coordinates for map display. Rounded for privacy.</p>
              </fieldset>

              {/* Operating Hours */}
              <ScheduleEditor
                schedule={form.schedule}
                onChange={(schedule) => setForm({ ...form, schedule })}
              />

              <FormField id="loc-transport" label="Transportation Notes" hint="e.g., Bus route 12, accessible parking available">
                <input
                  id="loc-transport"
                  type="text"
                  value={form.transportation}
                  onChange={(e) => setForm({ ...form, transportation: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                  maxLength={1000}
                />
              </FormField>

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
              <DialogTitle>Delete location?</DialogTitle>
              <DialogDescription>This removes the location from host lists.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={closeDeleteDialog} disabled={isDeleting}>Cancel</Button>
              <Button onClick={() => void handleDelete(deletingId)} disabled={isDeleting} className="bg-red-600 hover:bg-red-700 text-white">
                {isDeleting ? 'Deleting…' : 'Delete'}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
