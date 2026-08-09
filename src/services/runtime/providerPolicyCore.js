const PROHIBITED_ENV_PREFIXES = Object.freeze([
  'AZURE_',
  'FOUNDRY_',
  'APPINSIGHTS_',
  'APPLICATIONINSIGHTS_',
  'WEBSITE_',
]);

const PROHIBITED_ENV_NAMES = new Set([
  'azurewebjobsstorage',
  'functions_worker_runtime',
  'identity_endpoint',
  'identity_header',
  'llm_api_version',
  'llm_endpoint',
]);

const ALLOWED_LLM_PROVIDER_VALUES = new Set(['anthropic', 'disabled']);

const PROHIBITED_HOST_SUFFIXES = Object.freeze([
  'azconfig.io',
  'azmk8s.io',
  'azure.com',
  'azure.cn',
  'azure.us',
  'azure-api.cn',
  'azure-api.net',
  'azure-api.us',
  'azure-apihub.net',
  'azure-automation.net',
  'azure-devices.cn',
  'azure-devices.net',
  'azure-devices-provisioning.net',
  'azure-devices-provisioning.cn',
  'azure-devices-provisioning.us',
  'azure-devices.us',
  'azureedge.cn',
  'azure-mobile.net',
  'azurecomm.net',
  'azurecontainerapps.cn',
  'azurecontainerapps.io',
  'azurecontainerapps.us',
  'azurecontainer.io',
  'azurecr.cn',
  'azurecr.io',
  'azurecr.us',
  'azureedge.net',
  'azureedge.us',
  'azurefd.cn',
  'azurefd.net',
  'azurefd.us',
  'azurehealthcareapis.com',
  'azurehdinsight.net',
  'azureiotcentral.com',
  'azuremapscdn.com',
  'azuremaps.com',
  'azure.net',
  'azurestaticapps.net',
  'azurestaticapps.cn',
  'azurestaticapps.us',
  'azurewebsites.net',
  'azurewebsites.us',
  'cloudapp.net',
  'chinacloudapi.cn',
  'chinacloudsites.cn',
  'dynamics.com',
  'microsoft.com',
  'microsoftgraph.com',
  'microsoft.us',
  'microsoftonline.com',
  'microsoftonline.us',
  'microsofttranslator.com',
  'msappproxy.net',
  'onmicrosoft.com',
  'office.com',
  'office365.com',
  'powerapps.com',
  'sharepoint.com',
  'signalr.net',
  'usgovcloudapi.net',
  'visualstudio.com',
  'vo.msecnd.net',
  'windowsazure.com',
  'trafficmanager.net',
  'windows.net',
]);

const CONNECTION_HOST_KEYS = new Set([
  'addr',
  'address',
  'authority',
  'datasource',
  'endpoint',
  'endpointsuffix',
  'host',
  'hostname',
  'networkaddress',
  'server',
  'uri',
  'url',
]);

const SUPABASE_PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;
const SUPABASE_POOLER_HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.pooler\.supabase\.com$/u;

function normalize(value) {
  return String(value ?? '').trim();
}

function isNameCollection(envSource) {
  return Array.isArray(envSource) || envSource instanceof Set;
}

function entriesFromEnvSource(envSource) {
  if (isNameCollection(envSource)) {
    return Array.from(envSource).map((name) => [normalize(name), undefined]);
  }

  return Object.entries(envSource ?? {}).map(([name, value]) => [normalize(name), value]);
}

function isPresentValue(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== undefined && value !== null;
}

export function isProhibitedMicrosoftEnvName(name) {
  const normalized = normalize(name);
  if (!normalized) return false;

  const upper = normalized.toUpperCase();
  return PROHIBITED_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix))
    || PROHIBITED_ENV_NAMES.has(normalized.toLowerCase());
}

function normalizeConnectionKey(value) {
  return normalize(value).toLowerCase().replace(/[^a-z0-9]/gu, '');
}

function isEndpointBearingConnectionKey(key) {
  const normalizedKey = normalizeConnectionKey(key);
  if (CONNECTION_HOST_KEYS.has(normalizedKey)) return true;
  return [
    'address',
    'authority',
    'endpoint',
    'endpointsuffix',
    'host',
    'hostname',
    'server',
    'uri',
    'url',
  ].some((suffix) => normalizedKey.endsWith(suffix));
}

function urlHostname(candidate) {
  const trimmed = normalize(candidate).replace(/^jdbc:/iu, '');
  if (!trimmed) return '';

  try {
    return new URL(trimmed).hostname.toLowerCase().replace(/\.$/u, '');
  } catch {
    return '';
  }
}

function connectionHost(candidate) {
  let normalized = normalize(candidate)
    .replace(/^(?:["']|\{)+|(?:["']|\})+$/gu, '')
    .trim();
  if (!normalized) return '';

  const parsedHostname = urlHostname(normalized);
  if (parsedHostname) return parsedHostname;
  // An @ outside a parsed URL is most likely an email address or free-form
  // credential, not a host token.
  if (normalized.includes('@')) return '';

  normalized = normalized
    .replace(/^(?:tcp|np|lpc):/iu, '')
    .replace(/^\/\//u, '')
    .trim();

  // SQL Server commonly uses `host,1433`; other clients use `host:port`.
  normalized = (normalized.split(/[\\/,]/u, 1)[0] ?? '').trim();
  if (/\s/u.test(normalized)) return '';
  if (normalized.startsWith('[')) {
    normalized = normalized.slice(1, normalized.indexOf(']') > 0 ? normalized.indexOf(']') : undefined);
  } else {
    normalized = normalized.replace(/:\d+$/u, '');
  }
  normalized = normalized.toLowerCase().replace(/\.$/u, '');

  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u
    .test(normalized)
    ? normalized
    : '';
}

/**
 * Extract hosts from URLs and common DSN/connection-string forms. Matching is
 * performed only against normalized host values so credentials, free-form
 * text, and punctuation cannot accidentally masquerade as endpoint evidence.
 */
export function extractRuntimeEndpointHosts(value) {
  const normalized = normalize(value);
  if (!normalized) return [];

  const hosts = new Set();
  const addCandidate = (candidate) => {
    const hostname = urlHostname(candidate) || connectionHost(candidate);
    if (hostname) hosts.add(hostname);
  };

  addCandidate(normalized);

  for (const segment of normalized.split(';')) {
    const separator = segment.indexOf('=');
    if (separator < 1) continue;
    const key = segment.slice(0, separator);
    if (!isEndpointBearingConnectionKey(key)) continue;
    addCandidate(segment.slice(separator + 1));
  }

  // Covers URL-bearing composite values while still extracting and matching
  // the parsed hostname instead of relying on punctuation around a suffix.
  for (const match of normalized.matchAll(
    /(?:jdbc:)?[a-z][a-z0-9+.-]*:\/\/[^\s;'"<>()]+/giu,
  )) {
    addCandidate(match[0]);
  }

  return Array.from(hosts).sort((left, right) => left.localeCompare(right));
}

export function isProhibitedMicrosoftEndpoint(value) {
  const matchesHost = (candidate) => PROHIBITED_HOST_SUFFIXES.some(
    (suffix) => candidate === suffix || candidate.endsWith(`.${suffix}`),
  );
  return extractRuntimeEndpointHosts(value).some(matchesHost);
}

export function isExpectedSupabaseProjectDatabaseEndpoint(value, expectedProjectRef) {
  const endpoint = normalize(value);
  const projectRef = normalize(expectedProjectRef);
  if (!endpoint || !SUPABASE_PROJECT_REF_PATTERN.test(projectRef)) return false;

  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') return false;

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, '');
    if (hostname === `db.${projectRef}.supabase.co`) return true;

    const username = decodeURIComponent(parsed.username).toLowerCase();
    return SUPABASE_POOLER_HOST_PATTERN.test(hostname)
      && username === `postgres.${projectRef}`;
  } catch {
    return false;
  }
}

export function assertExpectedSupabaseProjectDatabaseEndpoint(
  value,
  expectedProjectRef,
  settingName = 'SUPABASE_DB_URL',
  projectRefSettingName = 'SUPABASE_PROJECT_REF',
) {
  const endpoint = normalize(value);
  const projectRef = normalize(expectedProjectRef);
  const safeSettingName = normalize(settingName) || 'SUPABASE_DB_URL';
  const safeProjectRefSettingName = normalize(projectRefSettingName) || 'SUPABASE_PROJECT_REF';

  if (!SUPABASE_PROJECT_REF_PATTERN.test(projectRef)) {
    throw new Error(`${safeProjectRefSettingName} is missing or invalid`);
  }
  if (!isExpectedSupabaseProjectDatabaseEndpoint(endpoint, projectRef)) {
    throw new Error(`${safeSettingName} does not match ${safeProjectRefSettingName}`);
  }
  return endpoint;
}

/**
 * Validate a generic URL, DSN, or connection string at the point where it is
 * about to be used. Startup validation is useful diagnostics, but it cannot
 * prevent a late env mutation or a cached module from reviving a retired
 * Microsoft runtime. The value is intentionally omitted from the error.
 *
 * Historical adapter tests may exercise Microsoft-shaped fixtures only in an
 * isolated Vitest runtime. Development, preview, and production all fail
 * closed.
 */
export function assertAllowedRuntimeEndpoint(
  value,
  settingName = 'runtime endpoint',
  envSource = typeof process === 'undefined' ? {} : process.env,
) {
  const normalized = normalize(value);
  if (
    normalized
    && isProhibitedMicrosoftEndpoint(normalized)
    && isRetiredMicrosoftProviderRuntime(envSource)
  ) {
    throw new Error(`${normalize(settingName) || 'runtime endpoint'} uses a prohibited Microsoft endpoint`);
  }
  return normalized;
}

export function findProhibitedMicrosoftRuntimeSettings(envSource = process.env) {
  const violations = [];

  for (const [name, value] of entriesFromEnvSource(envSource)) {
    if (!name) continue;
    if (isProhibitedMicrosoftEnvName(name)) {
      violations.push(name);
      continue;
    }
    if (isPresentValue(value) && isProhibitedMicrosoftEndpoint(value)) {
      violations.push(name);
      continue;
    }
    if (
      name.toUpperCase() === 'LLM_PROVIDER'
      && isPresentValue(value)
      && !ALLOWED_LLM_PROVIDER_VALUES.has(normalize(value).toLowerCase())
    ) {
      violations.push(name);
    }
  }

  return Array.from(new Set(violations)).sort((left, right) => left.localeCompare(right));
}

/**
 * Fail startup before application code can observe or use a prohibited
 * provider setting. Error text contains setting names only, never values.
 */
export function assertNoRetiredMicrosoftProviderSettings(envSource = process.env) {
  if (!isRetiredMicrosoftProviderRuntime(envSource)) return;

  const violations = findProhibitedMicrosoftRuntimeSettings(envSource);
  if (violations.length > 0) {
    throw new Error(
      `Prohibited runtime settings are present: ${violations.join(', ')}`,
    );
  }
}

/**
 * Microsoft-shaped fixtures remain permissible only in isolated unit tests.
 * Development, preview, and production runtimes fail closed.
 */
export function isRetiredMicrosoftProviderRuntime(envSource = process.env) {
  const isIsolatedTestRuntime = normalize(envSource?.NODE_ENV).toLowerCase() === 'test'
    && ['1', 'true'].includes(normalize(envSource?.VITEST).toLowerCase())
    && normalize(envSource?.VERCEL_ENV).toLowerCase() !== 'production';
  return !isIsolatedTestRuntime;
}
