import { validateRuntimeEnv as validateRuntimeEnvCore } from './envContractCore.js';

export type RuntimeEnvTarget = 'webapp' | 'functions';

export interface RuntimeEnvValidationOptions {
  nodeEnv?: string;
}

export interface RuntimeEnvValidationResult {
  target: RuntimeEnvTarget;
  nodeEnv: string;
  ok: boolean;
  missingCritical: string[];
  warnings: string[];
}

const validateRuntimeEnvBridge = validateRuntimeEnvCore as (
  target: RuntimeEnvTarget,
  envSource: Record<string, string | undefined> | Iterable<string>,
  options?: RuntimeEnvValidationOptions,
) => RuntimeEnvValidationResult;

export function validateRuntimeEnv(
  target: RuntimeEnvTarget,
  envSource: Record<string, string | undefined> | Iterable<string> = process.env,
  options?: RuntimeEnvValidationOptions,
): RuntimeEnvValidationResult {
  return validateRuntimeEnvBridge(target, envSource, options);
}
