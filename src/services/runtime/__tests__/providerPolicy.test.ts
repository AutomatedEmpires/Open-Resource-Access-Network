import { describe, expect, it } from 'vitest';

import {
  assertAllowedRuntimeEndpoint,
  assertExpectedSupabaseProjectDatabaseEndpoint,
  extractRuntimeEndpointHosts,
  findProhibitedMicrosoftRuntimeSettings,
  isProhibitedMicrosoftEndpoint,
  isProhibitedMicrosoftEnvName,
  isRetiredMicrosoftProviderRuntime,
  isExpectedSupabaseProjectDatabaseEndpoint,
} from '@/services/runtime/providerPolicy';

describe('off-Azure runtime provider policy', () => {
  it('recognizes retired provider and Azure-hosting environment names', () => {
    expect(isProhibitedMicrosoftEnvName('AZURE_OPENAI_KEY')).toBe(true);
    expect(isProhibitedMicrosoftEnvName('FOUNDRY_KEY')).toBe(true);
    expect(isProhibitedMicrosoftEnvName('AzureWebJobsStorage')).toBe(true);
    expect(isProhibitedMicrosoftEnvName('WEBSITE_INSTANCE_ID')).toBe(true);
    expect(isProhibitedMicrosoftEnvName('OPENAI_API_KEY')).toBe(false);
  });

  it('recognizes Microsoft endpoints without rejecting the target stack', () => {
    expect(isProhibitedMicrosoftEndpoint('https://atlas.microsoft.com/geocode')).toBe(true);
    expect(isProhibitedMicrosoftEndpoint('https://oran.openai.azure.com')).toBe(true);
    expect(isProhibitedMicrosoftEndpoint('https://oran.azurefd.net')).toBe(true);
    expect(isProhibitedMicrosoftEndpoint('postgres://u:p@oran.postgres.database.azure.com/db')).toBe(true);
    expect(isProhibitedMicrosoftEndpoint('https://api.openai.com/v1')).toBe(false);
    expect(isProhibitedMicrosoftEndpoint('https://project.supabase.co')).toBe(false);
    expect(isProhibitedMicrosoftEndpoint('https://openresourceaccessnetwork.com')).toBe(false);
    expect(isProhibitedMicrosoftEndpoint('ORAN <help@microsoft.com>')).toBe(false);
    expect(isProhibitedMicrosoftEndpoint('microsoft.com is named in an audit note')).toBe(false);
  });

  it.each([
    'https://hub.azure-devices.net/messages/events',
    'https://enroll.azure-devices-provisioning.net/register',
    'https://legacy.azurehealthcareapis.com/Patient',
    'https://cluster.azurehdinsight.net',
    'https://legacy.azure-mobile.net/tables/resources',
    'https://control.azmk8s.io/subscriptions/example',
    'https://retired.azurecontainer.io/status',
    'https://legacy.vo.msecnd.net/asset.js',
  ])('recognizes retired Azure host family %s', (endpoint) => {
    expect(isProhibitedMicrosoftEndpoint(endpoint)).toBe(true);
  });

  it.each([
    'Server=tcp:oran.database.windows.net,1433;Initial Catalog=oran;User ID=oran;Password=secret',
    'Data Source=tcp:oran.database.windows.net,1433;Initial Catalog=oran',
    'Driver={ODBC Driver 18 for SQL Server};Server={tcp:oran.database.windows.net,1433}',
    'Endpoint=sb://oran.servicebus.windows.net/;SharedAccessKeyName=Root;SharedAccessKey=secret',
    'DefaultEndpointsProtocol=https;AccountName=oran;EndpointSuffix=core.windows.net',
    'jdbc:sqlserver://oran.database.windows.net:1433;databaseName=oran',
  ])('extracts prohibited hosts from connection strings without relying on URL punctuation', (value) => {
    expect(isProhibitedMicrosoftEndpoint(value)).toBe(true);
  });

  it('extracts normalized URL and connection-string hosts', () => {
    expect(extractRuntimeEndpointHosts(
      'Server=tcp:oran.database.windows.net,1433;Endpoint=https://api.openai.com/v1',
    )).toEqual(['api.openai.com', 'oran.database.windows.net']);
  });

  it.each([
    'postgresql://postgres.project:pw@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
    'rediss://default:pw@oran.upstash.io:6379',
    'https://public@example.ingest.sentry.io/123',
    'https://openresourceaccessnetwork.vercel.app',
    'https://api.clerk.com/v1',
    'https://api.resend.com/emails',
    'https://api.openai.com/v1/responses',
  ])('preserves an approved target-stack endpoint %s', (endpoint) => {
    expect(isProhibitedMicrosoftEndpoint(endpoint)).toBe(false);
  });

  it('reports setting names only and never returns their values', () => {
    const result = findProhibitedMicrosoftRuntimeSettings({
      LLM_ENDPOINT: 'https://oran.openai.azure.com',
      AZURE_OPENAI_KEY: 'super-secret-value',
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    });

    expect(result).toEqual(['AZURE_OPENAI_KEY', 'LLM_ENDPOINT']);
    expect(result.join(' ')).not.toContain('super-secret-value');
  });

  it('rejects generic Microsoft endpoints at use without disclosing the endpoint', () => {
    const endpoint = 'rediss://secret@oran.redis.cache.windows.net:6380';

    expect(() => assertAllowedRuntimeEndpoint(endpoint, 'REDIS_URL', {
      NODE_ENV: 'production',
    })).toThrow('REDIS_URL uses a prohibited Microsoft endpoint');

    try {
      assertAllowedRuntimeEndpoint(endpoint, 'REDIS_URL', { NODE_ENV: 'production' });
    } catch (error) {
      expect(String(error)).not.toContain('secret');
      expect(String(error)).not.toContain('windows.net');
    }

    expect(assertAllowedRuntimeEndpoint(
      'rediss://token@oran.upstash.io:6380',
      'REDIS_URL',
      { NODE_ENV: 'production' },
    )).toBe('rediss://token@oran.upstash.io:6380');
  });

  it('binds migration DSNs to the expected Supabase project', () => {
    const projectRef = 'tpatxospkuqvajusuryw';
    const otherProjectRef = 'abcdefghijklmnopqrst';
    const direct = `postgresql://postgres:pw@db.${projectRef}.supabase.co:5432/postgres`;
    const pooler = `postgresql://postgres.${projectRef}:pw@aws-0-us-west-1.pooler.supabase.com:6543/postgres`;

    expect(isExpectedSupabaseProjectDatabaseEndpoint(direct, projectRef)).toBe(true);
    expect(isExpectedSupabaseProjectDatabaseEndpoint(pooler, projectRef)).toBe(true);
    expect(isExpectedSupabaseProjectDatabaseEndpoint(
      `postgresql://postgres:pw@db.${otherProjectRef}.supabase.co:5432/postgres`,
      projectRef,
    )).toBe(false);
    expect(isExpectedSupabaseProjectDatabaseEndpoint(
      `postgresql://postgres.${otherProjectRef}:pw@aws-0-us-west-1.pooler.supabase.com:6543/postgres`,
      projectRef,
    )).toBe(false);
    expect(isExpectedSupabaseProjectDatabaseEndpoint(
      `postgresql://postgres.${projectRef}:pw@pooler.supabase.com.evil.example:6543/postgres`,
      projectRef,
    )).toBe(false);
  });

  it('rejects a cross-portfolio Supabase DSN without disclosing either identifier', () => {
    const projectRef = 'tpatxospkuqvajusuryw';
    const otherProjectRef = 'abcdefghijklmnopqrst';
    const endpoint = `postgresql://postgres.${otherProjectRef}:hush@aws-0-us-west-1.pooler.supabase.com:6543/postgres`;

    expect(() => assertExpectedSupabaseProjectDatabaseEndpoint(
      endpoint,
      projectRef,
    )).toThrow('SUPABASE_DB_URL does not match SUPABASE_PROJECT_REF');

    try {
      assertExpectedSupabaseProjectDatabaseEndpoint(endpoint, projectRef);
    } catch (error) {
      expect(String(error)).not.toContain('hush');
      expect(String(error)).not.toContain(projectRef);
      expect(String(error)).not.toContain(otherProjectRef);
      expect(String(error)).not.toContain('pooler.supabase.com');
    }
  });

  it('permits Microsoft-shaped fixtures only in isolated Vitest', () => {
    expect(assertAllowedRuntimeEndpoint(
      'https://oran.openai.azure.com',
      'fixture endpoint',
      { NODE_ENV: 'test', VITEST: 'true' },
    )).toBe('https://oran.openai.azure.com');

    expect(() => assertAllowedRuntimeEndpoint(
      'https://oran.openai.azure.com',
      'fixture endpoint',
      { NODE_ENV: 'test' },
    )).toThrow('prohibited Microsoft endpoint');
  });

  it('allows retired adapters only in the isolated test runtime', () => {
    expect(isRetiredMicrosoftProviderRuntime({ NODE_ENV: 'test', VITEST: 'true' })).toBe(false);
    expect(isRetiredMicrosoftProviderRuntime({ NODE_ENV: 'test' })).toBe(true);
    expect(isRetiredMicrosoftProviderRuntime({
      NODE_ENV: 'test',
      VITEST: 'true',
      VERCEL_ENV: 'production',
    })).toBe(true);
    expect(isRetiredMicrosoftProviderRuntime({ NODE_ENV: 'development' })).toBe(true);
    expect(isRetiredMicrosoftProviderRuntime({ NODE_ENV: 'production' })).toBe(true);
  });
});
