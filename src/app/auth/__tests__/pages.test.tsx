import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const searchParamsGetMock = vi.hoisted(() => vi.fn());
const setStateMock = vi.hoisted(() => vi.fn());

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => [initial, setStateMock],
    useEffect: () => {},
  };
});
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: searchParamsGetMock }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...props }, children),
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
  Button: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('span', props, children),
}));

async function loadAuthErrorPage() {
  return import('../error/AuthErrorPageClient');
}

async function loadSignInPage() {
  return import('../signin/SignInPageClient');
}

/** Recursively collect all elements of a given tag/role from a React element tree. */
function collect(node: unknown, predicate: (el: React.ReactElement<any, any>) => boolean): React.ReactElement<any, any>[] {
  const out: React.ReactElement<any, any>[] = [];
  const visit = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(visit);
    const el = n as React.ReactElement<any, any>;
    if (el.props) {
      if (predicate(el)) out.push(el);
      React.Children.toArray(el.props.children).forEach(visit);
    }
  };
  visit(node);
  return out;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  searchParamsGetMock.mockReturnValue(null);
});

describe('auth pages', () => {
  it('builds the auth error page content from the error query param', async () => {
    searchParamsGetMock.mockImplementation((key: string) => (key === 'error' ? 'AccessDenied' : null));
    const { default: AuthErrorPage } = await loadAuthErrorPage();

    const suspense = AuthErrorPage() as React.ReactElement<any, any>;
    const content = (suspense.props.children as React.ReactElement<any, any>).type() as React.ReactElement<any, any>;
    const card = React.Children.only(content.props.children) as React.ReactElement<any, any>;
    const children = React.Children.toArray(card.props.children) as React.ReactElement<any, any>[];

    expect(children[1].props.children).toBe('Authentication Error');
    expect(children[2].props.children).toBe('You do not have permission to sign in.');
  });

  it('falls back to the default auth error message', async () => {
    searchParamsGetMock.mockImplementation((key: string) => (key === 'error' ? 'Unknown' : null));
    const { default: AuthErrorPage } = await loadAuthErrorPage();

    const suspense = AuthErrorPage() as React.ReactElement<any, any>;
    const content = (suspense.props.children as React.ReactElement<any, any>).type() as React.ReactElement<any, any>;
    const card = React.Children.only(content.props.children) as React.ReactElement<any, any>;
    const children = React.Children.toArray(card.props.children) as React.ReactElement<any, any>[];

    expect(children[2].props.children).toBe('An unexpected authentication error occurred.');
  });

  it('renders a path chooser and routes "Sign in" to Clerk with the callback', async () => {
    searchParamsGetMock.mockImplementation((key: string) => (key === 'callbackUrl' ? '/profile' : null));
    const { default: SignInPage } = await loadSignInPage();

    const content = (
      (SignInPage() as React.ReactElement<any, any>).props.children as React.ReactElement<any, any>
    ).type() as React.ReactElement<any, any>;

    // Three-path radiogroup present.
    const radiogroups = collect(content, (el) => el.props?.role === 'radiogroup');
    expect(radiogroups).toHaveLength(1);
    const radios = collect(content, (el) => el.props?.role === 'radio');
    expect(radios).toHaveLength(3);

    // "Sign in" links to Clerk's /sign-in, preserving the callback (seeker path keeps /profile).
    const links = collect(content, (el) => typeof el.props?.href === 'string');
    const signIn = links.find((a) => a.props.children === 'Sign in');
    expect(signIn?.props.href).toBe('/sign-in?redirect_url=%2Fprofile');

    const signUp = links.find((a) => a.props.children === 'Create an account');
    expect(signUp?.props.href).toBe('/sign-up?redirect_url=%2Fprofile');
  });

  it('offers a guest path for seekers defaulting to /chat', async () => {
    const { default: SignInPage } = await loadSignInPage();

    const content = (
      (SignInPage() as React.ReactElement<any, any>).props.children as React.ReactElement<any, any>
    ).type() as React.ReactElement<any, any>;

    const links = collect(content, (el) => typeof el.props?.href === 'string');
    const guest = links.find((a) => a.props.children === 'Continue as guest');
    expect(guest?.props.href).toBe('/chat');
  });

  it('detects organization path from callbackUrl', async () => {
    const { detectPath } = await loadSignInPage();
    expect(detectPath('/claim')).toBe('organization');
    expect(detectPath('/org')).toBe('organization');
    expect(detectPath('/services')).toBe('organization');
    expect(detectPath(null)).toBe('seeker');
  });

  it('detects admin path from callbackUrl', async () => {
    const { detectPath } = await loadSignInPage();
    expect(detectPath('/approvals')).toBe('admin');
    expect(detectPath('/triage')).toBe('admin');
    expect(detectPath('/queue')).toBe('admin');
    expect(detectPath('/audit')).toBe('admin');
  });

  it('defines the three account paths', async () => {
    const { PATHS } = await loadSignInPage();
    expect(PATHS).toHaveLength(3);
    expect(PATHS.map((p) => p.id)).toEqual(['seeker', 'organization', 'admin']);
    expect(PATHS[1].accessNotes[1]).toContain('approves the claim');
    expect(PATHS[2].accessNotes[1]).toContain('not created by self-service registration');
  });
});
