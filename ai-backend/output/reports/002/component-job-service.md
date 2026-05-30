# Job Service

The Job Service is the scheduling and workflow orchestration engine of the social media automation platform. Built on Node.js, Express, and Agenda.js, it translates user posting preferences into durable, time-bound background jobs and executes publish workflows at the configured times. It serves as the bridge between content preparation and platform delivery, ensuring that photo and video posts are triggered reliably across recurring or one-off schedules while maintaining full visibility into execution state.

## Responsibilities

- **Job Definition & Registration**: Registers Agenda.js job processors (e.g., `publish-post`, `prepare-content`, `retry-publish`) with explicit concurrency limits and lock lifetimes.
- **Schedule Orchestration**: Computes `nextRunAt` based on user-defined parameters such as posting frequency (e.g., three times per week), platform-specific publishing windows, local timezones, and media processing readiness.
- **Lifecycle Management**: Exposes CRUD operations for scheduled jobs, including immediate scheduling, cancellation, rescheduling after preference updates, and disabling active recurring campaigns.
- **Publish Workflow Triggering**: At execution time, invokes the Publish Service with a deterministic idempotency key, content reference IDs, target social account IDs, and publishing metadata.
- **Pre-flight Validation**: Before enqueueing or executing a publish job, verifies that the referenced content exists and that associated media variants have been finalized by the Media Service.
- **Retry & Escalation**: Implements tiered retry policies for failed publish attempts; emits terminal failure events to the Notification Service after final retry exhaustion.
- **Observability & Audit**: Persists execution history for every run attempt to support user-facing job logs, compliance requirements, and post-mortem debugging.

## APIs and Interfaces

### REST API (via API Gateway)
All endpoints are versioned under `/v1/jobs` and require a valid bearer token routed through the API Gateway.

- `POST /v1/jobs`
  - Creates a new scheduled or immediate job. Accepts `userId`, `contentId`, `accountIds`, `schedule` (ISO datetime, cron expression, or interval string), `timezone` (IANA format), and optional `metadata`.
  - Returns `201 Created` with the Agenda.js `jobId`.

- `GET /v1/jobs/:jobId`
  - Retrieves current job state including `nextRunAt`, `lastRunAt`, `failCount`, `lockedAt`, `repeatInterval`, and nested execution history.

- `GET /v1/jobs?userId={uid}&status={scheduled|completed|failed|cancelled}`
  - Lists jobs with cursor-based pagination. Supports filtering by campaign identifier or target platform.

- `PATCH /v1/jobs/:jobId`
  - Updates mutable schedule properties or payload metadata. Triggers an in-place Agenda.js reschedule and invalidates stale next-run calculations.

- `DELETE /v1/jobs/:jobId`
  - Cancels and removes the job from the active queue. Idempotent; safe to retry without side effects.

- `POST /v1/jobs/:jobId/trigger`
  - Manual ad-hoc execution of a scheduled job, bypassing `nextRunAt` but preserving the same idempotency and validation semantics.

### Internal Interfaces

- **Agenda_Queue**: The service initializes an Agenda instance connected to the platform MongoDB replica set. It defines processors and calls `agenda.schedule()`, `agenda.every()`, and `agenda.cancel()` against the shared queue.
- **Content Service**: Prior to scheduling, validates that `contentId` exists and that caption/hashtag generation is finalized. Optionally requests content preparation if the status is not `ready`.
- **Publish Service**: Synchronous HTTP invocation (within the job processor) to `POST /v1/publish` with payload:
  ```json
  {
    "idempotencyKey": "job:{jobId}:run:{runNumber}",
    "contentId": "uuid",
    "accountIds": ["acc_123", "acc_456"],
    "platformTargets": ["instagram", "linkedin"],
    "mediaVariantIds": ["var_789"]
  }
  ```
- **Notification Service**: Emits structured events (`job:started`, `job:completed`, `job:failed`) via an internal HTTP webhook for real-time user alerts, email digests, and dashboard updates.

### Configuration Interface
Environment-driven tuning for Agenda.js behavior:
```javascript
{
  "agenda": {
    "db": {
      "address": "mongodb://mongo-replica/agenda",
      "collection": "agendaJobs"
    },
    "processEvery": "30 seconds",
    "defaultConcurrency": 5,
    "maxConcurrency": 20,
    "lockLimit": 10,
    "defaultLockLifetime": 300000
  }
}
```

## Data Ownership

The Job Service owns and manages the following MongoDB collections:

- **`agendaJobs`** (managed by Agenda.js):
  - Core fields: `name`, `data` (payload containing `userId`, `contentId`, `accountIds`, `timezone`), `type` (`normal` | `single`), `priority`, `nextRunAt`, `lastRunAt`, `lastFinishedAt`, `repeatInterval`, `repeatTimezone`, `lockedAt`, `failCount`, `failReason`.
  - Custom indexes added beyond Agenda defaults: `{ "data.userId": 1, nextRunAt: 1 }` to support user dashboard lookups without collection scans.

- **`job_executions`**:
  - Denormalized audit log for every run attempt.
  - Schema: `executionId`, `jobId` (Agenda job `_id`), `userId`, `startedAt`, `completedAt`, `status` (`success` | `failed` | `cancelled`), `publishRequestId`, `errorCode`, `platformResponses` (array of `{ platform, externalPostId, error }`), `idempotencyKey`.
  - TTL index on `startedAt` (90 days) for automatic pruning of historical runs.

- **`schedule_snapshots`**:
  - Immutable snapshots of user posting preferences at job creation time. Guards against preference drift for recurring campaigns.
  - Fields: `jobId`, `frequency`, `timeSlots`, `platformTargets`, `mediaTypePreferences`, `capturedAt`.

## Failure Modes

| Failure | Impact | Mitigation |
|---|---|---|
| **Agenda worker crash mid-flight** | Job remains locked in `agendaJobs` with `lockedAt` set; prevents re-election until the lock expires. | Configure `defaultLockLifetime` to 5 minutes. Rely on deterministic idempotency keys passed to Publish Service to prevent duplicate posts if another worker acquires the lock after expiry. |
| **MongoDB primary failover** | Agenda cannot query, lock, or write jobs; scheduling API operations stall. | Connect with a replica set URI and `retryWrites=true`. API layer surfaces `503 Service Unavailable` with a `Retry-After` header while Agenda.js connection pool reconnects. |
| **Publish Service timeout or 5xx** | Job processor fails; `failCount` increments on the Agenda job. | Retry up to 3 times with exponential backoff (5 minutes, 15 minutes, 45 minutes). On exhaustion, mark the job `failed` and alert the user via Notification Service. |
| **Content or media not ready at trigger time** | Publish would fail or post incomplete/unprocessed media. | Pre-flight check in the processor: if content status is not `ready`, abort the run and schedule a deferred retry in 10 minutes (maximum 3 deferrals before hard failure). |
| **Duplicate job scheduling** | Client retries or double-clicks `POST /v1/jobs`, risking multiple live posts. | Enforce a unique composite index on `("data.userId", "data.contentId", "data.campaignId")` for non-recurring jobs in the `agendaJobs` collection. |
| **Clock skew across nodes** | Jobs execute early or late if host clocks diverge. | Deploy NTP synchronization on all Job Service hosts. Rely on MongoDB server time for `nextRunAt` comparisons where possible. |
| **Job payload bloat** | Embedding large caption objects or media blobs risks exceeding the MongoDB 16 MB document limit. | Store only reference IDs (`contentId`, `mediaVariantIds`) in `data`; never embed binary or large text blocks. |
| **Retry storm after platform outage** | Thousands of failed jobs retry simultaneously, overwhelming Publish Service and risking platform rate limits. | Apply jitter to retry delays and cap per-processor concurrency using Agenda's `lockLimit`. |

## Scaling Considerations

- **Horizontal Worker Scaling**: Deploy the Job Service as a stateless fleet where any instance can act as an API server and/or Agenda worker. Agenda.js uses atomic MongoDB locks, enabling safe concurrent job processing across N instances. For large fleets, separate the HTTP API tier from dedicated worker processes to prevent long-running publish jobs from starving Express request handlers.
- **Collection Growth & Archival**: The `agendaJobs` collection grows indefinitely as recurring campaigns accumulate history. Implement a nightly archival job that moves completed jobs older than 30 days to a cold storage collection or S3, keeping the active working set small and index lookups fast.
- **Indexing Strategy**: Maintain Agenda's required compound indexes on `(nextRunAt, lockedAt)` and `(name, lockedAt)`. Add partial indexes on `data.userId` and `status` to support high-throughput dashboard queries without table scans.
- **Concurrency Tuning**: Use `defaultConcurrency` and `lockLimit` to bound in-flight publish jobs. Introduce per-platform concurrency limits if downstream Platform APIs enforce strict rate limits (e.g., Instagram Graph API calls per hour).
- **Graceful Shutdown**: On `SIGTERM`, invoke `agenda.stop()` with a 30-second timeout to finish active processors and release MongoDB locks cleanly. This prevents false-positive stale locks on container restart or deployment rollover.
- **Queue Depth Monitoring**: Export Prometheus metrics for `agenda_jobs_pending`, `agenda_jobs_locked`, `job_execution_duration_seconds`, and `job_failures_total`. Page on-call when pending depth exceeds a threshold proportional to daily posting volume.
- **Shard Key Selection**: If `agendaJobs` exceeds the capacity of a single MongoDB shard, shard by a hashed `data.userId` prefix to distribute write load while keeping a user's jobs logically collocated for range queries.