# Runbook: Agenda Job Recovery

## Scope and Responsibilities

This runbook governs operational recovery procedures for the Agenda.js job layer that orchestrates automated content publishing across the social media automation platform. It covers the lifecycle of background jobs managed by `scheduler_service`, executed by `agenda_worker`, and persisted in MongoDB. Responsibilities include:

- Detecting and remediating jobs stuck in `locked` or `failed` states without manual worker intervention.
- Preventing duplicate content publication during recovery actions.
- Restoring consistency between the `agendaJobs` collection and the application-level `posts` collection.
- Coordinating with `notification_service` to surface recovery actions to end users when publish failures are user-visible.

## Affected Components

- **scheduler_service**: Creates and mutates Agenda job definitions; owns the translation of user posting preferences into `publish-post` and `prepare-media` job payloads.
- **agenda_worker**: Node.js process pool that locks, executes, and completes jobs. Crash or restart events are the primary source of stale locks.
- **mongodb**: Hosts the `agendaJobs` collection (Agenda’s internal queue store) and the application collections (`posts`, `platform_connections`, `users`).
- **publisher_service**: Invoked by the worker to execute platform API calls. Failures here propagate back to Agenda as job errors.
- **notification_service**: Dispatches user alerts when recovery actions change post status or require re-authentication.
- **token_store**: Source of truth for OAuth token validity; revoked tokens are a common root cause of unrecoverable job failures.

## Failure Modes

| Failure Mode | Root Cause | Impact |
|---|---|---|
| **Stale Job Locks** | `agenda_worker` pod crashes or is SIGKILLed while holding a lock. Agenda’s `lockLifetime` expires, but if all workers are down, the job sits unprocessed. | Posts remain in `publishing` state indefinitely; user content misses its scheduled window. |
| **Exhausted Retry Budget** | `publisher_service` encounters revoked OAuth tokens or deleted media. `failCount` reaches the job’s `maxRetries`. | Job is abandoned by Agenda; post never publishes unless manually requeued. |
| **Rate-Limit Retry Storm** | Platform APIs (e.g., Instagram, LinkedIn) return HTTP 429. Agenda’s default backoff is insufficient, or multiple jobs hit the same user token simultaneously. | Token rate limits escalate; platform may temporarily ban API client. |
| **Orphaned Scheduled Jobs** | User disconnects a platform account via `user_service`, but `scheduler_service` does not cascade-cancel pending jobs for that connection. | Jobs execute against invalid tokens, generating unnecessary failures and alerts. |
| **Clock Skew / Timezone Drift** | `nextRunAt` computed in the user’s timezone but stored without proper offset handling, or DST transition causes jobs to stack. | Jobs fire off-schedule or appear "missed" because `nextRunAt` is in the past relative to the worker’s clock. |

## Detection and Alerting

Monitor the following signals to trigger this runbook:

- **MongoDB Query — Stuck Locks**:
  ```javascript
  db.agendaJobs.find({
    name: 'publish-post',
    lockedAt: { $lt: new Date(Date.now() - 15 * 60 * 1000) },
    lastRunAt: { $exists: false }
  })
  ```
- **Application Metric — Long-Running Publishes**:
  `posts` documents in `status: 'publishing'` with `updatedAt` older than 20 minutes.
- **Worker Metric — Queue Depth**:
  `agenda_worker` reported queue depth (via Agenda’s `jobQueue` event or MongoDB count of `nextRunAt: { $lte: now }`) exceeds 5,000 jobs.
- **Error Rate Threshold**:
  `publisher_service` logs show > 10% error rate for a single platform client over a 5-minute window.

## Recovery Procedures

### 1. Stale Lock Cleanup (Worker Crash)

1. Verify `agenda_worker` pod health. If the deployment is crashed, restart the pool **before** clearing locks to prevent immediate re-locking by a degraded process.
2. Identify jobs that are locked beyond the configured `lockLifetime` (default 10 minutes, overridden to 5 minutes for `publish-post`):
   ```javascript
   const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);
   const stuck = await agenda._collection.find({
     name: 'publish-post',
     lockedAt: { $lt: staleThreshold }
   }).toArray();
   ```
3. For each stuck job, cross-check the `posts` collection to detect partial publication:
   ```javascript
   const post = await db.posts.findOne({ _id: stuck.data.postId });
   const alreadyPublished = post.platformPostIds?.length > 0;
   ```
   - If already published: cancel the stuck job to prevent duplicates.
   - If not published: reset the lock and preserve the original `nextRunAt`:
     ```javascript
     await agenda._collection.updateOne(
       { _id: stuck._id },
       { $set: { lockedAt: null, lastModifiedBy: 'runbook-stale-lock-recovery' } }
     );
     ```
4. Audit recovered jobs in `notification_service` logs with severity `warn`.

### 2. Failed Job Triage and Retry

1. Query for jobs that have exhausted retries or are failing repeatedly:
   ```javascript
   const failedJobs = await agenda.jobs({
     name: 'publish-post',
     failCount: { $gte: 5 }
   });
   ```
2. Classify by `failReason`:
   - **Token / Auth Error**: Query `token_store` for the user’s platform connection. If the refresh token is revoked, cancel the job and set `posts.status` to `failed-auth`. Trigger `notification_service` to prompt re-authentication.
   - **Media Not Found**: If `media_service` confirms the asset is deleted, cancel the job and mark `posts.status` to `failed-media`.
   - **Transient Platform Error** (5xx, timeout): Reset `failCount` to 0 and reschedule with exponential backoff:
     ```javascript
     await job.schedule('in 30 minutes');
     await job.save();
     ```
3. For mass failures (> 50 jobs) tied to a single platform API (e.g., Instagram Graph API outage), pause the worker’s consumption of that job type and reschedule all affected jobs to a future window rather than retrying individually.

### 3. Rate-Limit Backpressure Recovery

1. If `platform_api_clients` reports HTTP 429 with `x-ratelimit-remaining: 0`, immediately reduce `agenda_worker` concurrency for the affected client to 1 to stop the retry storm.
2. For all locked or queued jobs targeting that platform, bump `nextRunAt` by the platform’s reset window (typically extracted from `x-ratelimit-reset` or default to 1 hour):
   ```javascript
   await agenda._collection.updateMany(
     {
       name: 'publish-post',
       'data.platformTargets': 'instagram',
       nextRunAt: { $lt: resetWindow }
     },
     { $set: { nextRunAt: new Date(resetWindow * 1000), failCount: 0 } }
   );
   ```
3. Restore full concurrency only after the rate-limit window has passed and error rates drop below baseline.

### 4. Orphaned Job Cancellation

When `user_service` processes an account disconnection or user deletion, run a synchronous cleanup:

```javascript
await agenda.cancel({
  name: 'publish-post',
  'data.userId': userId
});
await db.posts.updateMany(
  { userId: userId, status: { $in: ['scheduled', 'publishing'] } },
  { $set: { status: 'cancelled', cancelledAt: new Date() } }
);
```

If the disconnection event was missed and orphaned jobs are discovered later:
1. Correlate `agendaJobs.data.userId` with `platform_connections.status: 'disconnected'`.
2. Cancel matching jobs and update `posts` status accordingly.

### 5. Mass Rescheduling (Timezone / Schedule Corrections)

If a bug in `scheduler_service` generates incorrect `nextRunAt` values (e.g., UTC/local mismatch):

1. Halt `agenda_worker` job processing for the affected job name to prevent misfires.
2. Recalculate correct `nextRunAt` based on the user’s `postingPreferences.timezone` stored in the `users` collection.
3. Apply a bulk update using a MongoDB aggregation pipeline or a batched Node.js script (batch size ≤ 500 to avoid oplog pressure):
   ```javascript
   const bulkOps = correctedJobs.map(j => ({
     updateOne: {
       filter: { _id: j._id },
       update: { $set: { nextRunAt: j.correctNextRunAt, lastModifiedBy: 'runbook-mass-reschedule' } }
     }
   }));
   await agenda._collection.bulkWrite(bulkOps);
   ```
4. Resume worker processing and verify queue ordering.

## Data Ownership

| Store | Owned By | Key Fields | Recovery Relevance |
|---|---|---|---|
| `agendaJobs` | Agenda.js / `scheduler_service` | `name`, `data`, `nextRunAt`, `lockedAt`, `failCount`, `failReason`, `lastModifiedBy` | Directly mutated during lock clearing, rescheduling, and cancellation. |
| `posts` | `content_service` / `publisher_service` | `status`, `agendaJobId`, `platformPostIds`, `publishAttempts`, `lastError` | Canonical source for whether a post was actually published; used to prevent duplicates. |
| `platform_connections` | `user_service` | `userId`, `platform`, `tokenStatus`, `rateLimitResetAt` | Determines if a failed job is recoverable or permanently blocked. |
| `users` | `user_service` | `postingPreferences.timezone`, `postingPreferences.frequency` | Used to reconstruct correct `nextRunAt` during mass rescheduling. |

## APIs and Interfaces

- **`agenda.jobs(query)`**: Read-only inspection of job state without acquiring locks.
- **`agenda.cancel(query)`**: Permanent removal of jobs from the queue. Use for orphaned or unrecoverable jobs.
- **`agenda.now(name, data)`**: Enqueue an immediate, one-time execution. Use sparingly during recovery to avoid queue flooding.
- **`agenda.schedule(when, name, data)`**: Updates `nextRunAt` on an existing job instance.
- **Direct MongoDB `agendaJobs` access**: Required for bulk `updateMany` and `bulkWrite` operations that Agenda’s API does not expose efficiently. All direct mutations must set `lastModifiedBy` to `runbook-<procedure-name>` for traceability.
- **`scheduler_service` Admin Endpoint** (if deployed): `POST /admin/jobs/requeue` accepts a list of `agendaJobId` values and delegates to Agenda to reset `failCount` and `lockedAt`. Prefer this over raw MongoDB when available to keep business logic centralized.
- **`notification_service.notifyUser(payload)`**: Emits `type: 'RECOVERY_ACTION'` events so users are informed if their posts were delayed or cancelled.

## Scaling Considerations

- **Database Contention**: The `agendaJobs` collection is high-churn. Recovery scripts that run `updateMany` or `bulkWrite` can contend with Agenda’s `findAndModify` lock acquisition. Execute bulk operations in batches of 500–1,000 and prefer off-peak hours (avoid 00:00 UTC when global midnight queues overlap).
- **Worker Ingestion Surge**: Unlocking thousands of jobs simultaneously can cause `agenda_worker` to pull them all at once, overwhelming `publisher_service` and triggering cross-platform rate limits. Throttle recovery by re-enabling jobs in tranches and temporarily lowering worker `maxConcurrency`.
- **Collection Bloat**: Failed jobs and their retry history accumulate in `agendaJobs`. Implement a compaction job (outside Agenda or via `agenda.purge()`) to remove documents where `failCount > 0` and `lastRunAt < (now - 30 days)`, preventing index inefficiency on `nextRunAt` and `lockedAt`.
- **Idempotency Boundaries**: Social platform APIs do not universally support idempotency keys. Therefore, recovery must treat `posts.platformPostIds` as the ground truth. Never blindly re-run a `publish-post` job without verifying the target platform array in `posts` is empty.
- **Regional MongoDB Primaries**: If the MongoDB replica set spans regions, run recovery scripts against the primary node. Reading from secondaries to build recovery lists is safe, but all state-mutating writes must go to the primary to prevent job state drift.

## Verification

After executing any recovery procedure:

1. **Lock Sanity**: `db.agendaJobs.countDocuments({ name: 'publish-post', lockedAt: { $ne: null } })` should trend to zero within the `lockLifetime` window.
2. **Post State Consistency**: No `posts` documents should remain in `status: 'publishing'` for longer than 20 minutes.
3. **Duplicate Check**: Query for duplicate `platformPostIds` per user across `posts` created within the recovery window. Expect zero duplicates.
4. **Log Correlation**: `agenda_worker` logs should show `starting publish-post` followed by `finished publish-post` for recovered job IDs within 10 minutes of lock release.
5. **User Notification Audit**: Confirm `notification_service` dispatched recovery summaries to affected users if the incident caused a publish delay > 1 hour.

## Related Diagrams

- `diagrams/001/iter1_overview.mmd`