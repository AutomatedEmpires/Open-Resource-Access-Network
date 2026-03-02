/**
 * Next.js Instrumentation Hook
 *
 * Initializes Azure Application Insights (OpenTelemetry-based) on server startup.
 * This file is automatically loaded by Next.js when the server starts.
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register(): Promise<void> {
  // Only run on the server (Node.js runtime), not in Edge or browser.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
    if (!connectionString) {
      console.log('[instrumentation] APPLICATIONINSIGHTS_CONNECTION_STRING not set — skipping Azure Monitor.');
      return;
    }

    try {
      const { useAzureMonitor: initAzureMonitor } = await import('applicationinsights');
      initAzureMonitor({
        azureMonitorExporterOptions: { connectionString },
        // Respect privacy: do not collect detailed dependency data that could contain PII.
        instrumentationOptions: {
          http: { enabled: true },
          azureSdk: { enabled: false },
          postgreSql: { enabled: true },
        },
      });
      console.log('[instrumentation] Azure Monitor initialized.');
    } catch (err) {
      // Gracefully degrade — telemetry is optional.
      console.warn('[instrumentation] Failed to initialize Azure Monitor:', err);
    }
  }
}
