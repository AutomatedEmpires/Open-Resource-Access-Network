'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Bell, Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { NOTIFICATION_EVENT_TYPES } from '@/domain/constants';
import type { NotificationChannel, NotificationEventType } from '@/domain/types';

// ── Friendly labels for event types ────────────────────────────────
const EVENT_LABELS: Record<NotificationEventType, string> = {
  submission_assigned: 'Submission assigned',
  submission_status_changed: 'Status changed',
  submission_sla_warning: 'SLA warning',
  submission_sla_breach: 'SLA breach',
  submission_escalation_warning: 'Escalation warning',
  scope_grant_requested: 'Scope grant requested',
  scope_grant_decided: 'Scope grant decided',
  scope_grant_revoked: 'Scope grant revoked',
  two_person_approval_needed: 'Two-person approval',
  system_alert: 'System alert',
};

const CHANNELS: { key: NotificationChannel; label: string; Icon: typeof Bell }[] = [
  { key: 'in_app', label: 'In-app', Icon: Bell },
  { key: 'email', label: 'Email', Icon: Mail },
];

interface PrefState {
  eventType: NotificationEventType;
  channel: NotificationChannel;
  enabled: boolean;
}

export default function NotificationPreferencesPanel() {
  const { success: toastSuccess, error: toastError error: toastError } = useToast();

  const [prefs, setPrefs] = useState<PrefState[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // ── Load preferences ──────────────────────────────────────────
  const loadPrefs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/user/notifications/preferences');
      if (!res.ok) throw new Error('Failed to load preferences');
      const data = await res.json() as { preferences: PrefState[] };
      const loaded = data.preferences ?? [];

      // Ensure every event × channel combination exists
      const merged: PrefState[] = [];
      for (const et of NOTIFICATION_EVENT_TYPES) {
        for (const ch of CHANNELS) {
          const existing = loaded.find(
            (p: PrefState) => p.eventType === et && p.channel === ch.key,
          );
          merged.push({
            eventType: et,
            channel: ch.key,
            enabled: existing ? existing.enabled : true,
          });
        }
      }
      setPrefs(merged);
      setDirty(false);
    } catch {
      toastError('Failed to load notification preferences.
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => { void loadPrefs(); }, [loadPrefs]);

  // ── Toggle a single preference ────────────────────────────────
  const toggle = useCallback((eventType: NotificationEventType, channel: NotificationChannel) => {
    setPrefs((prev) =>
      prev.map((p) =>
        p.eventType === eventType && p.channel === channel
          ? { ...p, enabled: !p.enabled }
          : p,
      ),
    );
    setDirty(true);
  }, []);

  // ── Save changes ──────────────────────────────────────────────
  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/user/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: prefs }),
      });
      if (!res.ok) throw new Error('Failed to save preferences');
      setDirty(false);
      toastSuccess('Notification preferences saved.
    } catch {
      toastError('Failed to save notification preferences.
    } finally {
      setSaving(false);
    }
  }, [prefs, toastSuccess, toastError]);

  // ── Render ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        <span className="ml-2 text-sm">Loading preferences…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Bell className="h-4 w-4 text-gray-500" aria-hidden="true" />
          Notification Preferences
        </h3>
        {dirty && (
          <Button type="button" size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" /> : null}
            Save
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs font-medium uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2">Event</th>
              {CHANNELS.map((ch) => (
                <th key={ch.key} className="px-4 py-2 text-center">
                  <span className="inline-flex items-center gap-1">
                    <ch.Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {ch.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {NOTIFICATION_EVENT_TYPES.map((et) => (
              <tr key={et} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-gray-700">{EVENT_LABELS[et]}</td>
                {CHANNELS.map((ch) => {
                  const pref = prefs.find(
                    (p) => p.eventType === et && p.channel === ch.key,
                  );
                  const enabled = pref?.enabled ?? true;
                  return (
                    <td key={ch.key} className="px-4 py-2 text-center">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        aria-label={`${EVENT_LABELS[et]} ${ch.label} ${enabled ? 'enabled' : 'disabled'}`}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          enabled ? 'bg-blue-600' : 'bg-gray-300'
                        }`}
                        onClick={() => toggle(et, ch.key)}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                            enabled ? 'translate-x-4' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
