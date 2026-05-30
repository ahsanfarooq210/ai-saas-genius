## Agenda Worker

The Agenda Worker is a dedicated Node.js background process that consumes and executes scheduled publishing jobs managed by Agenda.js. It serves as the execution engine for the `scheduler_service`, transforming queued job definitions into actual platform publish operations by orchestrating the `publisher_service` and reporting outcomes to the `notification_service`.

### Responsibilities

- **Job Execution**: Register and run Agenda.js job handlers for publishing tasks created by the `scheduler_service`, including the primary `publish-post` job type.
- **Distributed Lock Management**: Rely on Agenda.js MongoDB-backed locking to ensure that a scheduled publish job is executed by exactly one worker instance in a replicated deployment.
- **Payload Hand-off**: Extract job data (post draft IDs, media asset references, target platforms, captions, hashtags) and pass structured requests to the `publisher_service`.
- **Lifecycle State Management**: Transition jobs through Agenda states—lock, process, complete, fail, and reschedule—by updating the job document in MongoDB.
- **Retry Orchestration**: Honor Agenda retry configurations with exponential backoff for transient failures such as network blips or temporary platform API outages.
- **Failure Notification**: Upon terminal failure (retry exhaustion) or partial platform failure, invoke the `notification_service` to trigger user email/push alerts.
- **Graceful Shutdown**: On `SIGTERM`/`SIGINT`, stop accepting new jobs from Agenda, allow in-flight publish operations to finish, and cleanly close the MongoDB connection to prevent stalled locks.
- **Concurrency Enforcement**: Limit parallel job execution per handler to respect downstream social platform rate limits and prevent Node.js event-loop saturation.

### APIs and Interfaces

#### Job Definition API
The worker registers strongly-typed handlers via `agenda.define(name, options, handler)`:

- `publish-post`: Executes the full publish pipeline for a user’s scheduled content.
- `cleanup-completed-jobs`: Prunes Agenda job documents older than the retention window to prevent unbounded MongoDB growth.

Example registration:
```javascript
agenda.define('publish-post', { concurrency: 5, lockLifetime: 300000 }, async (job) => {
  const { userId, postDraftId, targetPlatforms, mediaAssetIds } = job.attrs.data;
  await publisherService.execute({ userId, postDraftId, targetPlatforms, mediaAssetIds });
});
```

#### Job Data Contract
`job.attrs.data` is populated by the `scheduler_service` and expected to contain:
```json
{
  "userId": "ObjectId",
  "postDraftId": "ObjectId",
  "mediaAssetIds": ["ObjectId"],
  "targetPlatforms": ["instagram", "twitter", "facebook", "tiktok", "linkedin"],
  "caption": "string",
  "hashtags": ["string"],
  "scheduledAt": "ISO8601"
}
```

#### External Service Interfaces
- **Publisher Service**: Internal async invocation (e.g., internal HTTP/gRPC/module call) to `publisher_service.executePublish(payload)`. The worker awaits the result to determine job success or failure.
- **Notification Service**: Structured call to `notification_service.notify(userId, eventType, metadata)` where `eventType` is `publish_success`, `publish_failed`, or `publish_partial`.

#### Control Interface
- `await agenda.start()` — Begin polling MongoDB for jobs ready to run.
- `await agenda.stop()` — Stop polling; finish in-flight jobs.
- `await agenda.close()` — Release MongoDB connections.

### Data Ownership

The Agenda Worker is intentionally stateless and does not own core business entities.

- **Agenda Job Documents**: Reads and writes to Agenda’s MongoDB collection (default `agendaJobs`), including fields such as `name`, `data`, `priority`, `nextRunAt`, `lockedAt`, `lastFinishedAt`, `failCount`, and `failReason`.
- **Transient Execution Context**: In-memory tracking of currently locked job IDs and their handler start timestamps for operational observability only; lost on restart.
- **Execution Logs**: Structured logs (job ID, duration, platform results) are shipped to a centralized logging system; not retained on local disk.
- **No Ownership Of**: User profiles, OAuth tokens, post drafts, media blobs, or platform connection states. These remain in `mongodb` under their respective domain collections.

### Failure Modes

- **Process Crash Mid-Job**: If the worker exits after locking a job but before completion, the job document remains locked in MongoDB until `lockLifetime` expires (default 10 minutes, configurable per handler). During this window the job is stalled. Mitigation: set `lockLifetime` aggressively (e.g., 2–5 minutes) for lightweight text posts, and ensure the `publisher_service` uses idempotent platform API calls.
- **Publisher Service Timeout**: Slow platform uploads (e.g., TikTok or large Instagram videos) may exceed the lock lifetime, causing a second worker to acquire the same job. Mitigation: set extended `lockLifetime` for media-heavy jobs, or split the workflow into `prepare-publish` and `confirm-publish` job stages.
- **Retry Exhaustion**: Once `failCount` exceeds the configured maximum, Agenda marks the job as failed permanently. The post will not publish unless manually rescheduled. The worker must trigger a terminal failure alert to the `notification_service` so the user can intervene.
- **MongoDB Primary Failover**: Agenda requires a MongoDB replica set. If the primary steps down, the worker loses its ability to lock or complete jobs. The process should exit and rely on the orchestrator (Kubernetes/PM2) to restart and reconnect.
- **Poison Payloads**: Corrupted `job.attrs.data` (e.g., missing `postDraftId` or invalid `targetPlatforms` enum) causes repeated handler exceptions. Mitigation: validate payload schema at the top of every handler; throw non-retryable fatal errors for schema violations to bypass Agenda retries and alert immediately.
- **Rate Limit Backpressure**: High concurrency can trigger platform API rate limits (e.g., Instagram Graph API). Mitigation: throttle via Agenda’s `concurrency` option and consider per-user job queues to serialize posts for a single social account.

### Scaling Considerations

- **Horizontal Replication**: Deploy as stateless replicas (e.g., Kubernetes Deployment or PM2 cluster). Agenda’s MongoDB-based distributed lock naturally prevents duplicate execution across replicas; all replicas share the same job collection.
- **Queue Segregation**: For high volume, run isolated Agenda Worker fleets by job type (e.g., one deployment for `publish-post`, another for `generate-analytics`) with independent MongoDB connections, concurrency settings, and resource limits.
- **Polling Interval Tuning**: Agenda’s `processEvery` (default 5 seconds) controls how frequently MongoDB is polled for runnable jobs. Lower values reduce publish latency but increase database load. For high-throughput scenarios, tune to 1–2 seconds and monitor MongoDB CPU.
- **Database Indexing**: Ensure compound indexes on `{ nextRunAt: 1, lockedAt: 1, name: 1, disabled: 1 }` and `{ lockedAt: 1 }` in the Agenda job collection to prevent lock contention and slow queries at scale.
- **Memory Constraints**: The worker must remain I/O-bound. It should never load photo or video file buffers into memory. Pass CDN URLs or object storage references to the `publisher_service` and stream responses where possible.
- **Observability**: Expose metrics such as `agenda_jobs_completed_total`, `agenda_jobs_failed_total`, `agenda_job_duration_seconds`, and `agenda_active_jobs` to drive autoscaling policies and SLO alerting.

## Related Diagrams

No paired Mermaid diagram was provided for this component document.