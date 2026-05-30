## ADR-002: Scheduler Design

### Status
Accepted

### Context
The social media automation platform must generate, queue, and execute publishing jobs on behalf of thousands of users. Each user defines posting preferences—target platforms, media type, captions, hashtags, publishing times, and timezone-specific windows—that result in one-time or recurring background jobs. The system must guarantee at-least-once execution, support horizontal scaling of workers, and remain operationally simple within the existing Node.js / Express / MongoDB stack.

### Decision
We will use **Agenda.js** backed by the existing **MongoDB** cluster as the job scheduling and orchestration engine. The `scheduler_service` will encapsulate all job lifecycle management, acting as the central coordinator between user preferences, media preparation, and platform publishing.

### Responsibilities
- Translate user posting schedules into durable Agenda job definitions (`prepare-post`, `publish-post`).
- Trigger one-time, cron-based recurring, and ad-hoc publishing jobs according to user timezone and frequency caps.
- Orchestrate the multi-step publishing pipeline: invoke `post_service` to compose content, `media_service` to finalize assets, and `platform_connector` to execute external API calls.
- Enforce job-level idempotency using composite keys (`userId + scheduleId + runDate`) to prevent duplicate posts.
- Track job state transitions (queued, locked, completed, failed) and persist failure reasons for debugging.
- Emit domain events (`job:completed`, `job:failed`) consumed by the `notification_service` for user alerts.
- Reclaim stale locks and prune completed job history to control MongoDB collection growth.

### APIs / Interfaces

#### REST Interface (internal, routed via `api_gateway`)
- `POST /api/v1/scheduler/schedules`  
  Creates a new recurring schedule from user preferences. Returns `scheduleId` and the first projected `nextRunAt`.
- `GET /api/v1/scheduler/schedules/:userId`  
  Lists active schedules with their last run status and next projected run.
- `DELETE /api/v1/scheduler/schedules/:scheduleId`  
  Cancels all future jobs for the schedule and removes the recurring definition.
- `POST /api/v1/scheduler/jobs`  
  Enqueues an immediate or one-time future job. Accepts `postId`, `platforms[]`, and `executeAt`.
- `GET /api/v1/scheduler/jobs/:jobId/status`  
  Returns current state, `lockedAt`, `lastFinishedAt`, and any `failReason`.
- `POST /api/v1/scheduler/jobs/:jobId/retry`  
  Manually requeues a failed job, bypassing automatic backoff.

#### Programmatic Interface (Node.js module)
- `defineJobHandlers()`  
  Registers Agenda job definitions at service startup. Handlers are wrapped in `try/catch` and explicitly acknowledge job completion or failure.
- `enqueueRecurring(scheduleConfig)`  
  Inserts or updates an Agenda unique job keyed by `scheduleId`. Stores user preferences in `job.attrs.data`.
- `enqueueImmediate(postId, platforms[], priority?)`  
  Creates a high-priority `publish-post` job to run as soon as a worker is free.
- `cancelByScheduleId(scheduleId)`  
  Atomically removes all pending jobs matching the schedule key.
- `gracefulShutdown()`  
  Calls `agenda.stop()` on SIGTERM to release locks within the configured drain period.

#### Event Contracts
- Publishes `job:started { jobId, userId, postId, platforms }` to the internal event bus.
- Publishes `job:completed { jobId, userId, platformResults[] }` on success.
- Publishes `job:failed { jobId, userId, error, willRetry }` on terminal or retriable failure.

### Data Ownership
The `scheduler_service` owns and exclusively writes to the following MongoDB collections:

- **`agendaJobs`** (Agenda default collection)  
  Stores job documents with fields: `name`, `data` (embedded `userId`, `postId`, `scheduleId`, `platforms`), `type` (normal/single), `priority`, `nextRunAt`, `lastRunAt`, `lastFinishedAt`, `failedAt`, `failCount`, `failReason`, `lockedAt`, `lastModifiedBy` (worker instance id). No other service may write to this collection.

- **`scheduler.schedules`**  
  Denormalized user schedule configurations used to regenerate or audit recurring jobs. Schema includes `userId`, `cronExpression`, `timezone`, `platformTargets[]`, `mediaType`, `frequencyCap`, `isActive`, and `lastJobId`.

- **`scheduler.job_logs`**  
  Immutable audit trail of executed jobs. Contains `jobId`, `scheduleId`, `startedAt`, `completedAt`, `durationMs`, `platformResponses`, and `errorSnapshot`. Written only after job terminal state is reached.

### Failure Modes
- **Stuck Locks (Zombie Jobs)**  
  If a worker process crashes while a job is locked (`lockedAt` set, process dies), Agenda will not requeue the job until `lockLifetime` expires (default 10 minutes). During this window the job is invisible to other workers.  
  *Mitigation*: Set `lockLifetime` to 5 minutes (shorter than max expected job duration) and ensure all job handlers are idempotent. On startup, workers call `agenda.purge()` to clear locks held by defunct process IDs.

- **Duplicate Execution**  
  Without unique constraints, concurrent API calls to create a schedule could spawn duplicate recurring jobs, resulting in double-posting to social platforms.  
  *Mitigation*: Use Agenda’s `unique({ 'data.scheduleId': 1 })` option on every recurring job insertion. The application layer validates `scheduleId` UUID uniqueness before calling Agenda.

- **Missed Beats During MongoDB Failover**  
  If the MongoDB primary steps down, Agenda’s `processEvery` polling loop may skip evaluation cycles, causing jobs to fire late.  
  *Mitigation*: Set `processEvery` to 30 seconds and enable Agenda’s `sort` on `nextRunAt` with a 5-minute look-ahead buffer. Monitor `lastRunAt` drift with alerts.

- **Cascading Backpressure**  
  A popular posting window (e.g., 09:00 local time across many users) can enqueue thousands of jobs simultaneously, overwhelming the `platform_connector` and triggering rate limits or bans.  
  *Mitigation*: Cap Agenda `maxConcurrency` per worker instance to 20. The `platform_connector` consults the `rate_limiter` before each external API call; if throttled, the job fails with a retriable error and Agenda’s exponential backoff (initial delay 1 min, max 1 hour) spreads the load.

- **Timezone Drift**  
  Cron expressions stored in UTC but interpreted relative to user timezones can misfire during daylight-saving transitions.  
  *Mitigation*: Store `timezone` (IANA string, e.g., `America/New_York`) in `scheduleConfig`. The handler converts `nextRunAt` to the user’s local time before deciding whether to skip or execute, and logs any ambiguous hour conflicts.

### Scaling Considerations
- **Horizontal Worker Scaling**  
  Agenda uses MongoDB document-level locking (`lockedAt`, `lockedBy`) to coordinate across multiple Node.js processes. The `scheduler_service` can be deployed as a dedicated worker fleet (e.g., 3–10 pods) separate from the API-serving instances. All workers connect to the same `agendaJobs` collection and compete for jobs via atomic find-and-modify operations.

- **Collection Growth & TTL**  
  Completed Agenda jobs accumulate indefinitely by default. To prevent unbounded growth, create a MongoDB TTL index on `lastFinishedAt` in `agendaJobs` with a 30-day retention. The `scheduler.job_logs` collection uses a 90-day TTL for audit compliance.

- **Shard Key Strategy**  
  Once `agendaJobs` exceeds 10 million documents, shard the collection by `name` (job type) or `data.userId` to distribute lock contention and query load. Avoid monotonically increasing shard keys like `_id` or `nextRunAt` to prevent hot spotting.

- **Resource Isolation**  
  Heavy CPU work (video transcoding) must not occur inside Agenda job handlers. The `scheduler_service` delegates such work asynchronously to `media_service` via internal HTTP calls and yields the event loop. Job handlers should only orchestrate I/O-bound coordination.

- **Graceful Shutdown**  
  On SIGTERM, the worker stops accepting new jobs, waits up to `drainTimeMs` (configured to 30 seconds) for in-flight jobs to complete, then exits. Kubernetes pre-stop hooks or Docker `stop_grace_period` must align with this window to prevent forced kills mid-publish.

- **Observability**  
  Expose Prometheus metrics for `agenda_jobs_pending`, `agenda_jobs_locked`, `agenda_jobs_failed_total`, and `agenda_job_duration_seconds`. Use these metrics to drive Horizontal Pod Autoscaler (HPA) targets for the worker fleet.

### Consequences
- **Positive**: Keeps infrastructure footprint minimal by reusing the existing MongoDB cluster. Agenda’s cron syntax directly supports user-defined posting frequencies. Document-level locking provides a simple, stateless worker model without requiring Redis or RabbitMQ.
- **Negative**: Agenda.js is tightly coupled to MongoDB; a future database migration would require replacing the scheduler. Throughput is bounded by MongoDB’s write latency and lock contention, making it less suitable than Redis-backed alternatives (e.g., BullMQ) for ultra-high-frequency job volumes (>1,000 jobs/second).
- **Trade-off Accepted**: We accept the throughput ceiling because the domain is inherently rate-limited by external social media APIs. The operational simplicity of a single persistence layer outweighs the marginal gains of a separate queue store.

### Related Diagrams
- `diagrams/0320/iter1_overview.mmd` — System overview illustrating the `scheduler_service` and its relations to MongoDB, `post_service`, `media_service`, and `platform_connector`.