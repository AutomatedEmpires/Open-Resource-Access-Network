// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const searchParamsGetMock = vi.hoisted(() => vi.fn());
const signInPropsMock = vi.hoisted(() => vi.fn());
const signUpPropsMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: searchParamsGetMock }),
}));

vi.mock('@clerk/nextjs', () => ({
  SignIn: (props: Record<string, unknown>) => {
    signInPropsMock(props);
    return React.createElement('div', {
      'data-testid': 'clerk-sign-in',
      'data-redirect': props.fallbackRedirectUrl,
    });
  },
  SignUp: (props: Record<string, unknown>) => {
    signUpPropsMock(props);
    return React.createElement('div', {
      'data-testid': 'clerk-sign-up',
      'data-redirect': props.fallbackRedirectUrl,
    });
  },
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...props }, children),
}));

async function loadAuthErrorPage() {
  return import('../error/AuthErrorPageClient');
}

async function loadSignInPage() {
  return import('../signin/SignInPageClient');
}

async function loadSignUpPage() {
  return import('../signup/[[...signup]]/page');
}

beforeEach(() => {
  vi.clearAllMocks();
  searchParamsGetMock.mockReturnValue(null);
});

afterEach(() => {
  cleanup();
});

describe('Clerk auth pages', () => {
  it('keeps the existing friendly auth-error mapping', async () => {
    searchParamsGetMock.mockImplementation((key: string) => key === 'error' ? 'AccessDenied' : null);
    const { default: AuthErrorPage } = await loadAuthErrorPage();

    render(<AuthErrorPage />);

    expect(screen.getByRole('heading', { name: 'Authentication Error' })).toBeInTheDocument();
    expect(screen.getByText('You do not have permission to sign in.')).toBeInTheDocument();
  });

  it('classifies seeker, organization, and admin return paths', async () => {
    const { detectPath } = await loadSignInPage();

    expect(detectPath('/profile')).toBe('seeker');
    expect(detectPath('/claim')).toBe('organization');
    expect(detectPath('/host/services')).toBe('organization');
    expect(detectPath('/queue')).toBe('admin');
    expect(detectPath('/operations')).toBe('admin');
  });

  it('allows only same-origin relative return paths', async () => {
    const { safeRedirect } = await loadSignInPage();

    expect(safeRedirect('/saved?from=chat', '/chat')).toBe('/saved?from=chat');
    expect(safeRedirect('https://attacker.example', '/chat')).toBe('/chat');
    expect(safeRedirect('//attacker.example', '/chat')).toBe('/chat');
    expect(safeRedirect('/\\attacker.example', '/chat')).toBe('/chat');
    expect(safeRedirect('/chat\u0000', '/chat')).toBe('/chat');
  });

  it('renders the ORAN paths and hands a safe deep link to Clerk', async () => {
    searchParamsGetMock.mockImplementation((key: string) => {
      if (key === 'redirect_url') return '/profile';
      return null;
    });
    const { default: SignInPage, PATHS } = await loadSignInPage();

    render(<SignInPage />);

    expect(PATHS.map((path) => path.id)).toEqual(['seeker', 'organization', 'admin']);
    expect(PATHS.find((path) => path.id === 'seeker')?.detail).toContain('publication-gated, source-backed');
    expect(PATHS.find((path) => path.id === 'seeker')?.detail).not.toContain('verified');
    expect(screen.getByText('Building Bridges | Strengthening Communities')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('link', { name: /continue without signing in/i })).toHaveAttribute('href', '/profile');
    expect(screen.getByTestId('clerk-sign-in')).toHaveAttribute('data-redirect', '/profile');
  });

  it('switches to the organization destination without granting a role', async () => {
    const { default: SignInPage } = await loadSignInPage();
    render(<SignInPage />);

    fireEvent.click(screen.getByRole('radio', { name: 'Organization' }));

    expect(screen.queryByRole('link', { name: /continue without signing in/i })).not.toBeInTheDocument();
    const latestProps = signInPropsMock.mock.calls.at(-1)?.[0];
    expect(latestProps?.fallbackRedirectUrl).toBe('/claim');
    expect(screen.getByText(/access begins after the claim is reviewed and approved/i)).toBeInTheDocument();
  });

  it('routes account creation through privacy-first onboarding', async () => {
    const { default: SignUpPage, metadata } = await loadSignUpPage();

    render(<SignUpPage />);

    expect(metadata.title).toBe('Create your account');
    expect(screen.getByText('Building Bridges | Strengthening Communities')).toBeInTheDocument();
    expect(screen.getByTestId('clerk-sign-up')).toHaveAttribute('data-redirect', '/onboarding');
    expect(signUpPropsMock).toHaveBeenCalledWith(expect.objectContaining({
      path: '/auth/signup',
      routing: 'path',
      signInUrl: '/auth/signin',
      fallbackRedirectUrl: '/onboarding',
    }));
  });
});
