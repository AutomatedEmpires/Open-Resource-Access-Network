import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Security Policy',
  description: 'ORAN security practices and responsible disclosure policy.',
};

const IN_SCOPE = [
  'ORAN web application (oranhf57ir-prod-web.azurewebsites.net)',
  'All public API endpoints (/api/**)',
  'Authentication and session management',
  'Data submission and search pipeline',
];

const OUT_OF_SCOPE = [
  'Third-party services (Azure Maps, Microsoft Entra ID, Azure infrastructure)',
  'Denial-of-service attacks',
  'Social engineering or phishing attempts against ORAN staff',
  'Physical security',
];

const SECURITY_PRACTICES = [
  {
    area: 'Authentication',
    detail:
      'Microsoft Entra ID via NextAuth.js. All protected routes gated server-side. Sessions fail closed if auth is misconfigured.',
  },
  {
    area: 'Authorization',
    detail:
      'Role-based access control (RBAC) enforced at both middleware and API handler level. Principle of least privilege.',
  },
  {
    area: 'Input validation',
    detail:
      'All API routes validate untrusted input with Zod before processing. No raw SQL string interpolation.',
  },
  {
    area: 'Encryption in transit',
    detail: 'TLS enforced on all endpoints. HTTPS-only. No mixed content.',
  },
  {
    area: 'Encryption at rest',
    detail: 'Database encrypted at rest via Azure Database for PostgreSQL Flexible Server.',
  },
  {
    area: 'PII in telemetry',
    detail:
      'Sentry error traces are anonymized. No user identifiers or location data in telemetry payloads.',
  },
  {
    area: 'Content Security Policy',
    detail: 'CSP header applied sitewide. No CORS wildcard. Same-origin policy default.',
  },
  {
    area: 'Rate limiting',
    detail:
      'In-memory sliding-window rate limiting on all API routes. 429 responses include Retry-After headers.',
  },
  {
    area: 'Dependency management',
    detail:
      'Dependabot security alerts enabled. npm audit runs in CI on every pull request. High-severity CVEs block merging.',
  },
];

export default function SecurityPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      {/* Page header */}
      <div className="mb-10 border-b border-gray-200 pb-8">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-red-50">
          <span className="text-xl" aria-hidden="true">🛡️</span>
        </div>
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-gray-900">
          Security Policy
        </h1>
        <p className="text-gray-600 leading-relaxed max-w-xl">
          ORAN handles authentication, location data, and health-adjacent service queries. We
          take security seriously and welcome responsible disclosure from the research community.
        </p>
      </div>

      {/* Reporting */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">
          Reporting a vulnerability
        </h2>
        <p className="mb-4 text-sm text-gray-700 leading-relaxed">
          If you discover a security vulnerability, please report it privately. Do not open a
          public GitHub issue for security-sensitive findings.
        </p>
        <div className="space-y-3">
          <a
            href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network/security/advisories/new"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-5 py-4 text-sm transition-colors hover:border-red-200 hover:bg-red-50"
          >
            <div>
              <p className="font-medium text-gray-900">GitHub private advisory</p>
              <p className="mt-0.5 text-gray-500">Preferred method — encrypted, tracked.</p>
            </div>
            <span className="text-gray-400" aria-hidden="true">→</span>
          </a>
          <Link
            href="/contact"
            className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-5 py-4 text-sm transition-colors hover:border-red-200 hover:bg-red-50"
          >
            <div>
              <p className="font-medium text-gray-900">Contact form</p>
              <p className="mt-0.5 text-gray-500">Select &ldquo;Security&rdquo; as the category.</p>
            </div>
            <span className="text-gray-400" aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      {/* Scope */}
      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Scope</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-3 text-sm font-medium text-green-700">In scope</h3>
            <ul className="space-y-2">
              {IN_SCOPE.map((item) => (
                <li key={item} className="flex gap-2 text-sm text-gray-700">
                  <span className="mt-0.5 shrink-0 text-green-500" aria-hidden="true">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-3 text-sm font-medium text-gray-500">Out of scope</h3>
            <ul className="space-y-2">
              {OUT_OF_SCOPE.map((item) => (
                <li key={item} className="flex gap-2 text-sm text-gray-600">
                  <span className="mt-0.5 shrink-0 text-gray-400" aria-hidden="true">✗</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Our commitments */}
      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Our commitments</h2>
        <div className="space-y-3 text-sm text-gray-700">
          <div className="flex gap-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
            <span className="shrink-0 font-mono text-gray-600">48h</span>
            <span>Acknowledge all vulnerability reports within 48 hours.</span>
          </div>
          <div className="flex gap-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
            <span className="shrink-0 font-mono text-gray-600">14d</span>
            <span>Remediate critical vulnerabilities within 14 days of confirmation.</span>
          </div>
          <div className="flex gap-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
            <span className="shrink-0 font-mono text-gray-600">✓</span>
            <span>
              No legal action against researchers acting in good faith, following this policy,
              and not accessing or exfiltrating user data beyond what is necessary to demonstrate
              the vulnerability.
            </span>
          </div>
          <div className="flex gap-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
            <span className="shrink-0 font-mono text-gray-600">✓</span>
            <span>
              Credit in release notes for responsibly disclosed, confirmed vulnerabilities
              (unless the researcher prefers anonymity).
            </span>
          </div>
          <div className="flex gap-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
            <span className="shrink-0 font-mono text-gray-600">ℹ</span>
            <span>
              ORAN does not currently operate a paid bug bounty program. All qualifying reporters
              receive public attribution (with consent) and our formal thanks.
            </span>
          </div>
        </div>
      </section>

      {/* Security practices */}
      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Security practices</h2>
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left font-medium text-gray-500 w-40">Area</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {SECURITY_PRACTICES.map(({ area, detail }) => (
                <tr key={area}>
                  <td className="px-4 py-3 font-medium text-gray-900 align-top">{area}</td>
                  <td className="px-4 py-3 text-gray-600 leading-relaxed">{detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Full technical control details in{' '}
          <a
            href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network/blob/main/docs/SECURITY_PRIVACY.md"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-700"
          >
            docs/SECURITY_PRIVACY.md
          </a>
          . See also our{' '}
          <Link href="/privacy" className="underline hover:text-gray-700">
            Privacy Policy
          </Link>{' '}
          for telemetry and data collection details.
        </p>
      </section>

      {/* Known disclosures */}
      <section className="mb-10">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Past disclosures</h2>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-5 py-8 text-center">
          <p className="text-sm text-gray-500">No disclosures on record.</p>
        </div>
      </section>

      {/* SECURITY.md link */}
      <div className="mb-3 flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-5 py-4">
        <div>
          <p className="text-sm font-medium text-gray-900">Machine-readable disclosure file</p>
          <p className="mt-0.5 text-xs text-gray-500">
            SECURITY.md in the repository root for automated tooling.
          </p>
        </div>
        <a
          href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network/blob/main/SECURITY.md"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        >
          View SECURITY.md →
        </a>
      </div>
      <p className="mb-8 text-xs text-gray-500">
        A{' '}
        <a
          href="https://securitytxt.org"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-gray-700"
        >
          security.txt
        </a>
        {' '}file at{' '}
        <code className="rounded bg-gray-100 px-1 py-0.5 font-mono">/.well-known/security.txt</code>
        {' '}is planned for a future release.
      </p>

      {/* Related */}
      <nav aria-label="Related pages" className="border-t border-gray-200 pt-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">Related</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Link href="/privacy" className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50">
            <span className="font-medium text-gray-900">Privacy Policy</span>
            <span className="text-gray-400" aria-hidden="true">→</span>
          </Link>
          <Link href="/contact" className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50">
            <span className="font-medium text-gray-900">Contact</span>
            <span className="text-gray-400" aria-hidden="true">→</span>
          </Link>
          <a
            href="https://github.com/AutomatedEmpires/Open-Resource-Access-Network/security/advisories"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
          >
            <span className="font-medium text-gray-900">GitHub Advisories</span>
            <span className="text-gray-400" aria-hidden="true">↗</span>
          </a>
        </div>
      </nav>
    </div>
  );
}
