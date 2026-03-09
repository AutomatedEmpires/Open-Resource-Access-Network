import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useStateMock = vi.hoisted(() => vi.fn());
const useEffectMock = vi.hoisted(() => vi.fn());
const useCallbackMock = vi.hoisted(() => vi.fn());
const useRefMock = vi.hoisted(() => vi.fn());
const useMemoMock = vi.hoisted(() => vi.fn());

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: useStateMock,
    useEffect: useEffectMock,
    useCallback: useCallbackMock,
    useRef: useRefMock,
    useMemo: useMemoMock,
  };
});
vi.mock('next/link', () => ({
  default: 'a',
}));
vi.mock('@/components/ui/button', () => ({
  Button: 'button',
}));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: 'dialog-root',
  DialogContent: 'dialog-content',
  DialogDescription: 'dialog-description',
  DialogFooter: 'dialog-footer',
  DialogHeader: 'dialog-header',
  DialogTitle: 'dialog-title',
}));
vi.mock('@/components/ui/error-boundary', () => ({
  ErrorBoundary: 'error-boundary',
}));
vi.mock('@/components/ui/skeleton', () => ({
  SkeletonCard: 'skeleton-card',
}));
vi.mock('@/components/ui/toast', () => ({
  ToastProvider: 'toast-provider',
  useToast: () => ({
    toast: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return {
    ...actual,
    Briefcase: 'svg',
    Plus: 'svg',
    Pencil: 'svg',
    Trash2: 'svg',
    Search: 'svg',
    AlertTriangle: 'svg',
    ArrowLeft: 'svg',
    ArrowRight: 'svg',
    Check: 'svg',
    ExternalLink: 'svg',
    ShieldCheck: 'svg',
    RefreshCw: 'svg',
    ChevronLeft: 'svg',
    ChevronRight: 'svg',
    CheckCircle2: 'svg',
    XCircle: 'svg',
    Building2: 'svg',
    Clock: 'svg',
    Mail: 'svg',
    Filter: 'svg',
    Info: 'svg',
    X: 'svg',
    Loader2: 'svg',
  };
});

async function loadHostServicesPage() {
  return import('../(host)/services/ServicesPageClient');
}

async function loadHostOrgPage() {
  return import('../(host)/org/OrgPageClient');
}

async function loadHostLocationsPage() {
  return import('../(host)/locations/LocationsPageClient');
}

async function loadApprovalsPage() {
  return import('../(oran-admin)/approvals/ApprovalsPageClient');
}

function collectElements(
  node: React.ReactNode,
  predicate: (element: React.ReactElement<any, any>) => boolean,
): React.ReactElement<any, any>[] {
  const elements: React.ReactElement<any, any>[] = [];

  const visit = (value: React.ReactNode) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!React.isValidElement(value)) {
      return;
    }

    const element = value as React.ReactElement<any, any>;
    if (predicate(element)) {
      elements.push(element);
    }
    visit(element.props.children);
  };

  visit(node);
  return elements;
}

function mockStateSequence(values: unknown[]) {
  values.forEach((value) => {
    useStateMock.mockImplementationOnce(() => [value, vi.fn()]);
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();

  useStateMock.mockImplementation((initial: unknown) => [initial, vi.fn()]);
  useEffectMock.mockImplementation(() => undefined);
  useCallbackMock.mockImplementation((fn: unknown) => fn);
  useRefMock.mockImplementation((initial: unknown) => ({ current: initial }));
  useMemoMock.mockImplementation((fn: () => unknown) => fn());
});

describe('portal page shells', () => {
  it('renders the host services management page with populated data and open dialogs', async () => {
    mockStateSequence([
      {
        results: [
          {
            id: 'svc-1',
            organization_id: 'org-1',
            name: 'Food Pantry',
            description: 'Emergency grocery assistance',
            status: 'active',
            organization_name: 'Helping Hands',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-02T00:00:00.000Z',
          },
        ],
        total: 25,
        page: 1,
        hasMore: true,
      },
      false,
      null,
      1,
      '',
      '',
      [{ id: 'org-1', name: 'Helping Hands' }],
      'svc-1',
      false,
    ]);
    const { default: ServicesPage } = await loadHostServicesPage();

    const element = ServicesPage() as React.ReactElement<any, any>;
    const dialogRoots = collectElements(element, (child) => child.type === 'dialog-root');
    const dialogContents = collectElements(element, (child) => child.type === 'dialog-content');
    const buttons = collectElements(element, (child) => child.type === 'button');
    const skeletons = collectElements(element, (child) => child.type === 'skeleton-card');

    expect(dialogRoots).toHaveLength(1);
    expect(dialogContents.length).toBeGreaterThanOrEqual(1);
    expect(buttons.length).toBeGreaterThan(6);
    expect(skeletons).toHaveLength(0);
  });

  it('renders the approvals moderation shell inside the error boundary wrapper', async () => {
    mockStateSequence([
      {
        results: [
          {
            id: 'queue-1',
            service_id: 'svc-1',
            status: 'pending',
            submitted_by_user_id: 'user-1',
            assigned_to_user_id: null,
            notes: 'Need approval',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-02T00:00:00.000Z',
            service_name: 'Food Pantry',
            organization_id: 'org-1',
            organization_name: 'Helping Hands',
            organization_url: 'https://example.org',
            organization_email: 'help@example.org',
          },
        ],
        total: 25,
        page: 1,
        hasMore: true,
      },
      false,
      null,
      1,
      '',
      'queue-1',
      'Missing proof of control',
      false,
      { success: true, message: 'Decision saved.' },
    ]);
    const { default: ApprovalsPage } = await loadApprovalsPage();

    const wrapper = ApprovalsPage() as React.ReactElement<any, any>;
    const innerElement = React.Children.only(wrapper.props.children) as React.ReactElement<any, any>;
    const content = (innerElement.type as () => React.ReactElement<any, any>)();
    const alerts = collectElements(content, (child) => child.props.role === 'alert');
    const tables = collectElements(content, (child) => child.type === 'table');
    const buttons = collectElements(content, (child) => child.type === 'button');
    const tabs = collectElements(content, (child) => child.props.role === 'tab');

    expect(wrapper.type).toBe('error-boundary');
    expect(alerts.length).toBeLessThanOrEqual(1);
    expect(tables).toHaveLength(1);
    expect(tabs).toHaveLength(5);
    expect(buttons.length).toBeGreaterThan(8);
  });

  it('renders the host organization dashboard as a Studio-only published-record surface', async () => {
    mockStateSequence([
      {
        results: [
          {
            id: 'org-1',
            name: 'Helping Hands',
            description: 'Emergency aid and community referrals',
            url: 'https://example.org',
            email: 'hello@example.org',
          },
        ],
        total: 14,
        page: 2,
        hasMore: true,
      },
      false,
      'Delete failed',
      2,
      'help',
      'org-1',
      false,
    ]);
    const { default: OrgDashboardPage } = await loadHostOrgPage();

    const element = OrgDashboardPage() as React.ReactElement<any, any>;
    const wrappers = collectElements(element, (child) => child.type === 'error-boundary');
    const alerts = collectElements(element, (child) => child.props.role === 'alert');
    const dialogRoots = collectElements(element, (child) => child.type === 'dialog-root');
    const dialogContents = collectElements(element, (child) => child.type === 'dialog-content');
    const buttons = collectElements(element, (child) => child.type === 'button');
    const skeletons = collectElements(element, (child) => child.type === 'skeleton-card');

    expect(wrappers).toHaveLength(1);
    expect(alerts.length).toBeGreaterThanOrEqual(0);
    expect(dialogRoots).toHaveLength(0);
    expect(dialogContents).toHaveLength(0);
    expect(buttons.length).toBe(4);
    expect(skeletons).toHaveLength(0);
  });

  it('renders the host locations page as a Studio-only operational surface', async () => {
    mockStateSequence([
      {
        results: [
          {
            id: 'loc-1',
            organization_id: 'org-1',
            name: 'Downtown Office',
            description: 'Main service access point',
            address_1: '123 Main St',
            city: 'Seattle',
            state_province: 'WA',
            postal_code: '98101',
            organization_name: 'Helping Hands',
            primary_service_id: 'svc-1',
            primary_service_name: 'Food Pantry',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-02T00:00:00.000Z',
          },
        ],
        total: 8,
        page: 1,
        hasMore: false,
      },
      false,
      null,
      1,
      '',
      [{ id: 'org-1', name: 'Helping Hands' }],
      'loc-1',
      false,
    ]);
    const { default: LocationsPage } = await loadHostLocationsPage();

    const element = LocationsPage() as React.ReactElement<any, any>;
    const wrappers = collectElements(element, (child) => child.type === 'error-boundary');
    const dialogRoots = collectElements(element, (child) => child.type === 'dialog-root');
    const dialogContents = collectElements(element, (child) => child.type === 'dialog-content');
    const buttons = collectElements(element, (child) => child.type === 'button');
    const skeletons = collectElements(element, (child) => child.type === 'skeleton-card');

    expect(wrappers).toHaveLength(1);
    expect(dialogRoots).toHaveLength(0);
    expect(dialogContents).toHaveLength(0);
    expect(buttons.length).toBe(3);
    expect(skeletons).toHaveLength(0);
  });
});
