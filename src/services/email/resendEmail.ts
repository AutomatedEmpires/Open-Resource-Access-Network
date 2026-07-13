/**
 * Resend transactional email dispatch.
 *
 * Requires both RESEND_API_KEY and RESEND_FROM. The sender must be authorized
 * for the dedicated ORAN Resend account.
 *
 * @see https://resend.com/docs/api-reference/emails/send-email
 */

import { Resend } from 'resend';
import { captureException } from '@/services/telemetry/sentry';

let client: Resend | null = null;

function configuredValue(name: 'RESEND_API_KEY' | 'RESEND_FROM'): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function getClient(): Resend | null {
  if (client) return client;

  const apiKey = configuredValue('RESEND_API_KEY');
  if (!apiKey || !configuredValue('RESEND_FROM')) return null;

  client = new Resend(apiKey);
  return client;
}

/** Returns true only when the complete Resend configuration is present. */
export function isEmailConfigured(): boolean {
  return Boolean(configuredValue('RESEND_API_KEY') && configuredValue('RESEND_FROM'));
}

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body. */
  text: string;
  /** Optional HTML body. */
  html?: string;
}

/**
 * Sends one transactional email.
 *
 * Returns the Resend message ID on success, or null when unconfigured or when
 * delivery fails. Email remains best-effort and never blocks the notification
 * pipeline. Telemetry intentionally excludes recipient and message content.
 */
export async function sendEmail(message: EmailMessage): Promise<string | null> {
  const resend = getClient();
  const from = configuredValue('RESEND_FROM');

  if (!resend || !from) {
    console.warn('[email] Resend not configured — skipping email delivery');
    return null;
  }

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    if (error) {
      await captureException(error, {
        feature: 'email_send',
        extra: { provider: 'resend' },
      });
      console.error('[email] Failed to send email via Resend');
      return null;
    }

    return data?.id ?? null;
  } catch (error) {
    await captureException(error, {
      feature: 'email_send',
      extra: { provider: 'resend' },
    });
    console.error('[email] Failed to send email via Resend');
    return null;
  }
}

/** @internal Reset the singleton between tests. */
export function _resetClient(): void {
  client = null;
}
