/**
 * Organization Public Profile Page — Server Component with dynamic metadata.
 *
 * Fetches org data from /api/organizations/[id] for SEO metadata + JSON-LD.
 * Client-side rendering handled by OrgProfileClient.
 */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import OrgProfileClient from './OrgProfileClient';

async function getBaseUrlFromHeaders(): Promise<string> {
  const defaultBaseUrl = 'https://openresourceaccessnetwork.com';
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    if (!host) return defaultBaseUrl;
    const protoFromHeader = h.get('x-forwarded-proto');
    const isLocalHost = host.includes('localhost') || host.startsWith('127.0.0.1');
    const proto = protoFromHeader ?? (isLocalHost ? 'http' : 'https');
    return `${proto}://${host}`;
  } catch {
    return defaultBaseUrl;
  }
}

interface OrgPageProps {
  params: Promise<{ id: string }>;
}

interface OrgMeta {
  name: string;
  description: string;
  url?: string;
  serviceCount: number;
}

async function fetchOrgMeta(id: string, baseUrl: string): Promise<OrgMeta | null> {
  try {
    const res = await fetch(`${baseUrl}/api/organizations/${encodeURIComponent(id)}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      name: data.organization?.name ?? 'Unknown Organization',
      description: data.organization?.description ?? '',
      url: data.organization?.url,
      serviceCount: data.serviceCount ?? 0,
    };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: OrgPageProps): Promise<Metadata> {
  const { id } = await params;
  const baseUrl = await getBaseUrlFromHeaders();
  const meta = await fetchOrgMeta(id, baseUrl);

  if (!meta) {
    return { title: 'Organization Profile', robots: { index: false } };
  }

  const title = meta.name;
  const description =
    meta.description.length > 0
      ? `${meta.description.slice(0, 155)}${meta.description.length > 155 ? '…' : ''}`
      : `${meta.name} offers ${meta.serviceCount} service${meta.serviceCount !== 1 ? 's' : ''} through the Open Resource Access Network.`;

  return {
    title,
    description,
    alternates: { canonical: `/org/${id}` },
    openGraph: {
      title: `${title} | ORAN`,
      description,
      url: `${baseUrl}/org/${id}`,
      type: 'website',
    },
    twitter: { card: 'summary', title: `${title} | ORAN`, description },
  };
}

function buildOrgJsonLd(baseUrl: string, id: string, name: string, description: string, url?: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name,
    description: description || undefined,
    url: url || `${baseUrl}/org/${id}`,
  };
}

/** Safely serialize JSON-LD to prevent script injection via </script> sequences */
function safeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export default async function OrgProfilePage({ params }: OrgPageProps) {
  const { id } = await params;
  const baseUrl = await getBaseUrlFromHeaders();
  const meta = await fetchOrgMeta(id, baseUrl);

  return (
    <>
      {meta && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLd(
              buildOrgJsonLd(baseUrl, id, meta.name, meta.description, meta.url),
            ),
          }}
        />
      )}
      <OrgProfileClient orgId={id} />
    </>
  );
}
