// ORAN Load Test — Search API baseline
//
// Validates the target throughput of the search API under concurrent load.
// Uses the built-in fetch API (Node 20+). No external dependencies needed.
//
// Usage:
//   ORAN_APP_URL=https://oran-prod-web.azurewebsites.net \
//   node scripts/load-test.mjs
//
// Optional environment variables:
//   LOAD_TEST_CONCURRENCY — parallel requests (default: 10)
//   LOAD_TEST_TOTAL       — total requests to send (default: 100)
//   LOAD_TEST_ENDPOINT    — API path to test (default: /api/search?q=food+assistance&lat=40.7&lng=-74.0)

const APP_URL = process.env.ORAN_APP_URL;
if (!APP_URL) {
  console.error('Set ORAN_APP_URL environment variable');
  process.exit(1);
}

const CONCURRENCY = parseInt(process.env.LOAD_TEST_CONCURRENCY || '10', 10);
const TOTAL = parseInt(process.env.LOAD_TEST_TOTAL || '100', 10);
const ENDPOINT = process.env.LOAD_TEST_ENDPOINT || '/api/search?q=food+assistance&lat=40.7&lng=-74.0';

const url = `${APP_URL}${ENDPOINT}`;

console.log(`Load test: ${url}`);
console.log(`  Concurrency: ${CONCURRENCY}`);
console.log(`  Total requests: ${TOTAL}`);
console.log('');

const results = {
  total: 0,
  success: 0,
  errors: 0,
  latencies: [],
  statusCodes: {},
};

async function sendRequest() {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    const elapsed = Date.now() - start;
    results.total++;
    results.latencies.push(elapsed);
    results.statusCodes[res.status] = (results.statusCodes[res.status] || 0) + 1;
    if (res.ok) {
      results.success++;
    } else {
      results.errors++;
    }
  } catch (err) {
    const elapsed = Date.now() - start;
    results.total++;
    results.errors++;
    results.latencies.push(elapsed);
    results.statusCodes['ERR'] = (results.statusCodes['ERR'] || 0) + 1;
  }
}

async function runBatch(batchSize) {
  const promises = [];
  for (let i = 0; i < batchSize; i++) {
    promises.push(sendRequest());
  }
  await Promise.all(promises);
}

const startTime = Date.now();
let sent = 0;

while (sent < TOTAL) {
  const batch = Math.min(CONCURRENCY, TOTAL - sent);
  await runBatch(batch);
  sent += batch;
  process.stdout.write(`\r  Progress: ${sent}/${TOTAL}`);
}

const totalTime = Date.now() - startTime;

// Calculate percentiles
results.latencies.sort((a, b) => a - b);
const percentile = (arr, p) => {
  const idx = Math.ceil(arr.length * p / 100) - 1;
  return arr[Math.max(0, idx)];
};

console.log('\n');
console.log('=== Results ===');
console.log(`Total requests:   ${results.total}`);
console.log(`Successful:       ${results.success}`);
console.log(`Errors:           ${results.errors}`);
console.log(`Error rate:       ${(100 * results.errors / results.total).toFixed(1)}%`);
console.log(`Total time:       ${(totalTime / 1000).toFixed(1)}s`);
console.log(`Throughput:       ${(results.total / (totalTime / 1000)).toFixed(1)} req/s`);
console.log('');
console.log('Latency:');
console.log(`  min:    ${results.latencies[0]}ms`);
console.log(`  p50:    ${percentile(results.latencies, 50)}ms`);
console.log(`  p95:    ${percentile(results.latencies, 95)}ms`);
console.log(`  p99:    ${percentile(results.latencies, 99)}ms`);
console.log(`  max:    ${results.latencies[results.latencies.length - 1]}ms`);
console.log('');
console.log('Status codes:', results.statusCodes);

// Baseline targets
const p95 = percentile(results.latencies, 95);
const errorRate = results.errors / results.total;

console.log('');
if (p95 > 5000) {
  console.log('⚠ WARN: p95 latency exceeds 5s target');
} else {
  console.log('✓ p95 latency within 5s target');
}

if (errorRate > 0.01) {
  console.log('⚠ WARN: Error rate exceeds 1% target');
} else {
  console.log('✓ Error rate within 1% target');
}
