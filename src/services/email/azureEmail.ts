/**
 * Azure Communication Services — Email Dispatch
 *
 * Sends transactional email via Azure Communication Services.
 * Requires AZURE_COMMUNICATION_CONNECTION_STRING in environment.
 *
 * @see https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/email/send-email
 */

import { EmailClient } from '@azure/communication-email';
import { captureException } from '@/services/telemetry/sentry';

// ============================================================
// CLIENT SINGLETON
// ============================================================

let client: EmailClient | null = null;

function getClient(): EmailClient | null {
  if (client) return client;

  const connectionString = process.env.AZURE_COMMUNICATION_CONNECTION_STRING;
  if (!connectionString) return null;

  client = new EmailClient(connectionString);
  return client;
}

/**
 * Returns true when Azure Communication Services is configured.
 */
export function isEmailConfigured(): boolean {
  return !!process.env.AZURE_COMMUNICATION_CONNECTION_STRING;
}

// ============================================================
// SEND EMAIL
// ============================================================

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text body */
  text: string;
  /** Optional HTML body */
  html?: string;
}

/**
 * Send an email via Azure Communication Services.
 *
 * Returns the message ID on success, or null on failure.
 * Failures are logged to telemetry but do not throw — email
 * delivery must never block the notification pipeline.
 */
export async function sendEmail(message: EmailMessage): Promise<string | null> {
  const emailClient = getClient();
  if (!emailClient) {
    console.warn('[email] Azure Communication Services not configured — skipping email delivery');
    return null;
  }

  const senderAddress = process.env.AZURE_COMMUNICATION_SENDER_ADDRESS
    ?? 'DoNotReply@oran.azure.com';

  try {
    const poller = await emailClient.beginSend({
      senderAddress,
      content: {
        subject: message.subject,
        plainText: message.text,
        html: message.html,
      },
      recipients: {
        to: [{ address: message.to }],
      },
    });

    const result = await poller.pollUntilDone();
    return result.id ?? null;
  } catch (error) {
    await captureException(error, { feature: 'email_send' });
    console.error('[email] Failed to send email:', error instanceof Error ? error.message : error);
    return null;
  }
}

// ============================================================
// TEST HELPER — reset singleton between tests
// ============================================================

/** @internal */
export function _resetClient(): void {
  client = null;
}
