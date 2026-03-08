/**
 * /queue — Verification Queue
 *
 * Enhanced with FormAlert, toast notifications.
 *
 * Lists all verification queue entries with status filters, pagination,
 * and claim-for-review actions. Click-through navigates to /verify?id=…
 * Wired to GET /api/community/queue + POST /api/community/queue (claim).
 */

'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  ClipboardList, RefreshCw, ChevronLeft, ChevronRight,
  UserCheck, Clock, Filter, AlertTriangle, ArrowUp, Unlock,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormAlert } from '@/components/ui/form-alert';
import { SkeletonCard } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { useToast } from '@/components/ui/toast';
import type { SubmissionStatus } from '@/domain/types';
import { formatDate, daysAgo } from '@/lib/format';

// ============================================================
// TYPES
// ============================================================

interface QueueRow {
  id: string;
  service_id: string;
  status: SubmissionStatus;
  submitted_by_user_id: string;
  assigned_to_user_id: string | null;
  assigned_to_display_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  service_name: string;
  service_status: string;
  organization_id: string;
  organization_name: string;
  sla_deadline: string | null;
  sla_breached: boolean;
  /** Computed by the API via triage service. */
  triage_priority: number;
  triage_tier: 'urgent' | 'high' | 'normal' | 'low';
  triage_explanations: string[];
}

interface QueueResponse {
  results: QueueRow[];
  total: number;
  page: number;
  hasMore: boolean;
}

// ============================================================
// CONSTANTS
// ============================================================

const LIMIT = 20;

const STATUS_TABS: { value: '' | SubmissionStatus; label: string }[] = [
  { value: '',                      label: 'All' },
  { value: 'submitted',             label: 'Submitted' },
  { value: 'under_review',          label: 'Under Review' },
  { value: 'pending_second_approval', label: 'Pending 2nd Approval' },
  { value: 'approved',              label: 'Approved' },
  { value: 'denied',                label: 'Denied' },
  { value: 'escalated',             label: 'Escalated' },
  { value: 'returned',              label: 'Returned' },
  { value: 'withdrawn',             label: 'Withdrawn' },
];

const SPECIAL_FILTER_ASSIGNED = '__assigned_to_me__';

// ============================================================
// HELPERS
// ============================================================

const TRIAGE_TIER_STYLES: Record<'urgent' | 'high' | 'normal' | 'low', string> = {
  urgent: 'bg-error-muted text-error-deep border border-error-soft',
  high:   'bg-orange-100 text-orange-800 border border-orange-200',
  normal: 'bg-info-subtle text-action-strong border border-action-soft',
  low:    'bg-gray-100 text-gray-600 border border-gray-200',
};

function TriageBadge({ tier, explanations }: { tier: 'urgent' | 'high' | 'normal' | 'low'; explanations: string[] }) {
  const tooltip = explanations.length > 0 ? explanations.join(' · ') : 'No priority signals';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TRIAGE_TIER_STYLES[tier]}`}
      title={tooltip}
      aria-label={`Priority: ${tier}${explanations.length > 0 ? ` — ${tooltip}` : ''}`}
    >
      {(tier === 'urgent' || tier === 'high') && (
        <ArrowUp className="h-3 w-3" aria-hidden="true" />
      )}
      {tier}
    </span>
  );
}



export default function QueuePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const [data, setData] = useState<QueueResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>(() => {
    // Honour ?status= from Coverage deep-links (only accept valid values)
    const s = searchParams.get('status') ?? '';
    const validTab = STATUS_TABS.some((t) => t.value === s);
    const isSpecial = s === SPECIAL_FILTER_ASSIGNED;
    return validTab || isSpecial ? s : '';
  });
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const { toast } = useToast();

  // ── Push filter changes to URL for back-navigation ──
  const setFilter = useCallback((value: string) => {
    setStatusFilter(value);
    setPage(1);
    const params = new URLSearchParams();
    if (value) params.set('status', value);
    const qs = params.toString();
    router.replace(qs ? `/queue?${qs}` : '/queue', { scroll: false });
  }, [router]);

  // ── Fetch queue entries ──
  const fetchQueue = useCallback(async (p: number, filter: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
      if (filter === SPECIAL_FILTER_ASSIGNED) {
        params.set('assignedToMe', 'true');
      } else if (filter) {
        params.set('status', filter);
      }

      const res = await fetch(`/api/community/queue?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to load queue');
      }
      const json = (await res.json()) as QueueResponse;
      setData(json);
      setPage(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load queue');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchQueue(1, statusFilter);
  }, [fetchQueue, statusFilter]);

  // ── Claim (assign to self) ──
  const handleClaim = useCallback(async (entryId: string) => {
    setClaimingId(entryId);
    try {
      const res = await fetch('/api/community/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId: entryId,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Claim failed');
      }
      toast('success', 'Entry claimed — you are now the reviewer.');
      void fetchQueue(page, statusFilter);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to claim entry');
    } finally {
      setClaimingId(null);
    }
  }, [page, statusFilter, fetchQueue, toast]);

  // ── Unclaim (release lock) ──
  const handleUnclaim = useCallback(async (entryId: string) => {
    setReleasingId(entryId);
    try {
      const res = await fetch('/api/community/queue', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId: entryId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Release failed');
      }
      toast('success', 'Entry released — available for others to claim.');
      void fetchQueue(page, statusFilter);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to release entry');
    } finally {
      setReleasingId(null);
    }
  }, [page, statusFilter, fetchQueue, toast]);

  // ── Bulk actions ──
  const selectableIds = useMemo(
    () => (data?.results ?? []).filter((r) => r.status === 'submitted' || r.status === 'under_review').map((r) => r.id),
    [data],
  );

  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (allSelected) return new Set();
      return new Set([...prev, ...selectableIds]);
    });
  }, [allSelected, selectableIds]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleBulkDecision = useCallback(async (decision: 'approved' | 'denied') => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setIsBulkProcessing(true);
    try {
      const res = await fetch('/api/community/queue/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, decision }),
      });
      const json = (await res.json()) as { succeeded?: string[]; failed?: { id: string; error: string }[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Bulk action failed');
      const { succeeded = [], failed = [] } = json;
      if (succeeded.length > 0) {
        toast('success', `${succeeded.length} ${decision === 'approved' ? 'approved' : 'denied'}.`);
      }
      if (failed.length > 0) {
        toast('error', `${failed.length} could not be processed.`);
      }
      setSelectedIds(new Set());
      void fetchQueue(page, statusFilter);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk action failed');
    } finally {
      setIsBulkProcessing(false);
    }
  }, [selectedIds, page, statusFilter, fetchQueue, toast]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;

  return (
    <ErrorBoundary>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-action-base" aria-hidden="true" />
            Verification Queue
            <span className="ml-2 inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
              Community Admin
            </span>
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Triage and review pending service verification submissions for your community.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => void fetchQueue(page, statusFilter)}
          disabled={isLoading}
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {/* Status filter tabs */}
      <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1" role="tablist" aria-label="Filter by status">
        <Filter className="h-4 w-4 text-gray-400 mr-1 shrink-0" aria-hidden="true" />
        {STATUS_TABS.map(({ value, label }) => (
          <button
            key={value}
            role="tab"
            aria-selected={statusFilter === value}
            onClick={() => { setFilter(value); }}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
              statusFilter === value
                ? 'bg-info-muted text-action-deep'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
        <span className="mx-1 text-gray-300" aria-hidden="true">|</span>
        <button
          role="tab"
          aria-selected={statusFilter === SPECIAL_FILTER_ASSIGNED}
          onClick={() => { setFilter(SPECIAL_FILTER_ASSIGNED); }}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
            statusFilter === SPECIAL_FILTER_ASSIGNED
              ? 'bg-green-100 text-green-800'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
          }`}
        >
          Assigned to me
        </button>
      </div>

      {/* Bulk action toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 mb-4 rounded-lg border border-action-soft bg-info-subtle px-4 py-2">
          <span className="text-sm font-medium text-action-deep">{selectedIds.size} selected</span>
          <div className="flex gap-2 ml-auto">
            <Button
              size="sm"
              variant="outline"
              className="gap-1 border-green-300 text-green-700 hover:bg-green-50"
              disabled={isBulkProcessing}
              onClick={() => void handleBulkDecision('approved')}
            >
              Approve selected
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1 border-error-accent text-error-strong hover:bg-error-subtle"
              disabled={isBulkProcessing}
              onClick={() => void handleBulkDecision('denied')}
            >
              Reject selected
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedIds(new Set())}
              disabled={isBulkProcessing}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <FormAlert variant="error" message={error} onDismiss={() => setError(null)} />
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
          <ClipboardList className="h-10 w-10 text-gray-300 mb-3" aria-hidden="true" />
          <p className="text-gray-500 font-medium">No entries found</p>
          <p className="text-gray-400 text-sm mt-1">
            {statusFilter
              ? `No entries with status "${STATUS_TABS.find(({ value }) => value === statusFilter)?.label ?? statusFilter}".`
              : 'The verification queue is empty.'}
          </p>
        </div>
      )}

      {/* Queue table */}
      {data && data.results.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Verification queue entries with status, submission date, assignee, and actions.</caption>
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th scope="col" className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      disabled={selectableIds.length === 0}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Service</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Organization</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Priority</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Submitted</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">SLA</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Assigned</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.results.map((entry) => {
                  const age = daysAgo(entry.created_at);
                  const isStale = age > 14;
                  return (
                    <tr
                      key={entry.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        {(entry.status === 'submitted' || entry.status === 'under_review') && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${entry.service_name}`}
                            checked={selectedIds.has(entry.id)}
                            onChange={() => toggleSelect(entry.id)}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/verify?id=${entry.id}`}
                          className="font-medium text-action-base hover:underline"
                        >
                          {entry.service_name ?? <span className="italic text-gray-400">(unnamed service)</span>}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {entry.organization_name ?? <span className="italic text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <TriageBadge
                          tier={entry.triage_tier ?? 'low'}
                          explanations={entry.triage_explanations ?? []}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={entry.status} />
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{formatDate(entry.created_at)}</span>
                          {isStale && (
                            <span className="ml-1 text-amber-600 text-xs font-medium" title="Stale — older than 14 days">
                              ({age}d)
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {entry.sla_breached ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-error-muted px-2 py-0.5 text-xs font-medium text-error-deep" title="SLA breached">
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                            Breached
                          </span>
                        ) : entry.sla_deadline ? (
                          <span className="text-xs text-gray-500" title={`Due: ${formatDate(entry.sla_deadline)}`}>
                            {formatDate(entry.sla_deadline)}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {entry.assigned_to_user_id ? (
                          <span
                            className="flex items-center gap-1"
                            title={entry.assigned_to_user_id}
                          >
                            <UserCheck className="h-3.5 w-3.5 text-green-600 shrink-0" aria-hidden="true" />
                            <span className="truncate max-w-[120px] text-xs text-gray-600">
                              {entry.assigned_to_display_name ?? entry.assigned_to_user_id.slice(0, 8) + '…'}
                            </span>
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {entry.status === 'submitted' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              disabled={claimingId === entry.id}
                              onClick={() => void handleClaim(entry.id)}
                            >
                              <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                              {claimingId === entry.id ? 'Claiming…' : 'Claim'}
                            </Button>
                          )}
                          {entry.status === 'under_review' && entry.assigned_to_user_id && entry.assigned_to_user_id === currentUserId && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1 border-amber-300 text-amber-700 hover:bg-amber-50"
                              disabled={releasingId === entry.id}
                              onClick={() => void handleUnclaim(entry.id)}
                            >
                              <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
                              {releasingId === entry.id ? 'Releasing…' : 'Release'}
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" asChild>
                            <Link href={`/verify?id=${entry.id}`}>Review</Link>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 bg-gray-50">
            <p className="text-sm text-gray-500">
              {data.total} {data.total === 1 ? 'entry' : 'entries'}
              {statusFilter ? ` (${STATUS_TABS.find(({ value }) => value === statusFilter)?.label ?? statusFilter})` : ''}
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1 || isLoading}
                onClick={() => void fetchQueue(page - 1, statusFilter)}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Previous page</span>
              </Button>
              <span className="text-sm text-gray-600">
                {page} / {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={!data.hasMore || isLoading}
                onClick={() => void fetchQueue(page + 1, statusFilter)}
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Next page</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </ErrorBoundary>
  );
}
