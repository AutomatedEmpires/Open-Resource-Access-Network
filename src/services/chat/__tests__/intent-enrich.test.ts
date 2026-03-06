import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Intent } from '@/services/chat/types';

const fetchMock = vi.hoisted(() => vi.fn());

const baseIntent: Intent = {
  category: 'general',
  rawQuery: 'need help',
  urgencyQualifier: 'standard',
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('intent enrichment', () => {
  it('reports configuration state', async () => {
    const svc = await import('../intentEnrich');
    expect(svc.isConfigured()).toBe(false);

    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://example.openai.azure.com/');
    vi.stubEnv('AZURE_OPENAI_KEY', 'key-1');
    vi.resetModules();
    const configured = await import('../intentEnrich');
    expect(configured.isConfigured()).toBe(true);
  });

  it('returns existing intent when category is already specific', async () => {
    const svc = await import('../intentEnrich');
    const existing: Intent = { ...baseIntent, category: 'housing' };

    const result = await svc.enrichIntent('find housing', existing);

    expect(result).toBe(existing);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns existing intent when env is not configured', async () => {
    const svc = await import('../intentEnrich');

    const result = await svc.enrichIntent('general help', baseIntent);

    expect(result).toBe(baseIntent);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns existing intent when Azure returns non-ok', async () => {
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://oran.openai.azure.com/');
    vi.stubEnv('AZURE_OPENAI_KEY', 'key-2');
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const svc = await import('../intentEnrich');
    const result = await svc.enrichIntent('I need help', baseIntent);

    expect(result).toBe(baseIntent);
    expect(warnSpy).toHaveBeenCalledWith('[intentEnrich] Azure OpenAI returned 500');
    warnSpy.mockRestore();
  });

  it('returns existing intent for unrecognized categories', async () => {
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://oran.openai.azure.com/');
    vi.stubEnv('AZURE_OPENAI_KEY', 'key-3');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'not_a_valid_category' } }],
      }),
    });

    const svc = await import('../intentEnrich');
    const result = await svc.enrichIntent('I need help', baseIntent);

    expect(result).toBe(baseIntent);
  });

  it('returns enriched intent when LLM returns a valid category', async () => {
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://oran.openai.azure.com/');
    vi.stubEnv('AZURE_OPENAI_KEY', 'key-4');
    vi.stubEnv('AZURE_OPENAI_DEPLOYMENT', 'gpt-4o-mini-v2');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '  HoUsInG  ' } }],
      }),
    });

    const svc = await import('../intentEnrich');
    const result = await svc.enrichIntent('Need affordable housing', baseIntent);

    expect(result).toEqual({ ...baseIntent, category: 'housing' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://oran.openai.azure.com/openai/deployments/gpt-4o-mini-v2/chat/completions?api-version=2024-02-15-preview',
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual(
      expect.objectContaining({
        'api-key': 'key-4',
        'Content-Type': 'application/json',
      }),
    );
  });

  it('builds prompt with trimmed user message and no general in category list', async () => {
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://oran.openai.azure.com/');
    vi.stubEnv('AZURE_OPENAI_KEY', 'key-5');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'general' } }],
      }),
    });

    const svc = await import('../intentEnrich');
    const longMessage = 'x'.repeat(350);
    await svc.enrichIntent(longMessage, baseIntent);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body)) as {
      messages: Array<{ role: string; content: string }>;
    };

    const prompt = payload.messages[0].content;
    expect(prompt).toContain('food_assistance');
    expect(prompt).toContain('utility_assistance');
    expect(prompt).toContain('If no category fits, output "general"');
    expect(prompt).not.toContain('category: general');

    const queryMatch = prompt.match(/Query: "([\s\S]*)"$/);
    expect(queryMatch?.[1].length).toBe(300);
  });

  it('returns existing intent when fetch throws', async () => {
    vi.stubEnv('AZURE_OPENAI_ENDPOINT', 'https://oran.openai.azure.com/');
    vi.stubEnv('AZURE_OPENAI_KEY', 'key-6');
    fetchMock.mockRejectedValueOnce(new Error('timeout'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const svc = await import('../intentEnrich');
    const result = await svc.enrichIntent('help', baseIntent);

    expect(result).toBe(baseIntent);
    expect(warnSpy).toHaveBeenCalledWith(
      '[intentEnrich] LLM enrichment failed (non-fatal): Error',
    );
    warnSpy.mockRestore();
  });
});
