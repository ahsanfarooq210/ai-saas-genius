## Scheduler Service

### Responsibilities

- **Preference Evaluation**: Periodically scans active user posting preferences (target platforms, frequency, time windows, media type, captions, hashtags, timezone) to determine which scheduled slots have arrived.
- **Job Generation**: Translates each due slot into a discrete, normalized publish job payload containing platform targets, processed media references, caption text, hashtag sets, and the requested `publishAt` timestamp.
- **Outbox Pattern Orchestration**: Persists every generated job to a MongoDB outbox collection with an initial `pending` status before attempting external enqueue. This ensures at-least-once durability even if the queue is temporarily unreachable.
- **Redis Streams Enqueueing**: Pushes validated jobs from the outbox into the `publish:jobs` Redis Stream using `XADD` with deterministic fields (`jobId`, `userId`, `platforms`, `mediaId`, `caption`, `hashtags`, `publishAt`, `idempotencyKey`).
- **Deduplication Guard**: Uses Redis `SETNX` scheduling locks (key pattern: `sched:lock:{userId}:{slotHash}`) with short TTLs to prevent duplicate job generation when multiple scheduler replicas evaluate the same cron window concurrently.
- **Reconciliation**: Runs a background reconciliation loop that queries the outbox for records stuck in `pending` status beyond a threshold (e.g., 60 seconds) and re-drives them into Redis Streams idempotently using the existing `jobId`.
- **Preference Change Handling**: Invalidates cached schedule snapshots and recalculates next-run times when users update posting preferences via the API.
- **Agenda.js Cron Management**: Uses Agenda.js internally as the cron trigger engine to fire evaluation cycles, but treats Redis Streams as the durable job queue and MongoDB as the scheduling ledger.

### APIs / Interfaces

**Internal REST (Node.js / Express)**
- `POST /schedules` — Creates or replaces a user’s posting schedule. Writes to MongoDB and invalidates the cached preference snapshot in Redis.
- `GET /schedules/:userId` — Returns the active schedule, next computed run times, and counts of pending/enqueued jobs in the outbox.
- `DELETE /schedules/:userId` — Deactivates the schedule, cancels future Agenda.js triggers for that user, and soft-deletes pending outbox records.
- `POST /schedules/trigger` — Admin endpoint to force an immediate evaluation for a specific `userId`. Respects Redis deduplication locks and outbox unique constraints.
- `POST /schedules/media-ready` — Callback from `media_service` (or `media_processor`) notifying that transcoding is complete for a given `mediaId`. The scheduler attaches the finalized CDN URL to any pending outbox jobs referencing that media ID before enqueueing.

**Database & Queue Interfaces**
- **MongoDB Ops**:
  - `schedules` collection: CRUD on user preference documents.
  - `jobs_outbox` collection: Atomic insert of job records; update to `enqueued` status after successful `XADD`; index on `(status, outboxCreatedAt)` for reconciliation queries.
  - `job_templates` collection: Read-only lookup for reusable caption/hashtag templates.
- **Redis Streams Queue**:
  - `XADD publish:jobs:{partition} * ...` — Writes the job payload. Stream keys are partitioned by `userId % N` to prevent hot-key contention.
  - `XLEN publish:jobs:{partition}` — Monitored during evaluation to apply back-pressure if stream depth exceeds a safe threshold.
- **Redis Cache**:
  - `SETNX sched:lock:{userId}:{slotHash} 1 EX 300` — Acquires a 5-minute scheduling lock per user slot.
  - `GET / SET sched:prefs:{userId}` — Caches deserialized preference objects with a 5-second TTL to reduce MongoDB read load during cron sweeps.
  - `ZADD sched:next-run ...` — Optional sorted set tracking next expected evaluation timestamps for observability.

### Data Owned

- **Schedule Definitions** (`schedules` in MongoDB):
  - `userId`, `platforms` (array: `twitter`, `instagram`, `linkedin`, etc.), `frequency` (object with `count` and `period`: `day`/`week`), `timeWindows` (array of UTC cron expressions or `{hour, minute}` tuples), `mediaType` (`photo`, `video`, `mixed`), `captionTemplate` (string with placeholders), `hashtagSets` (array of string arrays rotated per post), `timezone` (IANA string), `accountPreferences` (platform-specific overrides), `isActive` (boolean), `lastEvaluatedAt` (Date), `updatedAt` (Date).
- **Job Outbox** (`jobs_outbox` in MongoDB):
  - `_id` (UUID v4 serving as `jobId`), `userId`, `scheduleId`, `payload` (normalized JSON: `{platforms, mediaId, caption, hashtags, publishAt}`), `status` (`pending`, `enqueued`, `processing`, `completed`, `failed`), `outboxCreatedAt` (Date), `enqueuedAt` (Date, nullable), `streamMessageId` (string, nullable), `retryCount` (number).
- **Job Templates** (`job_templates` in MongoDB):
  - `templateId`, `name`, `captionFormat`, `defaultHashtags`, `mediaPairingRules` (e.g., `1:1` aspect for Instagram), `createdBy` (userId or system).
- **Scheduling Metadata** (Redis Cache):
  - `sched:lock:{userId}:{slotHash}` — Binary lock value with TTL.
  - `sched:prefs:{userId}` — Serialized active preference snapshot.
  - `sched:backpressure` — Global flag (string `1` with TTL) set when stream depth exceeds threshold, causing cron evaluation to skip non-urgent slots.

### Failure Modes

- **Duplicate Job Generation**: If Redis `SETNX` fails due to a network partition or TTL misconfiguration, two scheduler replicas may evaluate the same user slot and insert duplicate outbox records. **Mitigation**: Enforce a unique compound index on `jobs_outbox` for `(userId, slotHash, mediaId)` so MongoDB rejects the second insert; handle `MongoError` code 11000 as a no-op.
- **Outbox Orphans (Split Brain)**: A scheduler pod crashes or is killed after writing to `jobs_outbox` but before executing `XADD`, leaving the record in `pending` indefinitely. **Mitigation**: The reconciliation loop queries `status: pending` where `outboxCreatedAt < Date.now() - 60s` and re-attempts `XADD` using the existing `jobId`; updates `enqueuedAt` and `streamMessageId` only on success.
- **Redis Streams Partition**: If Redis Streams is unreachable, `XADD` throws. The scheduler must not mark the outbox record as `enqueued`. It logs the error, emits a metric, and relies on the reconciliation loop to retry once connectivity is restored. **Risk**: Unbounded pending backlog in MongoDB if Redis is down for extended periods; monitor collection size and alert.
- **Stale Preference Cache**: A user updates their schedule via `PUT /schedules`, but a concurrent cron evaluation reads the old snapshot from Redis. **Mitigation**: The update endpoint calls `DEL sched:prefs:{userId}` immediately after the MongoDB transaction; cron evaluation re-fetches from MongoDB on cache miss. Cache TTL is intentionally short (5s).
- **Agenda.js Stalled Jobs**: Agenda.js jobs can stall if the Node.js event loop is blocked by heavy BSON serialization or a synchronous crypto call during outbox bulk inserts. **Mitigation**: Run Agenda in an isolated process (or container) with no HTTP handlers; cap Agenda concurrency to `1` for the evaluation job type; expose a `/health` endpoint that fails if the last `lastEvaluatedAt` timestamp is older than `2 * evaluationInterval`.
- **Clock Skew Across Replicas**: If scheduler pods run on nodes with divergent system clocks, cron windows may be evaluated too early or too late. **Mitigation**: Evaluation windows are defined as 5-minute buckets rather than exact seconds; all `publishAt` timestamps are computed in UTC; pods run NTP synchronization checks on startup.
- **Back-pressure Ignorance**: During a platform API outage, `job_worker` consumption slows, Redis Streams depth grows, and the scheduler continues to pump in new jobs, risking OOM on Redis. **Mitigation**: Before each cron sweep, the scheduler checks `XLEN` on all stream partitions; if any exceeds 10,000 messages, it sets `sched:backpressure`, skips non-urgent future slots, and alerts.

### Scaling Considerations

- **Horizontal Pod Scaling**: HTTP handlers (`/schedules/*`) are stateless and scale horizontally behind the API Gateway without restriction. The Agenda.js cron evaluator, however, must run as a singleton or with shard-aware coordination to avoid duplicate evaluations. **Approach**: Deploy a dedicated `scheduler-cron` replica set with exactly one active leader selected via Redis Redlock; if the leader fails, another pod acquires the lock within 30 seconds.
- **MongoDB Write Shaping**: During peak cron windows (e.g., top of the hour), thousands of users become due simultaneously. Use bulk writes (`insertMany` with `ordered: false`) into `jobs_outbox` to reduce round-trips. The unique index on `(userId, slotHash, mediaId)` handles collisions safely.
- **Redis Stream Partitioning**: A single stream key (`publish:jobs`) would bottleneck both the scheduler (writers) and `job_worker` consumers. Partition into `publish:jobs:0` through `publish:jobs:15` using `userId` hash routing. This allows the scheduler to stripe writes and lets `job_worker` deploy consumer groups per partition.
- **Cache Key Cardinality**: Scheduling locks are high-cardinality (active users × time slots). Redis memory can fragment if keys are retained too long. **Policy**: TTL locks at 300 seconds (2× the cron interval) and use `sched:lock:{userId}:{slotHash}` where `slotHash` is a truncated HMAC to keep key length bounded.
- **Outbox Query Performance**: The reconciliation loop performs a range query on `(status, outboxCreatedAt)`. Ensure this is a covered query or backed by a partial index on `status: pending` to avoid collection scans as the outbox grows.
- **Evaluation Frequency vs. Precision**: Evaluating every minute increases accuracy but multiplies MongoDB reads. For users with daily frequency, evaluate only every 5 minutes and compute whether any slot falls within the elapsed window. This amortizes read cost without materially affecting post timing.

## Related Diagrams

- `diagrams/0350/iter4_component-scheduler-service.mmd`