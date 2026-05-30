# Scheduler Service

## Responsibilities

The Scheduler Service is the system's background job orchestrator, built on **Agenda.js** and Node.js. Its core responsibilities include:

- **Job Definition & Creation**: Translating user posting preferences (platform targets, frequency, publishing time windows, media type, captions, hashtags) into concrete, persisted Agenda job documents.
- **Schedule Enforcement**: Computing `nextRunAt` based on user timezone, allowed posting windows, and recurrence rules (e.g., "3 times per week between 9 AM – 5 PM EST").
- **Cross-Service Workflow Coordination**: Executing multi-stage publishing pipelines by invoking downstream services in sequence:
  1. **Post Service** to compose final captions, hashtags, and metadata.
  2. **Media Service** to validate, optimize, and retrieve platform-specific media URLs.
  3. **Platform Connector** to deliver the payload to external social APIs.
- **Lifecycle Management**: Monitoring job states (queued, locked, running, completed, failed), handling retries with exponential backoff, canceling obsolete jobs when users update preferences, and archiving stale records.
- **Idempotency & Deduplication**: Ensuring that a single logical post is never published twice, even in the presence of worker restarts or network partitions.
- **Operational Visibility**: Emitting structured execution logs and metrics for queue depth, job latency, and failure rates.

## APIs / Interfaces

### REST API (via API Gateway)
The service exposes management endpoints consumed by the web/mobile client through the API Gateway:

- `POST /v1/schedules`  
  Creates a new recurring or one-time publishing schedule. Accepts `userId`, `platforms`, `frequency`, `timeWindow`, `timezone`, `mediaType`, and `contentTemplate`. Returns `scheduleId`.

- `GET /v1/schedules/:scheduleId`  
  Retrieves the schedule configuration, next expected run times, and linked job IDs.

- `PATCH /v1/schedules/:scheduleId`  
  Updates schedule parameters. Triggers cancellation of pending future jobs and re-creation with new parameters.

- `DELETE /v1/schedules/:scheduleId`  
  Cancels all pending jobs for the schedule and marks it disabled.

- `POST /v1/schedules/:scheduleId/trigger`  
  Enqueues an immediate, out-of-band execution of the schedule.

- `GET /v1/jobs/:jobId/status`  
  Returns the current state of a specific Agenda job (`pending`, `running`, `completed`, `failed`) along with `startedAt`, `finishedAt`, and `errorMessage`.

### Internal Service Clients
During job execution, the Scheduler Service acts as a client to downstream services:

- **Post Service Client**
  - `composePost({ userId, scheduleId, captionTemplate, hashtags }) → { postId, composedContent }`

- **Media Service Client**
  - `prepareMedia({ mediaIds, targetPlatforms, optimizationProfile }) → { mediaUrls, metadata }`

- **Platform Connector Client**
  - `publish({ postId, platform, content, mediaUrls, oauthTokenRef }) → { platformPostId, publishedAt }`

### Database Interface
- **MongoDB (Agenda Store)**: Direct read/write to the `agendaJobs` collection for job persistence, locking, and state transitions.
- **MongoDB (Application Store)**: Read/write to custom `job_logs` and `schedule_snapshots` collections for audit trails and fast status lookups.

## Data It Owns

The Scheduler Service is the authoritative owner for job execution state and scheduling artifacts. It does **not** own canonical user preferences (owned by User Service) or media blobs (owned by Media Service / Object Storage).

- **`agendaJobs` Collection** (Agenda.js managed)  
  Documents represent individual or recurring job instances:
  - `name`: Job type enum (`prepare-and-publish`, `publish-only`, `retry-failed`).
  - `data`: Execution payload including `userId`, `scheduleId`, `postId`, `mediaIds[]`, `targetPlatforms[]`, `tokenVaultRef`, `retryCount`.
  - `nextRunAt`, `lastRunAt`, `lastFinishedAt`, `failedAt`, `lockedAt`: Scheduling and locking timestamps.
  - `repeatInterval`, `repeatTimezone`: Recurrence configuration.
  - `disabled`: Boolean flag for soft-deletion.

- **`job_logs` Collection** (Application managed)  
  Immutable audit records for every execution attempt:
  - `jobId`, `scheduleId`, `userId`, `status`, `stage` (`compose`, `media`, `publish`).
  - `startedAt`, `completedAt`, `durationMs`.
  - `errorCode`, `errorMessage`, `stackTrace` (on failure).
  - `platformResults[]`: Array of `{ platform, success, platformPostId, error }`.

- **`schedule_snapshots` Collection**  
  Denormalized, point-in-time cache of user posting settings copied at job creation time to ensure execution consistency even if the user updates preferences after a job is queued:
  - `scheduleId`, `capturedAt`, `frequency`, `timeWindow`, `platforms`, `contentTemplate`.

## Failure Modes

| Failure | Impact | Mitigation |
|---|---|---|
| **Agenda Worker Crash** | In-memory job context is lost; locked jobs may stall until `lockLifetime` expires. | Run stateless worker replicas behind a process manager. Agenda's MongoDB locking allows another worker to reclaim the job after lock timeout. |
| **Job Lock Timeout** | Long-running media preparation or slow platform APIs cause the lock to expire, triggering duplicate execution by another worker. | Configure `lockLifetime` per job type (e.g., 5 minutes for publish, 10 minutes for media prep). Workers send lock refresh heartbeats during long operations. |
| **Downstream Service Outage** | Post Service, Media Service, or Platform Connector returns 5xx or times out. | Implement stage-level retries with exponential backoff (max 3 attempts). After exhaustion, move job to a dead-letter state and alert via Notification Service. |
| **Duplicate Publishing** | Network partition or lock timeout causes two workers to execute the same publish step. | Enforce idempotency keys at Platform Connector (`idempotencyKey` derived from `jobId` + `platform`). Scheduler passes a deterministic UUID for each logical publish attempt. |
| **Invalid Schedule Configuration** | User defines an impossible schedule (e.g., every minute) or overlapping time windows. | Strict validation at creation time: minimum 15-minute intervals, max 100 pending jobs per user, deduplication of time windows. |
| **MongoDB Connection Loss** | Agenda cannot acquire, update, or release jobs; scheduling halts. | Use MongoDB connection pooling with `autoReconnect`. If connection is lost for >30s, exit the process so the container orchestrator replaces the unhealthy worker. |
| **Clock Skew Across Workers** | Desynchronized system clocks cause jobs to run early/late or locking anomalies. | Mandate NTP synchronization on all worker nodes. Rely on MongoDB server-side `$$NOW` for `nextRunAt` comparisons where possible. |
| **Queue Backlog from Rate Limiting** | Platform Connector or Rate Limiter rejects publishes due to external API quotas. | Scheduler implements back-pressure: pause enqueueing new publish jobs for a platform when rate-limit headers indicate exhaustion. Surface queue depth alerts. |

## Scaling Considerations

- **Horizontal Worker Scaling**: Deploy Scheduler Service workers as a separate replica set from the Express API servers. All workers connect to the same MongoDB job store. Agenda's atomic locking ensures jobs are processed by only one worker at a time.
- **Job-Type Segregation**: Use distinct Agenda instances or named job queues to isolate resource demands:
  - **Media-preparation workers**: CPU/bandwidth intensive; limited concurrency (e.g., 2 concurrent jobs per worker).
  - **Publish workers**: I/O bound waiting on external APIs; higher concurrency (e.g., 20 concurrent jobs per worker).
- **Database Indexing**: Ensure compound indexes on `agendaJobs` for `{ nextRunAt: 1, name: 1, disabled: 1 }` and `{ lockedAt: 1 }`. Without these, job scanning becomes a bottleneck beyond ~100k jobs.
- **Archival Strategy**: Completed Agenda jobs accumulate indefinitely. Implement a nightly cron that moves jobs older than 30 days from `agendaJobs` to a cold-storage `agendaJobs_archive` collection or S3 parquet files.
- **Memory Management**: Long-running Agenda worker processes in Node.js can suffer from event-loop lag or memory fragmentation under high churn. Enforce a **max job count per process** (e.g., restart after 1,000 processed jobs) or use a liveness probe based on event-loop delay.
- **Back-Pressure & Flow Control**: Monitor downstream latency. If Platform Connector average response time exceeds a threshold, dynamically reduce `processEvery` interval or job concurrency to prevent overwhelming the external APIs and the Rate Limiter.
- **Multi-Tenant Isolation**: Prevent a single high-volume user from monopolizing workers. Implement per-user job concurrency caps (e.g., max 5 simultaneous jobs per user) using Agenda job data filters.

## Related Diagrams

No paired diagram was provided for this document.