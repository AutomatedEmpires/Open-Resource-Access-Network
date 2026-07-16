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

/** Fetch all public service IDs for sitemap inclusion. */
async function fetchPublicServiceIds(): Promise<string[]> {
  try {
    const baseUrl = assertAllowedRuntimeEndpoint(SITE.baseUrl, 'sitemap base URL');
    // Use internal API to fetch active service IDs.
    // In production this runs server-side and has direct DB access.
    const res = await fetch(`${baseUrl}/api/search?status=active&limit=500&page=1`, {
      next: { revalidate: 3600 }, // Revalidate every hour
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: Array<{ service: { id: string } }> };
    return data.results?.map((r) => r.service.id) ?? [];
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
