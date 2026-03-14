/**
 * POST /api/locale
 *
 * Sets the NEXT_LOCALE cookie so the server-side locale resolver picks up the
 * user's language preference on the next (and future) request.
 *
 * Body: { locale: LocaleCode }
 * Response: { ok: true, locale: string } | { error: string }
 *
 * Security notes:
 *  - Validates locale against SUPPORTED_LOCALES before setting the cookie.
 *  - Cookie is HttpOnly=true (not readable by JS; server reads it via cookies()).
 *  - SameSite=Lax prevents cross-site misuse.
 *  - Secure flag enabled in production.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { SUPPORTED_LOCALES, type LocaleCode } from '@/services/i18n/i18n';
import { LOCALE_COOKIE } from '@/lib/locale';

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

export async function POST(req: NextRequest) {
  // Reject non-JSON requests
  const ct = req.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    return NextResponse.json({ error: 'Expected application/json' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || !('locale' in body)) {
    return NextResponse.json({ error: 'Missing locale field' }, { status: 400 });
  }

  const locale = (body as Record<string, unknown>).locale;

  if (
    typeof locale !== 'string' ||
    !(SUPPORTED_LOCALES as readonly string[]).includes(locale)
  ) {
    return NextResponse.json(
      { error: `Unsupported locale. Must be one of: ${SUPPORTED_LOCALES.join(', ')}` },
      { status: 400 }
    );
  }

  const res = NextResponse.json({ ok: true, locale });

  res.cookies.set(LOCALE_COOKIE, locale as LocaleCode, {
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
  });

  return res;
}
