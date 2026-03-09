// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchMock = vi.hoisted(() => vi.fn());
const navigationState = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => navigationState.searchParams,
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
  PageHeaderBadge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import ReportPageContent from '@/app/(seeker)/report/ReportPageClient';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  navigationState.searchParams = new URLSearchParams('serviceId=svc-123');
});

describe('ReportPageClient', () => {
  it('requires reason and details before enabling submit', async () => {
    render(<ReportPageContent />);

    const submitButton = screen.getByRole('button', { name: 'Submit Report' });
    expect(submitButton).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Back to listing' })).toHaveAttribute('href', '/service/svc-123');

    fireEvent.change(screen.getByLabelText('Reason for report'), {
      target: { value: 'incorrect_info' },
    });
    expect(submitButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Details'), {
      target: { value: 'Bad' },
    });
    expect(submitButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Details'), {
      target: { value: 'The address is outdated.' },
    });
    expect(submitButton).toBeEnabled();
  });

  it('submits a report successfully and shows the success state', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ reports: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ reportId: 'report-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ reports: [] }) });

    render(<ReportPageContent />);

    fireEvent.change(screen.getByLabelText('Reason for report'), {
      target: { value: 'wrong_location' },
    });
    fireEvent.change(screen.getByLabelText('Details'), {
      target: { value: 'Map pin is on the wrong block.' },
    });
    fireEvent.change(screen.getByLabelText('Contact email (optional)'), {
      target: { value: 'reporter@example.org' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Report' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/submissions/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: 'svc-123',
          reason: 'wrong_location',
          details: 'Map pin is on the wrong block.',
          contactEmail: 'reporter@example.org',
        }),
      });
      expect(screen.getByText('Thank you for your report')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Return to directory' })).toHaveAttribute('href', '/directory');
    });
  });

  it('shows API errors and keeps form visible', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ reports: [] }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Report submission blocked' }) });

    render(<ReportPageContent />);

    fireEvent.change(screen.getByLabelText('Reason for report'), {
      target: { value: 'suspected_fraud' },
    });
    fireEvent.change(screen.getByLabelText('Details'), {
      target: { value: 'Listing requests payment up front and appears fake.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Report' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Report submission blocked');
      expect(screen.getByRole('button', { name: 'Submit Report' })).toBeInTheDocument();
    });
  });

  it('falls back to directory link when serviceId is missing', async () => {
    navigationState.searchParams = new URLSearchParams();

    render(<ReportPageContent />);

    expect(screen.getByRole('link', { name: 'Back to listing' })).toHaveAttribute('href', '/directory');
    expect(screen.getByRole('button', { name: 'Submit Report' })).toBeDisabled();
  });

  it('preserves canonical discovery state in listing and directory return links', async () => {
    const taxonomyId = 'a1000000-4000-4000-8000-000000000001';
    navigationState.searchParams = new URLSearchParams(
      `serviceId=svc-123&category=food&confidence=HIGH&sort=name_desc&taxonomyIds=${taxonomyId}&attributes=%7B%22delivery%22%3A%5B%22virtual%22%5D%7D&page=2`,
    );
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ reports: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ reportId: 'report-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ reports: [] }) });

    render(<ReportPageContent />);

    expect(screen.getByRole('link', { name: 'Back to listing' })).toHaveAttribute(
      'href',
      `/service/svc-123?q=food&confidence=HIGH&sort=name_desc&category=food_assistance&taxonomyIds=${taxonomyId}&attributes=%7B%22delivery%22%3A%5B%22virtual%22%5D%7D&page=2`,
    );

    fireEvent.change(screen.getByLabelText('Reason for report'), {
      target: { value: 'wrong_location' },
    });
    fireEvent.change(screen.getByLabelText('Details'), {
      target: { value: 'Map pin is on the wrong block.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Report' }));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Return to directory' })).toHaveAttribute(
        'href',
        `/directory?q=food&confidence=HIGH&sort=name_desc&category=food_assistance&taxonomyIds=${taxonomyId}&attributes=%7B%22delivery%22%3A%5B%22virtual%22%5D%7D&page=2`,
      );
    });
  });
});
