/**
 * GET /api/maps/token
 *
 * Retired Azure Maps token broker. The seeker map uses Leaflet/open tiles and
 * does not need a browser credential. Keeping an explicit Gone response stops
 * stale clients from ever receiving a retired Microsoft token.
 */

import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    { error: 'Map token brokerage has been retired.' },
    {
      status: 410,
      headers: {
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    },
  );
}
