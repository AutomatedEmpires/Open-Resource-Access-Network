/**
 * Dynamic Sitemap
 *
 * Generates sitemap.xml for all public pages including
 * service detail pages fetched from the database.
 *
 * Next.js App Router: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap
 */

import type { MetadataRoute } from 'next';
import { PUBLIC_SITEMAP_ENTRIES, SITE } from '@/lib/site';
import { assertAllowedRuntimeEndpoint } from '@/services/runtime/providerPolicy';

/** /api/search caps limit at 100 — request full pages up to this many. */
const SITEMAP_SERVICE_PAGE_SIZE = 100;
const SITEMAP_SERVICE_MAX_PAGES = 5;

interface SitemapSearchResponse {
  results?: Array<{ service?: { service?: { id?: unknown } } }>;
  hasMore?: boolean;
}

/** Fetch public service IDs for sitemap inclusion (paged, capped at 500). */
async function fetchPublicServiceIds(): Promise<string[]> {
  try {
    const baseUrl = assertAllowedRuntimeEndpoint(SITE.baseUrl, 'sitemap base URL');
    const ids: string[] = [];

    for (let page = 1; page <= SITEMAP_SERVICE_MAX_PAGES; page += 1) {
      const res = await fetch(
        `${baseUrl}/api/search?limit=${SITEMAP_SERVICE_PAGE_SIZE}&page=${page}`,
        { next: { revalidate: 3600 } }, // Revalidate every hour
      );
      if (!res.ok) break;

      const data = (await res.json()) as SitemapSearchResponse;
      // SearchResult nests the record as result.service.service.
      for (const result of data.results ?? []) {
        const id = result?.service?.service?.id;
        if (typeof id === 'string' && id.length > 0) {
          ids.push(id);
        }
      }
      if (!data.hasMore) break;
    }

    return ids;
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const baseUrl = assertAllowedRuntimeEndpoint(SITE.baseUrl, 'sitemap base URL');

  // Static public pages
  const staticPages: MetadataRoute.Sitemap = PUBLIC_SITEMAP_ENTRIES.map((entry) => ({
    url: `${baseUrl}${entry.path}`,
    lastModified: now,
    changeFrequency: entry.changeFrequency,
    priority: entry.priority,
  }));

  // Dynamic service detail pages
  const serviceIds = await fetchPublicServiceIds();
  const servicePages: MetadataRoute.Sitemap = serviceIds.map((id) => ({
    url: `${baseUrl}/service/${id}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));

  return [...staticPages, ...servicePages];
}
