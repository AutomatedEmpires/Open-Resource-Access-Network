// @vitest-environment jsdom

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));

vi.mock('@/app/(seeker)/appeal/AppealPageClient', () => ({
  default: () => <div>Appeal Client</div>,
}));
vi.mock('@/app/(seeker)/notifications/NotificationsPageClient', () => ({
  default: () => <div>Notifications Client</div>,
}));
vi.mock('@/app/(seeker)/report/ReportPageClient', () => ({
  default: () => <div>Report Client</div>,
}));
vi.mock('@/app/auth/error/AuthErrorPageClient', () => ({
  default: () => <div>Auth Error Client</div>,
}));
vi.mock('@/app/auth/signin/SignInPageClient', () => ({
  default: () => <div>Sign In Client</div>,
}));

import AppError from '@/app/error';
import GlobalError from '@/app/global-error';
import NotFound, { metadata as notFoundMetadata } from '@/app/not-found';
import CommunityAdminError from '@/app/(community-admin)/error';
import HostError from '@/app/(host)/error';
import OranAdminError from '@/app/(oran-admin)/error';
import SeekerError from '@/app/(seeker)/error';
import AppealPage, { metadata as appealMetadata } from '@/app/(seeker)/appeal/page';
import NotificationsPage, { metadata as notificationsMetadata } from '@/app/(seeker)/notifications/page';
import ReportPage, { metadata as reportMetadata } from '@/app/(seeker)/report/page';
import AuthErrorPage, { metadata as authErrorMetadata } from '@/app/auth/error/page';
import SignInPage, { metadata as signInMetadata } from '@/app/auth/signin/page';

beforeEach(() => {
  vi.clearAllMocks();
  captureExceptionMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('app-level error and wrapper pages', () => {
  it('renders root not-found with metadata and navigation links', () => {
    render(<NotFound />);

    expect(notFoundMetadata.title).toBe('Page not found');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Search services' })).toHaveAttribute('href', '/directory');
  });

  it('renders seeker and auth wrapper pages with metadata', () => {
    render(<>
      <AppealPage />
      <NotificationsPage />
      <ReportPage />
      <AuthErrorPage />
      <SignInPage />
    </>);

    expect(appealMetadata.title).toBe('Appeal a Decision');
    expect(notificationsMetadata.title).toBe('Notifications');
    expect(reportMetadata.title).toBe('Report a Listing');
    expect(authErrorMetadata.title).toBe('Authentication Error');
    expect(signInMetadata.title).toBe('Sign in');

    expect(screen.getByText('Appeal Client')).toBeInTheDocument();
    expect(screen.getByText('Notifications Client')).toBeInTheDocument();
    expect(screen.getByText('Report Client')).toBeInTheDocument();
    expect(screen.getByText('Auth Error Client')).toBeInTheDocument();
    expect(screen.getByText('Sign In Client')).toBeInTheDocument();
  });

  it('renders app error boundary UI, reports telemetry, and resets', async () => {
    const reset = vi.fn();
    const error = Object.assign(new Error('boom'), { digest: 'app-err-1' });

    render(<AppError error={error} reset={reset} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Error ID: app-err-1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(captureExceptionMock).toHaveBeenCalledWith(error, {
        feature: 'app_error_boundary',
      });
    });
  });

  it('renders segmented error boundaries and reports with feature tags', async () => {
    const resetA = vi.fn();
    const resetB = vi.fn();
    const resetC = vi.fn();
    const resetD = vi.fn();

    const errA = Object.assign(new Error('community'), { digest: 'ca-1' });
    const errB = Object.assign(new Error('host'), { digest: 'host-1' });
    const errC = Object.assign(new Error('oran'), { digest: 'oran-1' });
    const errD = Object.assign(new Error('seeker'), { digest: 'seeker-1' });

    render(
      <>
        <CommunityAdminError error={errA} reset={resetA} />
        <HostError error={errB} reset={resetB} />
        <OranAdminError error={errC} reset={resetC} />
        <SeekerError error={errD} reset={resetD} />
      </>,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[1]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[2]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[3]);

    expect(resetA).toHaveBeenCalled();
    expect(resetB).toHaveBeenCalled();
    expect(resetC).toHaveBeenCalled();
    expect(resetD).toHaveBeenCalled();

    expect(screen.getByRole('link', { name: 'Review queue' })).toHaveAttribute('href', '/queue');
    expect(screen.getByRole('link', { name: 'Organization dashboard' })).toHaveAttribute('href', '/org');
    expect(screen.getByRole('link', { name: 'Approvals' })).toHaveAttribute('href', '/approvals');
    expect(screen.getByRole('link', { name: 'Search services' })).toHaveAttribute('href', '/chat');

    await waitFor(() => {
      expect(captureExceptionMock).toHaveBeenCalledWith(errA, {
        feature: 'community_admin_error_boundary',
      });
      expect(captureExceptionMock).toHaveBeenCalledWith(errB, {
        feature: 'host_error_boundary',
      });
      expect(captureExceptionMock).toHaveBeenCalledWith(errC, {
        feature: 'oran_admin_error_boundary',
      });
      expect(captureExceptionMock).toHaveBeenCalledWith(errD, {
        feature: 'seeker_error_boundary',
      });
    });
  });

  it('personalizes seeker error discovery fallback from stored seeker needs', async () => {
    localStorage.setItem('oran:seeker-context', JSON.stringify({
      serviceInterests: ['food_assistance'],
    }));
    const reset = vi.fn();
    const error = Object.assign(new Error('seeker'), { digest: 'seeker-pref-1' });

    render(<SeekerError error={error} reset={reset} />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Search services' })).toHaveAttribute(
        'href',
        '/chat?q=food&category=food_assistance',
      );
    });
  });

  it('renders global error boundary fallback and reset action', async () => {
    const reset = vi.fn();
    const error = Object.assign(new Error('global boom'), { digest: 'global-1' });

    render(<GlobalError error={error} reset={reset} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Error ID: global-1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(captureExceptionMock).toHaveBeenCalledWith(error, {
        feature: 'global_error_boundary',
      });
    });
  });
});
