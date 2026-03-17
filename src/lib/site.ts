import type { MetadataRoute } from 'next';

const DEFAULT_BASE_URL = 'https://openresourceaccessnetwork.com';

function normalizeBaseUrl(value?: string): string {
  if (!value) return DEFAULT_BASE_URL;
  return value.replace(/\/$/, '');
}

function splitCsvEnv(value?: string): string[] {
  if (!value) return [];

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export const SITE = {
  acronym: 'ORAN',
  legalName: 'Open Resource Access Network',
  title: 'ORAN — Open Resource Access Network',
  baseUrl: normalizeBaseUrl(process.env.NEXT_PUBLIC_SITE_URL),
  description:
    'Find verified government, nonprofit, and community services near you. No hallucinated results — real, confirmed information only.',
  mission:
    'Make verified social-service discovery reliable, safe, and accessible by connecting people to confirmed government, nonprofit, and community resources.',
  vision:
    'A world where finding help is as dependable as emergency routing: fast, factual, privacy-respecting, and available to everyone.',
  founded: '2024',
  githubUrl: 'https://github.com/AutomatedEmpires/Open-Resource-Access-Network',
  defaultLocale: 'en_US',
} as const;

export const PUBLIC_SITEMAP_ENTRIES: ReadonlyArray<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
  priority: number;
}> = [
  { path: '', changeFrequency: 'weekly', priority: 1.0 },
  { path: '/about', changeFrequency: 'monthly', priority: 0.9 },
  { path: '/trust', changeFrequency: 'weekly', priority: 0.9 },
  { path: '/about/press', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/about/team', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/contact', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/partnerships', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/partnerships/organizations', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/partnerships/admins', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/partnerships/oran-admins', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/chat', changeFrequency: 'monthly', priority: 0.9 },
  { path: '/directory', changeFrequency: 'daily', priority: 0.9 },
  { path: '/map', changeFrequency: 'daily', priority: 0.8 },
  { path: '/status', changeFrequency: 'daily', priority: 0.7 },
  { path: '/changelog', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/security', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/privacy', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/accessibility', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/terms', changeFrequency: 'monthly', priority: 0.5 },
];

export function getSameAsLinks(): string[] {
  const defaults = [
    SITE.githubUrl,
    ...splitCsvEnv(process.env.NEXT_PUBLIC_ORAN_SAME_AS),
  ];

  return Array.from(new Set(defaults));
}

export function getSiteVerification() {
  const google = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION;
  const yandex = process.env.NEXT_PUBLIC_YANDEX_SITE_VERIFICATION;
  const bing = process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION;

  const other: Record<string, string> = {};
  if (bing) other['msvalidate.01'] = bing;

  if (!google && !yandex && Object.keys(other).length === 0) {
    return undefined;
  }

  return {
    google,
    yandex,
    other: Object.keys(other).length > 0 ? other : undefined,
  };
}

export function buildOrganizationJsonLd() {
  const sameAs = getSameAsLinks();

  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE.legalName,
    alternateName: SITE.acronym,
    url: SITE.baseUrl,
    foundingDate: SITE.founded,
    description: SITE.description,
    mission: SITE.mission,
    slogan: 'Verified civic resource discovery',
    sameAs: sameAs.length > 0 ? sameAs : undefined,
  };
}

export function buildAboutPageJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    name: 'About ORAN',
    url: `${SITE.baseUrl}/about`,
    description:
      'Mission, vision, governance, and trust principles for the Open Resource Access Network.',
    isPartOf: {
      '@type': 'WebSite',
      name: SITE.title,
      url: SITE.baseUrl,
    },
    about: {
      '@type': 'Organization',
      name: SITE.legalName,
      url: SITE.baseUrl,
    },
  };
}

export function toSafeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
