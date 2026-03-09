/**
 * /rules — System Rules & Feature Flags
 *
 * ORAN admin view to manage feature flags and rollout percentages.
 * Wired to GET/PUT /api/admin/rules.
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Settings, RefreshCw, AlertTriangle,
  ToggleLeft, ToggleRight, Gauge,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormAlert } from '@/components/ui/form-alert';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { SkeletonCard } from '@/components/ui/skeleton';

// ============================================================
// TYPES
// ============================================================

interface FlagData {
  name: string;
  enabled: boolean;
  rolloutPct: number;
}

// ============================================================
// PAGE
// ============================================================

function RulesPageInner() {
  const [flags, setFlags] = useState<FlagData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editing state: which flag is being edited, and its draft values
  const [editingFlag, setEditingFlag] = useState<string | null>(null);
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [draftRollout, setDraftRollout] = useState(100);
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // ── Fetch flags ──
  const fetchFlags = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/rules');
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to load flags');
      }
      const json = (await res.json()) as { flags: FlagData[] };
      setFlags(json.flags);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load flags');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFlags();
  }, [fetchFlags]);

  // ── Start editing ──
  const startEditing = useCallback((flag: FlagData) => {
    setEditingFlag(flag.name);
    setDraftEnabled(flag.enabled);
    setDraftRollout(flag.rolloutPct);
    setSaveResult(null);
  }, []);

  // ── Save flag changes ──
  const handleSave = useCallback(async () => {
    if (!editingFlag) return;
    setIsSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch('/api/admin/rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingFlag,
          enabled: draftEnabled,
          rolloutPct: draftRollout,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Save failed');
      }
      const json = (await res.json()) as { message: string };
      setSaveResult({ success: true, message: json.message });
      setEditingFlag(null);
      void fetchFlags();
    } catch (e) {
      setSaveResult({ success: false, message: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setIsSaving(false);
    }
  }, [editingFlag, draftEnabled, draftRollout, fetchFlags]);

  return (
    <>
      <PageHeader
        eyebrow="ORAN Admin"
        title="System Rules & Feature Flags"
        icon={<Settings className="h-6 w-6 text-action-base" aria-hidden="true" />}
        subtitle="Configure feature flags and staged rollout percentages for platform features."
        badges={
          <>
            <PageHeaderBadge tone="trust">Flag changes affect platform behavior immediately</PageHeaderBadge>
            <PageHeaderBadge tone="accent">Rollouts stay explicit and reviewable</PageHeaderBadge>
            <PageHeaderBadge>{flags.length > 0 ? `${flags.length} flags` : 'No flags loaded yet'}</PageHeaderBadge>
          </>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => void fetchFlags()}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {/* Save result */}
      {saveResult && (
        <FormAlert
          variant={saveResult.success ? 'success' : 'error'}
          message={saveResult.message}
          onDismiss={() => setSaveResult(null)}
          className="mb-4"
        />
      )}

      {/* Error state */}
      {error && (
        <FormAlert variant="error" message={error} onDismiss={() => setError(null)} className="mb-4" />
      )}

      {/* Loading state */}
      {isLoading && flags.length === 0 && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && flags.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-gray-200 bg-white p-12 text-center">
          <Settings className="h-10 w-10 text-gray-300 mb-3" aria-hidden="true" />
          <p className="text-gray-500 font-medium">No feature flags configured</p>
          <p className="text-gray-400 text-sm mt-1">
            Feature flags will appear here once created.
          </p>
        </div>
      )}

      {/* Flag cards */}
      {flags.length > 0 && (
        <div className="space-y-3">
          {flags.map((flag) => {
            const isEditing = editingFlag === flag.name;
            return (
              <div
                key={flag.name}
                className={`bg-white rounded-lg border p-4 transition-colors ${
                  isEditing ? 'border-action-pale ring-1 ring-info-muted' : 'border-gray-200'
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  {/* Flag info */}
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {flag.enabled ? (
                      <ToggleRight className="h-5 w-5 text-green-600 shrink-0" aria-hidden="true" />
                    ) : (
                      <ToggleLeft className="h-5 w-5 text-gray-400 shrink-0" aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{flag.name}</p>
                      <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                        <span className={`inline-flex items-center gap-1 ${flag.enabled ? 'text-green-700' : 'text-gray-400'}`}>
                          {flag.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Gauge className="h-3 w-3" aria-hidden="true" />
                          {flag.rolloutPct}% rollout
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  {!isEditing && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => startEditing(flag)}
                    >
                      Edit
                    </Button>
                  )}
                </div>

                {/* Edit panel */}
                {isEditing && (
                  <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
                    {/* Enabled toggle */}
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={draftEnabled}
                        aria-label={`Toggle ${flag.name}`}
                        onClick={() => setDraftEnabled(!draftEnabled)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 ${
                          draftEnabled ? 'bg-action-base' : 'bg-gray-200'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${
                            draftEnabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                      <span className="text-sm text-gray-700">
                        {draftEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>

                    {/* Rollout slider */}
                    <div>
                      <label htmlFor={`rollout-${flag.name}`} className="block text-sm font-medium text-gray-700 mb-1">
                        Rollout percentage
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          id={`rollout-${flag.name}`}
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={draftRollout}
                          onChange={(e) => setDraftRollout(Number(e.target.value))}
                          className="flex-1 accent-blue-600"
                        />
                        <span className="text-sm font-mono text-gray-700 w-12 text-right">
                          {draftRollout}%
                        </span>
                      </div>
                    </div>

                    {/* Edit actions */}
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => setConfirmOpen(true)}
                        disabled={isSaving}
                        className="gap-1"
                      >
                        {isSaving ? 'Saving...' : 'Save Changes'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingFlag(null)}
                        disabled={isSaving}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmation dialog before saving production flag changes */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              Confirm Flag Change
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-700 mt-2">
            You are about to change{' '}
            <span className="font-mono font-medium">{editingFlag}</span> to{' '}
            <span className="font-medium">{draftEnabled ? 'enabled' : 'disabled'}</span> at{' '}
            <span className="font-medium">{draftRollout}%</span> rollout.
          </p>
          <p className="text-sm text-error-strong font-medium mt-1">
            This change takes effect in production immediately.
          </p>
          <DialogFooter className="mt-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmOpen(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => { setConfirmOpen(false); void handleSave(); }}
              disabled={isSaving}
              className="bg-amber-600 hover:bg-amber-700 text-white gap-1"
            >
              {isSaving ? 'Saving...' : 'Confirm Change'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function RulesPage() {
  return (
    <ErrorBoundary>
      <RulesPageInner />
    </ErrorBoundary>
  );
}
