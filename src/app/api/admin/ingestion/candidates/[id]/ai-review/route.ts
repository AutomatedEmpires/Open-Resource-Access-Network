import { NextResponse } from 'next/server';

/**
 * The former provider-specific review assistant is retired. Candidate review
 * continues through stored evidence and the existing two-person approval flow.
 */
export async function GET() {
  return NextResponse.json(
    { error: 'Automated candidate review is retired and unavailable.' },
    { status: 410, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
