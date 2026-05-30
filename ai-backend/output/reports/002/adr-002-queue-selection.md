# ADR-002: Queue and Job Scheduling Selection

## Status
Accepted

## Context
The social media automation platform must reliably schedule and execute background workflows for:
- **Media preparation**: Optimizing photos and videos for platform-specific requirements (e.g., Instagram reels vs. LinkedIn feed).
- **Content assembly**: Generating captions, hashtags, and template rendering.
- **Timed publishing**: Executing API calls to external social platforms at user-configured publishing times, which may be scheduled minutes or months in advance.
- **Retry handling**: Recovering from transient platform rate limits, expired OAuth tokens, or network failures without data loss.

The existing operational stack is Node.js, Express, and MongoDB. Redis is deployed exclusively for session caching and real-time status. The team requires a queue solution that minimizes infrastructure sprawl, integrates natively with Node.js, and persists job state durably alongside application data.

## Decision
We will use **Agenda.js** backed by **MongoDB** as the primary job queue, scheduler, and execution engine. `Job_Service` will host Agenda worker processes that define job processors, manage scheduling, and orchestrate calls to `Content_Service`, `Media_Service`, and `Publish_Service`.

## Responsibilities
- **Schedule persistence**: Store one-off and recurring jobs (e.g., "every Tuesday at 9:00 AM") with timezone-aware `nextRunAt` timestamps in MongoDB.
- **Execution orchestration**: Trigger publish workflows at the correct time by invoking downstream services.
- **Distributed locking**: Prevent duplicate execution when multiple `Job_Service` instances are horizontally scaled.
- **Lifecycle tracking**: Maintain job states (scheduled, locked, completed, failed) for observability and user-facing status dashboards.
- **Cancellation support**: Allow users to delete or modify upcoming posts, which must atomically remove or reschedule the associated Agenda job.

## Interfaces

### Programmatic API (`Job_Service` → `Agenda_Queue`)
- **`agenda.define(jobName, options, processor)`**: Registers a processor function for named job types such as `prepare-media`, `assemble-post`, and `publish-to-platform`.
- **`agenda.schedule(when, jobName, data)`**: Creates a one-off scheduled job from user-defined publishing preferences.
- **`agenda.every(interval, jobName, data, options)`**: Creates recurring jobs based on user frequency settings (e.g., `0 9 * * 1`).
- **`agenda.cancel(query)`**: Removes jobs when users delete scheduled content.
- **`agenda.now(jobName, data)`**: Enqueues immediate execution for "Post Now" actions.

### Data Interface (MongoDB Collection)
- **Collection**: `agendaJobs`
- **Access pattern**: `Job_Service` queries directly against this collection to power admin dashboards and user-facing job status APIs, using compound indexes on `{ nextRunAt: 1, name: 1, lockedAt: 1 }` and `{ 'data.userId': 1, name: 1 }`.

### Event Interface
- On completion or failure, job processors emit status events consumed by `Notification_Service` (email/alert triggers) and `WebSocket_Gateway` (real-time client updates).

## Data Ownership
- **`Agenda_Queue`** owns the schema and documents within the `agendaJobs` MongoDB collection. Each document contains:
  - Scheduling metadata: `name`, `type`, `priority`, `nextRunAt`, `lastRunAt`, `lastFinishedAt`, `repeatInterval`, `repeatTimezone`.
  - Concurrency control: `lockedAt`, `lastModifiedBy` (process ID).
  - Execution payload: `data` object containing `userId`, `postId`, `platform` (e.g., `instagram`, `tiktok`), `mediaAssetIds`, and `scheduledAt`.
  - Failure audit: `failCount`, `failReason`, `failedAt`.
- **`Job_Service`** owns the processor function implementations and the business logic mapping job execution to downstream service calls.

## Consequences

### Positive
- **Operational cohesion**: Job state persists in the same MongoDB cluster as users, posts, and preferences. Backup, restore, and disaster recovery processes remain unified.
- **Node.js native**: Agenda.js is purpose-built for the runtime, avoiding language bridging or binary dependencies.
- **Scheduling expressiveness**: Built-in support for cron expressions, intervals, and one-off dates covers all user posting-frequency requirements without external schedulers like `node-cron`.
- **Disk-backed durability**: Unlike memory-first queues, jobs scheduled far in the future survive restarts without snapshot tuning.

### Negative / Trade-offs
- **Throughput ceiling**: Agenda relies on MongoDB `findAndModify` polling (`processEvery`). Peak throughput is lower than Redis-backed alternatives. For a social automation platform where individual users schedule at human-scale frequencies, this is acceptable.
- **No built-in UI**: Unlike Bull/BullMQ, Agenda lacks a mature official dashboard. `Job_Service` must expose custom REST endpoints and admin screens for job inspection.
- **Database coupling**: Heavy job churn in `agendaJobs` can increase write load on the primary MongoDB node, potentially impacting query latency for user-facing operations if collections are not isolated by workload.

## Alternatives Considered

### Bull / BullMQ (Redis)
- **Rejected**: Although Redis is deployed for caching and WebSocket state, using it as a durable job store introduces conflicting operational concerns. Redis is configured with eviction policies optimized for session cache performance, not for guaranteed job durability over months-long scheduling horizons. Moving large video processing workloads through Redis would also strain memory resources and require costly vertical scaling or complex persistence tuning (AOF/RDB).

### RabbitMQ
- **Rejected**: Adds Erlang-based infrastructure outside the team's core expertise. The platform does not require complex routing topologies or multiple consumer patterns; simple delayed execution is sufficient.

### AWS SQS + EventBridge
- **Rejected**: Introduces vendor lock-in and latency variability (visibility timeout model) poorly suited for long-running media optimization jobs. EventBridge scheduling adds cost and cross-service operational complexity.

### Apache Kafka
- **Rejected**: Overkill for moderate-throughput, time-based scheduling. Kafka excels at high-throughput stream processing, not at efficiently scheduling millions of individual future-dated tasks with second-level granularity.

## Scaling Considerations
- **Horizontal workers**: Multiple `Job_Service` processes can safely share the same Agenda instance. MongoDB document-level locks (`lockedAt` with `lockLifetime`) ensure only one worker processes a job at a time. Scale by adding stateless `Job_Service` replicas behind a load balancer.
- **Concurrency tuning**: Configure per-job-type concurrency limits in Agenda (e.g., `concurrency: 5` for `publish-to-platform`) to respect external Platform API rate limits and prevent thundering herds during peak publishing windows (e.g., 9:00 AM in popular timezones).
- **Index strategy**: Maintain compound indexes on `{ nextRunAt: 1, name: 1, lockedAt: 1 }` and `{ 'data.userId': 1, name: 1, status: 1 }` to keep polling queries sub-millisecond as the job collection grows.
- **Archival**: Completed jobs must be periodically purged or moved to a cold archive collection. Without this, the `agendaJobs` collection grows unbounded, degrading polling performance.

## Failure Modes
- **MongoDB primary failover**: During a replica set election, Agenda's polling and locking pause. Jobs remain safe on disk, but publishing may be delayed by seconds to tens of seconds. Mitigation: configure `processEvery` to 30 seconds (tolerable for social media scheduling) and ensure `lockLifetime` exceeds expected failover duration plus maximum job runtime.
- **Long-running media jobs exceeding lock lifetime**: If `Media_Service` takes longer than Agenda's `defaultLockLifetime` to optimize a large video, the lock expires and a second worker may pick up the job, risking duplicate processing. Mitigation: set `lockLifetime` to 10 minutes for media jobs, and ensure processor functions heartbeat the lock for longer tasks.
- **Duplicate publishing**: If a lock is released after a partial publish to Instagram, a retry could create a duplicate post. Mitigation: `Publish_Service` must pass platform-specific idempotency keys where supported (e.g., LinkedIn `x-restli-id`) and store `publishAttemptId` in the job `data`.
- **Poison messages**: A malformed job payload (e.g., an unsupported `platform` enum) will fail repeatedly. Mitigation: implement a `failCount` threshold (e.g., 3 attempts). After threshold, move the job to a dead-letter sub-collection and alert via `Notification_Service`.
- **Clock skew**: If `Job_Service` nodes have divergent system clocks, `nextRunAt` evaluation becomes inconsistent. Mitigation: enforce NTP synchronization on all worker nodes and rely on MongoDB server time for lock queries where possible.

## Related Diagrams
- `diagrams/002/iter1_overview.mmd`