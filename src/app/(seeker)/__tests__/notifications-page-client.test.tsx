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

vi.mock('@/components/ui/PageHeader', () => ({
  PageHeader: ({ title, subtitle }: { title: string; subtitle: string }) => (
    <header>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  ),
  PageHeaderBadge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    asChild,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) =>
    asChild ? <>{children}</> : <button {...props}>{children}</button>,
}));

vi.mock('lucide-react', () => ({
  Bell: () => <svg data-testid="icon-bell" />,
  Check: () => <svg data-testid="icon-check" />,
  CheckCheck: () => <svg data-testid="icon-checkcheck" />,
  ExternalLink: () => <svg data-testid="icon-external" />,
  Inbox: () => <svg data-testid="icon-inbox" />,
}));

import NotificationsPageClient from '@/app/(seeker)/notifications/NotificationsPageClient';

type Notification = {
  id: string;
  title: string;
  read_at: string | null;
};

function buildNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n-1',
    title: 'Case assigned',
    read_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('NotificationsPageClient', () => {
  it('shows sign-in shell when notifications endpoint returns 401', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });

    render(<NotificationsPageClient />);

    await screen.findByText('Sign in to view notifications');
    expect(screen.getByRole('link', { name: 'Sign in with Microsoft' })).toHaveAttribute(
      'href',
      '/api/auth/signin?callbackUrl=/notifications',
    );
  });

  it('loads notifications and supports mark-one-read + mark-all-read', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url.includes('/api/user/notifications?') && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              {
                id: 'n-1',
                event_type: 'submission_assigned',
                title: 'Case assigned',
                body: 'A new case is assigned to you.',
                action_url: '/submissions/1',
                read_at: null,
                created_at: '2026-02-01T00:00:00.000Z',
              },
              {
                id: 'n-2',
                event_type: 'submission_comment',
                title: 'Comment posted',
                body: 'A new comment is available.',
                action_url: null,
                read_at: '2026-02-02T00:00:00.000Z',
                created_at: '2026-02-01T00:00:00.000Z',
              },
            ],
            total: 2,
            unreadCount: 2,
            hasMore: false,
          }),
        } as Response;
      }

      if (url.includes('/api/user/notifications/n-1/read') && method === 'PUT') {
        return { ok: true, status: 200, json: async () => ({ read: true }) } as Response;
      }

      if (url.includes('/api/user/notifications/read-all') && method === 'PUT') {
        return { ok: true, status: 200, json: async () => ({ markedRead: 2 }) } as Response;
      }

      return { ok: false, status: 500, json: async () => ({}) } as Response;
    });

    render(<NotificationsPageClient />);

    await screen.findByText('Case assigned');
    expect(screen.getByText('2 unread')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mark “Case assigned” as read' }));

    await waitFor(() => {
      expect(screen.getByText('1 unread')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));

    await waitFor(() => {
      expect(screen.getByText('All caught up')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Mark all read' })).toBeNull();
    });
  });

  it('supports unread filter and shows empty unread state', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('unread=true')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [],
            total: 0,
            unreadCount: 0,
            hasMore: false,
          }),
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              ...buildNotification(),
              event_type: 'submission_assigned',
              body: 'A new case is assigned to you.',
              action_url: '/submissions/1',
              created_at: '2026-02-01T00:00:00.000Z',
            },
          ],
          total: 1,
          unreadCount: 1,
          hasMore: false,
        }),
      } as Response;
    });

    render(<NotificationsPageClient />);

    await screen.findByText('Case assigned');
    fireEvent.click(screen.getByRole('button', { name: 'Unread (1)' }));

    await screen.findByText('No unread notifications.');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('unread=true'));
  });

  it('paginates forward and backward', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes('page=2')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              {
                ...buildNotification({ id: 'n-2', title: 'Page 2 item' }),
                event_type: 'submission_assigned',
                body: 'Second page row',
                action_url: null,
                created_at: '2026-02-01T00:00:00.000Z',
              },
            ],
            total: 21,
            unreadCount: 1,
            hasMore: false,
          }),
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [
            {
              ...buildNotification({ id: 'n-1', title: 'Page 1 item' }),
              event_type: 'submission_assigned',
              body: 'First page row',
              action_url: null,
              created_at: '2026-02-01T00:00:00.000Z',
            },
          ],
          total: 21,
          unreadCount: 1,
          hasMore: true,
        }),
      } as Response;
    });

    render(<NotificationsPageClient />);

    await screen.findByText('Page 1 item');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await screen.findByText('Page 2 item');
    expect(screen.getByText('Page 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));

    await screen.findByText('Page 1 item');
    expect(screen.getByText('Page 1')).toBeInTheDocument();
  });
});
