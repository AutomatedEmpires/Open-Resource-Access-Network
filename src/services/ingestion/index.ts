/**
 * ORAN Ingestion Service
 *
 * Legacy thin service entry point.
 *
 * Rich ingestion and federation workflows now primarily live under
 * `src/agents/ingestion/**` and Azure Functions. This module currently exports
 * shared service-level helpers used by existing route and workflow code.
 */

export * from './tagging-prompt';
