// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import AccessibilityPage from '@/app/(public)/accessibility/page';
import StatusPage from '@/app/(public)/status/page';

afterEach(() => cleanup());

describe('public platform migration copy', () => {
  it('publishes the active provider status links without stale Azure claims', () => {
    render(<StatusPage />);

    expect(screen.getByText(/manually published ORAN status summary/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Vercel Status/i })).toHaveAttribute(
      'href',
      'https://www.vercel-status.com/',
    );
    expect(screen.getByRole('link', { name: /Supabase Status/i })).toHaveAttribute(
      'href',
      'https://status.supabase.com/',
    );
    expect(screen.getByRole('link', { name: /Clerk Status/i })).toHaveAttribute(
      'href',
      'https://status.clerk.com/',
    );
    expect(screen.getByRole('link', { name: /OpenStreetMap Status/i })).toHaveAttribute(
      'href',
      'https://uptime.openstreetmap.org/',
    );
    expect(document.body).not.toHaveTextContent(/Azure|Microsoft/i);
    expect(document.body).not.toHaveTextContent(/Uptime \(90d\)/i);
  });

  it('names the map implementation accurately in the accessibility statement', () => {
    render(<AccessibilityPage />);

    expect(screen.getByText('Interactive map (OpenStreetMap)')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Azure Maps/i);
    expect(document.body).not.toHaveTextContent(/scheduled for Q2 2026/i);
  });
});
