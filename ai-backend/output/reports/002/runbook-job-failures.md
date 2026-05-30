# Runbook: Job Failures

## Scope
This runbook covers the detection, diagnosis, and remediation of background job failures across the social media automation platform. It applies to all Agenda.js job types managed by **Job_Service**, including content generation (`generate-content`), media processing (`process-media`), and publishing (`publish-post`). Failures in **Agenda_Queue**, **Content_Service**, **Media_Service**, **Publish_Service**, and their downstream dependencies are addressed.

## Severity Classification

| Level | Criteria | Response Time |
|-------|----------|---------------|
| **SEV-1** | All publishing halted across all platforms; widespread OAuth token invalidation; MongoDB primary outage causing queue deadlock. | Immediate |
| **SEV-2** | Publishing degraded for a single platform (e.g., Instagram API outage); media processing stalled for >25% of users; rate-limiting affecting a user cohort. | < 30 min |
| **SEV-3** | Isolated job failures; single-user token expiry; transient platform 5xx with successful retry. | < 4 hours |

## Detection & Alerting

- **Queue Depth**: Monitor `agendaJobs` documents where `nextRunAt <= now()` and `lockedAt` is null. Alert if depth exceeds 1,000 jobs for >5 minutes.
- **Stalled Jobs**: Alert when `lockedAt` is older than the configured `lockLifetime` (default 10 minutes) and `lastFinishedAt` is missing.
- **Failure Rate**: Publish_Service error rate >5% over a 5-minute window.
- **Media Processing Lag**: `process-media` jobs with `lastRunAt` older than 30 minutes and no `lastFinishedAt`.
- **Token Health**: Redis TTL for `oauth:{platform}:{accountId}` approaching zero.
- **Dead-Letter Activity**: Jobs with `failCount >= 3` in `agendaJobs`.

## Failure Taxonomy & Remediation

### 1. Agenda Queue Infrastructure Failures

#### Symptoms
- Jobs are scheduled but not executing.
- `lockedAt` timestamps are stale; workers appear idle.
- Multiple workers logging `unable to acquire lock` due to split-brain or zombie locks.

#### Diagnosis
Check for zombie locks in MongoDB:
```javascript
const cutoff = new Date(Date.now() - 10 * 60 * 1000);
db.agendaJobs.find({
  lockedAt: { $lt: cutoff },
  lastFinishedAt: { $exists: false }
});
```
Verify Job_Service pod health and MongoDB replica set status (`rs.status()`). Ensure no active process holds the PID referenced in `lastModifiedBy`.

#### Remediation
1. If the Job_Service worker process is confirmed dead, unlock affected jobs:
   ```javascript
   db.agendaJobs.updateMany(
     { lockedAt: { $lt: cutoff } },
     { $unset: { lockedAt: 1, lastModifiedBy: 1 } }
   );
   ```
   **Caution**: Do not unlock while a worker is still alive; this risks duplicate execution.
2. If MongoDB is in failover, pause Job_Service replicas until a primary is elected to prevent half-committed state updates.
3. Restart Job_Service pods gracefully to re-register job definitions with Agenda.

#### Prevention
- Set Agenda `lockLifetime` (e.g., 10 minutes) to exceed the longest expected job duration.
- Enable process-level heartbeats and liveness probes on Job_Service containers.
- Use MongoDB write concern `w: majority` for Agenda state transitions.

### 2. Content Generation Failures

#### Symptoms
- `generate-content` jobs fail with `failCount` increments.
- Draft posts in MongoDB have null or malformed `caption` / `hashtags`.

#### Diagnosis
Inspect Content_Service logs for template rendering exceptions (e.g., missing variables from user preferences). Query MongoDB:
```javascript
db.posts.find({
  status: 'draft',
  caption: null,
  createdAt: { $gte: new Date(Date.now() - 3600000) }
});
```

#### Remediation
1. Fix the underlying schema or template bug in Content_Service.
2. Re-enqueue affected jobs via the Job_Service admin retry endpoint with the original `jobId`.
3. If user preferences are corrupted, mark the post as `needs_configuration` and trigger **Notification_Service** to alert the user.

#### Prevention
- Validate posting preferences at ingestion time against a strict JSON Schema.
- Cap caption generation output length to platform-specific limits before enqueueing.

### 3. Media Processing Failures

#### Symptoms
- `process-media` jobs fail or timeout.
- Original asset exists in **S3_Storage** but processed variant is missing.
- CDN returns 404 for processed URLs.

#### Diagnosis
- Check Media_Service logs for FFmpeg/processing errors or S3 upload timeouts.
- Inspect S3 metrics (`5xxErrors`, `TotalRequestLatency`) for the processed media bucket.
- Query media records:
  ```javascript
  db.mediaAssets.find({ status: 'processing_failed' });
  ```

#### Remediation
1. **Transient S3 errors**: Re-enqueue the job. If S3 is throttling, reduce `process-media` concurrency in Agenda.
2. **Unsupported format**: Mark the asset as `rejected`. Notify the user via **Notification_Service** with the specific validation error.
3. **Corrupted source file**: Delete the source S3 object, mark the post as `pending_media`, and prompt the user to re-upload.
4. **Manual recovery**: If the processed file was lost but the source remains, trigger a one-off reprocessing job via Job_Service API.

#### Prevention
- Enforce MIME-type and file-size checks at API Gateway before upload.
- Store platform-specific encoding requirements (e.g., max resolution, codec) in **Media_Service** config and validate pre-flight.

### 4. Social Platform Publishing Failures

#### Symptoms
- `publish-post` jobs fail with platform HTTP errors.
- Users receive failure notifications or silent misses.

#### Diagnosis
Correlate `failReason` in `agendaJobs` with Publish_Service logs.

| HTTP Code | Meaning | Investigation |
|-----------|---------|---------------|
| **401/403** | Auth failure | Check Redis `oauth:{platform}:{accountId}` and MongoDB `socialAccounts.tokenExpiry`. Verify token has not been revoked by the platform. |
| **429** | Rate limited | Inspect response `retry-after` or `x-rate-limit-remaining`. Cross-check user posting frequency against platform limits. |
| **5xx** | Platform outage | Check external platform status pages. |
| **400** | Content policy | Inspect error payload for oversized media, banned hashtags, or missing required fields. |

#### Remediation
- **401/403**: Do **not** auto-retry. Trigger **Auth_Service** token refresh. If refresh fails, set `socialAccounts.status = 'reauth_required'` and alert the user via **Email_Provider** and **WebSocket_Gateway**.
- **429**: Respect `retry-after`. Reschedule the job in Agenda using `job.schedule(new Date(Date.now() + retryAfterMs))`. If the daily limit is reached, defer to the next configured posting window.
- **Platform 5xx**: Retry up to 3 times with exponential backoff using Agenda’s built-in `failCount` logic. If the platform outage persists >30 minutes, pause the platform-specific job processor to preserve rate-limit headroom.
- **400 (Policy)**: Permanently fail the job. Update `agendaJobs` status to `blocked` and attach the platform error code. Notify the user with actionable guidance.

#### Prevention
- Proactively refresh OAuth tokens 24 hours before expiry via a scheduled `refresh-token` job.
- Implement a per-user, per-platform token bucket rate limiter in Publish_Service backed by **Redis_Cache**.
- Run content validation against platform rulesets before enqueueing the `publish-post` job.

### 5. Cross-Cutting Dependency Failures

#### Symptoms
- Multiple unrelated job types fail simultaneously.
- Cascading timeouts across **Content_Service**, **Media_Service**, and **Publish_Service**.

#### Diagnosis
- **MongoDB**: Check replication lag (`rs.printSecondaryReplicationInfo()`) and primary health. If Agenda cannot write `lockedAt`, jobs will not start.
- **Redis**: Verify connectivity. If **Redis_Cache** is down, **Auth_Service** may fall back to slower MongoDB reads, increasing latency beyond Agenda `lockLifetime`.
- **Inter-Service Network**: Check HTTP/gRPC timeout logs between Job_Service and downstream services.

#### Remediation
- **MongoDB failover**: Pause all Job_Service workers during primary election. Resume only after `rs.status()` shows a stable primary.
- **Redis outage**: Accept degraded token lookup latency. If Redis is used for rate-limit counters, enable a fail-open or fail-closed policy consistent with platform agreements (recommended: fail-closed to avoid bans).
- **Service timeout**: If Publish_Service latency exceeds 5 seconds and cannot be reduced, temporarily lower Agenda concurrency to prevent lock exhaustion. If the issue is a downstream platform, apply the 5xx remediation above.

## General Investigation Steps

1. **Quantify impact**: Query `agendaJobs` to count affected jobs by `name`, `failCount`, and time range.
2. **Identify the stage**: Determine if the failure occurs in `generate-content`, `process-media`, or `publish-post`.
3. **Check service health**: Verify Job_Service, Content_Service, Media_Service, Publish_Service, and MongoDB metrics.
4. **Trace a representative job**: Follow the `jobId` / `traceId` across logs to locate the first point of failure.
5. **Classify transience**: Distinguish between retryable (network blip) and permanent (policy violation, revoked token) failures.

## Recovery Procedures

- **Bulk Retry**: Use the Job_Service internal admin endpoint to requeue jobs where `failCount < 3` and `failReason` indicates a transient error (timeout, platform 5xx). Exclude 401, 403, and policy violations.
- **Manual Unlock**: For jobs stuck after a worker crash, execute the MongoDB unlock script in the Infrastructure section only after confirming the worker PID is absent.
- **Cancel & Compensate**: If a publish window has passed and content is no longer relevant, update the job state to `cancelled` and notify the user. Offer a one-click reschedule via **Notification_Service**.
- **Reconciliation**: If a publish succeeded on the platform but Agenda recorded a failure (e.g., timeout on response), manually update `agendaJobs` and `posts` to `published` to prevent duplicate posts.

## Escalation Path

| Condition | Escalate To |
|-----------|-------------|
| Mass OAuth token revocation across a platform | **Auth_Service** owner + Security On-Call |
| Platform API breaking change (unexpected payload format) | **Integration Team** |
| MongoDB replica set instability or data inconsistency | **Data Infrastructure** |
>2-hour SEV-1 with no clear root cause | **Platform Engineering Lead** |

## Scaling Considerations

- **Worker Concurrency**: Agenda instances in Job_Service must align MongoDB connection pool size with `maxConcurrency`. Adding Job_Service replicas scales throughput horizontally, but excessive replicas increase lock contention on `agendaJobs`.
- **Media Isolation**: `process-media` jobs are I/O and CPU intensive. Consider dedicating a separate Agenda worker pool or namespace (e.g., `agenda-media`) backed by distinct Job_Service pods to prevent media backpressure from stalling publishing.
- **Publish Rate Limiting**: Scale Publish_Service horizontally cautiously; platform rate limits are bound per account or IP. Use **Redis_Cache** to coordinate global rate-limit state across Publish_Service instances.
- **Queue Backpressure**: If `nextRunAt` lag grows >10 minutes under peak load, scale Job_Service and evaluate MongoDB index health on `agendaJobs` (ensure compound index on `{ name: 1, lockedAt: 1, priority: -1, nextRunAt: 1 }`).

## Related Diagrams

- `diagrams/002/iter1_overview.mmd` — End-to-end system overview showing job orchestration flow across Job_Service, Agenda_Queue, Content_Service, Media_Service, and Publish_Service.