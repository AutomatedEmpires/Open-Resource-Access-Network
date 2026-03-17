import { SITE } from '@/lib/site';

const EXPIRES = '2027-03-16T00:00:00.000Z';

export function GET() {
  const body = [
    'Contact: https://github.com/AutomatedEmpires/Open-Resource-Access-Network/security/advisories/new',
    'Contact: https://openresourceaccessnetwork.com/contact',
    `Expires: ${EXPIRES}`,
    'Preferred-Languages: en',
    `Canonical: ${SITE.baseUrl}/.well-known/security.txt`,
    `${SITE.acronym}: ${SITE.legalName}`,
    `Policy: ${SITE.baseUrl}/security`,
    `Hiring: ${SITE.baseUrl}/about/team`,
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=86400',
    },
  });
}
