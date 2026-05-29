# Job Scheduler

## Responsibilities

The Job Scheduler is the background task engine built on Agenda.js. It owns the end-to-end lifecycle of publishing jobs, from durable enqueueing to timed execution triggers.

- **Job Persistence & Queueing**: Receives job creation and cancellation requests from upstream services (via the API Gateway or internal modules), persists them as Agenda.js documents in MongoDB, and guarantees durability across process restarts.
- **Temporal Scheduling**: Evaluates user posting preferences—frequency, time-of-day windows, timezone, and target platforms—to compute accurate `nextRunAt` values. Supports both one-off scheduled posts and recurring publication cadences.
- **Execution Triggering**: At the scheduled time, atomically locks a job document in MongoDB and delegates publishing work to the `publisherService` by invoking it with a normalized payload derived from the job’s `data`.
- **Distributed Lock Management**: Relies on Agenda.js’s document-level locking mechanism to ensure that exactly one worker instance processes a given job, even when multiple Node.js containers are polling the same collection.
- **Retry & Dead-Letter Handling**: Automatically re-queues failed publishing attempts with exponential backoff up to a configurable retry limit. Jobs exceeding the limit are marked terminal (`failCount` > threshold) and excluded from further automatic retry to prevent infinite loops.
- **Lifecycle Observability**: Maintains execution metadata—including `lockedAt`, `lastRunAt`, `lastFinishedAt`, `failCount`, and `failReason`—to support operational debugging and user-facing status dashboards.

## APIs / Interfaces

The Job Scheduler is consumed as an internal Node.js module. It does not expose public HTTP routes; instead, the API Gateway and preference services interact with it programmatically.

### Job Definition Contract

At application bootstrap, the scheduler registers its executable job types:

```javascript
agenda.define('publish-post', {
  priority: 10,
  concurrency: 5,
  lockLifetime: 300000 // 5 minutes
}, async (job, done) => {
  const { userId, preferenceId, mediaIds, accountIds, scheduledAt } = job.attrs.data;
  await publisherService.publish({ userId, preferenceId, mediaIds, accountIds, scheduledAt });
  done();
});
```

### Scheduling & Management API

| Method | Caller | Purpose |
|--------|--------|---------|
| `agenda.schedule(when, 'publish-post', data)` | API Gateway / Preference Service | Enqueues a single-run job for a specific UTC `Date`. |
| `agenda.every(interval, 'publish-post', data, { timezone })` | Preference Service | Creates a recurring job using a cron string or human-readable interval aligned to the user’s local timezone. |
| `agenda.cancel(query)` | API Gateway | Removes pending jobs matching a MongoDB query (e.g., user deletes a schedule). |
| `agenda.jobs(query)` | API Gateway / Admin tools | Retrieves job documents for queue inspection and status UIs. |
| `agenda.start()` | Bootstrap (worker nodes) | Begins polling MongoDB for jobs eligible to run. |
| `agenda.stop({ graceful: true })` | Shutdown hook | Halts polling and waits for in-flight jobs to complete before process exit. |

### Job Data Payload Schema

To keep the scheduler lean, job `data` stores only database references, not media blobs:

```javascript
{
  userId: ObjectId,        // User entity reference
  preferenceId: ObjectId,  // Posting preference rules reference
  mediaIds: [ObjectId],    // MediaStorage asset references
  accountIds: [ObjectId],  // Target social accounts from AccountService
  scheduledAt: ISODate     // Original intended publish time (UTC)
}
```

### Polling Configuration

- `agenda.processEvery('5 seconds')` — Configures the MongoDB poll frequency. Tuned to balance scheduling latency against database query load.

## Data Owned

The Job Scheduler exclusively owns the `agendaJobs` MongoDB collection (or the configured Agenda.js collection name). Each document represents a discrete unit of work and its current execution state.

Owned fields include:

- **`name`** — Job type discriminator (e.g., `publish-post`).
- **`data`** — Opaque payload adhering to the reference-only schema above.
- **`type`** — `normal` or `single`; singles can auto-remove upon completion.
- **`priority`** — Integer influencing dequeue order.
- **`nextRunAt`** — UTC timestamp when the job becomes eligible for execution. **Indexed** by Agenda.js.
- **`lastModifiedBy`** — Worker fingerprint (host/process ID) for debugging distributed runs.
- **`lockedAt`** — Set when a worker acquires the job; prevents concurrent execution. **Indexed** by Agenda.js.
- **`lastRunAt`** / **`lastFinishedAt`** — Boundaries for execution latency and duration metrics.
- **`failCount`** / **`failReason`** / **`failedAt`** — Retry state and terminal failure diagnostics.
- **`repeatInterval`** / **`repeatTimezone`** — Recurrence parameters for recurring user schedules.

The scheduler does **not** own user profiles, OAuth tokens, media binaries, or caption text. It references those via IDs and relies on the `publisherService` and downstream components to resolve them at execution time.

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Publisher Service Error** | Post fails to publish; user content remains dormant. | Agenda.js increments `failCount` and reschedules the job with exponential backoff. After `MAX_RETRIES` (configurable, default 5), the job is marked terminal and excluded from auto-retry. |
| **MongoDB Unavailability** | Scheduler cannot poll, lock, or persist state; all background publishing halts. | Health checks should fail readiness probes so the container orchestrator restarts instances. Use MongoDB driver auto-reconnect with jitter. Alert on sustained connection loss. |
| **Process Crash Mid-Execution** | Job document remains locked (`lockedAt` is set) and becomes invisible to workers. | Set `lockLifetime` to the 99th percentile of `publisherService` latency plus a safety margin (e.g., 5 minutes). Agenda.js reclaims expired locks automatically on subsequent poll cycles. |
| **Clock Skew (Node ↔ MongoDB)** | Jobs execute early or late, degrading user trust in scheduled publishing. | Enforce NTP synchronization across all nodes. Store and compare all timestamps in UTC; reject enqueue requests with `scheduledAt` beyond an acceptable server clock skew threshold. |
| **Duplicate Job Scheduling** | Identical preferences generate multiple jobs, risking double-posting to social platforms. | Enforce idempotency at enqueue time: query for existing pending jobs with the same `preferenceId` and overlapping `nextRunAt` window, or generate deterministic job names (`publish-post:${preferenceId}:${slot}`). |
| **Memory Pressure / OOM** | Large payloads or excessive concurrency exhaust the Node.js heap. | Strictly enforce the reference-only payload schema. Cap `concurrency` and `lockLimit` per job type. Monitor heap usage and scale workers horizontally rather than vertically increasing concurrency. |
| **Noisy Recurring Failures** | A broken preference (e.g., revoked token) causes a recurring job to fail indefinitely, wasting cycles and polluting logs. | Implement a circuit-breaker in the job handler: after N consecutive failures for the same `preferenceId`, cancel the recurring job and emit an event to notify the user. |

## Scaling Considerations

- **Horizontal Worker Scaling**: Agenda.js uses atomic `findAndModify` on MongoDB to acquire locks. This allows any number of stateless Node.js worker containers to poll the same `agendaJobs` collection safely without additional coordination service.
- **Scheduler vs. Worker Topology**: In production, separate API nodes (which call `agenda.schedule`) from dedicated worker nodes (which call `agenda.start()`). This isolates CPU/network-intensive publishing from HTTP request latency.
- **Poll Interval Tuning**: Reduce `processEvery` (e.g., to `1000ms`) for sub-minute scheduling precision, but monitor MongoDB query performance closely. Increase the interval (e.g., `30000ms`) for coarse schedules to lower DB load.
- **MongoDB Connection Sizing**: Each Agenda.js instance maintains persistent connections. Size the MongoDB connection pool to `(workerInstances × localPoolSize) + apiInstanceOverhead`. If job volume is high, route Agenda.js reads to a non-primary member or dedicated replica set member.
- **Collection Hotspotting**: The `agendaJobs` collection is heavily queried on `nextRunAt` and `lockedAt`. If enqueue volume exceeds millions of jobs daily, consider sharding by `name` or `data.userId` to distribute lock contention.
- **Graceful Shutdown**: On `SIGTERM`, invoke `await agenda.stop({ graceful: true })` with a timeout aligned to the longest expected `publisherService` call. Orchestrators should respect this grace period before `SIGKILL`.
- **Observability**: Export queue depth, lock wait time, job execution duration, and failure rate metrics. Alert when queue depth grows monotonically or when `failCount` spikes for a specific job type.

## Related Diagrams

No paired Mermaid diagram file is specified for this component.