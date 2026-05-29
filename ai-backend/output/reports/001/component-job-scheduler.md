## Job Scheduler

The Job Scheduler is an internal service built on Agenda.js that durably creates, queues, and monitors all background jobs for media preparation and automated social-media publishing. It translates user posting preferences into scheduled job definitions, persists them in MongoDB, and coordinates execution handoff to the Media Processor and Platform Publisher.

### Responsibilities

- **Job Definition and Queuing**: Convert user posting preferences (frequency, platforms, media type, captions, hashtags, and publishing times) into Agenda.js job documents. Enqueue two primary job types:
  - `media-preparation`: Requests the Media Processor to resize, format, and optimize media.
  - `content-publishing`: Requests the Platform Publisher to post optimized content via platform APIs.
- **Schedule Translation**: Map human-readable preferences (e.g., "every weekday at 9:00 AM EST") into concrete `nextRunAt` timestamps and recurrence rules using Agenda’s cron and repeat interval support.
- **Lifecycle Monitoring**: Track job states (`scheduled`, `queued`, `running`, `completed`, `failed`). Expose status queries to the API Gateway so users can inspect upcoming posts and historical execution results.
- **Inter-Service Coordination**: Orchestrate the dependency chain between job types. A `content-publishing` job must not execute until its corresponding `media-preparation` job succeeds and produces a CDN URL.
- **Retry and Backoff Management**: Apply platform-aware retry policies. Rate-limit failures from social-media APIs trigger long backoff intervals (e.g., 15 minutes), while transient media processing errors use short exponential backoff (e.g., 2^N minutes).
- **Dead-Letter Handling**: After exhausting retries, move failed jobs to a dead-letter state and alert the Notification Service to prompt user intervention.

### APIs and Interfaces

#### Internal Service Interface (Consumed by API Gateway)

The Job Scheduler exposes a Node.js module interface consumed by the API Gateway. All methods return Promises and accept a `userId` for tenant isolation.

- `createSchedule(userId: string, preferences: PostingPreferences): Promise<JobId>`
  - Validates preferences, generates an Agenda job, and persists it to MongoDB.
  - If the preference includes media, atomically creates a `media-preparation` job followed by a chained `content-publishing` job.
- `cancelSchedule(jobId: string, userId: string): Promise<void>`
  - Locates the job by `_id` and `userId` in the Agenda collection and removes it.
- `getJobStatus(jobId: string, userId: string): Promise<JobStatus>`
  - Returns the current state, `nextRunAt`, `lastFinishedAt`, `failCount`, and `failReason`.
- `listUserJobs(userId: string, filter: { state?: string, from?: Date, to?: Date }): Promise<JobSummary[]>`
  - Queries jobs where `data.userId` matches and returns paginated summaries.
- `updateSchedule(jobId: string, userId: string, preferences: Partial<PostingPreferences>): Promise<void>`
  - Re-computes recurrence and updates the job document in Agenda’s MongoDB collection.

#### Job Processor Definitions

Internally registered Agenda job processors that execute on worker instances:

- **`media-preparation`**
  - **Payload**:
    ```json
    {
      "userId": "u_123",
      "mediaStorageKey": "raw/u_123/campaign_456/video.mp4",
      "targetPlatforms": ["instagram", "twitter"],
      "processingProfile": { "maxWidth": 1920, "maxDuration": 60 }
    }
    ```
  - **Behavior**: Calls the Media Processor. On success, stores the resulting `processedCdnUrl` back into the job’s `data` and schedules the linked `content-publishing` job. On failure, throws to trigger Agenda retry logic.
- **`content-publishing`**
  - **Payload**:
    ```json
    {
      "userId": "u_123",
      "processedCdnUrl": "https://cdn.example.com/opt/u_123/campaign_456/video.mp4",
      "caption": "Launch day!",
      "hashtags": ["#saas", "#launch"],
      "platformTargets": ["instagram"],
      "tokenRefs": ["token_instagram_u_123"]
    }
    ```
  - **Behavior**: Calls the Platform Publisher. If publishing succeeds, emits a completion event to the Notification Service and records the post ID. If the Platform Publisher returns an OAuth error, transitions the job to a dead-letter state instead of retrying indefinitely.

#### Event Emissions

- On `job:completed`: Notifies the Notification Service to send a publishing confirmation.
- On `job:failed` (final attempt): Notifies the Notification Service to send a failure alert with the `failReason`.
- On `job:dead-letter`: Triggers a high-priority user alert indicating re-authentication or manual review is required.

#### Database Interface

- Uses Agenda’s MongoDB driver to read and write to the `agendaJobs` collection.
- Also writes an immutable `job_audit_log` collection for long-term retention of execution history, since Agenda may prune or overwrite job state.

### Data Ownership

The Job Scheduler owns and manages the following data:

- **`agendaJobs` collection** (Agenda.js-managed): The active job queue containing fields such as `name`, `data`, `type`, `priority`, `nextRunAt`, `lastModifiedBy`, `lockedAt`, `lastFinishedAt`, `failCount`, and `failReason`.
- **`job_audit_log` collection**: Immutable records of every job execution attempt, including start time, end time, worker instance ID, downstream service latency, and final status. Retained for 90 days.
- **Schedule recurrence rules**: The computed Agenda repeat intervals and next-run projections derived from user preferences. The raw user preferences remain in the User Service; the Scheduler owns the materialized schedule artifacts.
- **Job-to-user mappings**: Indexed `data.userId` values within job documents to enforce tenant-scoped queries and cancellations.

### Failure Modes

- **Stalled Jobs Due to Worker Crash**: If a Node.js worker process dies while a job is running, the `lockedAt` field remains set. Agenda will not re-process the job until `lockLifetime` (configured to 10 minutes) expires. Mitigation: process health checks, short `lockLifetime`, and job idempotency.
- **Duplicate Execution**: Agenda provides at-least-once execution semantics under failure. Both the Media Processor and Platform Publisher must treat `jobId` as an idempotency key to prevent duplicate uploads or duplicate posts.
- **MongoDB Replica Set Failover**: If the primary MongoDB node steps down, Agenda cannot acquire locks or persist new schedules. The service pauses processing; in-flight jobs may stall until a new primary is elected. The API Gateway should surface a 503 error for new scheduling requests during failover.
- **Downstream Media Processing Failure**: If the Media Processor throws (e.g., unsupported codec), Agenda increments `failCount`. After 5 retries with exponential backoff, the job is moved to the dead-letter state and the user is notified.
- **Downstream Publishing Failure**: If the Platform Publisher returns a 429 (rate limit), the job retries with a 15-minute fixed backoff. If it returns a 401 (invalid OAuth token), the job is immediately dead-lettered and the user is prompted to reconnect the account.
- **Notification Service Unavailability**: Job completion and failure alerts are emitted fire-and-forget. The scheduler must not block on the Notification Service to mark a job complete.
- **Clock Skew**: Multiple scheduler instances with unsynchronized system clocks can cause premature or delayed job execution. All instances must sync via NTP, and `nextRunAt` must be stored and evaluated in UTC.

### Scaling Considerations

- **Horizontal Instance Scaling**: The Job Scheduler runs as a pool of identical Node.js processes. Agenda uses MongoDB document-level locking (`lockedAt`, `lockLifetime`) to ensure only one instance processes a given job. Instances can be scaled behind a load balancer without additional coordination.
- **Concurrency Tuning**: Each instance is configured with Agenda `defaultConcurrency(5)` and `maxConcurrency(20)` to prevent overwhelming downstream services. `media-preparation` jobs are CPU-light (I/O wait on Media Processor) and can run at higher concurrency; `content-publishing` jobs are API-call-heavy and are throttled to 5 concurrent per instance.
- **Database Indexing**: Maintain compound indexes on `agendaJobs` for:
  - `{ nextRunAt: 1, lockedAt: 1 }` — for job picking efficiency.
  - `{ "data.userId": 1, name: 1, nextRunAt: -1 }` — for user job listing queries.
  - `{ lockedAt: 1 }` — for stale lock detection.
- **Worker Role Separation**: In high-load deployments, split the deployment into:
  - **Scheduler API Nodes**: Handle `createSchedule`, `cancelSchedule`, and queries but do not process jobs (`processEvery` disabled).
  - **Worker Nodes**: Dedicated processes that only run Agenda job processors. This prevents heavy publishing workloads from impacting API latency.
- **Queue Depth Monitoring**: Alert when the count of jobs with `nextRunAt < now - 5 minutes` grows, indicating worker starvation or downstream slowdown.
- **Payload Size Limits**: Job documents store only metadata and CDN references. Original media binaries are never embedded in job payloads, keeping MongoDB document size low and index performance stable.

## Related Diagrams

- `diagrams/001/iter1_component-job-scheduler.mmd`