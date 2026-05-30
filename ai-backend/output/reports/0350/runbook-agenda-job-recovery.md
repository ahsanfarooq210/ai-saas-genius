# Runbook: Agenda.js Job Recovery

## Scope and Responsibilities
This runbook defines operational procedures for detecting, diagnosing, and remediating failures within the Agenda.js job infrastructure that schedules and publishes social media content. It covers the full lifecycle of background jobs—from `scheduler_service` creation through `agenda_worker` execution to final platform publication. Responsibilities include releasing orphaned locks, retrying transient failures, reconciling missed schedules, deduplicating jobs, and restoring consistency between the `agendaJobs` queue and the `scheduled_posts` application state.

## Job Types and Lifecycle
The platform registers the following Agenda.js job definitions in `scheduler_service` for execution by `agenda_worker` nodes:

| Job Name | Responsibility | Max Retries | Lock Lifetime |
|---|---|---|---|
| `generate-content` | Draft captions, hashtags, and post metadata from user preferences | 3 | 5 min |
| `assemble-media` | Retrieve processed assets from `media_service` and build platform-specific payloads | 3 | 30 min |
| `publish-post` | Call `publisher_service` to execute OAuth-signed API requests to social platforms | 3 | 10 min |
| `refresh-platform-tokens` | Proactively refresh OAuth tokens before expiry to avoid publication failures | 5 | 5 min |
| `cleanup-stale-locks` | Internal maintenance job that releases locks held by dead workers | — | 2 min |

Job state is tracked in the `agendaJobs` MongoDB collection via the fields `nextRunAt`, `lockedAt`, `lastRunAt`, `lastFinishedAt`, `failCount`, and `failReason`.

## Data Ownership
Recovery procedures interact with the following data stores:

- **`agendaJobs` (MongoDB)**: Owned by Agenda.js. Contains the schedule, lock state, failure history, and opaque job payload (`data`). This is the queue’s source of truth.
- **`scheduled_posts` (MongoDB)**: Owned by `scheduler_service`. Maps business entities (`postId`, `userId`, `publishAt`) to Agenda job IDs. Used during reconciliation to verify that every scheduled post still has an active queue entry.
- **`job_recovery_log` (MongoDB)**: Owned by the operations toolchain. An append-only audit trail of manual or scripted recovery actions, capturing operator identity, prior state, applied mutation, and timestamp.

## Interfaces and Tools

### 1. Admin HTTP API (via API Gateway)
Internal endpoints exposed for operational intervention:
- `GET /admin/agenda/stats` — Returns job counts by state (`queued`, `running`, `failed`, `stuck`), worker node IDs, and oldest stuck lock timestamp.
- `POST /admin/agenda/jobs/:jobId/retry` — Idempotently resets `failCount` and `failReason` to `0`/`null`, sets `nextRunAt` to `now`, and clears any residual lock.
- `POST /admin/agenda/jobs/stuck/release` — Bulk-releases locks older than a configurable threshold, scoped by job name.

### 2. CLI Recovery Script
`ops/scripts/agenda-recover.js` connects directly to the MongoDB replica set:
```bash
node ops/scripts/agenda-recover.js \
  --env production \
  --action release-stuck \
  --lock-threshold-minutes 10 \
  --job-names assemble-media,publish-post \
  --dry-run false
```

### 3. Direct MongoDB Access
Break-glass queries executed via `mongosh` or an authenticated MongoDB client with read-write privileges on the application database.

## Failure Modes and Detection

### 1. Stuck Jobs (Orphaned Locks)
**Cause:** An `agenda_worker` process crashes, is OOM-killed, or loses network connectivity while holding a job lock. The `lockedAt` field remains set, preventing other workers from picking up the job.

**Detection:**
```javascript
db.agendaJobs.find({
  lockedAt: { $lt: new Date(Date.now() - 10 * 60 * 1000) },
  lastFinishedAt: { $exists: false },
  name: { $in: ['assemble-media', 'publish-post'] }
})
```

### 2. Exhausted Retry Failures
**Cause:** A job fails repeatedly due to downstream errors (e.g., revoked OAuth token, platform API outage, invalid media format). Once `failCount` reaches the max, Agenda stops rescheduling it.

**Detection:**
```javascript
db.agendaJobs.find({
  failCount: { $gte: 3 },
  $or: [{ nextRunAt: { $exists: false } }, { nextRunAt: null }]
})
```

### 3. Missed Schedules (Silent Drops)
**Cause:** `scheduler_service` crashes between writing the `scheduled_posts` record and creating the Agenda job, or a unique-job constraint race condition suppresses creation. The post is expected but never queued.

**Detection:** Run the reconciliation script to perform a left-join between `scheduled_posts` (where `status == PENDING` and `publishAt <= now + 24h`) and `agendaJobs` (matching on `data.postId`).

### 4. Duplicate Job Queuing
**Cause:** Lack of idempotency during `scheduler_service` retries or overlapping cron definitions creates multiple `agendaJobs` documents for the same `postId` and time window.

**Detection:**
```javascript
db.agendaJobs.aggregate([
  { $match: { name: 'publish-post', nextRunAt: { $gt: new Date() } } },
  { $group: { _id: '$data.postId', count: { $sum: 1 }, ids: { $push: '$_id' } } },
  { $match: { count: { $gt: 1 } } }
])
```

### 5. MongoDB Lock Contention
**Cause:** High-frequency polling (`processEvery` too low) combined with large job volumes causes `findAndModify` lock-acquisition queries to saturate the MongoDB primary or exhaust the connection pool.

## Recovery Procedures

### Releasing Stuck Jobs
1. Confirm the worker node is offline via infrastructure health checks or `GET /admin/agenda/workers`.
2. Execute the release update:
```javascript
db.agendaJobs.updateMany(
  {
    lockedAt: { $lt: new Date(Date.now() - 10 * 60 * 1000) },
    lastFinishedAt: { $exists: false },
    name: { $in: ['assemble-media', 'publish-post'] }
  },
  {
    $set: { lockedAt: null, lastModifiedBy: null },
    $inc: { __recoveryVersion: 1 }
  }
)
```
3. Agenda will automatically pick up eligible jobs on the next polling cycle according to `nextRunAt`.

### Retrying Failed Jobs
1. Read `failReason` to classify the root cause:
   - **Transient:** Rate limit (`429`), gateway timeout (`504`), network error → safe to retry.
   - **Permanent:** Revoked token (`401` with invalid_grant), content policy violation (`400`) → do not retry.
2. For transient failures, reset and re-queue:
```javascript
db.agendaJobs.updateOne(
  { _id: failedJobId },
  {
    $set: { failCount: 0, failReason: null, nextRunAt: new Date() },
    $unset: { lockedAt: "" }
  }
)
```
3. For permanent failures, update the corresponding `scheduled_posts` record to `FAILED_PERMANENT`, surface the error to the user via `user_service`, and delete the Agenda job to prevent alert noise.

### Reconciling Missed Schedules
1. Execute:
```bash
node ops/scripts/reconcile-schedules.js --window-hours 24
```
2. The script outputs orphaned `postId` values.
3. For each orphan, invoke the `scheduler_service` internal endpoint:
```bash
curl -X POST https://api.internal/scheduler/emit \
  -H "Authorization: Bearer $OPS_TOKEN" \
  -d '{ "postId": "<orphan-id>" }'
```
This endpoint recreates the Agenda job atomically with idempotency checks.

### Deduplicating Jobs
1. From the aggregation detection query, keep the document with the earliest `nextRunAt` and highest `priority`.
2. Remove duplicates:
```javascript
const keep = /* earliest nextRunAt */;
db.agendaJobs.deleteMany({
  _id: { $in: duplicateIds.filter(id => id !== keep) }
})
```

### Recovering from Lock Contention
1. Scale `agenda_worker` replicas down by 50% to reduce query pressure.
2. Verify the required indexes exist:
```javascript
db.agendaJobs.createIndex({ nextRunAt: 1, lockedAt: 1, name: 1, priority: -1 })
db.agendaJobs.createIndex({ lockedAt: 1 }, { sparse: true })
db.agendaJobs.createIndex({ 'data.postId': 1 }, { sparse: true })
```
3. Increase `defaultLockLifetime` for `assemble-media` jobs to 30 minutes to prevent premature lock expiry during slow object storage transfers.
4. Increase `processEvery` from 5 seconds to 15 seconds until contention subsides.
5. Gradually restore worker replicas and monitor `db.currentOp()` for long-running `findAndModify` operations.

## Scaling Considerations
- **Worker Concurrency:** Limit each `agenda_worker` instance to `maxConcurrency: 20` for `publish-post` and `5` for `assemble-media`. This protects `publisher_service` from OAuth rate limits and prevents `media_service` from being overwhelmed by concurrent large-video downloads.
- **Lock Lifetime by Payload:** Video posts require 30-minute locks due to variable transcoding and transfer times; text-only posts require only 5 minutes. Configure per-job lock lifetimes rather than a global default.
- **Statelessness:** Workers must remain stateless. Job progress cannot be stored in worker memory; any checkpointing required mid-job must write to MongoDB or object storage so that another worker can resume after a lock release.
- **MongoDB Polling Pressure:** At volumes exceeding 1M jobs/day, Agenda’s default 5-second `processEvery` interval generates significant read load. Raise the interval to 15 seconds and shard the `agendaJobs` collection on a compound key `{ name: 1, nextRunAt: 1 }` to distribute polling and lock acquisition across shards.
- **Observability:** Export Agenda metrics (`agenda:started`, `agenda:complete`, `agenda:failure`, `agenda:stuck`) to Prometheus. Maintain alerts for `stuck_jobs > 0` for longer than 5 minutes and for spikes in `failed_jobs` rate per job name.

## Related Diagrams
- `diagrams/0350/iter1_overview.mmd`