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
import { FormSection } from '@/components/ui/form-section';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
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
      <main className="min-h-screen bg-white">
        <div className="container mx-auto max-w-3xl px-4 py-8 md:py-10">
        <section className="rounded-[30px] border border-slate-200 bg-white p-6 text-center shadow-sm md:p-8">
        <PageHeader
          eyebrow="Account activity"
          title="Notifications"
          subtitle="Your notification inbox is private to your authenticated seeker account."
          badges={(
            <>
              <PageHeaderBadge tone="trust">Private inbox</PageHeaderBadge>
              <PageHeaderBadge tone="accent">Account required</PageHeaderBadge>
            </>
          )}
        />
        <Bell className="mx-auto mb-4 h-12 w-12 text-slate-300" aria-hidden="true" />
        <h1 className="mb-2 text-lg font-semibold text-stone-900">Sign in to view notifications</h1>
        <p className="mb-4 text-sm text-stone-500">
          Notifications are only available for authenticated users.
        </p>
        <Button asChild>
          <Link href="/api/auth/signin?callbackUrl=/notifications">Sign in with Microsoft</Link>
        </Button>
        </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white">
      <div className="container mx-auto max-w-3xl px-4 py-6 md:py-8">
      <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-sm md:p-8">
      <PageHeader
        eyebrow="Account activity"
        title="Notifications"
        icon={<Bell className="h-6 w-6" aria-hidden="true" />}
        subtitle={unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
        badges={(
          <>
            <PageHeaderBadge tone="trust">Private inbox</PageHeaderBadge>
            <PageHeaderBadge tone="accent">Verified workflow links only</PageHeaderBadge>
            <PageHeaderBadge>{unreadCount > 0 ? `${unreadCount} unread` : 'Up to date'}</PageHeaderBadge>
          </>
        )}
      />

      <FormSection
        title="Inbox"
        description="Notifications route you back to authenticated workflows and never expose profile details publicly."
      >
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex gap-2" role="group" aria-label="Filter notifications">
            <button
              type="button"
              onClick={() => setFilter('all')}
              aria-pressed={filter === 'all'}
              className={`inline-flex min-h-[44px] items-center rounded-full px-3 text-sm font-medium transition-colors ${
                filter === 'all'
                    ? 'border border-slate-900 bg-slate-900 text-white'
                    : 'text-stone-600 hover:bg-slate-50'
              }`}
            >
              All ({total})
            </button>
            <button
              type="button"
              onClick={() => setFilter('unread')}
              aria-pressed={filter === 'unread'}
              className={`inline-flex min-h-[44px] items-center rounded-full px-3 text-sm font-medium transition-colors ${
                filter === 'unread'
                    ? 'border border-slate-900 bg-slate-900 text-white'
                    : 'text-stone-600 hover:bg-slate-50'
              }`}
            >
              Unread ({unreadCount})
            </button>
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="inline-flex min-h-[44px] items-center gap-1.5 px-2 text-xs font-medium text-slate-700 hover:text-slate-900"
            >
              <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Mark all read
            </button>
          )}
        </div>

        <div aria-live="polite" aria-atomic="false">
        {loading && isAuthenticated === null ? (
          <div role="status" className="py-12 text-center text-sm text-stone-400">Loading notifications…</div>
        ) : notifications.length === 0 ? (
          <div role="status" className="text-center py-12">
            <Inbox className="mx-auto mb-3 h-10 w-10 text-slate-300" aria-hidden="true" />
            <p className="text-sm text-stone-400">
              {filter === 'unread' ? 'No unread notifications.' : 'No notifications yet.'}
            </p>
          </div>
        ) : (
          <div
            className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm divide-y divide-slate-200"
            aria-label="Notifications list"
          >
            {notifications.map((n) => (
              <div
                key={n.id}
                className={`px-4 py-3 flex items-start gap-3 transition-colors ${
                  !n.read_at ? 'bg-slate-50' : ''
                }`}
              >
                <div className="mt-1.5 flex-shrink-0" aria-hidden="true">
                  {!n.read_at ? (
                    <span className="block h-2 w-2 rounded-full bg-slate-900" />
                  ) : (
                    <span className="block h-2 w-2" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${!n.read_at ? 'font-semibold text-stone-900' : 'text-stone-700'}`}>
                    {n.title}
                  </p>
                  <p className="mt-0.5 text-xs text-stone-500">{n.body}</p>
                  <p className="mt-1 text-[10px] text-stone-400">{formatDate(n.created_at)}</p>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  {!n.read_at && (
                    <button
                      type="button"
                      onClick={() => markOneRead(n.id)}
                      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-stone-400 hover:bg-slate-100 hover:text-stone-600"
                      aria-label={`Mark \u201c${n.title}\u201d as read`}
                    >
                      <Check className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                  {n.action_url && (
                    <Link
                      href={n.action_url}
                      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-stone-400 hover:bg-slate-100 hover:text-stone-600"
                      aria-label={`View ${n.title}`}
                    >
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        </div>

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
            <span className="text-xs text-stone-400">Page {page}</span>
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
      </FormSection>
      </section>
      </div>
    </main>
  );
}
