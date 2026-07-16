/**
 * The Azure Functions application is an archive, not a deployment target.
 * Keep this file as an explicit tripwire for callers that bypass package.json.
 */
throw new Error(
  'ORAN_LEGACY_AZURE_FUNCTIONS_ARCHIVED: the retired Functions package cannot be built.',
);
