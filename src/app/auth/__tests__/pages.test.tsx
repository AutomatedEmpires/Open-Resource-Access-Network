import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const searchParamsGetMock = vi.hoisted(() => vi.fn());
const signInMock = vi.hoisted(() => vi.fn());
const setStateMock = vi.hoisted(() => vi.fn());

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => [initial, setStateMock],
  };
});
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({
    get: searchParamsGetMock,
  }),
}));
vi.mock('next-auth/react', () => ({
  signIn: signInMock,
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
  Search: (props: Record<string, unknown>) => React.createElement('svg', props),
  Building2: (props: Record<string, unknown>) => React.createElement('svg', props),
  ShieldCheck: (props: Record<string, unknown>) => React.createElement('svg', props),
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: { children: React.ReactNode; onClick?: () => void }) =>
    React.createElement('button', { ...props, onClick }, children),
}));

async function loadAuthErrorPage() {
  return import('../error/AuthErrorPageClient');
}

async function loadSignInPage() {
  return import('../signin/SignInPageClient');
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

    // Find the error alert in the dynamic content area
    const dynamicArea = cardChildren[2] as React.ReactElement<any, any>;
    const dynamicChildren = React.Children.toArray(dynamicArea.props.children) as React.ReactElement<any, any>[];
    const errorAlert = dynamicChildren.find((c: any) => c?.props?.role === 'alert') as React.ReactElement<any, any>;
    const signInButton = dynamicChildren.find((c: any) => c?.props?.onClick) as React.ReactElement<any, any>;

    expect(errorAlert).toBeDefined();
    expect(React.Children.toArray(errorAlert.props.children)).toContain(
      'Could not start the sign-in process. Please try again.',
    );
    // Sign-in button calls signIn with the detected seeker path (callbackUrl=/profile → seeker)
    expect(signInButton.props.onClick).toBeDefined();
    signInButton.props.onClick();
    expect(signInMock).toHaveBeenCalledWith('azure-ad', { callbackUrl: '/profile' });
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

    // Dynamic content area contains the error + button + guest link
    const dynamicArea = cardChildren[2] as React.ReactElement<any, any>;
    const dynamicChildren = React.Children.toArray(dynamicArea.props.children) as React.ReactElement<any, any>[];
    const errorAlert = dynamicChildren.find((c: any) => c?.props?.role === 'alert') as React.ReactElement<any, any>;
    const guestSection = dynamicChildren.find((c: any) => c?.props?.className?.includes('border-t')) as React.ReactElement<any, any>;

    expect(React.Children.toArray(errorAlert.props.children)).toContain(
      'An unexpected error occurred. Please try again.',
    );
    // Guest link defaults to /chat for seeker path
    const guestLink = React.Children.only(guestSection.props.children) as React.ReactElement<any, any>;
    expect(guestLink.props.href).toBe('/chat');
  });

  it('detects organization path from callbackUrl', async () => {
    const { detectPath } = await import('../signin/SignInPageClient');
    expect(detectPath('/claim')).toBe('organization');
    expect(detectPath('/org')).toBe('organization');
    expect(detectPath('/services')).toBe('organization');
    expect(detectPath(null)).toBe('seeker');
  });

  it('detects admin path from callbackUrl', async () => {
    const { detectPath } = await import('../signin/SignInPageClient');
    expect(detectPath('/approvals')).toBe('admin');
    expect(detectPath('/triage')).toBe('admin');
    expect(detectPath('/queue')).toBe('admin');
    expect(detectPath('/audit')).toBe('admin');
  });

  it('renders three path selector buttons', async () => {
    const { default: SignInPage, PATHS } = await loadSignInPage();
    const suspense = SignInPage() as React.ReactElement<any, any>;
    const content = (suspense.props.children as React.ReactElement<any, any>).type() as React.ReactElement<any, any>;
    const contentChildren = React.Children.toArray(content.props.children) as React.ReactElement<any, any>[];
    const card = contentChildren[0] as React.ReactElement<any, any>;
    const cardChildren = React.Children.toArray(card.props.children) as React.ReactElement<any, any>[];

    // Path selector area (radiogroup)
    const pathSelector = cardChildren[1] as React.ReactElement<any, any>;
    expect(pathSelector.props.role).toBe('radiogroup');

    // Should have 3 paths defined
    expect(PATHS).toHaveLength(3);
    expect(PATHS.map((p: any) => p.id)).toEqual(['seeker', 'organization', 'admin']);
  });
});
