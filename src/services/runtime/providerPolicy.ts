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
