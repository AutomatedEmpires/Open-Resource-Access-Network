import { z } from 'zod';

export const SourceTrustLevelSchema = z.enum(['allowlisted', 'quarantine', 'blocked']);
export type SourceTrustLevel = z.infer<typeof SourceTrustLevelSchema>;

export const DomainRuleSchema = z
  .object({
    type: z.enum(['exact_host', 'suffix']),
    value: z.string().min(1),
  })
  .strict();
export type DomainRule = z.infer<typeof DomainRuleSchema>;

export const DiscoveryRuleSchema = z
  .object({
    type: z.enum(['seeded_only', 'sitemap', 'rss', 'html_directory']),
    seedUrls: z.array(z.string().url()).optional(),
    sitemapUrl: z.string().url().optional(),
    feedUrl: z.string().url().optional(),
    indexUrl: z.string().url().optional(),
    linkSelectorHint: z.string().min(1).optional(),
  })
  .strict();
export type DiscoveryRule = z.infer<typeof DiscoveryRuleSchema>;

export const CrawlPolicySchema = z
  .object({
    obeyRobotsTxt: z.boolean().default(true),
    userAgent: z.string().min(1).default('oran-ingestion-agent/1.0'),
    allowedPathPrefixes: z.array(z.string().min(1)).default(['/']),
    blockedPathPrefixes: z.array(z.string().min(1)).default([]),
    maxRequestsPerMinute: z.number().int().min(1).max(600).default(60),
    maxConcurrentRequests: z.number().int().min(1).max(50).default(3),
    fetchTtlHours: z.number().int().min(0).max(24 * 365).default(24),
  })
  .strict();
export type CrawlPolicy = z.infer<typeof CrawlPolicySchema>;

export const CoverageHintSchema = z
  .object({
    kind: z.enum(['local', 'regional', 'statewide', 'national', 'virtual']).default('national'),
    country: z.string().min(2).max(2).default('US'),
    stateProvince: z.string().min(1).optional(),
    countyOrRegion: z.string().min(1).optional(),
  })
  .strict();
export type CoverageHint = z.infer<typeof CoverageHintSchema>;

export const SourceRegistryEntrySchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    trustLevel: SourceTrustLevelSchema,
    domainRules: z.array(DomainRuleSchema).min(1),
    discovery: z.array(DiscoveryRuleSchema).default([{ type: 'seeded_only' }]),
    crawl: CrawlPolicySchema.default(() => ({
      obeyRobotsTxt: true,
      userAgent: 'oran-ingestion-agent/1.0',
      allowedPathPrefixes: ['/'],
      blockedPathPrefixes: [],
      maxRequestsPerMinute: 60,
      maxConcurrentRequests: 3,
      fetchTtlHours: 24,
    })),
    coverage: z.array(CoverageHintSchema).default([]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type SourceRegistryEntry = z.infer<typeof SourceRegistryEntrySchema>;

export type DomainMatchResult =
  | { allowed: true; trustLevel: Exclude<SourceTrustLevel, 'blocked'>; sourceId: string }
  | { allowed: false; trustLevel: SourceTrustLevel; sourceId?: string; reason: string };

function normalizeHost(host: string): string {
  let h = host.trim().toLowerCase();
  // Strip www. prefix — www.example.org and example.org should be the same
  if (h.startsWith('www.')) {
    h = h.slice(4);
  }
  return h;
}

function hostMatchesRule(host: string, rule: DomainRule): boolean {
  const normalizedHost = normalizeHost(host);
  const normalizedValue = rule.value.trim().toLowerCase();

  if (rule.type === 'exact_host') {
    return normalizedHost === normalizedValue;
  }

  // suffix match with dot-boundary: ".gov" should match "example.gov" and "a.b.gov"
  // but not "notgov".
  if (rule.type === 'suffix') {
    const suffix = normalizedValue.startsWith('.') ? normalizedValue : `.${normalizedValue}`;
    return normalizedHost === suffix.slice(1) || normalizedHost.endsWith(suffix);
  }

  return false;
}

const TRACKING_PARAM_KEYS = new Set([
  'gclid',
  'dclid',
  'fbclid',
  'igshid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'yclid',
  'twclid',
  'gbraid',
  'wbraid',
]);

function stripTrackingParams(u: URL): void {
  for (const key of Array.from(u.searchParams.keys())) {
    const lower = key.toLowerCase();
    if (lower.startsWith('utm_') || TRACKING_PARAM_KEYS.has(lower)) {
      u.searchParams.delete(key);
    }
  }

  // Deterministic ordering for stable canonicalization.
  u.searchParams.sort();
}

export function canonicalizeUrl(rawUrl: string): string {
  const u = new URL(rawUrl);

  u.hash = '';
  u.username = '';
  u.password = '';

  // Normalize http → https to prevent duplicate crawls of the same page
  if (u.protocol === 'http:') {
    u.protocol = 'https:';
  }

  u.hostname = normalizeHost(u.hostname);

  if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) {
    u.port = '';
  }

  // Lowercase the path — most web servers are case-insensitive
  u.pathname = u.pathname.toLowerCase();

  stripTrackingParams(u);

  // Normalize trailing slash (but keep root '/')
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.replace(/\/+$/, '');
  }

  return u.toString();
}

export function matchSourceForUrl(
  rawUrl: string,
  registry: SourceRegistryEntry[]
): DomainMatchResult {
  let canonical: string;
  try {
    canonical = canonicalizeUrl(rawUrl);
  } catch {
    return { allowed: false, trustLevel: 'blocked', reason: 'invalid_url' };
  }

  const u = new URL(canonical);
  const host = u.hostname;

  for (const entry of registry) {
    const matches = entry.domainRules.some((r) => hostMatchesRule(host, r));
    if (!matches) continue;

    if (entry.trustLevel === 'blocked') {
      return { allowed: false, trustLevel: 'blocked', sourceId: entry.id, reason: 'blocked_source' };
    }

    if (entry.trustLevel === 'quarantine') {
      // Quarantine means: fetch is allowed for seeded URLs, but the agent must not do
      // within-host expansion or auto-promotion without admin approval.
      return { allowed: true, trustLevel: 'quarantine', sourceId: entry.id };
    }

    return { allowed: true, trustLevel: 'allowlisted', sourceId: entry.id };
  }

  return { allowed: false, trustLevel: 'quarantine', reason: 'unregistered_domain' };
}

/**
 * A minimal bootstrap registry: nationwide allowlist for official domains.
 * This does NOT discover hosts automatically; it only permits crawling within a host once seeded.
 */
export function buildBootstrapRegistry(nowIso: string = new Date().toISOString()): SourceRegistryEntry[] {
  const base = {
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return [
    SourceRegistryEntrySchema.parse({
      ...base,
      id: 'bootstrap-gov',
      displayName: 'US Government (.gov)',
      trustLevel: 'quarantine',
      domainRules: [{ type: 'suffix', value: '.gov' }],
      discovery: [{ type: 'seeded_only' }],
      coverage: [{ kind: 'national', country: 'US' }],
    }),
    SourceRegistryEntrySchema.parse({
      ...base,
      id: 'bootstrap-edu',
      displayName: 'US Higher Education (.edu)',
      trustLevel: 'quarantine',
      domainRules: [{ type: 'suffix', value: '.edu' }],
      discovery: [{ type: 'seeded_only' }],
      coverage: [{ kind: 'national', country: 'US' }],
    }),
    SourceRegistryEntrySchema.parse({
      ...base,
      id: 'bootstrap-mil',
      displayName: 'US Military (.mil) (quarantined by default)',
      trustLevel: 'quarantine',
      domainRules: [{ type: 'suffix', value: '.mil' }],
      discovery: [{ type: 'seeded_only' }],
      coverage: [{ kind: 'national', country: 'US' }],
    }),
    SourceRegistryEntrySchema.parse({
      ...base,
      id: 'bootstrap-org',
      displayName: 'Non-profit Organizations (.org) (quarantined)',
      trustLevel: 'quarantine',
      domainRules: [{ type: 'suffix', value: '.org' }],
      discovery: [{ type: 'seeded_only' }],
      coverage: [{ kind: 'national', country: 'US' }],
    }),
  ];
}
