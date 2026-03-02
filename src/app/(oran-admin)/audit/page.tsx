/**
 * /audit — Audit Log
 *
 * ORAN admin view of the full system audit trail.
 * Wired to GET /api/admin/audit.
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollText, RefreshCw, AlertTriangle,
  ChevronLeft, ChevronRight, Filter,
  ChevronDown, ChevronUp, Clock, Database,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { SkeletonCard } from '@/components/ui/skeleton';

// ============================================================
// TYPES
// ============================================================

const AUDIT_ACTIONS = [
  'create', 'update', 'delete',
  'approve', 'deny', 'escalate',
  'login', 'logout',
  'flag_change',
] as const;

type AuditAction = typeof AUDIT_ACTIONS[number];

interface AuditRow {
  id: string;
  action: AuditAction;
  table_name: string;
  record_id: string;
  user_id: string | null;
  old_data: string | null;
  new_data: string | null;
  ip_address: string | null;
  created_at: string;
}

interface AuditResponse {
  results: AuditRow[];
  total: number;
  page: number;
  hasMore: boolean;
}

// ============================================================
// CONSTANTS
// ============================================================

const LIMIT = 25;

const ACTION_STYLES: Record<AuditAction, { color: string; label: string }> = {
  create:      { color: 'bg-green-100 text-green-800',  label: 'Create' },
  update:      { color: 'bg-blue-100 text-blue-800',    label: 'Update' },
  delete:      { color: 'bg-red-100 text-red-800',      label: 'Delete' },
  approve:     { color: 'bg-emerald-100 text-emerald-800', label: 'Approve' },
  deny:        { color: 'bg-orange-100 text-orange-800', label: 'Deny' },
  escalate:    { color: 'bg-purple-100 text-purple-800', label: 'Escalate' },
  login:       { color: 'bg-sky-100 text-sky-800',      label: 'Login' },
  logout:      { color: 'bg-gray-100 text-gray-700',    label: 'Logout' },
  flag_change: { color: 'bg-amber-100 text-amber-800',  label: 'Flag Change' },
};

// ============================================================
// HELPERS
// ============================================================

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function ActionBadge({ action }: { action: AuditAction }) {
  const s = ACTION_STYLES[action] ?? ACTION_STYLES.update;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.color}`}>
      {s.label}
    </span>
  );
}

function tryParseJson(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ============================================================
// PAGE
// ============================================================

function AuditPageInner() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // Filters
  const [actionFilter, setActionFilter] = useState<'' | AuditAction>('');
  const [tableFilter, setTableFilter] = useState('');

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── Fetch logs ──
  const fetchLogs = useCallback(async (p: number, action: string, tableName: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const url = new URL('/api/admin/audit', window.location.origin);
      url.searchParams.set('page', String(p));
      url.searchParams.set('limit', String(LIMIT));
      if (action) url.searchParams.set('action', action);
      if (tableName) url.searchParams.set('tableName', tableName);

      const res = await fetch(url.toString());
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to load audit log');
      }
      const json = (await res.json()) as AuditResponse;
      setData(json);
      setPage(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit log');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLogs(1, actionFilter, tableFilter);
  }, [fetchLogs, actionFilter, tableFilter]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ScrollText className="h-6 w-6 text-blue-600" aria-hidden="true" />
            Audit Log
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Full system audit trail for all write operations.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => void fetchLogs(page, actionFilter, tableFilter)}
          disabled={isLoading}
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1">
          <Filter className="h-4 w-4 text-gray-400 shrink-0" aria-hidden="true" />
          <label htmlFor="action-filter" className="text-sm text-gray-500 sr-only">Action filter</label>
          <select
            id="action-filter"
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value as '' | AuditAction); setPage(1); }}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All actions</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>{ACTION_STYLES[a].label}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1">
          <Database className="h-4 w-4 text-gray-400 shrink-0" aria-hidden="true" />
          <label htmlFor="table-filter" className="text-sm text-gray-500 sr-only">Table filter</label>
          <input
            id="table-filter"
            type="text"
            value={tableFilter}
            onChange={(e) => { setTableFilter(e.target.value); setPage(1); }}
            placeholder="Filter by table..."
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-40"
            maxLength={100}
          />
        </div>

        {(actionFilter || tableFilter) && (
          <button
            type="button"
            onClick={() => { setActionFilter(''); setTableFilter(''); setPage(1); }}
            className="text-xs text-blue-600 hover:underline"
          >
            Clear filters
          </button>
        )}
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
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && data && data.results.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-gray-200 bg-white p-12 text-center">
          <ScrollText className="h-10 w-10 text-gray-300 mb-3" aria-hidden="true" />
          <p className="text-gray-500 font-medium">No audit entries found</p>
          <p className="text-gray-400 text-sm mt-1">
            {actionFilter || tableFilter
              ? 'No entries match the current filters.'
              : 'The audit log is empty.'}
          </p>
        </div>
      )}

      {/* Audit table */}
      {data && data.results.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left font-medium text-gray-600 w-8" />
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Action</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Table</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Record ID</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.results.map((row) => {
                  const isExpanded = expandedId === row.id;
                  const oldObj = tryParseJson(row.old_data);
                  const newObj = tryParseJson(row.new_data);
                  const hasDetails = oldObj || newObj;

                  return (
                    <React.Fragment key={row.id}>
                      <tr
                        className={`hover:bg-gray-50 ${hasDetails ? 'cursor-pointer' : ''} ${isExpanded ? 'bg-blue-50/30' : ''}`}
                        onClick={() => hasDetails && setExpandedId(isExpanded ? null : row.id)}
                      >
                        <td className="px-4 py-3">
                          {hasDetails && (
                            isExpanded
                              ? <ChevronUp className="h-4 w-4 text-gray-400" aria-hidden="true" />
                              : <ChevronDown className="h-4 w-4 text-gray-400" aria-hidden="true" />
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <ActionBadge action={row.action} />
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-700">
                          {row.table_name}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500 truncate max-w-[180px]">
                          {row.record_id}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3 text-gray-400" aria-hidden="true" />
                            {formatTimestamp(row.created_at)}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded details */}
                      {isExpanded && hasDetails && (
                        <tr>
                          <td colSpan={5} className="px-4 py-4 bg-gray-50/50 border-t border-gray-100">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
                              {oldObj && (
                                <div>
                                  <p className="text-xs font-medium text-gray-500 mb-1">Previous Data</p>
                                  <pre className="bg-white border border-gray-200 rounded-md p-3 text-xs text-gray-700 overflow-auto max-h-48 whitespace-pre-wrap">
                                    {JSON.stringify(oldObj, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {newObj && (
                                <div>
                                  <p className="text-xs font-medium text-gray-500 mb-1">New Data</p>
                                  <pre className="bg-white border border-gray-200 rounded-md p-3 text-xs text-gray-700 overflow-auto max-h-48 whitespace-pre-wrap">
                                    {JSON.stringify(newObj, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                            {row.user_id && (
                              <p className="mt-2 text-xs text-gray-400">
                                User: <span className="font-mono">{row.user_id}</span>
                                {row.ip_address ? ` · IP: ${row.ip_address}` : ''}
                              </p>
                            )}
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
              onClick={() => void fetchLogs(page - 1, actionFilter, tableFilter)}
              disabled={page <= 1 || isLoading}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchLogs(page + 1, actionFilter, tableFilter)}
              disabled={!data.hasMore || isLoading}
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

export default function AuditPage() {
  return (
    <ErrorBoundary>
      <AuditPageInner />
    </ErrorBoundary>
  );
}
