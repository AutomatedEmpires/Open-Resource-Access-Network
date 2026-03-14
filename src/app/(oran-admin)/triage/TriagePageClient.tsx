/**
 * /triage — Queue Triage with Anomaly Prioritization
 *
 * ORAN admin dashboard for reviewing prioritized queues.
 * Shows per-queue summary + a sortable/filterable table of entries
 * ordered by deterministic triage_priority score.
 *
 * Wired to:
 *   GET /api/admin/triage/summary
 *   GET /api/admin/triage?queue_type=...
 *   POST /api/admin/triage (trigger re-score)
 *   POST /api/admin/triage/[id] (re-score single)
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, RefreshCw, ChevronLeft, ChevronRight,
  Loader2, ShieldAlert, ListFilter, Info,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormAlert } from '@/components/ui/form-alert';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/status-badge';
import { SkeletonCard } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { formatDate } from '@/lib/format';
import {
  QUEUE_TYPES,
  QUEUE_TYPE_LABELS,
  HIGH_PRIORITY_THRESHOLD,
  CRITICAL_PRIORITY_THRESHOLD,
  type QueueType,
  type TriageQueueEntry,
  type TriageQueueSummary,
} from '@/domain/triage';
import type { StatusStyle } from '@/domain/status-styles';

// ============================================================
// TYPES
// ============================================================

interface TriageListResponse {
  entries:    TriageQueueEntry[];
  total:      number;
  queue_type: QueueType;
}

interface SummaryResponse {
  summary: TriageQueueSummary[];
}

// ============================================================
// CONSTANTS
// ============================================================

const LIMIT = 25;

const PRIORITY_BADGE_STYLES: Record<string, StatusStyle> = {
  critical:    { color: 'bg-red-100 text-red-800 ring-red-600/20',       label: 'Critical'  },
  high:        { color: 'bg-orange-100 text-orange-800 ring-orange-600/20', label: 'High'   },
  normal:      { color: 'bg-gray-100 text-gray-700 ring-gray-500/20',    label: 'Normal'    },
};

function priorityKey(p: number): string {
  if (p >= CRITICAL_PRIORITY_THRESHOLD) return 'critical';
  if (p >= HIGH_PRIORITY_THRESHOLD) return 'high';
  return 'normal';
}

// ============================================================
// SUMMARY CARD
// ============================================================

function SummaryCard({ queue }: { queue: TriageQueueSummary }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        {queue.label}
      </span>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-bold text-gray-900">{queue.total}</span>
        <span className="text-xs text-gray-400 mb-0.5">items</span>
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-600 flex-wrap">
        {queue.critical > 0 && (
          <span className="flex items-center gap-0.5 text-red-600 font-medium">
            <ShieldAlert className="h-3 w-3" aria-hidden="true" />
            {queue.critical} critical
          </span>
        )}
        {queue.high_priority > 0 && (
          <span className="text-orange-600">{queue.high_priority} high</span>
        )}
        {queue.avg_priority != null && (
          <span className="text-gray-400 ml-auto">
            avg {queue.avg_priority.toFixed(0)}
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================================
// MAIN PAGE (INNER)
// ============================================================

function TriagePageInner() {
  const { toast } = useToast();
  const [summary, setSummary] = useState<TriageQueueSummary[] | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [activeQueue, setActiveQueue] = useState<QueueType>('pending_verification');
  const [data, setData] = useState<TriageListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [isRescoring, setIsRescoring] = useState(false);
  const [rescoringId, setRescoringId] = useState<string | null>(null);

  // Fetch summary once
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/admin/triage/summary');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as SummaryResponse;
        setSummary(json.summary);
      } catch (err) {
        setSummaryError(err instanceof Error ? err.message : 'Failed to load summary.');
      }
    })();
  }, []);

  const fetchQueue = useCallback(
    async (queue: QueueType, p: number) => {
      setIsLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          queue_type: queue,
          limit:      String(LIMIT),
          offset:     String((p - 1) * LIMIT),
        });
        const res = await fetch(`/api/admin/triage?${qs.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as TriageListResponse;
        setData(json);
        setPage(p);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load queue.');
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void fetchQueue(activeQueue, 1);
  }, [fetchQueue, activeQueue]);

  const handleRescore = async () => {
    setIsRescoring(true);
    try {
      const res = await fetch('/api/admin/triage', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { scored: number };
      toast('success', `Re-scored ${json.scored} submission${json.scored !== 1 ? 's' : ''}.`);
      void fetchQueue(activeQueue, page);
    } catch {
      toast('error', 'Failed to run triage scoring.');
    } finally {
      setIsRescoring(false);
    }
  };

  const handleRescoreOne = async (submissionId: string) => {
    setRescoringId(submissionId);
    try {
      const res = await fetch(`/api/admin/triage/${submissionId}`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast('success', 'Score refreshed.');
      void fetchQueue(activeQueue, page);
    } catch {
      toast('error', 'Failed to rescore submission.');
    } finally {
      setRescoringId(null);
    }
  };

  const totalPages = data ? Math.ceil(data.total / LIMIT) : 0;

  return (
    <>
      <PageHeader
        eyebrow="ORAN Admin"
        title="Triage Queue"
        icon={<ListFilter className="h-6 w-6 text-action-base" aria-hidden="true" />}
        subtitle="Review prioritized queues, anomaly signals, and re-score pending submissions when needed."
        badges={
          <>
            <PageHeaderBadge tone="trust">Priority signals stay deterministic</PageHeaderBadge>
            <PageHeaderBadge tone="accent">Active queue: {QUEUE_TYPE_LABELS[activeQueue]}</PageHeaderBadge>
            <PageHeaderBadge>{data ? `${data.total} queued items` : 'Loading triage queue'}</PageHeaderBadge>
          </>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleRescore()}
            disabled={isRescoring}
            className="gap-1"
            aria-label="Re-score all pending submissions"
          >
            {isRescoring
              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              : <RefreshCw className="h-4 w-4" aria-hidden="true" />
            }
            Re-score All
          </Button>
        }
      />

      {/* Summary cards */}
      {summaryError && (
        <FormAlert variant="warning" message={`Could not load summary: ${summaryError}`} className="mb-4" />
      )}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
          {summary.map((q) => (
            <button
              key={q.queue_type}
              onClick={() => setActiveQueue(q.queue_type)}
              className={`text-left rounded-xl border transition-all ${
                activeQueue === q.queue_type
                  ? 'border-action ring-2 ring-action/20'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <SummaryCard queue={q} />
            </button>
          ))}
        </div>
      )}

      {/* Queue tab strip */}
      <div
        role="tablist"
        aria-label="Queue types"
        className="flex items-center gap-1 mb-4 flex-wrap border-b border-gray-200 pb-3"
      >
        {QUEUE_TYPES.map((qt) => (
          <button
            key={qt}
            role="tab"
            aria-selected={activeQueue === qt}
            onClick={() => setActiveQueue(qt)}
            className={`inline-flex min-h-[44px] items-center px-3 rounded-lg text-sm font-medium transition-colors ${
              activeQueue === qt
                ? 'bg-action text-white shadow-sm'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {QUEUE_TYPE_LABELS[qt]}
          </button>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <div className="space-y-2 mb-4">
          <FormAlert variant="error" message={error} />
          <Button size="sm" variant="outline" onClick={() => void fetchQueue(activeQueue, page)}>
            Retry
          </Button>
        </div>
      )}

      {/* Loading */}
      {isLoading && !data && (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Empty */}
      {!isLoading && data?.entries.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <AlertTriangle className="h-10 w-10 mx-auto mb-3 opacity-20" aria-hidden="true" />
          <p className="font-medium">No items in this queue.</p>
          <p className="text-sm mt-1">All items have been reviewed or none are actionable.</p>
        </div>
      )}

      {/* Table */}
      {data && data.entries.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm" aria-label={`${QUEUE_TYPE_LABELS[activeQueue]} triage queue`}>
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600 w-1/3">Submission</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Priority</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Why Prioritized</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Age</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.entries.map((entry) => (
                <tr
                  key={entry.submission_id}
                  className={`hover:bg-gray-50 transition-colors ${
                    entry.triage_priority >= CRITICAL_PRIORITY_THRESHOLD ? 'bg-red-50/30' : ''
                  }`}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 truncate max-w-[220px]">
                      {entry.title ?? entry.service_name ?? entry.submission_id.slice(0, 8) + '…'}
                    </div>
                    {entry.sla_breached && (
                      <span className="inline-flex items-center gap-0.5 text-xs text-red-600 font-medium mt-0.5">
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        SLA breached
                      </span>
                    )}
                    {entry.sla_deadline && !entry.sla_breached && (
                      <div className="text-xs text-gray-400 mt-0.5">
                        Due {formatDate(entry.sla_deadline)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 capitalize whitespace-nowrap">
                    {entry.submission_type.replace(/_/g, ' ')}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={entry.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusBadge
                        status={priorityKey(entry.triage_priority)}
                        overrides={PRIORITY_BADGE_STYLES}
                      />
                      <span className="text-xs font-mono text-gray-500">
                        {entry.triage_priority.toFixed(0)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 max-w-[200px]">
                    {entry.triage_explanations.length > 0 ? (
                      <ul className="space-y-0.5">
                        {entry.triage_explanations.slice(0, 3).map((exp, i) => (
                          <li key={i} className="flex items-start gap-1 text-xs text-gray-600">
                            <Info className="h-3 w-3 shrink-0 mt-0.5 text-gray-400" aria-hidden="true" />
                            {exp}
                          </li>
                        ))}
                        {entry.triage_explanations.length > 3 && (
                          <li className="text-xs text-gray-400 pl-4">
                            +{entry.triage_explanations.length - 3} more
                          </li>
                        )}
                      </ul>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {formatDate(entry.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => void handleRescoreOne(entry.submission_id)}
                        disabled={rescoringId === entry.submission_id}
                        title="Re-score this submission"
                        className="p-1.5 rounded text-gray-500 hover:text-action hover:bg-action/10 transition-colors disabled:opacity-40"
                        aria-label={`Re-score submission ${entry.submission_id}`}
                      >
                        {rescoringId === entry.submission_id
                          ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          : <RefreshCw className="h-4 w-4" aria-hidden="true" />
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
              onClick={() => void fetchQueue(activeQueue, page - 1)}
              disabled={page <= 1 || isLoading}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchQueue(activeQueue, page + 1)}
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

export default function TriagePageClient() {
  return (
    <ErrorBoundary>
      <TriagePageInner />
    </ErrorBoundary>
  );
}
