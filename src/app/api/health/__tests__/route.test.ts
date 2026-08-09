import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
  executeQuery: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
}));

function createRequest(ip = '127.0.0.1') {
  const headers = new Headers();
  headers.set('x-forwarded-for', ip);
  return {
    headers,
    nextUrl: new URL('https://oran.test/api/health'),
    url: 'https://oran.test/api/health',
  } as never;
}

function stubProductionWebappEnv(databaseUrl: string) {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('DATABASE_URL', databaseUrl);
  vi.stubEnv('ORAN_DATABASE_ROLE', 'oran_backend_runtime');
  vi.stubEnv('ORAN_SUPABASE_PROJECT_REF', 'tpatxospkuqvajusuryw');
  vi.stubEnv('CRON_SECRET', 'vercel-cron-secret');
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_example');
  vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_example');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('DATABASE_URL', '');
  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([{ ok: 1 }]);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
});

describe('GET /api/health', () => {
  it('returns healthy when database is connected', async () => {
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store, max-age=0');
    const body = await res.json();
    expect(body.status).toBe('healthy');
    expect(body.configuration).toBe('ready');
    expect(body.database).toBe('connected');
    expect(body.databaseTarget).toBeNull();
    expect(typeof body.latencyMs).toBe('number');
  });

  it('returns an opaque SHA-256 target derived from the actual database endpoint', async () => {
    const projectRef = 'tpatxospkuqvajusuryw';
    vi.stubEnv(
      'DATABASE_URL',
      `postgres://oran_backend_runtime.${projectRef}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`,
    );
    const { GET } = await import('../route');

    const res = await GET(createRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.databaseTarget).toBe(
      createHash('sha256').update(projectRef, 'utf8').digest('hex'),
    );
    expect(JSON.stringify(body)).not.toContain(projectRef);
    expect(JSON.stringify(body)).not.toContain('oran_backend_runtime');
  });

  it('fails closed in production when DATABASE_URL has no valid Supabase project target', async () => {
    stubProductionWebappEnv(
      'postgres://oran_backend_runtime@database.example.com:5432/postgres',
    );
    const { GET } = await import('../route');

    const res = await GET(createRequest());

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      status: 'unhealthy',
      configuration: 'invalid',
      database: 'target_invalid',
    });
    expect(dbMocks.executeQuery).not.toHaveBeenCalled();
  });

  it('returns the bound target for a valid production Supabase endpoint', async () => {
    const projectRef = 'tpatxospkuqvajusuryw';
    stubProductionWebappEnv(
      `postgres://oran_backend_runtime.${projectRef}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`,
    );
    const { GET } = await import('../route');

    const res = await GET(createRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.databaseTarget).toBe(
      createHash('sha256').update(projectRef, 'utf8').digest('hex'),
    );
  });

  it('returns 503 when database is not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store, max-age=0');
    const body = await res.json();
    expect(body.status).toBe('unhealthy');
    expect(body.database).toBe('not_configured');
  });

  it('returns 503 when database query fails', async () => {
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('connection refused'));
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store, max-age=0');
    const body = await res.json();
    expect(body.status).toBe('unhealthy');
    expect(body.database).toBe('unreachable');
  });

  it('returns 503 when runtime configuration is invalid', async () => {
    vi.stubEnv('NDP_211_POLLING_ENABLED', 'true');
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store, max-age=0');
    const body = await res.json();
    expect(body.status).toBe('unhealthy');
    expect(body.configuration).toBe('invalid');
    expect(body.missing).toEqual(['NDP_211_DATA_OWNERS', 'NDP_211_SUBSCRIPTION_KEY']);
  });

  it('does not expose configuration details in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('unhealthy');
    expect(body.configuration).toBe('invalid');
    expect(body.missing).toBeUndefined();
  });

  it('fails closed without querying the database when retired Microsoft settings are present', async () => {
    stubProductionWebappEnv(
      'postgres://oran_backend_runtime.tpatxospkuqvajusuryw@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
    );
    vi.stubEnv('AZURE_OPENAI_KEY', 'must-not-leak');
    vi.stubEnv('LLM_ENDPOINT', 'https://oran.openai.azure.com');
    vi.stubEnv('LLM_PROVIDER', 'azure_openai');
    const { GET } = await import('../route');

    const res = await GET(createRequest());
    const serialized = JSON.stringify(await res.json());

    expect(res.status).toBe(503);
    expect(serialized).toBe(JSON.stringify({ status: 'unhealthy', configuration: 'invalid' }));
    expect(serialized).not.toContain('AZURE_OPENAI_KEY');
    expect(serialized).not.toContain('must-not-leak');
    expect(serialized).not.toContain('openai.azure.com');
    expect(serialized).not.toContain('azure_openai');
    expect(dbMocks.executeQuery).not.toHaveBeenCalled();
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 30 });
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get('Cache-Control')).toBe('no-store, max-age=0');
    expect(res.headers.get('Retry-After')).toBe('30');
  });
});
