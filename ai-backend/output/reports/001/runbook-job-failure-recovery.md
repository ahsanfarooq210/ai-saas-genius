# Job Failure Recovery Runbook

## Scope and Responsibilities

This runbook governs operational recovery procedures for all background jobs in the social media automation platform. It covers failures originating in or affecting the `job_scheduler` (Agenda.js), `media_processor`, and `platform_publisher` components. Primary responsibilities include:

- Detecting and classifying job failures across the content pipeline (media preparation → scheduling → platform publishing).
- Executing safe retry and rollback procedures without causing duplicate posts or leaking partial media artifacts.
- Recovering from stale job locks when Agenda.js worker processes crash or are terminated mid-flight.
- Orchestrating OAuth token refresh during mid-job authentication failures via the `auth_service` and `token_store`.
- Moving unrecoverable jobs to a Dead Letter Queue (DLQ) and triggering the `notification_service` to alert end users.
- Maintaining an audit trail of all manual and automated recovery actions.

## APIs and Operational Interfaces

Recovery operations interact with the following interfaces:

| Interface | Purpose |
|-----------|---------|
| **Agenda.js MongoDB Collection** (`agendaJobs`) | Direct source of truth for job state (`lockedAt`, `nextRunAt`, `failCount`, `failReason`, `lastRunAt`). Used for diagnostic queries and surgical state repairs. |
| **Internal Admin REST API** (`/admin/jobs`) | `GET /admin/jobs?status=failed&component=platform_publisher` lists failed jobs. `POST /admin/jobs/retry` accepts a payload of job IDs to requeue. `POST /admin/jobs/unlock` clears stale `lockedAt` fields. |
| **MongoDB Collections** (`posts`, `media`, `users`) | Updated to reflect recovery outcomes (e.g., resetting `post.status` from `publishing` to `scheduled`). |
| **Token Store Internal API** | `POST /internal/tokens/refresh` forces an OAuth refresh for a given `userId` and `platform` before retrying a publish job. |
| **Notification Service Webhook** | `POST /notify/job-fatal` emits user-facing alerts when a job is moved to the DLQ after exhausting retries. |
| **Platform APIs (Meta, X, etc.)** | Idempotency keys and status checks prevent duplicate publication during recovery retries. |

### Example Diagnostic Query

```javascript
// Find all failed platform publishing jobs for a specific user in the last 24h
db.agendaJobs.find({
  name: "publish-to-platform",
  "data.userId": ObjectId("..."),
  failCount: { $gt: 0 },
  lastRunAt: { $gte: new Date(Date.now() - 86400000) }
}, {
  _id: 1,
  failReason: 1,
  failCount: 1,
  "data.postId": 1,
  "data.platform": 1
})
```

## Data Ownership

The recovery process owns and mutates the following data artifacts:

- **`agendaJobs` documents**: The Agenda.js job record is the canonical source for execution state. Recovery procedures directly update `lockedAt`, `nextRunAt`, `failCount`, and `failReason` when clearing crashes or forcing retries.
- **`posts` collection**: Tracks the logical lifecycle of a social media post. Recovery must keep `post.status` synchronized with the job state to prevent users from editing a post currently being retried.
- **`media` collection**: References processed file variants. Recovery from media processing failures may require deleting corrupted derived assets in `media_storage` and resetting `media.processingStatus` to `pending`.
- **Dead Letter Queue (`failed_jobs_dlq`)**: A separate MongoDB collection capturing jobs that exceeded the maximum retry threshold. Stores the final error payload, original job data, and tombstone timestamp.
- **Recovery Audit Log (`recovery_audit`)**: Append-only records of who/what initiated a retry, the previous and new job states, and the timestamp of the action.

## Failure Modes and Recovery Procedures

### 1. Media Processing Failures

**Symptoms**: `media_processor` jobs fail with `failReason` referencing Sharp/FFmpeg errors, memory exhaustion, or unsupported codecs. `media.processingStatus` remains `processing` or `failed`.

**Recovery Steps**:
1. Inspect `failReason` in `agendaJobs` to distinguish between corrupt source files (unrecoverable) and transient resource limits (recoverable).
2. For transient errors, delete any partial processed artifacts in `media_storage` (identified by `media.derivedVariants` partial writes) to avoid serving incomplete files.
3. Reset the job via `POST /admin/jobs/retry` with `jobIds`. Agenda.js will pick up the job based on `nextRunAt`.
4. If the source file is corrupt, move the job to `failed_jobs_dlq`, set `post.status` to `failed`, and invoke the `notification_service` so the user can re-upload.

### 2. Platform Publishing Failures

**Symptoms**: `platform_publisher` jobs fail with HTTP 4xx/5xx responses from social media APIs.

| Platform Error | Root Cause | Recovery Action |
|----------------|------------|-----------------|
| `429 Too Many Requests` | Rate limiting | Retry with exponential backoff. Do not increment `failCount` toward the DLQ threshold. Use `nextRunAt = now + (2^attempt * 60s)`. |
| `401 Unauthorized` | Expired or revoked OAuth token | Halt retry loop. Call `POST /internal/tokens/refresh` via `auth_service`. If refresh succeeds, update `token_store` and requeue the job. If revoked, notify the user to reconnect the account. |
| `400 Bad Request` (content policy) | Platform rejected media/caption | Move immediately to `failed_jobs_dlq`. Update `post.status` to `rejected`. Do not auto-retry. |
| `500/503` | Platform outage | Retry with fixed 5-minute intervals up to 12 attempts (1 hour total). |

**Duplicate Prevention**: Every retry must reuse the original idempotency key stored in `job.data.platformRequestId`. If the platform does not support idempotency keys, query the platform’s recent posts API to verify the post does not already exist before re-issuing the publish call.

### 3. Job Scheduler / Worker Crashes

**Symptoms**: Agenda.js workers restart due to OOM or pod eviction. Jobs remain in a "zombie" state with `lockedAt` set in the past and no active worker holding the lock.

**Recovery Steps**:
1. Detect stale locks: `db.agendaJobs.find({ lockedAt: { $lt: new Date(Date.now() - 300000) } })` (5-minute threshold).
2. Unlock via `POST /admin/jobs/unlock` or direct update:
   ```javascript
   db.agendaJobs.updateMany(
     { lockedAt: { $lt: new Date(Date.now() - 300000) } },
     { $set: { lockedAt: null, lastModifiedBy: null } }
   )
   ```
3. For jobs that were mid-publish, inspect the target platform to determine if the post succeeded before the crash. If confirmed published, mark `post.status` as `published` and remove the Agenda.js job. If uncertain, requeue with the same idempotency key.

### 4. Token Expiration Mid-Job

**Symptoms**: `platform_publisher` receives a 401 response after `token_store` provided a token that expired during the request window.

**Recovery Steps**:
1. Catch the 401 in the publisher worker and throw a non-retryable `TokenExpiredError`.
2. The `job_scheduler` intercepts this error type and emits an `auth.refresh.required` internal event containing `userId` and `platform`.
3. `auth_service` performs the refresh against the social platform and writes the new token to `token_store`.
4. Once the refresh event is acknowledged, recompute `nextRunAt` for the job to `now + 30s` and reset `failCount` for this specific error class to avoid DLQ escalation.

### 5. Database and Infrastructure Failures

**Symptoms**: Jobs fail with MongoDB connection timeouts, `media_storage` blob write errors, or CDN URL resolution failures.

**Recovery Steps**:
- **MongoDB Timeouts**: If `agendaJobs` updates fail due to replica set failover, Agenda.js will automatically reconnect. Verify the job lock was not orphaned. Add the `lockedAt` index if queries slow down: `db.agendaJobs.createIndex({ lockedAt: 1, nextRunAt: 1, name: 1 })`.
- **Blob Storage Failures**: If processed media cannot be written to `media_storage`, the `media_processor` job should fail fast. Retry only after confirming storage health. Do not leave zero-byte objects in the bucket.
- **CDN Failures**: If the platform cannot fetch media from the `cdn`, verify the signed URL has not expired. If the URL TTL is shorter than the scheduling window, regenerate the CDN URL in the `platform_publisher` before the publish attempt.

## Scaling Considerations

- **Bulk Retry Safety**: The `POST /admin/jobs/retry` endpoint must paginate large retry batches (max 500 jobs per request) and use cursor-based iteration on `agendaJobs`. Avoid `$in` queries with thousands of IDs, which degrade MongoDB performance under load.
- **Worker Concurrency During Backlogs**: When recovering from a regional platform outage, temporarily scale `platform_publisher` worker replicas. Cap total concurrent publishes per platform per user to avoid rate limits (e.g., max 2 concurrent jobs per user per platform).
- **Distributed Rate Limiting**: If scaling publishers horizontally, replace in-memory rate limiters with a Redis-backed token bucket. This ensures the 429 recovery backoff is respected across all nodes.
- **MongoDB Agenda.js Collection Growth**: At >10 million jobs/day, shard the `agendaJobs` collection by `name` (e.g., `media-processor`, `platform-publisher`) to prevent the scheduler from becoming a bottleneck during mass recovery events.
- **Media Processor Memory**: Reprocessing a large backlog of video jobs requires vertical scaling (memory) or throttling concurrency, as FFmpeg processes are memory-intensive. Scale `media_processor` pods independently from stateless API pods.

## Related Diagrams

- `diagrams/001/iter1_overview.mmd` — System architecture overview showing the interaction between `job_scheduler`, `media_processor`, `platform_publisher`, `auth_service`, `token_store`, and `notification_service` during failure recovery scenarios.