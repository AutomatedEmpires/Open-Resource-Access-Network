/**
 * Service Detail Page — Server Component wrapper with dynamic metadata.
 * generateMetadata fetches service data to build og:title, description, etc.
 * Client-side rendering is handled by ServiceDetailClient.
 */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import ServiceDetailContent from './ServiceDetailClient';

async function getBaseUrlFromHeaders(): Promise<string> {
  const defaultBaseUrl = 'https://openresourceaccessnetwork.com';

  // Prefer proxy headers (Vercel/Azure/App Service) when available.
  // In unit tests / build-time environments there may be no request context,
  // and `headers()` can throw — fall back to the canonical base URL.
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

interface ServiceDetailPageProps {
  params: Promise<{ id: string }>;
}

interface ServiceMeta {
  name: string;
  orgName: string;
  description: string;
  address?: string;
  phone?: string;
  url?: string;
}

async function fetchServiceMeta(id: string, baseUrl: string): Promise<ServiceMeta | null> {
  try {
    const res = await fetch(`${baseUrl}/api/services?ids=${encodeURIComponent(id)}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: Array<{
        service: { id: string; name: string; description?: string; url?: string };
        organization?: { name: string };
        location?: { address?: string };
        phones?: Array<{ number: string }>;
      }>;
    };
    const item = data.results?.[0];
    if (!item) return null;
    return {
      name: item.service.name,
      orgName: item.organization?.name ?? 'Unknown Organization',
      description: item.service.description ?? '',
      address: item.location?.address,
      phone: item.phones?.[0]?.number,
      url: item.service.url,
    };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: ServiceDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const baseUrl = await getBaseUrlFromHeaders();
  const meta = await fetchServiceMeta(id, baseUrl);

  if (!meta) {
    return {
      title: 'Service Details',
      robots: { index: false },
    };
  }

  const title = `${meta.name} — ${meta.orgName}`;
  const description =
    meta.description.length > 0
      ? `${meta.description.slice(0, 155)}${meta.description.length > 155 ? '…' : ''}`
      : `Find details, hours, eligibility, and contact information for ${meta.name} at ${meta.orgName}.`;

  return {
    title,
    description,
    alternates: { canonical: `/service/${id}` },
    openGraph: {
      title: `${title} | ORAN`,
      description,
      url: `${baseUrl}/service/${id}`,
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title: `${title} | ORAN`,
      description,
    },
  };
}

/** Build JSON-LD BreadcrumbList schema */
function buildBreadcrumbJsonLd(baseUrl: string, id: string, serviceName: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: baseUrl,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Directory',
        item: `${baseUrl}/directory`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: serviceName,
        item: `${baseUrl}/service/${id}`,
      },
    ],
  };
}

/** Build JSON-LD LocalBusiness/GovernmentService schema */
function buildServiceJsonLd(baseUrl: string, id: string, meta: ServiceMeta) {
  return {
    '@context': 'https://schema.org',
    '@type': 'GovernmentService',
    name: meta.name,
    description: meta.description || undefined,
    provider: {
      '@type': 'Organization',
      name: meta.orgName,
    },
    url: meta.url || `${baseUrl}/service/${id}`,
    ...(meta.address && {
      areaServed: {
        '@type': 'Place',
        address: meta.address,
      },
    }),
    ...(meta.phone && {
      contactPoint: {
        '@type': 'ContactPoint',
        telephone: meta.phone,
        contactType: 'customer service',
      },
    }),
  };
}

export default async function ServiceDetailPage({ params }: ServiceDetailPageProps) {
  const { id } = await params;
  const baseUrl = await getBaseUrlFromHeaders();
  const meta = await fetchServiceMeta(id, baseUrl);

  return (
    <>
      {meta && (
        <>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(buildBreadcrumbJsonLd(baseUrl, id, meta.name)),
            }}
          />
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(buildServiceJsonLd(baseUrl, id, meta)),
            }}
          />
        </>
      )}
      <ServiceDetailContent serviceId={id} />
    </>
  );
}
