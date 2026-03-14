import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as cheerio from 'cheerio';

import { createPageFetcher, discoverLinks, isFetchSuccess } from '../src/agents/ingestion/fetcher';
import { publishCandidateToLiveService } from '../src/agents/ingestion/livePublish';
import { createIngestionService } from '../src/agents/ingestion/service';
import { createIngestionStores } from '../src/agents/ingestion/persistence/storeFactory';
import {
  buildBootstrapRegistry,
  canonicalizeUrl,
  matchSourceForUrl,
  type SourceTrustLevel,
} from '../src/agents/ingestion/sourceRegistry';
import { closeDb, getDb, getPool } from '../src/db';
import { geocode, isConfigured as isGeocodingConfigured } from '../src/services/geocoding/azureMaps';

type CampaignOptions = {
  urls: string[];
  forceReprocess: boolean;
  publishReady: boolean;
  publishMinConfidence: number;
  allowedSourceQuality: Set<string>;
  actorId: string;
  registerHosts: SourceTrustLevel | null;
  expandAllowlisted: boolean;
  expandDepth: number;
  expandMaxPages: number;
  expandMaxLinksPerPage: number;
  dryRun: boolean;
};

type CampaignExpansionSummary = {
  enabled: boolean;
  seedUrls: number;
  expandedUrls: number;
  fetchedPages: number;
  skippedNonHtml: number;
  skippedUnallowlisted: number;
  skippedFetchErrors: number;
};

type ExpansionQueueItem = {
  url: string;
  depth: number;
};

type ScoredLink = {
  url: string;
  score: number;
};

const SKIPPED_PATH_PATTERNS = [
  /\/privacy/i,
  /\/terms/i,
  /\/legal/i,
  /\/login/i,
  /\/signin/i,
  /\/search/i,
  /\/news/i,
  /\/events/i,
  /\/press/i,
  /\/blog/i,
  /\/careers/i,
  /\/jobs/i,
  /\/about/i,
  /\/contact$/i,
  /\/contact-us/i,
  /\/sitemap/i,
  /\/faq/i,
  /\/help$/i,
];

const SERVICE_PATH_PATTERNS = [
  /\/benefit/i,
  /\/benefits/i,
  /\/program/i,
  /\/programs/i,
  /\/service/i,
  /\/services/i,
  /\/assistance/i,
  /\/aid/i,
  /\/support/i,
  /\/resources/i,
  /\/resource/i,
  /\/housing/i,
  /\/food/i,
  /\/shelter/i,
  /\/mental/i,
  /\/health/i,
  /\/medicaid/i,
  /\/snap/i,
  /\/wic/i,
  /\/tanf/i,
  /\/liheap/i,
  /\/child/i,
  /\/family/i,
  /\/utility/i,
  /\/disability/i,
  /\/veteran/i,
  /\/seniors?/i,
  /\/elder/i,
  /\/homeless/i,
  /\/recovery/i,
  /\/counsel/i,
  /\/financial/i,
  /\/emergency/i,
];

const SERVICE_TEXT_PATTERNS = [
  /benefits?/i,
  /programs?/i,
  /services?/i,
  /assistance/i,
  /support/i,
  /resources?/i,
  /housing/i,
  /food/i,
  /shelter/i,
  /mental health/i,
  /health care/i,
  /medicaid/i,
  /snap/i,
  /wic/i,
  /tanf/i,
  /liheap/i,
  /child care/i,
  /family/i,
  /utility/i,
  /disability/i,
  /veteran/i,
  /senior/i,
  /elder/i,
  /homeless/i,
  /recovery/i,
  /counsel/i,
  /financial hardship/i,
  /emergency help/i,
  /basic needs/i,
];

const EXPANDABLE_DISCOVERY_TYPES = new Set([
  'apply',
  'eligibility',
  'intake_form',
  'hours',
  'contact',
]);

type PublishSkipReason =
  | 'no_candidate'
  | 'already_published'
  | 'not_ready'
  | 'below_min_confidence'
  | 'source_quality_not_allowed';

function printUsage(): void {
  console.log([
    'Usage:',
    '  npx tsx scripts/run-ingestion-campaign.ts [--urls-file path] [--url https://...] [more urls...]',
    '',
    'Options:',
    '  --urls-file <path>               Read newline-delimited URLs (supports blank lines and # comments)',
    '  --url <https://...>             Add a URL seed (may be repeated)',
    '  --force-reprocess               Re-run pages even if already seen',
    '  --publish-ready                 Publish newly-ingested candidates that meet readiness gates',
    '  --publish-min-confidence <n>    Minimum confidence for publish pass (default: 80)',
    '  --allowed-source-quality <csv>  Allowed source_quality tags for publish (default: gov_source,edu_source)',
    '  --actor-id <id>                 Audit actor id (default: system:ingestion-campaign)',
    '  --register-hosts <trust>        Upsert exact-host source entries for supplied URLs',
    '                                  Allowed values: allowlisted, quarantine, blocked',
    '  --dry-run                       Validate env/schema/inputs without running ingestion',
    '  --help                          Show this message',
  ].join('\n'));
}

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): CampaignOptions {
  const inlineUrls: string[] = [];
  let urlsFile = '';
  let forceReprocess = false;
  let publishReady = false;
  let publishMinConfidence = 80;
  let allowedSourceQuality = new Set(['gov_source', 'edu_source']);
  let actorId = 'system:ingestion-campaign';
  let registerHosts: SourceTrustLevel | null = null;
  let expandAllowlisted = true;
  let expandDepth = 1;
  let expandMaxPages = 150;
  let expandMaxLinksPerPage = 12;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help') {
      printUsage();
      process.exit(0);
    }

    if (arg === '--urls-file') {
      urlsFile = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (arg === '--url') {
      inlineUrls.push(argv[index + 1] ?? '');
      index += 1;
      continue;
    }

    if (arg === '--force-reprocess') {
      forceReprocess = true;
      continue;
    }

    if (arg === '--publish-ready') {
      publishReady = true;
      continue;
    }

    if (arg === '--publish-min-confidence') {
      publishMinConfidence = Number.parseInt(argv[index + 1] ?? '80', 10);
      index += 1;
      continue;
    }

    if (arg === '--allowed-source-quality') {
      allowedSourceQuality = new Set(
        String(argv[index + 1] ?? '')
          .split(',')
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean),
      );
      index += 1;
      continue;
    }

    if (arg === '--actor-id') {
      actorId = argv[index + 1] ?? actorId;
      index += 1;
      continue;
    }

    if (arg === '--register-hosts') {
      const value = argv[index + 1] ?? '';
      if (value !== 'allowlisted' && value !== 'quarantine' && value !== 'blocked') {
        fail('--register-hosts must be one of: allowlisted, quarantine, blocked');
      }
      registerHosts = value;
      index += 1;
      continue;
    }

    if (arg === '--expand-allowlisted') {
      expandAllowlisted = true;
      continue;
    }

    if (arg === '--no-expand-allowlisted') {
      expandAllowlisted = false;
      continue;
    }

    if (arg === '--expand-depth') {
      expandDepth = Number.parseInt(argv[index + 1] ?? '1', 10);
      index += 1;
      continue;
    }

    if (arg === '--expand-max-pages') {
      expandMaxPages = Number.parseInt(argv[index + 1] ?? '150', 10);
      index += 1;
      continue;
    }

    if (arg === '--expand-max-links-per-page') {
      expandMaxLinksPerPage = Number.parseInt(argv[index + 1] ?? '12', 10);
      index += 1;
      continue;
    }

    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg.startsWith('--')) {
      fail(`Unknown option: ${arg}`);
    }

    inlineUrls.push(arg);
  }

  const fileUrls = urlsFile ? parseUrlFile(urlsFile) : [];
  const urls = Array.from(new Set([...inlineUrls, ...fileUrls].map((value) => value.trim()).filter(Boolean)));

  if (urls.length === 0) {
    fail('Provide at least one URL via --url, a positional URL, or --urls-file');
  }

  for (const url of urls) {
    try {
      new URL(url);
    } catch {
      fail(`Invalid URL: ${url}`);
    }
  }

  if (!Number.isFinite(publishMinConfidence) || publishMinConfidence < 0 || publishMinConfidence > 100) {
    fail('--publish-min-confidence must be between 0 and 100');
  }

  if (allowedSourceQuality.size === 0) {
    fail('--allowed-source-quality must include at least one tag');
  }

  if (!Number.isFinite(expandDepth) || expandDepth < 0 || expandDepth > 3) {
    fail('--expand-depth must be between 0 and 3');
  }

  if (!Number.isFinite(expandMaxPages) || expandMaxPages < urls.length || expandMaxPages > 1000) {
    fail('--expand-max-pages must be at least the seed URL count and no greater than 1000');
  }

  if (!Number.isFinite(expandMaxLinksPerPage) || expandMaxLinksPerPage < 1 || expandMaxLinksPerPage > 50) {
    fail('--expand-max-links-per-page must be between 1 and 50');
  }

  return {
    urls,
    forceReprocess,
    publishReady,
    publishMinConfidence,
    allowedSourceQuality,
    actorId,
    registerHosts,
    expandAllowlisted,
    expandDepth,
    expandMaxPages,
    expandMaxLinksPerPage,
    dryRun,
  };
}

function sameHost(left: string, right: string): boolean {
  return new URL(left).hostname.toLowerCase() === new URL(right).hostname.toLowerCase();
}

function isSkippablePath(url: string): boolean {
  const pathname = new URL(url).pathname;
  return SKIPPED_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}

function isLikelyServiceLink(url: string, label = ''): boolean {
  if (isSkippablePath(url)) {
    return false;
  }

  const pathname = new URL(url).pathname;
  return SERVICE_PATH_PATTERNS.some((pattern) => pattern.test(pathname))
    || SERVICE_TEXT_PATTERNS.some((pattern) => pattern.test(label));
}

function scoreLink(url: string, label = '', discoveryScore = 0): number {
  let score = discoveryScore;
  const pathname = new URL(url).pathname;
  const combinedText = `${pathname} ${label}`;

  if (isLikelyServiceLink(url, label)) {
    score += 0.8;
  }

  if (/\/benefit\//i.test(pathname)) {
    score += 0.4;
  }

  if (/apply|eligib|intake/i.test(combinedText)) {
    score += 0.15;
  }

  if (/contact/i.test(combinedText)) {
    score -= 0.05;
  }

  return score;
}

export function extractExpandableLinks(
  html: string,
  baseUrl: string,
  maxLinksPerPage: number,
): string[] {
  const scored = new Map<string, number>();

  for (const link of discoverLinks(html, baseUrl, {
    includeExternal: false,
    maxLinks: Math.max(maxLinksPerPage * 3, 30),
    minConfidence: 0.3,
  })) {
    if (!sameHost(link.url, baseUrl)) {
      continue;
    }
    if (link.type === 'pdf' || link.type === 'privacy' || link.type === 'home') {
      continue;
    }

    const label = link.label ?? '';
    const shouldInclude = EXPANDABLE_DISCOVERY_TYPES.has(link.type)
      || isLikelyServiceLink(link.url, label);

    if (!shouldInclude) {
      continue;
    }

    const normalizedUrl = canonicalizeUrl(link.url);
    scored.set(normalizedUrl, Math.max(scored.get(normalizedUrl) ?? 0, scoreLink(normalizedUrl, label, link.confidence)));
  }

  const $ = cheerio.load(html);
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) {
      return;
    }

    let resolvedUrl: string;
    try {
      resolvedUrl = canonicalizeUrl(new URL(href, baseUrl).href);
    } catch {
      return;
    }

    if (!sameHost(resolvedUrl, baseUrl)) {
      return;
    }

    const label = $(element).text().trim();
    if (!isLikelyServiceLink(resolvedUrl, label)) {
      return;
    }

    scored.set(resolvedUrl, Math.max(scored.get(resolvedUrl) ?? 0, scoreLink(resolvedUrl, label, 0.35)));
  });

  return Array.from(scored.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, maxLinksPerPage)
    .map(([url]) => url);
}

export async function expandAllowlistedCampaignUrls(options: {
  seedUrls: string[];
  depth: number;
  maxPages: number;
  maxLinksPerPage: number;
}): Promise<{ urls: string[]; summary: CampaignExpansionSummary }> {
  const registry = buildBootstrapRegistry();
  const fetcher = createPageFetcher({ timeoutMs: 20_000, maxRedirects: 8 });
  const seen = new Set<string>();
  const queue: ExpansionQueueItem[] = [];
  const urls: string[] = [];
  const summary: CampaignExpansionSummary = {
    enabled: true,
    seedUrls: options.seedUrls.length,
    expandedUrls: 0,
    fetchedPages: 0,
    skippedNonHtml: 0,
    skippedUnallowlisted: 0,
    skippedFetchErrors: 0,
  };

  for (const seedUrl of options.seedUrls) {
    const normalizedUrl = canonicalizeUrl(seedUrl);
    if (seen.has(normalizedUrl)) {
      continue;
    }
    seen.add(normalizedUrl);
    urls.push(normalizedUrl);
    queue.push({ url: normalizedUrl, depth: 0 });
  }

  while (queue.length > 0 && urls.length < options.maxPages) {
    const current = queue.shift();
    if (!current || current.depth >= options.depth) {
      continue;
    }

    const sourceCheck = matchSourceForUrl(current.url, registry);
    if (!sourceCheck.allowed || sourceCheck.trustLevel !== 'allowlisted') {
      summary.skippedUnallowlisted += 1;
      continue;
    }

    const fetchResult = await fetcher.fetch(current.url);
    if (!isFetchSuccess(fetchResult)) {
      summary.skippedFetchErrors += 1;
      continue;
    }

    summary.fetchedPages += 1;
    if (!fetchResult.contentType?.toLowerCase().includes('html')) {
      summary.skippedNonHtml += 1;
      continue;
    }

    for (const discoveredUrl of extractExpandableLinks(
      fetchResult.body,
      fetchResult.canonicalUrl,
      options.maxLinksPerPage,
    )) {
      if (seen.has(discoveredUrl)) {
        continue;
      }

      const discoveredCheck = matchSourceForUrl(discoveredUrl, registry);
      if (!discoveredCheck.allowed || discoveredCheck.trustLevel !== 'allowlisted') {
        summary.skippedUnallowlisted += 1;
        continue;
      }

      seen.add(discoveredUrl);
      urls.push(discoveredUrl);
      queue.push({ url: discoveredUrl, depth: current.depth + 1 });

      if (urls.length >= options.maxPages) {
        break;
      }
    }
  }

  summary.expandedUrls = Math.max(urls.length - options.seedUrls.length, 0);
  return { urls, summary };
}

function parseUrlFile(filePath: string): string[] {
  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    fail(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function assertSchemaReady(): Promise<void> {
  const pool = getPool();
  const result = await pool.query<{
    sourceSystems: string | null;
    extractedCandidates: string | null;
    candidateReadiness: string | null;
    services: string | null;
  }>(
    `SELECT
        to_regclass('public.source_systems') AS "sourceSystems",
        to_regclass('public.extracted_candidates') AS "extractedCandidates",
        to_regclass('public.candidate_readiness') AS "candidateReadiness",
        to_regclass('public.services') AS "services"`
  );

  const row = result.rows[0];
  const missing = [
    ['source_systems', row?.sourceSystems],
    ['extracted_candidates', row?.extractedCandidates],
    ['candidate_readiness', row?.candidateReadiness],
    ['services', row?.services],
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length > 0) {
    fail(`DATABASE_URL schema is missing required tables: ${missing.join(', ')}`);
  }
}

async function registerHostsIfRequested(
  stores: ReturnType<typeof createIngestionStores>,
  urls: string[],
  trustLevel: SourceTrustLevel | null,
): Promise<number> {
  if (!trustLevel) {
    return 0;
  }

  const grouped = new Map<string, string[]>();
  for (const url of urls) {
    const host = new URL(url).hostname.toLowerCase();
    const current = grouped.get(host) ?? [];
    current.push(url);
    grouped.set(host, current);
  }

  const now = new Date().toISOString();
  for (const [host, seedUrls] of grouped.entries()) {
    const id = `campaign-${host.replace(/[^a-z0-9]+/g, '-')}`;
    await stores.sourceRegistry.upsert({
      id,
      displayName: `Campaign Source: ${host}`,
      trustLevel,
      domainRules: [{ type: 'exact_host', value: host }],
      discovery: [{ type: 'seeded_only', seedUrls }],
      crawl: {
        obeyRobotsTxt: true,
        userAgent: 'oran-ingestion-agent/1.0',
        allowedPathPrefixes: ['/'],
        blockedPathPrefixes: [],
        maxRequestsPerMinute: 60,
        maxConcurrentRequests: 3,
        fetchTtlHours: 24,
      },
      coverage: [{ kind: 'national', country: 'US' }],
      createdAt: now,
      updatedAt: now,
    });
  }

  return grouped.size;
}

async function publishReadyCandidates(options: {
  stores: ReturnType<typeof createIngestionStores>;
  candidateIds: string[];
  actorId: string;
  publishMinConfidence: number;
  allowedSourceQuality: Set<string>;
}): Promise<{
  published: Array<{ candidateId: string; serviceId: string }>;
  skipped: Record<PublishSkipReason, number>;
}> {
  const skipped: Record<PublishSkipReason, number> = {
    no_candidate: 0,
    already_published: 0,
    not_ready: 0,
    below_min_confidence: 0,
    source_quality_not_allowed: 0,
  };
  const published: Array<{ candidateId: string; serviceId: string }> = [];

  for (const candidateId of options.candidateIds) {
    const candidate = await options.stores.candidates.getById(candidateId);
    if (!candidate) {
      skipped.no_candidate += 1;
      continue;
    }

    if (candidate.review.status === 'published') {
      skipped.already_published += 1;
      continue;
    }

    const readiness = await options.stores.publishReadiness.getReadiness(candidateId);
    if (!readiness?.meetsPublishThreshold) {
      skipped.not_ready += 1;
      continue;
    }

    if (readiness.confidenceScore < options.publishMinConfidence) {
      skipped.below_min_confidence += 1;
      continue;
    }

    const qualityTags = await options.stores.tags.listByType(candidateId, 'candidate', 'source_quality');
    const hasAllowedSourceQuality = qualityTags.some((tag) =>
      options.allowedSourceQuality.has(tag.tagValue.toLowerCase()),
    );

    if (!hasAllowedSourceQuality) {
      skipped.source_quality_not_allowed += 1;
      continue;
    }

    const result = await publishCandidateToLiveService({
      stores: options.stores,
      candidateId,
      publishedByUserId: options.actorId,
      geocode: isGeocodingConfigured() ? geocode : undefined,
    });

    await options.stores.candidates.markPublished(candidateId, result.serviceId, options.actorId);
    published.push({ candidateId, serviceId: result.serviceId });
  }

  return { published, skipped };
}

export async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  requireEnv('DATABASE_URL');
  requireEnv('LLM_ENDPOINT');
  requireEnv('LLM_API_KEY');
  await assertSchemaReady();

  let campaignUrls = options.urls;
  let expansionSummary: CampaignExpansionSummary = {
    enabled: false,
    seedUrls: options.urls.length,
    expandedUrls: 0,
    fetchedPages: 0,
    skippedNonHtml: 0,
    skippedUnallowlisted: 0,
    skippedFetchErrors: 0,
  };

  if (options.expandAllowlisted && options.expandDepth > 0) {
    const expanded = await expandAllowlistedCampaignUrls({
      seedUrls: options.urls,
      depth: options.expandDepth,
      maxPages: options.expandMaxPages,
      maxLinksPerPage: options.expandMaxLinksPerPage,
    });
    campaignUrls = expanded.urls;
    expansionSummary = expanded.summary;
  }

  const db = getDb();
  const stores = createIngestionStores(db);

  const registeredHosts = await registerHostsIfRequested(stores, campaignUrls, options.registerHosts);

  console.log(`Seed URLs: ${options.urls.length}`);
  console.log(`URLs queued: ${campaignUrls.length}`);
  console.log(`Publish pass: ${options.publishReady ? 'enabled' : 'disabled'}`);
  console.log(`Allowlisted expansion: ${options.expandAllowlisted ? 'enabled' : 'disabled'}`);
  console.log(`Registered hosts: ${registeredHosts}`);

  if (options.dryRun) {
    console.log('Dry run complete. Runtime and schema checks passed.');
    return;
  }

  const service = createIngestionService(stores);
  const candidateIds = new Set<string>();
  const failedRuns: Array<{ url: string; error: string }> = [];
  let completedRuns = 0;

  for (const [index, url] of campaignUrls.entries()) {
    process.stdout.write(`[${index + 1}/${campaignUrls.length}] ${url}\n`);
    try {
      const result = await service.runPipeline({
        sourceUrl: url,
        forceReprocess: options.forceReprocess,
        triggeredBy: options.actorId,
      });
      completedRuns += 1;
      if (result.pipeline.candidateId) {
        candidateIds.add(result.pipeline.candidateId);
      }
      process.stdout.write(
        `  status=${result.pipeline.status} candidate=${result.pipeline.candidateId ?? '-'} score=${result.pipeline.confidenceScore ?? '-'} tier=${result.pipeline.confidenceTier ?? '-'}\n`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failedRuns.push({ url, error: message });
      process.stdout.write(`  failed=${message}\n`);
    }
  }

  let publishSummary = {
    published: [] as Array<{ candidateId: string; serviceId: string }>,
    skipped: {
      no_candidate: 0,
      already_published: 0,
      not_ready: 0,
      below_min_confidence: 0,
      source_quality_not_allowed: 0,
    },
  };

  if (options.publishReady && candidateIds.size > 0) {
    publishSummary = await publishReadyCandidates({
      stores,
      candidateIds: Array.from(candidateIds),
      actorId: options.actorId,
      publishMinConfidence: options.publishMinConfidence,
      allowedSourceQuality: options.allowedSourceQuality,
    });
  }

  console.log(JSON.stringify({
    seedUrlsSubmitted: options.urls.length,
    urlsSubmitted: campaignUrls.length,
    runsCompleted: completedRuns,
    runsFailed: failedRuns.length,
    candidateIds: Array.from(candidateIds),
    failedRuns,
    expansion: expansionSummary,
    publish: {
      attempted: options.publishReady,
      minConfidence: options.publishMinConfidence,
      allowedSourceQuality: Array.from(options.allowedSourceQuality),
      publishedCount: publishSummary.published.length,
      published: publishSummary.published,
      skipped: publishSummary.skipped,
    },
  }, null, 2));

  if (failedRuns.length > 0) {
    process.exitCode = 1;
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
