import { NextResponse } from 'next/server';

const retiredResponse = () => NextResponse.json(
  {
    error: 'Speech synthesis is unavailable. Use your device or browser read-aloud tools.',
  },
  { status: 410, headers: { 'Cache-Control': 'private, no-store' } },
);

/** Retired provider endpoint retained only as a fail-closed compatibility path. */
export async function POST() {
  return retiredResponse();
}

export async function GET() {
  return retiredResponse();
}
