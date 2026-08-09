/**
 * ORAN Ingestion Service
 *
 * Legacy thin service entry point.
 *
 * Rich ingestion and federation workflows now primarily live under
 * `src/agents/ingestion/**` and Vercel route/cron handlers. This module exports
 * shared service-level helpers used by existing route and workflow code.
 */

export * from './tagging-prompt';
