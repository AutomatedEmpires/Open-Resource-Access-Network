import {
  assertAllowedRuntimeEndpoint,
  assertExpectedSupabaseProjectDatabaseEndpoint,
} from '../src/services/runtime/providerPolicyCore.js';

const settingName = String(process.argv[2] ?? '').trim();
const projectRefSettingName = String(process.argv[3] ?? '').trim();

if (
  process.argv.length !== 4
  || !/^[A-Z][A-Z0-9_]*$/u.test(settingName)
  || !/^[A-Z][A-Z0-9_]*$/u.test(projectRefSettingName)
) {
  console.error('Runtime endpoint validator requires endpoint and project-ref environment setting names.');
  process.exit(1);
}

const value = process.env[settingName];
if (!value?.trim()) {
  console.error(`${settingName} is not configured.`);
  process.exit(1);
}

const expectedProjectRef = process.env[projectRefSettingName];
if (!expectedProjectRef?.trim()) {
  console.error(`${projectRefSettingName} is not configured.`);
  process.exit(1);
}

try {
  assertAllowedRuntimeEndpoint(value, settingName, { NODE_ENV: 'production' });
  assertExpectedSupabaseProjectDatabaseEndpoint(
    value,
    expectedProjectRef,
    settingName,
    projectRefSettingName,
  );
} catch (error) {
  const message = error instanceof Error
    ? error.message
    : `${settingName} failed endpoint policy validation`;
  console.error(message);
  process.exit(1);
}

console.log(`${settingName} endpoint and project identity policy satisfied.`);
