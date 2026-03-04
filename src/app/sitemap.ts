/**
 * Dynamic Sitemap
 *
 * Generates sitemap.xml for all public pages including
 * service detail pages fetched from the database.
 *
 * Next.js App Router: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap
 */

import type { MetadataRoute } from 'next';

const BASE_URL = 'https://openresourceaccessnetwork.com';

/** Fetch all public service IDs for sitemap inclusion. */
async function fetchPublicServiceIds(): Promise<string[]> {
  try {
    // Use internal API to fetch active service IDs.
    // In production this runs server-side and has direct DB access.
    const res = await fetch(`${BASE_URL}/api/search?status=active&limit=500&page=1`, {
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

  // Static public pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/chat`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/directory`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/map`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.8,
    },
  ];

  // Dynamic service detail pages
  const serviceIds = await fetchPublicServiceIds();
  const servicePages: MetadataRoute.Sitemap = serviceIds.map((id) => ({
    url: `${BASE_URL}/service/${id}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));

  return [...staticPages, ...servicePages];
}
