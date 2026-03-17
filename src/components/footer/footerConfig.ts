/**
 * Footer Link Configuration
 *
 * Defines role-scoped column content for the AppFooter.
 * Each FooterVariant maps to three columns shown alongside the brand column.
 */

import type { OranRole } from '@/domain/types';

// ============================================================
// TYPES
// ============================================================

export interface FooterLink {
  label: string;
  href: string;
  /** Opens in a new tab — only for genuinely external URLs. */
  external?: boolean;
}

export interface FooterColumn {
  title: string;
  links: FooterLink[];
}

export type FooterVariant = 'public' | 'host' | 'community_admin' | 'oran_admin';

// ============================================================
// VARIANT RESOLVER
// ============================================================

export function getFooterVariant(role: OranRole | undefined): FooterVariant {
  if (!role || role === 'seeker') return 'public';
  if (role === 'host_member' || role === 'host_admin') return 'host';
  if (role === 'community_admin') return 'community_admin';
  if (role === 'oran_admin') return 'oran_admin';
  return 'public';
}

// ============================================================
// COLUMN DEFINITIONS
// ============================================================

const PUBLIC_COLUMNS: FooterColumn[] = [
  {
    title: 'Find Help',
    links: [
      { label: 'Chat Assistant',    href: '/chat' },
      { label: 'Service Directory', href: '/directory' },
      { label: 'Map View',          href: '/map' },
      { label: 'Saved Services',    href: '/saved' },
    ],
  },
  {
    title: 'Get Involved',
    links: [
      { label: 'List Your Organization', href: '/partnerships' },
      { label: 'Donate',                 href: '/partnerships#donate' },
      { label: 'Volunteer',              href: '/partnerships#volunteer' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About ORAN', href: '/about' },
      { label: 'Trust Center', href: '/trust' },
      { label: 'Team',       href: '/about/team' },
      { label: 'Press',      href: '/about/press' },
      { label: 'Changelog',  href: '/changelog' },
      { label: 'Contact',    href: '/contact' },
      { label: 'Status',     href: '/status' },
      {
        label: 'GitHub',
        href: 'https://github.com/AutomatedEmpires/Open-Resource-Access-Network',
        external: true,
      },
    ],
  },
];

const HOST_COLUMNS: FooterColumn[] = [
  {
    title: 'Manage',
    links: [
      { label: 'Organization Profile', href: '/org' },
      { label: 'Services',             href: '/services' },
      { label: 'Locations',            href: '/locations' },
      { label: 'Team Members',         href: '/admins' },
      { label: 'Claim an Org',         href: '/claim' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Contact Support', href: '/contact' },
      { label: 'System Status',   href: '/status' },
      { label: 'Partnerships',    href: '/partnerships' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About ORAN',    href: '/about' },
      { label: 'Trust Center',  href: '/trust' },
      { label: 'Changelog',     href: '/changelog' },
      { label: 'Accessibility', href: '/accessibility' },
      {
        label: 'GitHub',
        href: 'https://github.com/AutomatedEmpires/Open-Resource-Access-Network',
        external: true,
      },
    ],
  },
];

const COMMUNITY_ADMIN_COLUMNS: FooterColumn[] = [
  {
    title: 'My Work',
    links: [
      { label: 'Dashboard',       href: '/dashboard' },
      { label: 'Review Queue',    href: '/queue' },
      { label: 'Verify Services', href: '/verify' },
      { label: 'Coverage',        href: '/coverage' },
    ],
  },
  {
    title: 'Admin Tools',
    links: [
      { label: 'Contact Support', href: '/contact' },
      { label: 'System Status',   href: '/status' },
      { label: 'Security Policy', href: '/security' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About ORAN',    href: '/about' },
      { label: 'Trust Center',  href: '/trust' },
      { label: 'Changelog',     href: '/changelog' },
      { label: 'Accessibility', href: '/accessibility' },
      {
        label: 'GitHub',
        href: 'https://github.com/AutomatedEmpires/Open-Resource-Access-Network',
        external: true,
      },
    ],
  },
];

const ORAN_ADMIN_COLUMNS: FooterColumn[] = [
  {
    title: 'Operations',
    links: [
      { label: 'Triage Queue', href: '/triage' },
      { label: 'Approvals',    href: '/approvals' },
      { label: 'Appeals',      href: '/appeals' },
      { label: 'Scopes',       href: '/scopes' },
      { label: 'Rules',        href: '/rules' },
    ],
  },
  {
    title: 'System',
    links: [
      { label: 'Audit Log',       href: '/audit' },
      { label: 'Ingestion',       href: '/ingestion' },
      { label: 'Zone Management', href: '/zone-management' },
      { label: 'Templates',       href: '/templates' },
    ],
  },
  {
    title: 'Platform',
    links: [
      { label: 'About ORAN',      href: '/about' },
      { label: 'Trust Center',    href: '/trust' },
      { label: 'System Status',   href: '/status' },
      { label: 'Security Policy', href: '/security' },
      { label: 'Changelog',       href: '/changelog' },
      {
        label: 'GitHub',
        href: 'https://github.com/AutomatedEmpires/Open-Resource-Access-Network',
        external: true,
      },
    ],
  },
];

// ============================================================
// EXPORT MAP
// ============================================================

export const FOOTER_CONFIG: Record<FooterVariant, FooterColumn[]> = {
  public:          PUBLIC_COLUMNS,
  host:            HOST_COLUMNS,
  community_admin: COMMUNITY_ADMIN_COLUMNS,
  oran_admin:      ORAN_ADMIN_COLUMNS,
};

// ============================================================
// LEGAL BAR (same for all roles)
// ============================================================

export const LEGAL_LINKS: ReadonlyArray<{ label: string; href: string }> = [
  { label: 'Privacy Policy', href: '/privacy' },
  { label: 'Terms of Use',   href: '/terms' },
  { label: 'Accessibility',  href: '/accessibility' },
  { label: 'Security',       href: '/security' },
  { label: 'Trust Center',   href: '/trust' },
];
