# ORAN Load & Scale Testing

Baseline targets and configuration for the ORAN ingestion pipeline and search API.

## Throughput Targets

| Metric | Target | Notes |
|---|---|---|
| Ingestion throughput | 100 URLs/day | Scheduled crawl cadence |
| Search API p95 latency | < 5 s | PostGIS spatial + full-text |
| Search API error rate | < 1 % | Under normal traffic |
| Function cold start | < 10 s | Consumption plan, Node 20 |

## Queue Concurrency Tuning (`functions/host.json`)

```jsonc
"extensions": {
  "queues": {
    "batchSize": 4,          // messages processed per function instance
    "maxDequeueCount": 3,    // retries before poison queue
    "newBatchThreshold": 2,  // fetch next batch when only 2 remain
    "visibilityTimeout": "00:05:00",  // 5 min lock per message
    "maxPollingInterval": "00:00:30"  // poll empty queues every 30 s
  }
}
```

**Rationale:**
- `batchSize: 4` — each pipeline stage (fetch → extract → verify → route) calls an external service (HTTP fetch, Azure OpenAI, DB write). Keeping concurrency at 4 prevents overwhelming downstream dependencies while still processing in parallel.
- `maxDequeueCount: 3` — three attempts before moving to poison queue. Aligns with the `docs/ops/services/RUNBOOK_INGESTION.md` poison-queue recovery procedure.
- `visibilityTimeout: 5 min` — allows time for Azure OpenAI extraction (p99 ~4 s) plus retry back-off.

## Database Connection Pool Sizing

Configured in `src/db/index.ts`:

```ts
new Pool({
  connectionString,
  max: 10,                    // max concurrent connections
  idleTimeoutMillis: 30000,   // close idle connections after 30 s
  connectionTimeoutMillis: 5000, // fail fast on connection issues
});
```

**Sizing rationale:**
- Azure PostgreSQL Flexible Server **Standard_B1ms** supports ~50 max connections.
- App Service (B1, 1 core) + Function App (Consumption) share the server.
- `max: 10` leaves headroom for concurrent App Service requests, Functions queue processing, and DB migration connections.
- For production scale-up (S1/P1v3 App Service plan), increase to `max: 20` and upgrade PostgreSQL to Standard_B2ms (100 connections).

## Load Test Script

Run the search API load test:

```bash
# Against staging
ORAN_APP_URL=https://oran-staging-web.azurewebsites.net \
  node scripts/load-test.mjs

# Custom concurrency and volume
ORAN_APP_URL=https://oran-prod-web.azurewebsites.net \
  LOAD_TEST_CONCURRENCY=20 \
  LOAD_TEST_TOTAL=500 \
  node scripts/load-test.mjs
```

See [scripts/load-test.mjs](../../scripts/load-test.mjs) for implementation.

## Scale Triggers

| Signal | Action |
|---|---|
| p95 search latency > 5 s sustained | Upgrade App Service plan (B1 → S1) |
| DB CPU > 80% sustained | Upgrade PostgreSQL SKU (B1ms → B2ms) |
| Queue depth > 50 per queue | Consumption plan auto-scales; verify host.json batchSize |
| Ingestion throughput > 500 URLs/day | Move Functions to Premium plan (EP1) for VNET + warm instances |
| Connection pool exhaustion errors | Increase `max` in `src/db/index.ts` (up to DB server limit) |
