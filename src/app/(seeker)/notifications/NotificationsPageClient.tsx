/**
 * Notifications Inbox — Client Component.
 *
 * Full-page notification list with pagination, read/unread filtering,
 * mark-read actions, and link-through to related resources.
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, Check, CheckCheck, ExternalLink, Inbox } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';

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

type Filter = 'all' | 'unread';

// ============================================================
// HELPERS
// ============================================================

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ============================================================
// COMPONENT
// ============================================================

export default function NotificationsPageClient() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  const PAGE_SIZE = 20;

  const fetchPage = useCallback(async (p: number, f: Filter) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) });
      if (f === 'unread') params.set('unread', 'true');

      const res = await fetch(`/api/user/notifications?${params}`);
      if (res.status === 401) {
        setIsAuthenticated(false);
        return;
      }
      if (!res.ok) return;

      setIsAuthenticated(true);
      const data = await res.json();
      setNotifications(data.results ?? []);
      setTotal(data.total ?? 0);
      setUnreadCount(data.unreadCount ?? 0);
      setHasMore(data.hasMore ?? false);
      setPage(p);
    } catch {
      // Silently handle network errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPage(1, filter);
  }, [filter, fetchPage]);

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

  // Not authenticated
  if (isAuthenticated === false) {
    return (
      <main className="container mx-auto max-w-2xl px-4 py-12 text-center">
        <Bell className="h-12 w-12 text-gray-300 mx-auto mb-4" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-gray-900 mb-2">Sign in to view notifications</h1>
        <p className="text-sm text-gray-500 mb-4">
          Notifications are only available for authenticated users.
        </p>
        <Button asChild>
          <Link href="/api/auth/signin?callbackUrl=/notifications">Sign in with Microsoft</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-2xl px-4 py-8">
      <PageHeader
        title="Notifications"
        icon={<Bell className="h-6 w-6" aria-hidden="true" />}
        subtitle={unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
      />

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filter === 'all'
                ? 'bg-info-subtle text-action-strong'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            All ({total})
          </button>
          <button
            type="button"
            onClick={() => setFilter('unread')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filter === 'unread'
                ? 'bg-info-subtle text-action-strong'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            Unread ({unreadCount})
          </button>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            className="inline-flex items-center gap-1.5 text-xs text-action-base hover:text-action-deep font-medium"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark all read
          </button>
        )}
      </div>

      {/* List */}
      {loading && isAuthenticated === null ? (
        <div className="text-center py-12 text-sm text-gray-400">Loading notifications…</div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-12">
          <Inbox className="h-10 w-10 text-gray-200 mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm text-gray-400">
            {filter === 'unread' ? 'No unread notifications.' : 'No notifications yet.'}
          </p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 bg-white">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`px-4 py-3 flex items-start gap-3 transition-colors ${
                !n.read_at ? 'bg-info-subtle/30' : ''
              }`}
            >
              {/* Unread dot */}
              <div className="mt-1.5 flex-shrink-0">
                {!n.read_at ? (
                  <span className="block h-2 w-2 rounded-full bg-action" aria-label="Unread" />
                ) : (
                  <span className="block h-2 w-2" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${!n.read_at ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                  {n.title}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{n.body}</p>
                <p className="text-[10px] text-gray-400 mt-1">{formatDate(n.created_at)}</p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                {!n.read_at && (
                  <button
                    type="button"
                    onClick={() => markOneRead(n.id)}
                    className="p-1.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600"
                    aria-label={`Mark "${n.title}" as read`}
                  >
                    <Check className="h-4 w-4" />
                  </button>
                )}
                {n.action_url && (
                  <Link
                    href={n.action_url}
                    className="p-1.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600"
                    aria-label={`View ${n.title}`}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {(page > 1 || hasMore) && (
        <div className="flex items-center justify-between mt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => fetchPage(page - 1, filter)}
          >
            Previous
          </Button>
          <span className="text-xs text-gray-400">Page {page}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasMore}
            onClick={() => fetchPage(page + 1, filter)}
          >
            Next
          </Button>
        </div>
      )}
    </main>
  );
}
