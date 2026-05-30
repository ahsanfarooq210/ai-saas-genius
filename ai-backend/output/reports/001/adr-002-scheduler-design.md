# ADR-002: Scheduler Design with Agenda.js

## Status
Accepted

## Context
The social media automation platform must translate user posting preferences—such as target platforms, posting frequency, media type, captions, hashtags, and publishing times—into automated background jobs that publish content without manual intervention. The backend is built on Node.js/Express with MongoDB as the primary database.

We evaluated scheduling mechanisms against the following constraints:
- **Infrastructure cohesion**: Avoid introducing additional state stores (e.g., Redis) solely for job queueing.
- **Persistence and recovery**: Jobs must survive process restarts and be recoverable after deployments.
- **Distributed execution**: Multiple worker instances must share the queue safely without duplicate execution.
- **Recurrence support**: Native handling of cron-style and interval-based repetition derived from user preferences.

Alternatives considered:
- **node-cron / node-schedule**: Rejected. In-memory scheduling only; no distributed locking; jobs are lost on restart.
- **Bull / BullMQ**: Rejected. Requires Redis, adding operational overhead and a second persistence layer outside our MongoDB primary store.
- **Agenda.js**: Selected. MongoDB-backed job queue with native recurrence, document-level locking, and direct integration with our existing Mongoose/MongoDB stack.

## Decision
Adopt **Agenda.js** as the core scheduling engine. Responsibilities are split between two architectural components:

1. **Scheduler Service**: An Express-based service that translates user posting preferences into Agenda job definitions, manages job lifecycle (CRUD, pause, resume), and binds jobs to content drafts and user accounts.
2. **Agenda Worker**: A separate, long-running Node.js process that instantiates Agenda, polls MongoDB for due jobs, and delegates execution to the Publisher Service.

## Responsibilities

### Scheduler Service
- **Preference Translation**: Converts human-readable preferences (e.g., "Mon/Wed/Fri at 09:00 America/New_York") into Agenda-compatible `repeatInterval` or `repeatTimezone` definitions.
- **Job Lifecycle Management**: Creates, updates, cancels, pauses, and resumes Agenda jobs via the Agenda.js API.
- **Content Binding**: Associates each job with a `contentId` (from Content Service) and `userId` to ensure the worker has full context at execution time.
- **Validation**: Prevents overlapping schedule storms for the same connected social account and validates that media processing is complete before a publish job is enqueued.
- **Idempotency**: Ensures duplicate preference updates do not spawn duplicate job series.

### Agenda Worker
- **Job Acquisition**: Polls the `agendaJobs` MongoDB collection using `processEvery` and acquires locks via Agenda’s `lockedAt` / `lockedBy` mechanism.
- **Execution Delegation**: Upon job trigger, fetches finalized content metadata and calls the Publisher Service to execute platform API requests.
- **Completion Handling**: Marks jobs as completed, records failure reasons, and triggers retry logic with exponential backoff.
- **Event Emission**: Notifies the Notification Service of hard failures or repeated retry exhaustion.

## APIs and Interfaces

### Scheduler Service REST API (via API Gateway)
| Endpoint | Method | Description |
|---|---|---|
| `/schedules` | `POST` | Creates a posting schedule and generates associated Agenda jobs. Returns `scheduleId` and an array of enqueued `jobIds`. |
| `/schedules/:scheduleId` | `GET` | Retrieves schedule configuration, active state, and computed next run times. |
| `/schedules/:scheduleId` | `PATCH` | Updates preferences; atomically cancels stale jobs and creates new ones to match the updated recurrence. |
| `/schedules/:scheduleId` | `DELETE` | Cancels all future jobs and soft-deletes the schedule record. |
| `/schedules/:scheduleId/pause` | `POST` | Disables future job runs without removing definitions. Sets `disabled: true` on Agenda jobs. |
| `/schedules/:scheduleId/resume` | `POST` | Re-enables disabled jobs. |

### Internal Service Interfaces
- **Content Service**: Scheduler Service calls `GET /content/:contentId/status` internally to verify media processing is `ready` before finalizing the job enqueue time.
- **User Service**: Reads `timezone` and connected `platformAccounts` to validate that requested targets are authenticated and active.

### Agenda Job Definition
Registered in the Agenda Worker process:

```javascript
agenda.define('publish-post', {
  concurrency: 10,
  lockLifetime: 30000, // 30 seconds
  priority: 10
}, async (job, done) => {
  const { contentId, userId, platformTargets, timezone } = job.attrs.data;
  // Delegate to Publisher Service
  await publisherService.publish({ contentId, userId, platformTargets });
  done();
});
```

Job `data` payload schema:
```json
{
  "contentId": "507f1f77bcf86cd799439011",
  "userId": "507f1f77bcf86cd799439012",
  "platformTargets": ["instagram", "twitter"],
  "timezone": "America/New_York",
  "scheduleId": "507f1f77bcf86cd799439013"
}
```

## Data Ownership

### Owned by Scheduler Service
- **`posting_schedules` collection**: Source-of-truth for user-defined recurrence rules, time windows, platform selections, and schedule state (`active`, `paused`, `deleted`). Each document links to a `userId` and caches an array of associated Agenda job `_id`s.
- **`schedule_audit` collection**: Immutable log of schedule mutations (create, update, cancel) for debugging and compliance.

### Owned by Agenda.js (MongoDB)
- **`agendaJobs` collection**: Managed exclusively by the Agenda.js library. Stores job names, `nextRunAt`, `lastRunAt`, `lockedAt`, `lockedBy`, `repeatInterval`, `repeatTimezone`, `failCount`, `failReason`, and the embedded `data` payload.

### Referenced (Read-Only)
- **`content_drafts`**: Validated for readiness before job creation.
- **`users.accounts`**: Referenced to confirm platform OAuth tokens exist at scheduling time.

## Failure Modes

| Failure | Impact | Mitigation |
|---|---|---|
| **Agenda Worker crash mid-job** | Job remains locked in MongoDB until `lockLifetime` expires. | Set `lockLifetime` to 2× the maximum expected publish duration (e.g., 30s). Agenda auto-releases the lock and retries. |
| **MongoDB primary failover** | Brief inability to acquire or release job locks. | Use a MongoDB replica set with `retryWrites=true` and `w=majority`. The MongoDB driver reconnects transparently. |
| **Duplicate job creation** | Same content published multiple times to social platforms. | Enforce deterministic job naming: `publish-post:${contentId}:${scheduleId}`. Use Agenda’s `unique` constraint on `name` + `data.contentId` where possible, or maintain a unique index in `posting_schedules` on `jobName`. |
| **Timezone/DST shift errors** | Posts fire at incorrect local times. | Store IANA timezone strings (e.g., `America/New_York`) in job `data`. Compute `nextRunAt` in UTC within the Scheduler Service using a timezone-aware library. Reject invalid timezone strings at the API layer. |
| **Queue backpressure** | Job creation outpaces worker throughput; `agendaJobs` collection grows unbounded. | Monitor `agendaJobs` count and `nextRunAt` lag. Horizontally scale Agenda Worker pods. Implement per-user job rate limits to prevent a single user from flooding the queue. |
| **Publisher Service timeout** | Job exceeds `lockLifetime`, causing a second worker to acquire and potentially duplicate work. | Enforce a 25s timeout on all Publisher Service platform API calls. If a timeout occurs, the first worker’s lock expires; the second worker must verify publish state via idempotency keys before retrying. |
| **Stale job accumulation after schedule deletion** | Orphaned `agendaJobs` remain in MongoDB. | On `DELETE /schedules/:id`, the Scheduler Service explicitly calls `agenda.cancel({ 'data.scheduleId': id })` and then removes the mapping from `posting_schedules`. |

## Scaling Considerations

- **Worker Horizontal Scaling**: Agenda Workers are deployed as stateless containers. Increasing replica count is safe because Agenda uses MongoDB document-level locking (`lockedAt`, `lockedBy`). Poll frequency is controlled by `processEvery` (recommended: `30s` in high-volume deployments to reduce DB pressure).
- **MongoDB Indexing**: The `agendaJobs` collection requires compound indexes on:
  - `{ nextRunAt: 1, name: 1, priority: -1 }` (primary query for due jobs)
  - `{ lockedAt: 1 }` (lock cleanup)
  - `{ name: 1 }` (job type filtering)
  - `{ 'data.userId': 1 }` (operational queries and potential sharding)
  Missing indexes cause full collection scans and CPU spikes on the MongoDB primary.
- **Concurrency Tuning**: Each Agenda Worker instance should set `maxConcurrency` based on I/O wait characteristics. Start with `10` for mixed media publishing. Avoid unbounded concurrency to prevent Event Loop starvation and excessive outbound HTTP connections to social platform APIs.
- **Collection Growth**: `agendaJobs` retains completed jobs unless purged. Implement a nightly cron that removes jobs with `lastFinishedAt` older than 30 days (or move them to cold storage) to keep the working set small.
- **Sharding**: If the platform exceeds millions of daily jobs, shard `agendaJobs` by `data.userId` (high-cardinality, evenly distributed) rather than monotonically increasing `_id` to avoid hot shards.
- **Scheduler Service Isolation**: The Scheduler Service remains separate from workers. This ensures that deployments or restarts of the preference-translation API do not interrupt active job processing.

## Related Diagrams
- `diagrams/001/iter1_overview.mmd`