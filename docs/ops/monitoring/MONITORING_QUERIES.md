# ORAN Monitoring — KQL Queries

Standard queries for Application Insights dashboards and ad-hoc investigation.

---

## 1. Ingestion Pipeline Health

### Extraction Success Rate (last 24h)

```kql
traces
| where timestamp > ago(24h)
| where message has "[extractService]"
| extend success = message has "Completed" or message has "success"
| summarize
    total = count(),
    succeeded = countif(success),
    failed = countif(not(success))
    by bin(timestamp, 1h)
| extend successRate = round(100.0 * succeeded / total, 1)
| order by timestamp asc
| render timechart
```

### Verification Pass Rate (last 24h)

```kql
traces
| where timestamp > ago(24h)
| where message has "[verifyCandidate]"
| extend passed = message has "passed" or message has "Completed"
| summarize
    total = count(),
    passed = countif(passed),
    failed = countif(not(passed))
    by bin(timestamp, 1h)
| extend passRate = round(100.0 * passed / total, 1)
| order by timestamp asc
| render timechart
```

### Pipeline Stage Latency (last 7d)

```kql
requests
| where timestamp > ago(7d)
| where name has "ingestion" or name has "extract" or name has "verify" or name has "route"
| summarize
    p50 = percentile(duration, 50),
    p95 = percentile(duration, 95),
    p99 = percentile(duration, 99)
    by bin(timestamp, 1d), name
| order by timestamp asc
```

---

## 2. SLA & Escalation Monitoring

### SLA Breach Count by Day

```kql
traces
| where timestamp > ago(30d)
| where message has "[checkSlaBreaches]" and message has "breached"
| parse message with * "breached " breachedCount:int " submissions"
| summarize totalBreaches = sum(breachedCount) by bin(timestamp, 1d)
| order by timestamp asc
| render columnchart
```

### Escalation Activity (last 7d)

```kql
traces
| where timestamp > ago(7d)
| where message has "escalat" and (message has "reassign" or message has "ORAN admin" or message has "re-notify")
| summarize count() by bin(timestamp, 1h), tostring(message)
| order by timestamp desc
```

### SLA Warning vs Breach Ratio

```kql
traces
| where timestamp > ago(7d)
| where message has "sla_warning" or message has "sla_breach"
| extend eventType = case(
    message has "warning", "warning",
    message has "breach", "breach",
    "other"
)
| summarize count() by eventType, bin(timestamp, 1d)
| render columnchart
```

---

## 3. Admin Capacity & Routing

### Queue Depth per Admin (current)

```kql
customMetrics
| where timestamp > ago(1h)
| where name == "admin_pending_count" or name == "admin_in_review_count"
| summarize avg(value) by name, tostring(customDimensions.adminId)
| order by avg_value desc
```

### Coverage Gap Trends (last 30d)

```kql
traces
| where timestamp > ago(30d)
| where message has "[alertCoverageGaps]"
| parse message with * "unrouted candidates, " gapStates:int " gap states, " alertsSent:int " alerts sent"
| summarize
    avgUnrouted = avg(toreal(gapStates)),
    totalAlerts = sum(alertsSent)
    by bin(timestamp, 1d)
| render timechart
```

---

## 4. Search & API Performance

### Search API Latency (p50/p95/p99)

```kql
requests
| where timestamp > ago(7d)
| where name has "/api/search"
| summarize
    p50 = percentile(duration, 50),
    p95 = percentile(duration, 95),
    p99 = percentile(duration, 99),
    count = count()
    by bin(timestamp, 1h)
| render timechart
```

### API Error Rate by Endpoint

```kql
requests
| where timestamp > ago(24h)
| where resultCode >= 400
| summarize errorCount = count() by name, resultCode
| order by errorCount desc
| take 20
```

### Top Slow Requests

```kql
requests
| where timestamp > ago(24h)
| where duration > 5000
| project timestamp, name, duration, resultCode, url
| order by duration desc
| take 25
```

---

## 5. Application Health

### Exception Rate by Component

```kql
exceptions
| where timestamp > ago(24h)
| summarize count() by type, problemId
| order by count_ desc
| take 20
```

### Dependency Failures (DB, Redis, external)

```kql
dependencies
| where timestamp > ago(24h)
| where success == false
| summarize failCount = count() by type, target, name
| order by failCount desc
| take 15
```

### Server Health (CPU, Memory, Requests)

```kql
performanceCounters
| where timestamp > ago(24h)
| where category == "Process" or category == "ASP.NET"
| summarize avg(value) by name, bin(timestamp, 5m)
| render timechart
```

---

## 6. Security & Auth

### Failed Auth Attempts (last 24h)

```kql
requests
| where timestamp > ago(24h)
| where name has "/api/auth" and resultCode == 401
| summarize count() by bin(timestamp, 1h), client_IP
| order by count_ desc
```

### Rate Limited Requests

```kql
requests
| where timestamp > ago(24h)
| where resultCode == 429
| summarize count() by name, bin(timestamp, 1h)
| render timechart
```

---

## 7. Source Feed Polling

### Source Feed Poll Success / Failure Rate (last 7d)

```kql
traces
| where timestamp > ago(7d)
| where message has "[pollSourceFeeds]"
| extend status = case(
        message has "Completed", "completed",
        message has "Skipped", "skipped",
        message has "HTTP" or message has "Failed", "failed",
        "other"
    )
| summarize total = count(), failures = countif(status == "failed"), completed = countif(status == "completed") by bin(timestamp, 1h)
| extend successRate = iff(total == 0, 100.0, round(100.0 * completed / total, 1))
| order by timestamp asc
| render timechart
```

### Feed Poll Audit Events by Feed (last 24h)

```kql
traces
| where timestamp > ago(24h)
| where message has "feed.poll_" or message has "normalize.failed"
| summarize count() by tostring(message), bin(timestamp, 1h)
| order by timestamp desc
```

### Internal Feed Poll Endpoint Failures

```kql
requests
| where timestamp > ago(24h)
| where name has "/api/internal/ingestion/feed-poll"
| summarize failures = countif(success == false), total = count() by resultCode, bin(timestamp, 1h)
| order by timestamp desc
```

---

## Dashboard Setup

1. Navigate to Azure Portal → Application Insights → Logs
2. Run queries and pin results to a shared dashboard
3. Recommended dashboard sections:
   - **Pipeline Health**: Extraction success rate + verification pass rate
   - **SLA Compliance**: Breach count + warning/breach ratio
   - **API Performance**: Search latency + error rate
   - **Infrastructure**: Exception rate + dependency failures
