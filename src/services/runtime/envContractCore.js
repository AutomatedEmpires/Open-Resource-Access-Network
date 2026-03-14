const RULES_BY_TARGET = {
  webapp: [
    { name: 'DATABASE_URL', level: 'critical', productionOnly: true },
    { name: 'NEXTAUTH_SECRET', level: 'critical', productionOnly: true },
    { name: 'NEXTAUTH_URL', level: 'critical', productionOnly: true },
    { name: 'INTERNAL_API_KEY', level: 'critical', productionOnly: true },
    { name: 'NDP_211_SUBSCRIPTION_KEY', level: 'critical', whenTruthy: 'NDP_211_POLLING_ENABLED' },
    { name: 'NDP_211_DATA_OWNERS', level: 'critical', whenTruthy: 'NDP_211_POLLING_ENABLED' },
    { name: 'AZURE_AD_CLIENT_SECRET', level: 'critical', whenPresent: 'AZURE_AD_CLIENT_ID' },
    { name: 'AZURE_AD_TENANT_ID', level: 'warning', whenPresent: 'AZURE_AD_CLIENT_ID' },
    { name: 'GOOGLE_CLIENT_SECRET', level: 'critical', whenPresent: 'GOOGLE_CLIENT_ID' },
    { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', level: 'warning', productionOnly: true },
    { name: 'REDIS_URL', level: 'warning', productionOnly: true },
    { name: 'AZURE_MAPS_KEY', level: 'warning', productionOnly: true },
    { name: 'AZURE_MAPS_SAS_TOKEN', level: 'warning', productionOnly: true },
    { name: 'AZURE_TRANSLATOR_KEY', level: 'warning', productionOnly: true },
    { name: 'AZURE_TRANSLATOR_ENDPOINT', level: 'warning', productionOnly: true },
    { name: 'AZURE_TRANSLATOR_REGION', level: 'warning', productionOnly: true },
  ],
  functions: [
    { name: 'AzureWebJobsStorage', level: 'critical', productionOnly: true },
    { name: 'FUNCTIONS_WORKER_RUNTIME', level: 'critical', productionOnly: true },
    { name: 'ORAN_APP_URL', level: 'critical', productionOnly: true },
    { name: 'INTERNAL_API_KEY', level: 'critical', productionOnly: true },
    { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', level: 'warning', productionOnly: true },
    { name: 'FOUNDRY_KEY', level: 'warning', whenPresent: 'FOUNDRY_ENDPOINT' },
    { name: 'FOUNDRY_ENDPOINT', level: 'warning', whenPresent: 'FOUNDRY_KEY' },
  ],
};

function isTruthyValue(value) {
  return ['1', 'true', 'yes', 'on'].includes(normalizeName(value).toLowerCase());
}

function normalizeName(name) {
  return String(name ?? '').trim();
}

function isNameCollection(envSource) {
  return Array.isArray(envSource) || envSource instanceof Set;
}

function getPresentNames(envSource) {
  if (isNameCollection(envSource)) {
    return new Set(
      Array.from(envSource)
        .map((name) => normalizeName(name))
        .filter(Boolean),
    );
  }

  return new Set(
    Object.entries(envSource ?? {})
      .filter(([, value]) => {
        if (typeof value === 'string') {
          return value.trim().length > 0;
        }
        return value !== undefined && value !== null;
      })
      .map(([name]) => name),
  );
}

function getNodeEnv(envSource, options) {
  if (options?.nodeEnv) {
    return normalizeName(options.nodeEnv) || 'development';
  }

  if (isNameCollection(envSource)) {
    return 'development';
  }

  const value = normalizeName(envSource?.NODE_ENV);
  return value || 'development';
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

export const runtimeEnvTargets = Object.freeze(Object.keys(RULES_BY_TARGET));

export function validateRuntimeEnv(target, envSource = process.env, options = {}) {
  const rules = RULES_BY_TARGET[target];
  if (!rules) {
    throw new Error(`Unsupported runtime env target: ${target}`);
  }

  const nodeEnv = getNodeEnv(envSource, options);
  const presentNames = getPresentNames(envSource);
  const missingCritical = [];
  const warnings = [];

  for (const rule of rules) {
    if (rule.productionOnly && nodeEnv !== 'production') {
      continue;
    }

    if (rule.whenPresent && !presentNames.has(rule.whenPresent)) {
      continue;
    }

    if (rule.whenTruthy && !isTruthyValue(isNameCollection(envSource) ? undefined : envSource?.[rule.whenTruthy])) {
      continue;
    }

    if (presentNames.has(rule.name)) {
      continue;
    }

    if (rule.level === 'critical') {
      missingCritical.push(rule.name);
      continue;
    }

    warnings.push(rule.name);
  }

  return {
    target,
    nodeEnv,
    ok: missingCritical.length === 0,
    missingCritical: uniqueSorted(missingCritical),
    warnings: uniqueSorted(warnings),
  };
}
