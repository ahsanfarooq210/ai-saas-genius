# ADR-002: Job Scheduling with Agenda.js

## Status
Accepted

## Context
The social media automation platform must translate per-user posting preferences—target platforms, frequency, publishing windows, captions, hashtags, and media type—into reliable, time-triggered publish actions. These actions must survive process restarts, tolerate transient external API failures, and coordinate across multiple backend workers without duplicate publishing. The stack is Node.js, Express, and MongoDB.

## Decision
Adopt **Agenda.js** as the durable job scheduling engine. Agenda persists job definitions and schedules directly in the existing MongoDB primary database, avoiding additional infrastructure. It provides MongoDB-backed distributed locking, cron-style recurrence, and native Node.js promise-based job handlers.

## Responsibilities
- Convert `preferenceService` schedules into durable Agenda job documents with computed `nextRunAt` values based on user timezone and platform-specific posting windows.
- Trigger `publisherService` at the exact scheduled time to execute the publish workflow.
- Manage job lifecycle states (queued, locked, completed, failed) and persist execution history for audit and retry purposes.
- Enforce singleton execution per job across horizontally scaled worker processes via MongoDB document locking.
- Cancel or regenerate future jobs when a user updates preferences or disconnects a social account via `accountService`.
- Surface job status and recent failure reasons to the API layer for user visibility.

## Interfaces

### Programmatic API (Internal)
Consumed by `preferenceService` and `apiGateway` during preference mutations:

| Method | Input | Behavior |
|--------|-------|----------|
| `regenerateUserSchedule(userId, preferenceConfig)` | User ID, full preference object | Idempotently removes future pending jobs for the user and creates new Agenda jobs aligned with updated frequency, windows, and platforms. |
| `cancelUserJobs(userId, platform?)` | User ID, optional platform filter | Cancels all matching pending jobs. Used when an account is revoked or paused. |
| `getJobHistory(userId, limit)` | User ID, page limit | Queries Agenda collection for recent `lastFinishedAt`, `failCount`, and `failReason` entries. |

### Job Handler Contract
At application startup, the scheduler registers:
```javascript
agenda.define('publish-content', { 
  priority: 10, 
  concurrency: 5,
  lockLifetime: 15 * 60 * 1000  // 15 minutes
}, async (job) => {
  const { userId, mediaId, platform, scheduledAt } = job.attrs.data;
  // Rehydrate latest captions/hashtags to avoid stale payload
  const prefs = await preferenceService.getLatest(userId);
  const payload = await contentBuilder.assemble(mediaId, platform, prefs);
  await publisherService.publish(userId, platform, payload);
});
```

### Database Interface
Agenda owns and manages a dedicated MongoDB collection (default: `agendaJobs`). Application services do not write directly to this collection; they interact through Agenda's API.

## Data Ownership
The `jobScheduler` owns the following data in the `agendaJobs` collection:
- **Job specification** (`name`, `data`): Includes `userId`, `mediaId`, target `platform`, and the original `scheduledAt` timestamp.
- **Schedule metadata** (`nextRunAt`, `repeatInterval`, `repeatTimezone`): Computed recurrence rules derived from user preferences.
- **Distributed lock state** (`lockedAt`, `lastModifiedBy`): Worker identifier and lock timestamp to prevent concurrent execution.
- **Execution outcome** (`lastFinishedAt`, `failCount`, `failReason`): Automatic audit trail of successes and failures.

## Failure Modes

| Failure | Cause | Mitigation |
|---------|-------|------------|
| **Orphaned lock** | Worker process crashes while holding a job lock. | Configure `lockLifetime` (15 min) longer than the 99th percentile publish duration. Agenda automatically releases expired locks. |
| **Duplicate publish** | Lock expires before slow platform API call returns; second worker picks up the job. | `publisherService` must issue idempotent publish requests using a deterministic deduplication key (`userId:mediaId:scheduledAt:platform`). |
| **Stale payload** | User updates captions/hashtags after a job is queued. | Job handler rehydrates the latest preference snapshot from `preferenceService` at execution time rather than caching full payload at schedule time. |
| **Missed window** | All workers down during `nextRunAt`; job becomes overdue. | Agenda executes overdue jobs on recovery, but posts may be late. Mitigated by redundant worker count, health-check alerts, and a user-visible "last attempted" timestamp. |
| **MongoDB failover** | Primary step-down interrupts lock acquisition. | Use MongoDB replica sets with `retryWrites=true`; Agenda's underlying driver reconnects and resumes polling. |
| **Rate-limit backpressure** | External social API (e.g., Instagram Graph API) returns 429 during a job. | Job handler catches the error and throws a non-fatal exception; Agenda retries with exponential backoff up to 3 attempts before parking the job in a dead-letter state. |

## Scaling Considerations
- **Horizontal workers**: Deploy stateless Agenda worker containers separate from the Express API Gateway. All workers connect to the same MongoDB replica set and rely on document-level locking; no Redis or shared memory is required.
- **Per-user concurrency**: Social platforms enforce strict per-user rate limits. Define Agenda job processors with `concurrency: 1` per queue scope, or partition jobs by `userId` hash if sharding across multiple Agenda instances.
- **Database polling load**: Agenda polls MongoDB every `processEvery` interval (default 5 seconds). For thousands of active users, this generates significant read load on the primary. Tune `processEvery` to 30 seconds if sub-minute drift is acceptable, or isolate Agenda to a hidden secondary node if read concerns arise.
- **Index health**: Ensure compound indexes exist on `{ nextRunAt: 1, lockedAt: 1 }` and `{ name: 1, lockedAt: 1 }`. Without these, job retrieval slows linearly with collection growth.
- **Event-loop isolation**: Media assembly (video transcoding, image watermarking via `contentBuilder`) must not block Agenda's control loop. Offload heavy work to a pre-publish job stage or a worker thread so that Agenda's polling and lock renewals remain responsive.
- **Graceful shutdown**: On `SIGTERM`, invoke `await agenda.stop()` to finish in-flight jobs up to a 30-second timeout, preventing orphaned locks and incomplete publishes.

## Consequences

**Positive:**
- Reuses existing MongoDB infrastructure; no new persistence system to operate.
- Durable, recoverable schedules that survive deploys and crashes.
- Native promise/async-await support fits the Node.js codebase.

**Negative:**
- Tight coupling of job state to MongoDB primary load; scheduling throughput is bounded by primary oplog and lock contention.
- Agenda's polling model introduces minor latency (up to `processEvery` interval) rather than true push-based triggering.
- Job definitions and application data share the same database, requiring careful backup and TTL policies to prevent the `agendaJobs` collection from unbounded growth.

## Related Diagrams
- [Overview Diagram](diagrams/string/iter1_overview.mmd)