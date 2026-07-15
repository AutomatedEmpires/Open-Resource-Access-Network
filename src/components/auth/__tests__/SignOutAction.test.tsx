// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signOutMock = vi.hoisted(() => vi.fn());

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@/services/auth/client', () => ({
  useOranAuth: () => ({ signOut: signOutMock }),
}));

import { SignOutAction } from '../SignOutAction';
import { AccessDenied } from '@/components/ui/access-denied';

beforeEach(() => {
  signOutMock.mockReset();
  signOutMock.mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe('SignOutAction', () => {
  it('clears the Clerk-backed session through the shared auth bridge', () => {
    render(<SignOutAction redirectUrl="/chat">Sign out</SignOutAction>);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(signOutMock).toHaveBeenCalledWith({ redirectUrl: '/chat' });
  });

  it('keeps portal access-denied recovery on the Clerk-backed sign-out action', () => {
    render(<AccessDenied portalName="ORAN Admin" requiredRole="oran_admin" />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));

    expect(signOutMock).toHaveBeenCalledWith({ redirectUrl: '/' });
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
  });
});
