# Job Scheduler

## Responsibilities

The Job Scheduler is the centralized background execution engine for all asynchronous publishing workflows. Its specific responsibilities include:

- **Queue & Persistence**: Receiving scheduling instructions from the API layer and persisting them as durable Agenda.js job documents in MongoDB.
- **Temporal Orchestration**: Evaluating `nextRunAt` timestamps derived from user posting preferences (timezone-aware windows, frequency rules, and platform-specific blackout periods) and triggering job execution when those times mature.
- **Dispatch to Publisher**: At execution time, handing off the assembled job payload to the `publisherService` to perform the actual external API calls.
- **Retry & Dead-Letter Handling**: Applying platform-aware retry policies—exponential backoff for transient 5xx/timeout errors, immediate cessation for auth revocation (4xx)—and quarantining permanently failed jobs.
- **Concurrency & Rate Limit Guardrails**: Enforcing per-job-type concurrency limits and lock lifetimes so that external social media APIs are not overwhelmed by concurrent publish requests from a single user or the global worker pool.

## APIs / Interfaces

The Job Scheduler does not expose public HTTP endpoints directly. All interaction occurs through internal programmatic interfaces consumed by the API Gateway and upstream domain services.

### Scheduling API (Internal Module)

```javascript
// Enqueue a new publishing job
const job = await scheduler.createPostJob({
  userId: ObjectId,
  accountIds: [ObjectId],
  mediaBucketKey: String,       // Reference to mediaStorage
  caption: String,
  hashtags: [String],
  targetPlatforms: ['instagram', 'twitter', 'linkedin'],
  publishAt: Date,              // Timezone-normalized UTC
  retryPolicy: { maxAttempts: 3, backoff: 'exponential' }
});
// Returns: Agenda job document with _id (string)

// Cancel a pending job
await scheduler.cancelJob(jobId);  // Throws if locked/running

// Reschedule an existing job
await scheduler.rescheduleJob(jobId, newPublishAt);
```

### Job Processor Definitions

```javascript
agenda.define('prepare-media', { concurrency: 5 }, async (job) => {
  const { userId, mediaBucketKey, targetPlatforms } = job.attrs.data;
  // Calls contentBuilder.assemblePayload(...)
  // Updates job.data with finalized payload reference
});

agenda.define('publish-post', { 
  concurrency: 10, 
  lockLifetime: 60000,     // 60 seconds
  priority: 10 
}, async (job) => {
  const { accountIds, payloadRef } = job.attrs.data;
  await publisherService.publish(accountIds, payloadRef);
});
```

### Database Interface

- Agenda.js uses the MongoDB Node driver to perform atomic `findAndModify` operations on its jobs collection for distributed locking.
- The scheduler reads the `preferenceService` master records at schedule-creation time but does not own them.

## Data It Owns

All persistent state is stored in the dedicated Agenda MongoDB collection (default: `agendaJobs`). Each document contains:

- **`name`**: Job type identifier (`prepare-media`, `publish-post`).
- **`data`**: Serialized job payload including `userId`, `accountIds`, `mediaBucketKey`, `caption`, `hashtags`, `targetPlatforms`, `retryAttempt`.
- **`type`**: `normal` for one-off posts; `single` for deduplicated unique jobs.
- **`nextRunAt`**: UTC timestamp when the job becomes eligible for execution.
- **`lastRunAt` / `lastFinishedAt`**: Execution boundary timestamps for observability.
- **`failedAt` / `failCount` / `failReason`**: Audit trail for debugging and alerting.
- **`lockedAt` / `lastModifiedBy`**: Distributed lock metadata preventing multi-instance collisions.

The scheduler does **not** own user preference master data, OAuth tokens, or media blobs. It owns only the job execution ledger and transient scheduling metadata.

## Failure Modes

| Failure Scenario | Impact | Mitigation / Runbook Action |
|---|---|---|
| **MongoDB Primary Unavailable** | Agenda cannot acquire or release job locks. New schedules fail. Workers stall. | Health check (`/health/agenda`) must fail. API Gateway should reject new scheduling requests. Automatic reconnect is handled by the MongoDB driver; monitor `mongoDB` replica set lag. |
| **Publisher Service Timeout (> lockLifetime)** | Job lock expires while `publish-post` is mid-flight. A second worker may pick up the same job, risking duplicate posts. | Set `lockLifetime` to the 99th percentile of `publisherService` latency plus 50% buffer (e.g., 60–90s). Ensure `publisherService.publish` is idempotent using client-generated post UUIDs. |
| **OAuth Token Expired / Revoked (4xx)** | `publisherService` returns unrecoverable auth errors. Infinite retry wastes resources and may trigger platform rate-limit bans. | Hard-fail after first 4xx auth error. Set `failCount` threshold to 1 for auth-related errors. Emit an event to `accountService` to mark the linked account as `disconnected` and notify the user. |
| **Midnight Scheduling Burst** | Many users schedule posts for 9:00 AM local time. Queue depth spikes and latency increases. | Enforce per-user maximum pending job caps in `preferenceService`. Add database indexes and scale worker pods horizontally. Use `priority` to guarantee paid-tier jobs are dequeued first. |
| **Clock Skew Across Nodes** | Workers see inconsistent `nextRunAt` evaluations, causing premature or delayed execution. | Run NTP on all scheduler nodes. Store all timestamps in UTC; do not rely on local server time for scheduling math. |
| **Zombie / Orphaned Locks** | A worker container is SIGKILLed while holding a job lock. | Agenda automatically unlocks jobs when `lockLifetime` passes. Alert if any job has `lockedAt` older than `2 * lockLifetime`. |

## Scaling Considerations

- **Horizontal Worker Scaling**: Deploy identical Job Scheduler containers behind the same MongoDB cluster. Agenda’s atomic locking ensures mutual exclusion across nodes. To reduce DB polling overhead, avoid setting `processEvery` below 5 seconds when running more than 10 replicas.
- **Concurrency Segmentation**:
  - `prepare-media`: Cap at `concurrency: 5` per instance to prevent memory exhaustion from concurrent video downloads/transcoding via `contentBuilder`.
  - `publish-post`: Cap at `concurrency: 15` per instance globally, with sub-caps per external platform if rate limits differ (e.g., Instagram Graph API vs. Twitter API v2).
- **Database Index Strategy**: Maintain a compound index on `{ nextRunAt: 1, lockedAt: 1, name: 1, priority: -1 }` in the `agendaJobs` collection. Without it, job polling becomes an unbounded collection scan as queue depth grows.
- **Collection Hygiene**: By default, Agenda retains completed jobs indefinitely. Schedule a recurring internal job (`archive-completed-jobs`) to move successful jobs older than 30 days to a cold archive collection or object storage. This prevents the working set from exceeding MongoDB’s RAM capacity.
- **Graceful Shutdown**: On `SIGTERM`, stop the Agenda worker gracefully (`await agenda.stop({ timeout: 30000 })`) to allow in-flight `publish-post` jobs to complete before container replacement, reducing the zombie-lock window.
- **Observability**: Export queue depth by job name, lock wait duration, and platform-specific failure rates to Prometheus. Page on-call if `publish-post` error rate exceeds 5% over a 10-minute rolling window or if queue depth grows faster than processing rate for 15 minutes.

## Related Diagrams

- `diagrams/string/iter1_overview.mmd` — System architecture context showing Job Scheduler interactions with MongoDB, Publisher Service, API Gateway, and upstream domain services.