import { NextResponse } from 'next/server';
import { getAuthContext } from '@/services/auth/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const context = await getAuthContext();
  if (!context) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(
    {
      userId: context.userId,
      role: context.role,
      accountStatus: context.accountStatus,
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
