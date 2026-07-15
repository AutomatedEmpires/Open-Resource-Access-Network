/**
 * Hard runtime boundary for the retired Azure Functions implementation.
 *
 * These modules remain in the repository only as migration history and for a
 * narrow set of isolated contract tests. Any direct invocation in development,
 * preview, production, or a non-Vitest test runner must fail before a handler
 * can initialize a database client, provider SDK, queue, or network request.
 */
export const LEGACY_AZURE_FUNCTIONS_ARCHIVE_MARKER = 'ORAN_LEGACY_AZURE_FUNCTIONS_ARCHIVED';

export function assertLegacyAzureFunctionsArchived(
  env: Record<string, string | undefined> = process.env,
): void {
  const isolatedVitest = env.NODE_ENV?.trim().toLowerCase() === 'test'
    && ['1', 'true'].includes(env.VITEST?.trim().toLowerCase() ?? '')
    && env.VERCEL_ENV?.trim().toLowerCase() !== 'production';

  if (!isolatedVitest) {
    throw new Error('Legacy Azure Functions are archived and cannot execute in this runtime.');
  }
}
