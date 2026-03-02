import type { NextRequest } from 'next/server';

/**
 * Best-effort client IP extraction.
 *
 * Privacy note:
 * - This should only be used for in-memory rate limiting / abuse controls.
 * - Do not log or persist raw IPs.
 */
export function getIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }

  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  // Next.js may expose ip in some runtimes; keep this optional.
  const maybeIp = (req as unknown as { ip?: string }).ip;
  if (maybeIp && typeof maybeIp === 'string' && maybeIp.trim()) return maybeIp.trim();

  return 'unknown';
}
