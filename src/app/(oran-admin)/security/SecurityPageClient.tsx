'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Lock, RefreshCw, ShieldCheck, Unlock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormAlert } from '@/components/ui/form-alert';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { SkeletonCard } from '@/components/ui/skeleton';

interface SecurityAccountRow {
  user_id: string;
  display_name: string | null;
  email: string | null;
  role: string;
  account_status: 'active' | 'frozen';
  security_note: string | null;
  suspended_at: string | null;
  restored_at: string | null;
  organization_count: number;
  updated_at: string;
}

interface SecurityResponse {
  results: SecurityAccountRow[];
  total: number;
  page: number;
  hasMore: boolean;
}

export default function SecurityPageClient() {
  const [data, setData] = useState<SecurityResponse | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchAccounts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: '1', limit: '20' });
      if (statusFilter) params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());

      const res = await fetch(`/api/admin/security/accounts?${params.toString()}`);
      const body = (await res.json().catch(() => null)) as SecurityResponse & { error?: string } | null;
      if (!res.ok) {
        throw new Error(body?.error ?? 'Failed to load account security data');
      }
      setData(body as SecurityResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load account security data');
    } finally {
      setIsLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  const handleDecision = useCallback(async (userId: string, action: 'freeze' | 'restore') => {
    const note = noteDrafts[userId]?.trim() ?? '';
    if (note.length < 5) {
      setError('Add a brief security note before changing account status.');
      return;
    }

    setPendingUserId(userId);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch('/api/admin/security/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action, note }),
      });
      const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (!res.ok) {
        throw new Error(body?.error ?? 'Failed to update account status');
      }
      setInfo(body?.message ?? 'Account updated successfully.');
      await fetchAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update account status');
    } finally {
      setPendingUserId(null);
    }
  }, [fetchAccounts, noteDrafts]);

  return (
    <ErrorBoundary>
      <PageHeader
        eyebrow="ORAN Admin"
        title="Account Security"
        icon={<ShieldCheck className="h-6 w-6 text-action-base" aria-hidden="true" />}
        subtitle="Freeze compromised or abusive accounts without deleting their audit trail, then restore them when review is complete."
        badges={(
          <>
            <PageHeaderBadge tone="trust">Freezing blocks new authenticated actions</PageHeaderBadge>
            <PageHeaderBadge tone="accent">Every change requires an operator note</PageHeaderBadge>
            <PageHeaderBadge>{data ? `${data.total} tracked accounts` : 'Loading accounts'}</PageHeaderBadge>
          </>
        )}
        actions={(
          <Button variant="outline" size="sm" className="gap-1" onClick={() => void fetchAccounts()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </Button>
        )}
        className="mb-8"
      />

      <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 md:flex-row md:items-end">
        <label className="flex-1 text-sm text-gray-600">
          Search users
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="User ID, name, email"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="w-full text-sm text-gray-600 md:w-56">
          Status
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="frozen">Frozen</option>
          </select>
        </label>
        <Button onClick={() => void fetchAccounts()} disabled={isLoading}>Apply</Button>
      </div>

      {error && <FormAlert variant="error" message={error} onDismiss={() => setError(null)} className="mb-6" />}
      {info && <FormAlert variant="success" message={info} onDismiss={() => setInfo(null)} className="mb-6" />}

      {isLoading && !data ? (
        <div className="grid gap-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonCard key={index} />
          ))}
        </div>
      ) : (
        <div className="grid gap-4">
          {data?.results.map((entry) => {
            const isFrozen = entry.account_status === 'frozen';
            return (
              <section key={entry.user_id} className={`rounded-2xl border bg-white p-5 ${isFrozen ? 'border-amber-300' : 'border-gray-200'}`}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-gray-900">{entry.display_name ?? entry.user_id}</h2>
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${isFrozen ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-800'}`}>
                        {entry.account_status}
                      </span>
                      <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                        {entry.role.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500">{entry.email ?? 'No email on file'} • {entry.organization_count} active org memberships</p>
                    <p className="text-sm text-gray-600">{entry.security_note ?? 'No operator note recorded yet.'}</p>
                    <p className="text-xs text-gray-400">
                      Updated {new Date(entry.updated_at).toLocaleString()}.
                      {entry.suspended_at ? ` Frozen ${new Date(entry.suspended_at).toLocaleString()}.` : ''}
                      {entry.restored_at ? ` Restored ${new Date(entry.restored_at).toLocaleString()}.` : ''}
                    </p>
                  </div>

                  <div className="w-full max-w-xl space-y-3">
                    <textarea
                      rows={3}
                      value={noteDrafts[entry.user_id] ?? entry.security_note ?? ''}
                      onChange={(event) => setNoteDrafts((current) => ({ ...current, [entry.user_id]: event.target.value }))}
                      placeholder="Record why this account is being frozen or restored."
                      className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                    />
                    <div className="flex flex-wrap gap-2">
                      {isFrozen ? (
                        <Button
                          className="gap-2"
                          onClick={() => void handleDecision(entry.user_id, 'restore')}
                          disabled={pendingUserId === entry.user_id}
                        >
                          <Unlock className="h-4 w-4" aria-hidden="true" />
                          {pendingUserId === entry.user_id ? 'Restoring…' : 'Restore account'}
                        </Button>
                      ) : (
                        <Button
                          className="gap-2 bg-amber-600 text-white hover:bg-amber-700"
                          onClick={() => void handleDecision(entry.user_id, 'freeze')}
                          disabled={pendingUserId === entry.user_id}
                        >
                          <Lock className="h-4 w-4" aria-hidden="true" />
                          {pendingUserId === entry.user_id ? 'Freezing…' : 'Freeze account'}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            );
          })}
          {data && data.results.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
              No accounts matched the current filters.
            </div>
          ) : null}
        </div>
      )}
    </ErrorBoundary>
  );
}
