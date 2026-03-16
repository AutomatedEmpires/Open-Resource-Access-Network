// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const usePathnameMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const useSessionMock = vi.hoisted(() => vi.fn());
const isRoleAtLeastMock = vi.hoisted(() => vi.fn());

vi.mock('next/link', () => ({
  default: 'a',
}));
vi.mock('next/navigation', () => ({
  usePathname: usePathnameMock,
  useRouter: useRouterMock,
}));
vi.mock('next-auth/react', () => ({
  useSession: useSessionMock,
}));
vi.mock('@/services/auth/roles', () => ({
  isRoleAtLeast: isRoleAtLeastMock,
}));
vi.mock('@/components/ui/access-denied', () => ({
  AccessDenied: ({ portalName, requiredRole }: { portalName: string; requiredRole: string }) => (
    <div
      data-testid="access-denied"
      data-portal-name={portalName}
      data-required-role={requiredRole}
    />
  ),
}));
vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: (props: Record<string, unknown>) => <div data-testid="skeleton" {...props} />,
}));
vi.mock('@/components/footer', () => ({
  AppFooter: () => <div data-testid="app-footer" />,
}));
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return { ...actual };
});

async function loadHostLayout() {
  return import('../(host)/layout');
}

async function loadCommunityLayout() {
  return import('../(community-admin)/layout');
}

async function loadOranLayout() {
  return import('../(oran-admin)/layout');
}

async function loadSeekerLayout() {
  return import('../(seeker)/layout');
}

beforeEach(() => {
  cleanup();
  vi.resetModules();
  vi.clearAllMocks();

  usePathnameMock.mockReturnValue('/org');
  useRouterMock.mockReturnValue({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  });
  useSessionMock.mockReturnValue({
    data: { user: { role: 'host_admin' } },
    status: 'authenticated',
  });
  isRoleAtLeastMock.mockReturnValue(true);
});

describe('portal layouts', () => {
  it('renders the host loading shell while the session resolves', async () => {
    useSessionMock.mockReturnValue({
      data: null,
      status: 'loading',
    });
    const { default: HostLayout } = await loadHostLayout();

    const { container } = render(<HostLayout>Child</HostLayout>);
    const root = container.firstElementChild as HTMLElement;

    expect(root.getAttribute('aria-busy')).toBe('true');
    expect(root.getAttribute('aria-label')).toBe('Loading Host portal');
    expect(screen.getAllByTestId('skeleton')).toHaveLength(3);
  });

  it('shows access denied for host users below the required role', async () => {
    useSessionMock.mockReturnValue({
      data: { user: { role: 'seeker' } },
      status: 'authenticated',
    });
    isRoleAtLeastMock.mockReturnValue(false);
    const { default: HostLayout } = await loadHostLayout();

    render(<HostLayout>Child</HostLayout>);

    const denied = screen.getByTestId('access-denied');
    expect(denied.getAttribute('data-portal-name')).toBe('Host');
    expect(denied.getAttribute('data-required-role')).toBe('host_member');
  });

  it('renders host nav and marks the active destination when authorized', async () => {
    usePathnameMock.mockReturnValue('/admins/settings');
    useSessionMock.mockReturnValue({
      data: { user: { role: 'host_admin' } },
      status: 'authenticated',
    });
    isRoleAtLeastMock.mockReturnValue(true);
    const { default: HostLayout } = await loadHostLayout();

    const { container } = render(<HostLayout>Child</HostLayout>);
    const adminsLink = container.querySelector('a[href="/admins"]');
    const servicesLink = container.querySelector('a[href="/services"]');
    const main = container.querySelector('#main-content');

    expect(adminsLink?.getAttribute('aria-current')).toBe('page');
    expect(servicesLink?.getAttribute('aria-current')).toBe(null);
    expect(main?.textContent).toContain('Child');
  });

  it('shows access denied for community-admin users below the required role', async () => {
    useSessionMock.mockReturnValue({
      data: { user: { role: 'host_admin' } },
      status: 'authenticated',
    });
    isRoleAtLeastMock.mockReturnValue(false);
    const { default: CommunityAdminLayout } = await loadCommunityLayout();

    render(<CommunityAdminLayout>Child</CommunityAdminLayout>);

    const denied = screen.getByTestId('access-denied');
    expect(denied.getAttribute('data-portal-name')).toBe('Community Admin');
    expect(denied.getAttribute('data-required-role')).toBe('community_admin');
  });

  it('renders community admin shell navigation when authorized', async () => {
    usePathnameMock.mockReturnValue('/verify/task');
    useSessionMock.mockReturnValue({
      data: { user: { role: 'community_admin' } },
      status: 'authenticated',
    });
    isRoleAtLeastMock.mockReturnValue(true);
    const { default: CommunityAdminLayout } = await loadCommunityLayout();

    const { container } = render(<CommunityAdminLayout>Child</CommunityAdminLayout>);
    const verifyLink = container.querySelector('a[href="/verify"]');
    const queueLink = container.querySelector('a[href="/queue"]');

    expect(verifyLink?.getAttribute('aria-current')).toBe('page');
    expect(queueLink?.getAttribute('aria-current')).toBe(null);
    expect(container.querySelector('#main-content')?.textContent).toContain('Child');
  });

  it('marks the active ORAN admin destination in the shell navigation', async () => {
    usePathnameMock.mockReturnValue('/rules/override');
    useSessionMock.mockReturnValue({
      data: { user: { role: 'oran_admin' } },
      status: 'authenticated',
    });
    const { default: OranAdminLayout } = await loadOranLayout();

    const { container } = render(<OranAdminLayout>Child</OranAdminLayout>);
    const rulesLink = container.querySelector('a[href="/rules"]');
    const auditLink = container.querySelector('a[href="/audit"]');

    expect(rulesLink?.getAttribute('aria-current')).toBe('page');
    expect(auditLink?.getAttribute('aria-current')).toBe(null);
  });

  it('renders the seeker shell with active desktop and mobile navigation links', async () => {
    usePathnameMock.mockReturnValue('/map/cluster');
    const { default: SeekerLayout } = await loadSeekerLayout();

    const { container } = render(<SeekerLayout>Child</SeekerLayout>) as { container: HTMLElement };
    const main = container.querySelectorAll('#main-content');
    const mapLinks = Array.from(container.querySelectorAll('a[href="/map"]')) as HTMLAnchorElement[];
    const chatLink = container.querySelector('a[href="/chat"]');

    expect(main).toHaveLength(1);
    expect(mapLinks).toHaveLength(2);
    expect(mapLinks.every((link: HTMLAnchorElement) => link.getAttribute('aria-current') === 'page')).toBe(true);
    expect(chatLink).toBeTruthy();
  });
});
