import {
  assertAllowedRuntimeEndpoint as assertAllowedRuntimeEndpointCore,
  assertExpectedSupabaseProjectDatabaseEndpoint as assertExpectedSupabaseProjectDatabaseEndpointCore,
  extractRuntimeEndpointHosts as extractRuntimeEndpointHostsCore,
  findProhibitedMicrosoftRuntimeSettings as findProhibitedMicrosoftRuntimeSettingsCore,
  isProhibitedMicrosoftEndpoint as isProhibitedMicrosoftEndpointCore,
  isProhibitedMicrosoftEnvName as isProhibitedMicrosoftEnvNameCore,
  isRetiredMicrosoftProviderRuntime as isRetiredMicrosoftProviderRuntimeCore,
  isExpectedSupabaseProjectDatabaseEndpoint as isExpectedSupabaseProjectDatabaseEndpointCore,
} from './providerPolicyCore.js';

type RuntimeEnvSource = Record<string, string | undefined> | Iterable<string>;

const SUPABASE_PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;
const SUPABASE_DIRECT_DATABASE_HOST_PATTERN = /^db\.([a-z0-9]{20})\.supabase\.co$/u;
const SUPABASE_POOLER_HOST_PATTERN = /^(?:[a-z0-9-]+\.)+pooler\.supabase\.com$/u;

/**
 * Resolve the project owning the actual PostgreSQL endpoint without logging or
 * returning any credential-bearing URL material. Database-role authorization
 * is enforced separately; for poolers the project ref is the final username
 * segment (`postgres.<ref>` or a dedicated role's equivalent).
 */
export function extractSupabaseProjectRefFromDatabaseUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    const parsed = new URL(value.trim());
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) return null;

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, '');
    const directMatch = SUPABASE_DIRECT_DATABASE_HOST_PATTERN.exec(hostname);
    if (directMatch?.[1]) return directMatch[1];
    if (!SUPABASE_POOLER_HOST_PATTERN.test(hostname)) return null;

    const username = decodeURIComponent(parsed.username).toLowerCase();
    const separator = username.lastIndexOf('.');
    if (separator <= 0) return null;
    const projectRef = username.slice(separator + 1);
    return SUPABASE_PROJECT_REF_PATTERN.test(projectRef) ? projectRef : null;
  } catch {
    return null;
  }
}

export const assertAllowedRuntimeEndpoint =
  assertAllowedRuntimeEndpointCore as (
    value: unknown,
    settingName?: string,
    envSource?: Record<string, string | undefined>,
  ) => string;

export const assertExpectedSupabaseProjectDatabaseEndpoint =
  assertExpectedSupabaseProjectDatabaseEndpointCore as (
    value: unknown,
    expectedProjectRef: unknown,
    settingName?: string,
    projectRefSettingName?: string,
  ) => string;

export const extractRuntimeEndpointHosts =
  extractRuntimeEndpointHostsCore as (value: unknown) => string[];

export const findProhibitedMicrosoftRuntimeSettings =
  findProhibitedMicrosoftRuntimeSettingsCore as (envSource?: RuntimeEnvSource) => string[];

export const isProhibitedMicrosoftEndpoint =
  isProhibitedMicrosoftEndpointCore as (value: unknown) => boolean;

export const isProhibitedMicrosoftEnvName =
  isProhibitedMicrosoftEnvNameCore as (name: unknown) => boolean;

export const isRetiredMicrosoftProviderRuntime =
  isRetiredMicrosoftProviderRuntimeCore as (
    envSource?: Record<string, string | undefined>,
  ) => boolean;

export const isExpectedSupabaseProjectDatabaseEndpoint =
  isExpectedSupabaseProjectDatabaseEndpointCore as (
    value: unknown,
    expectedProjectRef: unknown,
  ) => boolean;
