## Agenda Queue

### Overview
The Agenda Queue is a MongoDB-backed distributed job queue powered by the [Agenda.js](https://github.com/agenda/agenda) library. It persists job definitions, schedules, and execution state inside the primary MongoDB cluster and enables `Job_Service` workers to process background tasks—such as content preparation and social-media publishing—across multiple horizontally scaled instances with automatic locking and concurrency control.

### Responsibilities

- **Job Persistence**: Store job documents with scheduling metadata (`nextRunAt`, `repeatInterval`, `repeatTimezone`), execution history (`lastRunAt`, `lastFinishedAt`), and failure counters in a dedicated MongoDB collection.
- **Schedule Orchestration**: Support one-time (`schedule`), immediate (`now`), and recurring (`every`) job triggers based on user-defined posting frequencies and publishing windows.
- **Distributed Work-Stealing**: Allow any available `Job_Service` worker process to atomically claim an unclaimed job via MongoDB `findAndModify`, ensuring that a job runs on exactly one worker at a time.
- **Concurrency Control**: Enforce per-job-type and global concurrency limits so that expensive operations (e.g., video transcoding or platform API calls) do not overwhelm downstream services.
- **Failure & Retry Handling**: Automatically increment `failCount`, record `failReason`, and reschedule retries with exponential backoff for transient errors; surface terminal failures to the `Job_Service`.
- **Job Lifecycle Events**: Emit `start`, `success`, `fail`, and `complete` events that the `Job_Service` consumes to trigger `Notification_Service` alerts and metrics.
- **Graceful Drain**: On shutdown, finish in-flight jobs (up to a timeout) and stop acquiring new work to prevent orphaned locks.

### APIs and Interfaces

The queue is accessed programmatically by the `Job_Service`; it does not expose HTTP endpoints directly.

#### Job Definition API
Used at worker bootstrap to register handlers:
```javascript
agenda.define('prepare-content', { concurrency: 5, lockLifetime: 300000 }, async (job) => {
  // handler implementation in Job_Service
});

agenda.define('publish-post', { concurrency: 10, priority: 20, lockLifetime: 600000 }, async (job) => {
  // handler implementation in Job_Service
});
```

#### Scheduling API
Used by `Job_Service` to enqueue work:
- `agenda.schedule(when, 'publish-post', { userId, contentId, platforms[] })` – Schedules a future one-time post.
- `agenda.every('0 9 * * 1-5', 'prepare-content', { userId }, { timezone: 'America/New_York' })` – Recurring content generation based on user preference.
- `agenda.now('publish-post', data)` – Immediate execution bypassing the schedule.
- `agenda.cancel({ 'data.userId': userId, name: 'publish-post' })` – Bulk cancellation when a user disables automation or changes frequency.

#### Event Interface
The `Job_Service` attaches listeners to react to state changes:
- `agenda.on('start', job => ...)` – Log job start, update Redis Cache real-time status.
- `agenda.on('success', job => ...)` – Mark post as published in MongoDB, notify via `Notification_Service`.
- `agenda.on('fail', (err, job) => ...)` – Log error, alert user if `job.attrs.failCount >= MAX_RETRIES`.

#### Control Interface
- `await agenda.start()` – Begins polling MongoDB for jobs to process.
- `await agenda.stop()` – Stops polling and optionally waits for active jobs to finish (graceful shutdown).
- `await agenda.database(mongoConnection, 'agendaJobs')` – Binds to the MongoDB collection.

### Data Ownership

All state is stored in a single MongoDB collection (default name: `agendaJobs`). Each document represents a unit of work and contains:

| Field | Purpose |
|-------|---------|
| `_id` | MongoDB ObjectId |
| `name` | Job type string (e.g., `prepare-content`, `publish-post`) |
| `data` | Payload object passed by `Job_Service`; typically includes `userId`, `contentId`, `platforms[]`, `mediaUrls[]`, and scheduling overrides. Must remain small—only references, not media blobs. |
| `type` | `normal` or `single` (prevents duplicate recurring definitions) |
| `priority` | Numeric priority for execution order |
| `nextRunAt` | ISODate when the job is eligible to run |
| `lastModifiedBy` | Worker process identifier that currently holds the lock |
| `lockedAt` | ISODate when the job was claimed; null if unclaimed |
| `lastRunAt` | ISODate of the most recent execution attempt |
| `lastFinishedAt` | ISODate when the job last completed or failed |
| `failCount` | Cumulative failure count |
| `failReason` | Last error message string |
| `repeatInterval` | Cron string or human-interval for recurring jobs |
| `repeatTimezone` | IANA timezone (e.g., `Europe/London`) for recurring triggers |
| `disabled` | Boolean flag to soft-disable a job without deleting it |

**Indexes**: The queue relies on a compound index on `{ nextRunAt: 1, lockedAt: 1, name: 1, disabled: 1 }` for efficient job querying and locking. Operational teams must ensure this index exists and is not fragmented under high write load.

### Failure Modes

- **MongoDB Unavailability**: If the primary MongoDB node is unreachable, Agenda cannot poll for jobs or update lock status. Workers enter a stalled state and retry via the underlying MongoDB driver; scheduled publishes will be delayed until connectivity is restored.
- **Long-Running Job Exceeds `lockLifetime`**: A video upload job that outlives its `lockLifetime` (e.g., 10 minutes) will have its lock expire. A second worker may then claim and execute the same job, resulting in duplicate social-media posts. Mitigation: set `lockLifetime` to the P99 job duration + margin.
- **Unhandled Handler Exception**: If the `Job_Service` handler throws without catching, Agenda captures the error, increments `failCount`, and sets `failReason`. After a configurable number of retries, the job is abandoned and requires manual intervention or dead-letter handling.
- **Orphaned Locks (Worker Crash)**: If a worker process crashes between claiming a job and releasing the lock, the `lockedAt` field remains set. The job is invisible to other workers until the lock expires (governed by `lockLifetime`), causing latency spikes for that specific unit of work.
- **Duplicate Scheduling Race**: Rapid user preference updates may cause the `Job_Service` to invoke `agenda.cancel(...)` and `agenda.every(...)` concurrently. Without idempotency checks in `Job_Service`, duplicate recurring jobs for the same user/content window can be created, leading to double publishing.
- **Clock Skew Across Workers**: Agenda uses system clocks to evaluate `nextRunAt`. If worker instances have divergent clocks (e.g., in a containerized environment without NTP sync), jobs may execute early or late.
- **Payload Bloat**: Embedding large base64 media strings or verbose caption arrays in `data` inflates MongoDB documents, slows replication, and increases worker memory pressure. This is an application-level failure propagated through the queue.

### Scaling Considerations

- **Horizontal Worker Scaling**: Multiple `Job_Service` pods/instances can safely share the same Agenda collection. MongoDB's atomic `findAndModify` operation serializes lock acquisition, but contention rises linearly with worker count. Monitor MongoDB `opLatencies` and cap workers if read/write latency degrades.
- **Concurrency Tuning**: 
  - Set global `defaultConcurrency` to a low baseline (e.g., 20) to protect `Platform_APIs` rate limits.
  - Use per-definition `concurrency` to isolate noisy neighbors: `publish-post` may be limited to 5 concurrent jobs per worker, while `prepare-content` can run at 20.
- **Poll Frequency (`processEvery`)**: The default 5-second poll interval generates significant MongoDB read traffic at scale. Increase to 10–30 seconds for high-volume installations, accepting higher scheduling latency.
- **Lock Lifetime Sizing**: Size `lockLifetime` to the P99 execution time of the handler plus a 50% buffer. For publish jobs (network-bound, 5–30s), 5 minutes is safe. For large video pipeline jobs (minutes), extend to 30 minutes.
- **Index & Storage Management**: The `agendaJobs` collection grows indefinitely with recurring job history. Implement a TTL index or archival job to prune completed documents older than 90 days, preventing full-collection scans.
- **Separate Agenda Instances for Workload Isolation**: If publishing latency is critical, run a dedicated Agenda instance (separate Node.js process or collection) for `publish-post` jobs, isolating them from CPU-intensive `prepare-content` or bulk-cleanup tasks.
- **Graceful Shutdown on Deployments**: Kubernetes/Docker signals (`SIGTERM`) must trigger `await agenda.stop({ timeout: 30000 })` to allow in-flight publishes to complete before pod termination, preventing orphaned locks and partial platform posts.
- **Payload Discipline**: Enforce a maximum serialized `data` size (e.g., 16 KB) in `Job_Service` validation. Store media in `S3_Storage` and pass only S3 keys and CDN URLs through the queue.