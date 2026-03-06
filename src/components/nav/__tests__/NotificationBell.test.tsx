// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('lucide-react', () => ({
  Bell: () => <svg data-testid="icon-bell" />,
  Check: () => <svg data-testid="icon-check" />,
  ExternalLink: () => <svg data-testid="icon-external" />,
}));

import { NotificationBell } from '../NotificationBell';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('NotificationBell', () => {
  it('stays hidden when auth probe fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });

    render(<NotificationBell />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/user/notifications?limit=1&unread=true');
    });
    expect(screen.queryByRole('button', { name: /Notifications/i })).toBeNull();
  });

  it('loads notifications when opened and marks one as read', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.includes('/api/user/notifications?limit=1&unread=true')) {
        return { ok: true, json: async () => ({ unreadCount: 2 }) } as Response;
      }
      if (url.includes('/api/user/notifications?limit=10')) {
        return {
          ok: true,
          json: async () => ({
            unreadCount: 2,
            results: [
              {
                id: 'n-1',
                event_type: 'submission_assigned',
                title: 'Case assigned',
                body: 'You have a new assignment.',
                action_url: '/submissions/1',
                read_at: null,
                created_at: '2026-02-01T00:00:00.000Z',
              },
            ],
          }),
        } as Response;
      }
      if (url.includes('/api/user/notifications/n-1/read') && method === 'PUT') {
        return { ok: true, json: async () => ({ read: true }) } as Response;
      }
      return { ok: false, status: 500, json: async () => ({}) } as Response;
    });

    render(<NotificationBell />);

    const bellButton = await screen.findByRole('button', { name: 'Notifications (2 unread)' });
    fireEvent.click(bellButton);

    await screen.findByRole('menu', { name: 'Notifications' });
    await screen.findByText('Case assigned');

    fireEvent.click(screen.getByRole('button', { name: 'Mark "Case assigned" as read' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Notifications (1 unread)' })).toBeInTheDocument();
    });
  });

  it('supports mark-all-read and caps badge display at 99+', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.includes('/api/user/notifications?limit=1&unread=true')) {
        return { ok: true, json: async () => ({ unreadCount: 120 }) } as Response;
      }
      if (url.includes('/api/user/notifications?limit=10')) {
        return {
          ok: true,
          json: async () => ({
            unreadCount: 120,
            results: [
              {
                id: 'n-1',
                event_type: 'submission_status_changed',
                title: 'Status changed',
                body: 'Your submission moved status.',
                action_url: null,
                read_at: null,
                created_at: '2026-02-01T00:00:00.000Z',
              },
            ],
          }),
        } as Response;
      }
      if (url.includes('/api/user/notifications/read-all') && method === 'PUT') {
        return { ok: true, json: async () => ({ markedRead: 120 }) } as Response;
      }
      return { ok: false, status: 500, json: async () => ({}) } as Response;
    });

    render(<NotificationBell />);

    const bellButton = await screen.findByRole('button', { name: 'Notifications (120 unread)' });
    expect(screen.getByText('99+')).toBeInTheDocument();

    fireEvent.click(bellButton);
    await screen.findByRole('menu', { name: 'Notifications' });

    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull();
    });
  });

  it('closes on Escape and outside click', async () => {
    const unreadCount = 1;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/user/notifications?limit=1&unread=true')) {
        return { ok: true, json: async () => ({ unreadCount }) } as Response;
      }
      if (url.includes('/api/user/notifications?limit=10')) {
        return {
          ok: true,
          json: async () => ({
            unreadCount,
            results: [
              {
                id: 'n-2',
                event_type: 'submission_comment',
                title: 'Comment received',
                body: 'A reviewer left a comment.',
                action_url: '/submissions/2',
                read_at: null,
                created_at: '2026-02-01T00:00:00.000Z',
              },
            ],
          }),
        } as Response;
      }
      return { ok: false, status: 500, json: async () => ({}) } as Response;
    });

    render(<NotificationBell />);

    const bellButton = await screen.findByRole('button', { name: 'Notifications (1 unread)' });
    fireEvent.click(bellButton);
    await screen.findByRole('menu', { name: 'Notifications' });

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('menu', { name: 'Notifications' })).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Notifications (1 unread)' }));
    await screen.findByRole('menu', { name: 'Notifications' });
    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(screen.queryByRole('menu', { name: 'Notifications' })).toBeNull();
    });
  });

  it('polls unread count every 60 seconds when authenticated', async () => {
    let unreadCount = 1;
    const originalSetInterval = globalThis.setInterval;
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation(
      ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        if (timeout === 60_000 && typeof handler === 'function') {
          unreadCount = 3;
          void handler();
          return 123 as unknown as ReturnType<typeof setInterval>;
        }
        return originalSetInterval(
          handler as Parameters<typeof setInterval>[0],
          timeout as Parameters<typeof setInterval>[1],
          ...(args as Parameters<typeof setInterval>[2][]),
        ) as unknown as ReturnType<typeof setInterval>;
      }) as unknown as typeof setInterval,
    );

    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/user/notifications?limit=1&unread=true')) {
        return { ok: true, json: async () => ({ unreadCount }) } as Response;
      }
      return { ok: true, json: async () => ({ unreadCount, results: [] }) } as Response;
    });

    render(<NotificationBell />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Notifications (3 unread)' })).toBeInTheDocument();
    });
    expect(setIntervalSpy.mock.calls.some(([, ms]) => ms === 60_000)).toBe(true);
    setIntervalSpy.mockRestore();
  });
});
