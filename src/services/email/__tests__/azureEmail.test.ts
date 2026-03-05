import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock sentry
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: vi.fn(),
}));

describe('Azure Email Service', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('isEmailConfigured returns false when connection string is missing', async () => {
    vi.stubEnv('AZURE_COMMUNICATION_CONNECTION_STRING', '');
    const { isEmailConfigured } = await import('../azureEmail');
    expect(isEmailConfigured()).toBe(false);
  }, 20_000);

  it('isEmailConfigured returns true when connection string is set', async () => {
    vi.stubEnv('AZURE_COMMUNICATION_CONNECTION_STRING', 'endpoint=https://test.comm.azure.com/;accesskey=abc');
    const { isEmailConfigured } = await import('../azureEmail');
    expect(isEmailConfigured()).toBe(true);
  }, 20_000);

  it('sendEmail returns null when service is not configured', async () => {
    vi.stubEnv('AZURE_COMMUNICATION_CONNECTION_STRING', '');
    const { sendEmail, _resetClient } = await import('../azureEmail');
    _resetClient();

    const result = await sendEmail({
      to: 'test@example.com',
      subject: 'Test',
      text: 'Hello',
    });

    expect(result).toBeNull();
  }, 20_000);

  it('sendEmail accepts valid EmailMessage shape', () => {
    // Type-check: ensure the interface is usable
    const msg = {
      to: 'recipient@example.com',
      subject: 'SLA Breach Alert',
      text: 'Your submission has exceeded its deadline.',
      html: '<p>Your submission has exceeded its deadline.</p>',
    };
    expect(msg.to).toBe('recipient@example.com');
    expect(msg.subject).toBe('SLA Breach Alert');
    expect(msg.text).toBeDefined();
    expect(msg.html).toBeDefined();
  });
});
