// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());
const searchParamGetMock = vi.hoisted(() => vi.fn());
const sessionState = vi.hoisted(() => ({
  data: { user: { name: 'Test', email: 'test@example.com' } } as { user: { name: string; email: string } } | null,
  status: 'authenticated' as string,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: searchParamGetMock,
  }),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@/components/ui/PageHeader', () => ({
  PageHeader: ({
    title,
    subtitle,
  }: {
    title: string;
    subtitle?: string;
  }) => (
    <div>
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  ),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => sessionState,
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import AppealPageContent from '@/app/(seeker)/appeal/AppealPageClient';

function makeAppeal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appeal-1',
    status: 'submitted',
    title: 'My prior appeal',
    notes: 'Please re-check this denial',
    reviewer_notes: null,
    created_at: '2026-01-05T00:00:00.000Z',
    updated_at: '2026-01-05T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  sessionState.data = { user: { name: 'Test', email: 'test@example.com' } };
  sessionState.status = 'authenticated';
  searchParamGetMock.mockImplementation((key: string) => (key === 'submissionId' ? '11111111-1111-4111-8111-111111111111' : null));
});

describe('AppealPageClient', () => {
  it('renders sign-in required shell for unauthenticated users', async () => {
    sessionState.data = null;
    sessionState.status = 'unauthenticated';
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ appeals: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ submissions: [] }) });

    render(<AppealPageContent />);

    await screen.findByText('Sign in required');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/api/auth/signin');
  });

  it('loads and renders existing appeals', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ appeals: [makeAppeal()] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ submissions: [] }) });

    render(<AppealPageContent />);

    await screen.findByText('My prior appeal');
    expect(fetchMock).toHaveBeenCalledWith('/api/submissions/appeal');
    expect(screen.getByRole('button', { name: 'Submit Appeal' })).toBeDisabled();
  });

  it('submits an appeal and refreshes the appeals list', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ appeals: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ submissions: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ appealId: 'new-appeal' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ appeals: [makeAppeal({ id: 'new-appeal', title: 'New appeal' })] }) });

    render(<AppealPageContent />);
    await screen.findByText('No appeals found.');

    fireEvent.change(screen.getByLabelText('Reason for appeal'), {
      target: { value: 'This denial should be reconsidered with new documentation.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Appeal' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/submissions/appeal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId: '11111111-1111-4111-8111-111111111111',
          reason: 'This denial should be reconsidered with new documentation.',
        }),
      });
      expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/submissions/appeal');
      expect(screen.getByText('Appeal submitted')).toBeInTheDocument();
      expect(screen.getByText('New appeal')).toBeInTheDocument();
    });
  });

  it('shows API errors for failed submissions', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ appeals: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ submissions: [] }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Appeal is not eligible' }) });

    render(<AppealPageContent />);
    await screen.findByText('No appeals found.');

    fireEvent.change(screen.getByLabelText('Reason for appeal'), {
      target: { value: 'Sufficient reason text to trigger submit.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Appeal' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Appeal is not eligible');
    });
  });

  it('disables submission when no submissionId query param is present', async () => {
    searchParamGetMock.mockImplementation(() => null);
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ appeals: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ submissions: [] }) });

    render(<AppealPageContent />);

    await screen.findByText('No appeals found.');
    expect(screen.getByRole('button', { name: 'Submit Appeal' })).toBeDisabled();
  });

  it('renders denied picker and submits only non-empty evidence rows', async () => {
    searchParamGetMock.mockImplementation(() => null);
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ appeals: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          submissions: [
            {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              title: 'Denied Listing',
              submission_type: 'new_service',
              created_at: '2026-01-02T00:00:00.000Z',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ appealId: 'appeal-with-evidence' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ appeals: [] }) });

    render(<AppealPageContent />);
    await screen.findByLabelText('Select a denied submission');
    fireEvent.change(screen.getByLabelText('Select a denied submission'), {
      target: { value: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add evidence' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add evidence' }));

    const descriptionInputs = screen.getAllByPlaceholderText('Description of this evidence');
    const urlInputs = screen.getAllByPlaceholderText('URL to document or screenshot (https://...)');
    fireEvent.change(descriptionInputs[0], { target: { value: 'Updated provider documentation' } });
    fireEvent.change(urlInputs[0], { target: { value: 'https://example.org/doc.pdf' } });

    fireEvent.change(screen.getByLabelText('Reason for appeal'), {
      target: { value: 'Submitting a detailed appeal with evidence attached.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Appeal' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/submissions/appeal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          reason: 'Submitting a detailed appeal with evidence attached.',
          evidence: [
            {
              type: 'document',
              description: 'Updated provider documentation',
              fileUrl: 'https://example.org/doc.pdf',
            },
          ],
        }),
      });
      expect(screen.getByText('Appeal submitted')).toBeInTheDocument();
    });
  });

  it('supports evidence add/remove and renders unknown status/reviewer notes', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          appeals: [
            makeAppeal({
              status: 'custom_status',
              title: null,
              notes: 'Appeal note text',
              reviewer_notes: 'Reviewer asks for more detail',
            }),
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ submissions: [] }) });

    render(<AppealPageContent />);

    await screen.findByText('Appeal');
    expect(screen.getByText('custom_status')).toBeInTheDocument();
    expect(screen.getByText('Appeal note text')).toBeInTheDocument();
    expect(screen.getByText('Reviewer asks for more detail')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add evidence' }));
    await screen.findByText('Evidence #1');
    fireEvent.click(screen.getByRole('button', { name: 'Remove evidence 1' }));
    expect(screen.queryByText('Evidence #1')).not.toBeInTheDocument();
  });
});
