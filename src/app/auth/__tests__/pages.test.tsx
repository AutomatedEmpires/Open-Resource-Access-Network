import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const searchParamsGetMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: searchParamsGetMock,
  }),
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => React.createElement('a', { href, ...props }, children),
}));
vi.mock('lucide-react', () => ({
  AlertTriangle: (props: Record<string, unknown>) => React.createElement('svg', props),
  ArrowLeft: (props: Record<string, unknown>) => React.createElement('svg', props),
  Shield: (props: Record<string, unknown>) => React.createElement('svg', props),
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('button', props, children),
}));

async function loadAuthErrorPage() {
  return import('../error/page');
}

async function loadSignInPage() {
  return import('../signin/page');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  searchParamsGetMock.mockReturnValue(null);
});

describe('auth pages', () => {
  it('builds the auth error page content from the error query param', async () => {
    searchParamsGetMock.mockImplementation((key: string) =>
      key === 'error' ? 'AccessDenied' : null,
    );
    const { default: AuthErrorPage } = await loadAuthErrorPage();

    const suspense = AuthErrorPage() as React.ReactElement<any, any>;
    const content = (suspense.props.children as React.ReactElement<any, any>).type() as React.ReactElement<any, any>;
    const card = React.Children.only(content.props.children) as React.ReactElement<any, any>;
    const children = React.Children.toArray(card.props.children) as React.ReactElement<any, any>[];
    const links = children[3] as React.ReactElement<any, any>;

    expect(children[1].props.children).toBe('Authentication Error');
    expect(children[2].props.children).toBe('You do not have permission to sign in.');
    expect(React.Children.toArray(links.props.children)).toHaveLength(2);
  });

  it('falls back to the default auth error message', async () => {
    searchParamsGetMock.mockImplementation((key: string) =>
      key === 'error' ? 'Unknown' : null,
    );
    const { default: AuthErrorPage } = await loadAuthErrorPage();

    const suspense = AuthErrorPage() as React.ReactElement<any, any>;
    const content = (suspense.props.children as React.ReactElement<any, any>).type() as React.ReactElement<any, any>;
    const card = React.Children.only(content.props.children) as React.ReactElement<any, any>;
    const children = React.Children.toArray(card.props.children) as React.ReactElement<any, any>[];

    expect(children[2].props.children).toBe('An unexpected authentication error occurred.');
  });

  it('builds the sign-in page with a callback url and mapped error', async () => {
    searchParamsGetMock.mockImplementation((key: string) => {
      if (key === 'callbackUrl') return '/profile';
      if (key === 'error') return 'OAuthSignin';
      return null;
    });
    const { default: SignInPage } = await loadSignInPage();

    const suspense = SignInPage() as React.ReactElement<any, any>;
    const content = (suspense.props.children as React.ReactElement<any, any>).type() as React.ReactElement<any, any>;
    const contentChildren = React.Children.toArray(content.props.children) as React.ReactElement<any, any>[];
    const card = contentChildren[0] as React.ReactElement<any, any>;
    const cardChildren = React.Children.toArray(card.props.children) as React.ReactElement<any, any>[];
    const errorAlert = cardChildren[1] as React.ReactElement<any, any>;
    const button = cardChildren[2] as React.ReactElement<any, any>;
    const buttonLink = React.Children.only(button.props.children) as React.ReactElement<any, any>;
    const backLink = React.Children.only((cardChildren[4] as React.ReactElement<any, any>).props.children) as React.ReactElement<any, any>;
    const errorChildren = React.Children.toArray(errorAlert.props.children);

    expect(errorAlert.props.role).toBe('alert');
    expect(errorChildren).toContain('Could not start the sign-in process. Please try again.');
    expect(buttonLink.props.href).toContain('/api/auth/signin/azure-ad?callbackUrl=%2Fprofile');
    expect(backLink.props.href).toBe('/profile');
  });

  it('uses the default chat callback and fallback error message', async () => {
    searchParamsGetMock.mockImplementation((key: string) => {
      if (key === 'error') return 'Unexpected';
      return null;
    });
    const { default: SignInPage } = await loadSignInPage();

    const suspense = SignInPage() as React.ReactElement<any, any>;
    const content = (suspense.props.children as React.ReactElement<any, any>).type() as React.ReactElement<any, any>;
    const contentChildren = React.Children.toArray(content.props.children) as React.ReactElement<any, any>[];
    const card = contentChildren[0] as React.ReactElement<any, any>;
    const cardChildren = React.Children.toArray(card.props.children) as React.ReactElement<any, any>[];
    const errorAlert = cardChildren[1] as React.ReactElement<any, any>;
    const backLink = React.Children.only((cardChildren[4] as React.ReactElement<any, any>).props.children) as React.ReactElement<any, any>;
    const errorChildren = React.Children.toArray(errorAlert.props.children);

    expect(errorChildren).toContain('An unexpected error occurred. Please try again.');
    expect(backLink.props.href).toBe('/chat');
  });
});
