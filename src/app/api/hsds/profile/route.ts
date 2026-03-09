/**
 * GET /api/hsds/profile
 *
 * HSDS-compliant root profile endpoint.
 * Returns ORAN HSDS profile metadata: version, profile URI,
 * supported endpoints, and publication policy.
 *
 * This is the HSDS `GET /` equivalent — profile discovery for
 * HSDS-oriented toolchains and validators.
 */

import { NextResponse } from 'next/server';

const ORAN_HSDS_PROFILE = {
  id: 'oran-hsds-profile',
  name: 'ORAN HSDS Profile',
  description:
    'Open Resource Access Network — civic-grade HSDS-compatible service directory. ' +
    'Publishes only canonical approved records from verified and curated sources.',
  profile_uri: 'https://openreferral.org/imls/hsds/',
  hsds_version: '3.0',
  endpoints: [
    { path: '/api/hsds/services', method: 'GET', description: 'List published services' },
    { path: '/api/hsds/services/{id}', method: 'GET', description: 'Get service by ID' },
    { path: '/api/hsds/organizations', method: 'GET', description: 'List published organizations' },
    { path: '/api/hsds/organizations/{id}', method: 'GET', description: 'Get organization by ID' },
    { path: '/api/hsds/profile', method: 'GET', description: 'Profile metadata (this endpoint)' },
  ],
  publication_policy: {
    source: 'canonical_approved_only',
    raw_source_records_exposed: false,
    extracted_candidates_exposed: false,
  },
} as const;

export async function GET() {
  return NextResponse.json(ORAN_HSDS_PROFILE, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
