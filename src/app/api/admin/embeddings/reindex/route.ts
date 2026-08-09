import { NextResponse } from 'next/server';

/**
 * Retained as an explicit tombstone so stale admin clients cannot reactivate
 * the retired Foundry embedding transport through old credentials or flags.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'Embedding reindexing is retired and unavailable.' },
    { status: 410, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
