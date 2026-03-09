# Runbook: Admin Routing Failures

Procedures for when candidate submissions cannot be routed to admin reviewers.

## Metadata

- Owner role: Ingestion Operations Lead
- Reviewers: Platform On-Call Lead, Data Platform Lead
- Last reviewed (UTC): 2026-03-06
- Next review due (UTC): 2026-06-06
- Severity scope: SEV-2 to SEV-3

---

## How Routing Works

1. `routeToAdmin` function receives a verified candidate
2. Queries `admin_review_profiles` for the nearest admins with capacity (PostGIS `ST_Distance`)
3. Creates assignments in `candidate_admin_assignments` (up to 5 nearest admins)
4. If no community admins have capacity → falls back to ORAN admins
5. If no ORAN admins available → writes `system_alert` notification and logs `unrouted_candidate`

## Routing Thresholds

| Signal | Warning | Critical |
| --- | --- | --- |
| Unassigned pending candidates | > 20 for 4 hours | > 50 for 8 hours |
| SLA breaches per 24h | > 10 | > 25 |
| ORAN admins accepting new | < 2 | 0 |

Critical conditions should trigger SEV-2 triage and incident command activation.

## Decision Matrix

| Condition | Immediate action |
| --- | --- |
| No coverage in area | Manual ORAN assignment + coverage gap escalation |
| Capacity exhausted | Temporarily increase `max_pending` for approved admins |
| Auto-pause saturation | Verify resume threshold and manually re-enable if safe |
| Systemic SLA breach growth | Trigger incident triage and pause new ingestion if needed |

---

## Symptom: Candidates stuck with no assignment

### Diagnosis

```kql
-- Check for unrouted candidates in Application Insights
traces
| where timestamp > ago(24h)
| where message has "unrouted" or message has "No ORAN admins"
| project timestamp, message
| order by timestamp desc
```

```sql
-- Direct DB check: candidates with no assignment after 24h
SELECT c.id, c.created_at, c.organization_name, c.state, c.county
FROM ingestion_candidates c
LEFT JOIN candidate_admin_assignments a ON a.candidate_id = c.id
WHERE a.id IS NULL
  AND c.created_at < NOW() - INTERVAL '24 hours'
  AND c.status = 'pending_review'
ORDER BY c.created_at ASC;
```

### Resolution

1. **Check admin coverage**: Are there any admins with coverage zones overlapping the candidate's location?

   ```sql
   SELECT arp.user_id, arp.coverage_states, arp.coverage_counties,
          arp.pending_count, arp.max_pending, arp.is_accepting_new, arp.is_active
   FROM admin_review_profiles arp
   WHERE arp.is_active = true
   ORDER BY arp.pending_count ASC;
   ```

2. **If no admins cover the area**:
   - The coverage gap alerting function should have flagged this (daily at 8 AM UTC)
   - Manually assign an ORAN admin:

     ```sql
     INSERT INTO candidate_admin_assignments (candidate_id, admin_profile_id, status, sla_deadline)
     SELECT '<candidate-id>', id, 'pending', NOW() + INTERVAL '48 hours'
     FROM admin_review_profiles
     WHERE role = 'oran_admin' AND is_active = true AND is_accepting_new = true
     LIMIT 1;
     ```

3. **If admins exist but are at capacity**:
   - Check capacity status via the admin capacity API:

     ```bash
     curl "https://<web-app>.azurewebsites.net/api/admin/capacity" \
       -H "Authorization: Bearer <admin-token>"
     ```

   - Consider temporarily increasing `max_pending` for an ORAN admin:

     ```sql
     UPDATE admin_review_profiles SET max_pending = 60 WHERE user_id = '<oran-admin-id>';
     ```

   - The auto-capacity scaling may help fast reviewers take on more if they have > 20 completed reviews

4. **If auto-pause triggered**:
   - `shouldToggleAcceptingNew()` pauses admins at capacity and resumes at 80% utilization
   - Check if admins are paused:

     ```sql
     SELECT user_id, is_accepting_new, pending_count, max_pending
     FROM admin_review_profiles
     WHERE is_accepting_new = false AND is_active = true;
     ```

---

## Symptom: SLA breaches accumulating

### Diagnosis

```bash
# Check recent SLA breach output
curl -X POST "https://<web-app>.azurewebsites.net/api/internal/sla-check" \
  -H "Authorization: Bearer <INTERNAL_API_KEY>"
```

```kql
traces
| where timestamp > ago(7d)
| where message has "[checkSlaBreaches]"
| project timestamp, message
| order by timestamp desc
```

### Resolution

The escalation engine handles breaches automatically in tiers:

- T+0h: Notify assignee
- T+12h: Re-notify assignee + alert org host_admins
- T+24h: Auto-reassign to next available admin
- T+48h: Escalate to ORAN admin queue

If breaches persist past T+48h with no resolution:

1. Check if any ORAN admins are active and accepting
2. Manually review and resolve the oldest breached candidates
3. Consider onboarding more community admins for the affected areas

---

## Symptom: Coverage gap alerts firing daily

### Diagnosis

Check the coverage gap report:

```bash
curl -X POST "https://<web-app>.azurewebsites.net/api/internal/coverage-gaps" \
  -H "Authorization: Bearer <INTERNAL_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"thresholdHours": 24}'
```

### Resolution

1. Identify states/counties with no admin coverage
2. Recruit community admins for those areas
3. In the interim, ensure ORAN admins are handling spillover
4. Review the admin capacity dashboard (`GET /api/admin/capacity`) to verify ORAN admin headroom

---

## Emergency: All admins unavailable

If no admin can accept assignments:

1. **Assess scope**: How many candidates are waiting?

   ```sql
   SELECT COUNT(*) FROM ingestion_candidates WHERE status = 'pending_review';
   ```

2. **Temporary measure**: Create a temporary ORAN admin profile for a trusted team member

   ```sql
   INSERT INTO admin_review_profiles (user_id, role, max_pending, max_in_review, is_active, is_accepting_new, coverage_states)
   VALUES ('<user-id>', 'oran_admin', 50, 20, true, true, ARRAY['*']);
   ```

3. **Communicate**: The system sends `system_alert` notifications when routing fails — check ORAN admin notification inboxes

4. **Post-incident**: Review admin coverage map and capacity limits; adjust `ROLE_CAPACITY_DEFAULTS` if needed
