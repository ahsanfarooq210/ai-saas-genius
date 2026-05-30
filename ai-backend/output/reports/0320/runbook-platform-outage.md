# Runbook: Platform Outage

## Overview
This runbook covers total or severe partial loss of service for the social media automation platform. It applies when multiple critical components fail simultaneously, the API is unreachable, background publishing stops globally, or user data integrity is at risk. The architecture relies on Node.js/Express (API Gateway), MongoDB (primary database), Agenda.js (scheduler), S3-compatible object storage, and OAuth-integrated platform connectors.

## Severity Classification

| Level | Criteria | Response Time |
|-------|----------|---------------|
| **SEV-1** | Complete platform outage: API Gateway returns 5xx for >5 min, zero jobs processing, or MongoDB primary unavailable. | Immediate |
| **SEV-2** | Major degradation: >50% publish failure rate, one social platform globally failing, or severe replication lag preventing job scheduling. | 15 minutes |
| **SEV-3** | Minor degradation: Elevated error rates (<10%), delayed job execution, or non-critical service failure (e.g., notification_service only). | 30 minutes |

## Detection & Alerting

Primary detection channels:
- **API Gateway**: P99 latency >2s or 5xx rate >1% for 2 consecutive minutes.
- **Agenda.js (scheduler_service)**: `agendaJobs` collection shows `lockedAt` older than 10 minutes for >100 jobs, or `lastFinishedAt` stale by >15 minutes.
- **MongoDB**: Replica set member state not `PRIMARY`/`SECONDARY`, or `oplog` replication lag >30s.
- **Platform Connector**: Publish failure rate >5% across all accounts for a single platform (Instagram, Twitter, Facebook).
- **Object Storage**: Upload/download error rate >2% or presigned URL generation failures.
- **Notification Service**: Internal alert pipeline failure (meta-alerting via PagerDuty/Slack).

## Impact Assessment

Within the first 5 minutes, determine:
1. **User-facing scope**: Can users authenticate via `auth_service`? Is the dashboard loading user profiles from `user_service`?
2. **Publishing pipeline**: Is `scheduler_service` creating new jobs? Is `post_service` composing content? Are `media_service` assets retrievable?
3. **Platform reach**: Which platforms are failing in `platform_connector`? Check `rate_limiter` MongoDB collection for `throttledUntil` timestamps.
4. **Data durability**: Is MongoDB accepting writes? Are `object_storage` multipart uploads completing?

Query to assess Agenda.js health:
```javascript
// Run against MongoDB in platform database
db.agendaJobs.find({
  lockedAt: { $lt: new Date(Date.now() - 10 * 60 * 1000) },
  lastFinishedAt: { $exists: false }
}).count()
```

## Immediate Response (0–5 Minutes)

1. **Page the on-call engineer** and open a Slack war room `#incident-platform`.
2. **Halt non-critical operations**:
   - Pause bulk onboarding flows.
   - Disable optional `notification_service` digests to reduce MongoDB load.
3. **Preserve evidence**:
   - Capture `kubectl logs` / CloudWatch logs for `api_gateway` and `scheduler_service`.
   - Export MongoDB `db.serverStatus()` and `rs.status()`.
   - Snapshot `rate_limiter` and `agendaJobs` collection counts.
4. **Do not restart MongoDB primary** unless it is confirmed unrecoverable; prefer failover.

## Scenario-Based Mitigation

### MongoDB Primary Failure or Replication Lag
**Symptoms**: API Gateway 500s with `MongoNetworkError`, Agenda.js jobs not locking, `user_service` timeouts.

- Verify replica set status:
  ```bash
  mongosh --eval "rs.status()"
  ```
- If primary is down, initiate failover:
  ```bash
  mongosh --eval "rs.stepDown(60)" # if primary is responsive but degraded
  ```
  Or force reconfiguration if majority is lost (last resort).
- Check for long-running queries blocking the `agendaJobs` collection:
  ```javascript
  db.currentOp({ "secs_running": { $gt: 60 }, "ns": /agendaJobs/ })
  db.killOp(<opid>)
  ```
- If replication lag is the issue, temporarily reduce `scheduler_service` concurrency to 1 to decrease oplog pressure.

### Agenda.js Scheduler Gridlock
**Symptoms**: Jobs accumulate in `agendaJobs` with `lockedAt` set but no progress; CPU/memory on `scheduler_service` pods is normal.

- Identify stalled job types:
  ```javascript
  db.agendaJobs.aggregate([
    { $match: { lockedAt: { $lt: new Date(Date.now() - 10*60*1000) } } },
    { $group: { _id: "$name", count: { $sum: 1 } } }
  ])
  ```
- If `publish-to-platform` jobs are stuck, check `platform_connector` and `rate_limiter` first.
- Unlock stale jobs (risk: duplicate execution):
  ```javascript
  db.agendaJobs.updateMany(
    { lockedAt: { $lt: new Date(Date.now() - 15 * 60 * 1000) } },
    { $set: { lockedAt: null, lastModifiedBy: null } }
  )
  ```
- Restart `scheduler_service` pods one at a time with reduced `JOB_PROCESSOR_CONCURRENCY` (e.g., from 20 to 5) to prevent thundering herd.

### API Gateway Crash Loop or 502/503 Errors
**Symptoms**: Load balancer health checks failing; Express.js `ECONNRESET` spikes.

- Check for memory leaks or uncaught exceptions in `api_gateway` logs.
- If a bad deployment is suspected, rollback to previous image immediately.
- Verify upstream service health (`auth_service`, `user_service`) before scaling gateway pods; scaling a gateway against failing backends amplifies errors.
- Enable circuit breaker in ingress/load balancer to fail fast on `/health` endpoint failures.

### Object Storage (S3-Compatible) Unavailability
**Symptoms**: `media_service` upload timeouts; posts fail with `MissingMediaError`; presigned URLs return 403/500.

- Verify bucket endpoint and credentials.
- If storage is degraded:
  - Pause `media_service` processing jobs in Agenda.js to prevent infinite retry loops.
  - Allow `scheduler_service` to skip media-heavy posts only if business rules permit; otherwise queue jobs with `nextRunAt` delayed by 30 minutes.
- Check multipart upload cleanup to avoid storage cost spikes after recovery.

### Platform Connector / Rate Limiter Throttle
**Symptoms**: `platform_connector` logs show 429/403 errors; `rate_limiter` collection has `remainingQuota: 0`.

- Inspect per-platform throttle state:
  ```javascript
  db.rate_limits.find().sort({ resetAt: -1 }).limit(10)
  ```
- If a platform globally throttled the app (e.g., Instagram API change), immediately pause all jobs targeting that platform:
  ```javascript
  db.agendaJobs.updateMany(
    { "data.platform": "instagram", name: "publish-to-platform" },
    { $set: { disabled: true } } // or custom flag your scheduler respects
  )
  ```
- If `token_vault` decryption is failing (401/403 from platforms), halt OAuth-dependent publishes to avoid account lockouts.

### Cross-Service Cascading Failure
**Symptoms**: Multiple services report high latency simultaneously; MongoDB connection pools saturated.

- Likely cause: connection pool exhaustion in Node.js services (default MongoDB driver pools can overwhelm under spike).
- Immediate action: scale `api_gateway` replicas **down** temporarily to reduce inbound DB pressure, then scale `scheduler_service` to 1 replica.
- Enable `slowOp` threshold to 100ms to capture the triggering query.

## Communication Protocol

| Audience | Channel | Message Cadence |
|----------|---------|-----------------|
| Internal team | Slack `#incident-platform` | Every 15 minutes |
| Engineering leadership | PagerDuty + email | Upon SEV-1/2 declaration |
| Customers | Status page + in-app banner via `notification_service` | Every 30 minutes during SEV-1 |
| Platform partners | Email (if API partner escalation needed) | As required for rate limit or OAuth issues |

**Note**: If `notification_service` is also degraded, fall back to direct email via SendGrid/SES bypassing the internal queue.

## Recovery & Verification

1. **Restore traffic gradually**:
   - Re-enable `api_gateway` health checks.
   - Confirm MongoDB primary is stable and replication lag <5s.
2. **Validate job pipeline**:
   - Inject a test job via `scheduler_service` to publish a dummy post to a test account.
   - Verify `media_service` can retrieve an object from `object_storage`.
   - Confirm `platform_connector` receives a 200-level response and `rate_limiter` decrements correctly.
3. **Drain backlog**:
   - Monitor `agendaJobs` queued count. If >10,000 jobs backlog exists, increase `scheduler_service` concurrency slowly (steps of 5) to avoid re-throttling platforms.
4. **Re-enable notifications**:
   - Turn `notification_service` back on and verify queued alerts from the outage window are sent or marked stale.

## Escalation Matrix

| Role | Responsibility | Escalation Trigger |
|------|---------------|--------------------|
| L1 On-Call | Initial triage, runbook execution | SEV-1 declared or >10 min no root cause |
| L2 Backend | MongoDB/Agenda.js/Node.js deep dive | MongoDB failover needed or data corruption suspected |
| L3 Platform | OAuth/API partner escalation, rate limit negotiation | Platform-wide 429s or token vault breach |
| Product Lead | Customer communication, feature freeze decision | >1 hour SEV-1 or data loss |

## Post-Incident Actions

Within 24 hours of resolution:
1. Export MongoDB slow query logs and `scheduler_service` memory profiles.
2. Review `agendaJobs` for any jobs that ran twice due to manual unlocks; deduplicate publishes if needed.
3. Audit `token_vault` access logs for any unauthorized decryption during the incident window.
4. Update `rate_limiter` baselines if platform quotas changed.
5. Schedule a blameless post-mortem and update this runbook with new failure modes observed.

## Related Diagrams

- `diagrams/0320/iter1_overview.mmd` — System architecture overview showing component dependencies and data flow relevant to cross-service outage correlation.