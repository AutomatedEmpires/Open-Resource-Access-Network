/**
 * Resend — Transactional Email Dispatch
 *
 * Portfolio-standard email delivery (aligns ORAN with the rest of the Automated
 * Empires stack, which uses Resend). Replaces the former Azure Communication
 * Services adapter with a dependency-free REST call so there is no SDK to load
 * and delivery stays fail-open.
 *
 * Requires env:
 *   RESEND_API_KEY — API key from the Resend dashboard.
 *   RESEND_FROM    — verified sender, e.g. "ORAN <notifications@oran.example>".
 *
 * @see https://resend.com/docs/api-reference/emails/send-email
 */

import { captureException } from '@/services/telemetry/sentry';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_FROM = 'ORAN <onboarding@resend.dev>';

// ============================================================
// TYPES
// ============================================================

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text body */
  text: string;
  /** Optional HTML body */
  html?: string;
}

// ============================================================
// CONFIG
// ============================================================

/**
 * Returns true when Resend is configured.
 */
export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

// ============================================================
// SEND EMAIL
// ============================================================

/**
 * Send an email via Resend.
 *
 * Returns the message ID on success, or null on failure. Failures are logged to
 * telemetry but do not throw — email delivery must never block the notification
 * pipeline.
 */
export async function sendEmail(message: EmailMessage): Promise<string | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[email] Resend not configured — skipping email delivery');
    return null;
  }

  const from = process.env.RESEND_FROM?.trim() || DEFAULT_FROM;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(`[email] Resend returned ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
      return null;
    }

    const data = (await res.json()) as { id?: string };
    return data.id ?? null;
  } catch (error) {
    await captureException(error, { feature: 'email_send' });
    console.error('[email] Failed to send email:', error instanceof Error ? error.message : error);
    return null;
  }
}

// ============================================================
// TEST HELPER — retained for API parity with prior adapter
// ============================================================

/** @internal — no persistent client to reset; kept for call-site compatibility. */
export function _resetClient(): void {
  // no-op: the Resend adapter is stateless (per-request fetch).
}
