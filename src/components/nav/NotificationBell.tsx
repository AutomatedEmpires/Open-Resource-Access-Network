/**
 * NotificationBell — Bell icon dropdown for AppNav.
 *
 * Shows unread badge, fetches recent notifications, and provides
 * mark-read + link-to-inbox actions. Only renders for authenticated users.
 */

'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, Check, ExternalLink } from 'lucide-react';

// ============================================================
// TYPES
// ============================================================

interface NotificationItem {
  id: string;
  event_type: string;
  title: string;
  body: string;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
}

// ============================================================
// HELPERS
// ============================================================

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ============================================================
// COMPONENT
// ============================================================

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Check auth by probing the notifications endpoint
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/user/notifications?limit=1&unread=true');
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setIsAuthenticated(true);
          setUnreadCount(data.unreadCount ?? 0);
        }
      } catch {
        // Not authenticated or DB unavailable — hide bell
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Poll unread count every 60s
  useEffect(() => {
    if (!isAuthenticated) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/user/notifications?limit=1&unread=true');
        if (res.ok) {
          const data = await res.json();
          setUnreadCount(data.unreadCount ?? 0);
        }
      } catch {
        // Silently ignore poll failures
      }
    }, 60_000);

    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/user/notifications?limit=10');
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.results ?? []);
        setUnreadCount(data.unreadCount ?? 0);
      }
    } catch {
      // Silently handle
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleOpen = useCallback(() => {
    setOpen((prev) => {
      const willOpen = !prev;
      if (willOpen) {
        void fetchNotifications();
      }
      return willOpen;
    });
  }, [fetchNotifications]);

  const markAllRead = useCallback(async () => {
    try {
      const res = await fetch('/api/user/notifications/read-all', { method: 'PUT' });
      if (res.ok) {
        setUnreadCount(0);
        setNotifications((prev) =>
          prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })),
        );
      }
    } catch {
      // Silently handle
    }
  }, []);

  const markOneRead = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/user/notifications/${id}/read`, { method: 'PUT' });
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) => n.id === id ? { ...n, read_at: new Date().toISOString() } : n),
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch {
      // Silently handle
    }
  }, []);

  if (!isAuthenticated) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={toggleOpen}
        className="relative inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-2 text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            className="absolute right-1 top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-slate-900 px-1 text-[10px] font-bold leading-none text-white"
            aria-hidden="true"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 z-[var(--z-modal)] mt-1 flex max-h-[420px] w-80 flex-col rounded-lg border border-slate-200 bg-white shadow-lg"
          role="menu"
          aria-label="Notifications"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Notifications</h3>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs font-medium text-slate-700 hover:text-slate-900"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="px-4 py-6 text-center text-sm text-slate-400">Loading…</div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-slate-400">
                No notifications yet.
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {notifications.map((n) => (
                  <li
                    key={n.id}
                    className={`px-4 py-3 transition-colors hover:bg-slate-50 ${
                      !n.read_at ? 'bg-slate-50' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${!n.read_at ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                          {n.title}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{n.body}</p>
                        <p className="mt-1 text-[10px] text-slate-400">{timeAgo(n.created_at)}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                        {!n.read_at && (
                          <button
                            type="button"
                            onClick={() => markOneRead(n.id)}
                            className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                            aria-label={`Mark "${n.title}" as read`}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {n.action_url && (
                          <Link
                            href={n.action_url}
                            onClick={() => setOpen(false)}
                            className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                            aria-label={`View ${n.title}`}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-slate-100 px-4 py-2">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="block py-1 text-center text-xs font-medium text-slate-700 hover:text-slate-900"
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
