/**
 * /scopes — Scope Center
 *
 * ORAN admin UI for managing platform scopes, reviewing pending scope grants,
 * and viewing the scope audit log.
 *
 * Three tabs:
 *  1. Scopes — list/create platform scopes
 *  2. Pending Grants — two-person approval queue
 *  3. Audit Log — scope_audit_log entries
 *
 * Wired to:
 *  GET/POST /api/admin/scopes
 *  GET/POST /api/admin/scopes/grants
 *  PUT /api/admin/scopes/grants/[id]
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Shield, RefreshCw, AlertTriangle, Plus,
  ChevronLeft, ChevronRight, CheckCircle2, XCircle,
  Loader2, Key, UserCheck, ScrollText,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormField } from '@/components/ui/form-field';
import { useToast } from '@/components/ui/toast';
import { SkeletonCard } from '@/components/ui/skeleton';
import { formatDate } from '@/lib/format';

// ============================================================
// TYPES
// ============================================================

interface ScopeRow {
  id: string;
  name: string;
  description: string;
  risk_level: string;
  requires_approval: boolean;
  is_active: boolean;
  created_at: string;
}

interface GrantRow {
  id: string;
  user_id: string;
  scope_name: string;
  organization_id: string | null;
  status: string;
  requested_by_user_id: string;
  justification: string;
  created_at: string;
  expires_at: string | null;
}

type ActiveTab = 'scopes' | 'grants' | 'audit';

// ============================================================
// CONSTANTS
// ============================================================

const LIMIT = 20;

const RISK_STYLES: Record<string, { color: string; label: string }> = {
  low:      { color: 'bg-green-100 text-green-800 ring-green-600/20',  label: 'Low' },
  medium:   { color: 'bg-amber-100 text-amber-800 ring-amber-600/20',  label: 'Medium' },
  high:     { color: 'bg-orange-100 text-orange-800 ring-orange-600/20', label: 'High' },
  critical: { color: 'bg-error-muted text-error-deep ring-error-base/20',        label: 'Critical' },
};

const GRANT_STATUS_STYLES: Record<string, { color: string; label: string }> = {
  pending_approval: { color: 'bg-amber-100 text-amber-800 ring-amber-600/20', label: 'Pending' },
  approved:         { color: 'bg-green-100 text-green-800 ring-green-600/20', label: 'Approved' },
  denied:           { color: 'bg-error-muted text-error-deep ring-error-base/20',       label: 'Denied' },
  revoked:          { color: 'bg-gray-100 text-gray-800 ring-gray-600/20',    label: 'Revoked' },
};

// ============================================================
// HELPERS
// ============================================================

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${color}`}>
      {label}
    </span>
  );
}

// ============================================================
// SCOPES TAB
// ============================================================

function ScopesTab() {
  const [scopes, setScopes] = useState<ScopeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const toast = useToast();

  // Create form state
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newRisk, setNewRisk] = useState('medium');
  const [newApproval, setNewApproval] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  const fetchScopes = useCallback(async (p: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
      const res = await fetch(`/api/admin/scopes?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load scopes');
      const json = (await res.json()) as { results: ScopeRow[]; total: number };
      setScopes(json.results);
      setTotal(json.total);
      setPage(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error loading scopes');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void fetchScopes(1); }, [fetchScopes]);

  const handleCreate = useCallback(async () => {
    setIsCreating(true);
    try {
      const res = await fetch('/api/admin/scopes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim(),
          risk_level: newRisk,
          requires_approval: newApproval,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to create scope');
      }
      toast.success('Scope created');
      setShowCreate(false);
      setNewName('');
      setNewDescription('');
      void fetchScopes(1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setIsCreating(false);
    }
  }, [newName, newDescription, newRisk, newApproval, fetchScopes, toast]);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">{total} scope{total !== 1 ? 's' : ''} defined</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void fetchScopes(page)} disabled={isLoading} className="gap-1">
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCreate(!showCreate)} className="gap-1">
            <Plus className="h-4 w-4" aria-hidden="true" />
            New Scope
          </Button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
          <h3 className="font-medium text-gray-900">Create Platform Scope</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField id="scope-name" label="Scope name" hint="Lowercase, alphanumeric, dots/underscores">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. admin.manage_users"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action"
              />
            </FormField>
            <div className="flex gap-3">
              <FormField id="scope-risk" label="Risk level">
                <select
                  value={newRisk}
                  onChange={(e) => setNewRisk(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </FormField>
              <FormField id="scope-approval" label="Requires approval">
                <label className="flex items-center gap-2 mt-1">
                  <input
                    type="checkbox"
                    checked={newApproval}
                    onChange={(e) => setNewApproval(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">Yes</span>
                </label>
              </FormField>
            </div>
          </div>
          <FormField id="scope-desc" label="Description" charCount={newDescription.length} maxChars={2000}>
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action"
              placeholder="What this scope controls..."
              maxLength={2000}
            />
          </FormField>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void handleCreate()} disabled={isCreating || !newName.trim() || !newDescription.trim()} className="gap-1">
              {isCreating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
              Create
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-error-soft bg-error-subtle p-3 text-sm text-error-strong" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      {isLoading && scopes.length === 0 && (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}</div>
      )}

      {!isLoading && scopes.length === 0 && (
        <div className="text-center p-8 text-gray-400">
          <Key className="h-8 w-8 mx-auto mb-2 text-gray-300" aria-hidden="true" />
          <p>No scopes defined yet.</p>
        </div>
      )}

      {scopes.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <caption className="sr-only">Platform scopes with risk levels and approval requirements.</caption>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Scope</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Risk</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Approval</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {scopes.map((s) => {
                const risk = RISK_STYLES[s.risk_level] ?? { color: 'bg-gray-100 text-gray-700', label: s.risk_level };
                return (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-mono text-sm font-medium text-gray-900">{s.name}</p>
                      <p className="text-xs text-gray-500 truncate max-w-xs">{s.description}</p>
                    </td>
                    <td className="px-4 py-3"><Badge label={risk.label} color={risk.color} /></td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${s.requires_approval ? 'text-amber-700' : 'text-gray-500'}`}>
                        {s.requires_approval ? 'Required' : 'Auto'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${s.is_active ? 'text-green-700' : 'text-gray-400'}`}>
                        {s.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{formatDate(s.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {total > LIMIT && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-gray-500">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void fetchScopes(page - 1)} disabled={page <= 1 || isLoading} className="gap-1">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Prev
            </Button>
            <Button variant="outline" size="sm" onClick={() => void fetchScopes(page + 1)} disabled={page >= totalPages || isLoading} className="gap-1">
              Next <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// PENDING GRANTS TAB (Two-Person Approval Queue)
// ============================================================

function GrantsTab() {
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const toast = useToast();

  const fetchGrants = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/scopes/grants');
      if (!res.ok) throw new Error('Failed to load grants');
      const json = (await res.json()) as { results: GrantRow[] };
      setGrants(json.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error loading grants');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void fetchGrants(); }, [fetchGrants]);

  const handleDecision = useCallback(async (grantId: string, decision: 'approved' | 'denied') => {
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/admin/scopes/grants/${grantId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, reason: decisionReason.trim() || 'Reviewed' }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Decision failed');
      }
      toast.success(`Grant ${decision}`);
      setDecidingId(null);
      setDecisionReason('');
      void fetchGrants();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setIsSubmitting(false);
    }
  }, [decisionReason, fetchGrants, toast]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">{grants.length} pending grant{grants.length !== 1 ? 's' : ''}</p>
        <Button variant="outline" size="sm" onClick={() => void fetchGrants()} disabled={isLoading} className="gap-1">
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-error-soft bg-error-subtle p-3 text-sm text-error-strong" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> {error}
        </div>
      )}

      {isLoading && grants.length === 0 && (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}</div>
      )}

      {!isLoading && grants.length === 0 && (
        <div className="text-center p-8 text-gray-400">
          <UserCheck className="h-8 w-8 mx-auto mb-2 text-gray-300" aria-hidden="true" />
          <p>No pending grants awaiting your approval.</p>
        </div>
      )}

      {grants.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <caption className="sr-only">Pending scope grants awaiting two-person approval.</caption>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">User</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Scope</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Requested By</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Justification</th>
                <th scope="col" className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {grants.map((g) => {
                const isDeciding = decidingId === g.id;
                const grantStatus = GRANT_STATUS_STYLES[g.status] ?? { color: 'bg-gray-100 text-gray-700', label: g.status };
                return (
                  <React.Fragment key={g.id}>
                    <tr className={`hover:bg-gray-50 ${isDeciding ? 'bg-indigo-50/50' : ''}`}>
                      <td className="px-4 py-3">
                        <p className="text-gray-900 truncate max-w-[120px]">{g.user_id.slice(0, 12)}…</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs text-gray-800">{g.scope_name}</p>
                        <Badge label={grantStatus.label} color={grantStatus.color} />
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 truncate max-w-[120px]">{g.requested_by_user_id.slice(0, 12)}…</td>
                      <td className="px-4 py-3 text-xs text-gray-600 max-w-[200px] truncate">{g.justification}</td>
                      <td className="px-4 py-3 text-right">
                        {!isDeciding ? (
                          <Button variant="outline" size="sm" onClick={() => setDecidingId(g.id)}>Review</Button>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => { setDecidingId(null); setDecisionReason(''); }}>Cancel</Button>
                        )}
                      </td>
                    </tr>
                    {isDeciding && (
                      <tr>
                        <td colSpan={5} className="px-4 py-4 bg-indigo-50/30 border-t border-indigo-100">
                          <div className="max-w-xl space-y-3">
                            <div className="text-sm">
                              <span className="text-gray-500 font-medium">Justification: </span>
                              <span className="text-gray-700">{g.justification}</span>
                            </div>
                            {g.expires_at && (
                              <p className="text-xs text-gray-500">Expires: {formatDate(g.expires_at)}</p>
                            )}
                            <FormField id={`reason-${g.id}`} label="Decision reason" charCount={decisionReason.length} maxChars={5000}>
                              <textarea
                                value={decisionReason}
                                onChange={(e) => setDecisionReason(e.target.value)}
                                rows={2}
                                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                placeholder="Reason for decision..."
                                maxLength={5000}
                              />
                            </FormField>
                            <div className="flex gap-2">
                              <Button size="sm" onClick={() => void handleDecision(g.id, 'approved')} disabled={isSubmitting || !decisionReason.trim()} className="gap-1 bg-green-600 hover:bg-green-700 text-white">
                                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                                Approve
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => void handleDecision(g.id, 'denied')} disabled={isSubmitting || !decisionReason.trim()} className="gap-1 text-error-base border-error-soft hover:bg-error-subtle">
                                <XCircle className="h-4 w-4" aria-hidden="true" />
                                Deny
                              </Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// AUDIT LOG TAB
// ============================================================

function AuditTab() {
  const [entries, setEntries] = useState<Array<{
    id: string;
    actor_user_id: string;
    action: string;
    target_type: string;
    target_id: string;
    justification: string | null;
    created_at: string;
  }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const res = await fetch('/api/admin/scopes/audit?limit=50');
        if (!res.ok) throw new Error('Failed to load audit log');
        const json = await res.json();
        if (!cancelled) {
          setEntries(json.results ?? []);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-error-soft bg-error-subtle p-3 text-sm text-error-strong" role="alert">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> {error}
        </div>
      )}

      {isLoading && (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}</div>
      )}

      {!isLoading && entries.length === 0 && (
        <div className="text-center p-8 text-gray-400">
          <ScrollText className="h-8 w-8 mx-auto mb-2 text-gray-300" aria-hidden="true" />
          <p>Audit log entries will appear here as scope actions are performed.</p>
          <p className="text-xs mt-1">Scope creation, grant approvals, denials, and revocations are all recorded.</p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <caption className="sr-only">Scope audit log entries showing all scope-related actions.</caption>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Time</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Actor</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Action</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Target</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-gray-600">Justification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{formatDate(e.created_at)}</td>
                  <td className="px-4 py-3 text-xs text-gray-600 truncate max-w-[120px]">{e.actor_user_id.slice(0, 12)}…</td>
                  <td className="px-4 py-3 text-xs font-medium text-gray-800">{e.action}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {e.target_type}: {e.target_id.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 truncate max-w-[200px]">{e.justification ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// PAGE
// ============================================================

function ScopeCenterInner() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('scopes');

  const TABS: { value: ActiveTab; label: string; icon: React.ElementType }[] = [
    { value: 'scopes', label: 'Scopes',         icon: Key },
    { value: 'grants', label: 'Pending Grants',  icon: UserCheck },
    { value: 'audit',  label: 'Audit Log',       icon: ScrollText },
  ];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Shield className="h-6 w-6 text-indigo-600" aria-hidden="true" />
          Scope Center
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Manage platform scopes, review pending scope grants (two-person approval), and view the audit trail.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 mb-6 border-b border-gray-200 pb-px" role="tablist" aria-label="Scope center sections">
        {TABS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            role="tab"
            aria-selected={activeTab === value}
            onClick={() => setActiveTab(value)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === value
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'scopes' && <ScopesTab />}
      {activeTab === 'grants' && <GrantsTab />}
      {activeTab === 'audit'  && <AuditTab />}
    </>
  );
}

export default function ScopeCenterPage() {
  return (
    <ErrorBoundary>
      <ScopeCenterInner />
    </ErrorBoundary>
  );
}
