/**
 * /queue — Verification Queue
 *
 * Lists all verification queue entries with status filters, pagination,
 * and claim-for-review actions. Click-through navigates to /verify?id=…
 * Wired to GET /api/community/queue + POST /api/community/queue (claim).
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ClipboardList, RefreshCw, ChevronLeft, ChevronRight,
  AlertTriangle, UserCheck, Clock, Filter,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { SkeletonCard } from '@/components/ui/skeleton';
import type { VerificationStatus } from '@/domain/types';

// ============================================================
// TYPES
// ============================================================

interface QueueRow {
  id: string;
  service_id: string;
  status: VerificationStatus;
  submitted_by_user_id: string;
  assigned_to_user_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  service_name: string;
  service_status: string;
  organization_id: string;
  organization_name: string;
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

const STATUS_TABS: { value: '' | VerificationStatus; label: string }[] = [
  { value: '',          label: 'All' },
  { value: 'pending',   label: 'Pending' },
  { value: 'in_review', label: 'In Review' },
  { value: 'verified',  label: 'Verified' },
  { value: 'rejected',  label: 'Rejected' },
  { value: 'escalated', label: 'Escalated' },
];

const STATUS_STYLES: Record<VerificationStatus, { color: string; label: string }> = {
  pending:   { color: 'bg-amber-100 text-amber-800 ring-amber-600/20',   label: 'Pending' },
  in_review: { color: 'bg-blue-100 text-blue-800 ring-blue-600/20',      label: 'In Review' },
  verified:  { color: 'bg-green-100 text-green-800 ring-green-600/20',   label: 'Verified' },
  rejected:  { color: 'bg-red-100 text-red-800 ring-red-600/20',         label: 'Rejected' },
  escalated: { color: 'bg-purple-100 text-purple-800 ring-purple-600/20', label: 'Escalated' },
};

// ============================================================
// HELPERS
// ============================================================

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

function StatusBadge({ status }: { status: VerificationStatus }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s.color}`}
    >
      {s.label}
    </span>
  );
}

// ============================================================
// COMPONENT
// ============================================================

export default function QueuePage() {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<'' | VerificationStatus>('');
  const [claimingId, setClaimingId] = useState<string | null>(null);

  // ── Fetch queue entries ──
  const fetchQueue = useCallback(async (p: number, status: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const url = new URL('/api/community/queue', window.location.origin);
      url.searchParams.set('page', String(p));
      url.searchParams.set('limit', String(LIMIT));
      if (status) url.searchParams.set('status', status);

      const res = await fetch(url.toString());
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
          queueEntryId: entryId,
          // Placeholder user ID — will be replaced by auth context
          assignedTo: 'current-user',
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Claim failed');
      }
      void fetchQueue(page, statusFilter);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to claim entry');
    } finally {
      setClaimingId(null);
    }
  }, [page, statusFilter, fetchQueue]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;

  return (
    <ErrorBoundary>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-blue-600" aria-hidden="true" />
            Verification Queue
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Review and act on pending service verification submissions.
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
            onClick={() => { setStatusFilter(value); setPage(1); }}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
              statusFilter === value
                ? 'bg-blue-100 text-blue-800'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 mb-4 text-sm text-red-700" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
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
              ? `No entries with status "${STATUS_STYLES[statusFilter]?.label}".`
              : 'The verification queue is empty.'}
          </p>
        </div>
      )}

      {/* Queue table */}
      {data && data.results.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Service</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Organization</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Submitted</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Assigned</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
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
                        <Link
                          href={`/verify?id=${entry.id}`}
                          className="font-medium text-blue-600 hover:underline"
                        >
                          {entry.service_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {entry.organization_name}
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
                      <td className="px-4 py-3 text-gray-500">
                        {entry.assigned_to_user_id ? (
                          <span className="flex items-center gap-1">
                            <UserCheck className="h-3.5 w-3.5 text-green-600" aria-hidden="true" />
                            <span className="truncate max-w-[120px]">{entry.assigned_to_user_id}</span>
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {entry.status === 'pending' && (
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
              {statusFilter ? ` (${STATUS_STYLES[statusFilter]?.label})` : ''}
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
