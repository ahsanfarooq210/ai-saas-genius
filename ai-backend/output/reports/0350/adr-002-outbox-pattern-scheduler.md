# ADR-002: Outbox Pattern and Scheduler Design

## Status
Accepted

## Context
The platform translates user posting preferences—target platforms, frequency, media type, captions, hashtags, and publishing windows—into time-executed publish tasks. User preferences and content metadata are authoritative in MongoDB, while the execution pipeline relies on Redis Streams to decouple job production from the horizontally scalable Job Workers. Writing a schedule record to MongoDB and enqueueing a corresponding job to Redis are independent network operations. Without a transactional bridge, partial failures produce orphaned schedules (MongoDB committed, Redis lost) or phantom jobs (Redis committed, MongoDB rolled back), leading to missed posts or duplicate publishes.

Agenda.js is used inside the Scheduler Service for cron-based firing of recurring schedules, but it does not enqueue directly to Redis. Instead, it acts as a timer that produces domain events into a local outbox.

## Decision
Implement the **Outbox Pattern** inside the Scheduler Service. Every operation that creates or triggers a publish job first writes an outbox event into MongoDB within the same ACID transaction as the schedule update. A dedicated relay process polls the outbox collection and appends entries to Redis Streams. Job Workers consume from those streams. This converts an unsafe dual-write into two sequential, locally retryable steps with exactly-once semantics enforced via idempotency keys.

## Responsibilities

- **Scheduler Service API Layer** (Node.js/Express):
  - Validates user preference updates and computes next-run timestamps.
  - Executes MongoDB multi-document transactions that update `schedules` and insert into `outbox`.
  - Exposes internal endpoints for ad-hoc triggering and schedule mutation.

- **Agenda.js Engine** (embedded in Scheduler Service):
  - Evaluates cron expressions derived from user `postingFrequency` and `publishingTimes`.
  - Fires job handlers that open a MongoDB transaction and write an `outbox` row; it never talks to Redis directly.

- **Outbox Relay** (Scheduler Service background process):
  - Polls the `outbox` collection for rows where `processedAt` is `null`.
  - Transforms each row into a Redis `XADD` command with a deterministic idempotency key.
  - Updates the outbox row with `processedAt` and the returned Redis Stream ID using an atomic find-and-modify.
  - Uses a Redis-based distributed lock (`SCHEDULER_RELAY_LOCK`) to ensure only one relay instance is active across horizontally scaled Scheduler Service pods.

- **Redis Streams Queue**:
  - Owns the durable, ordered job log.
  - Provides consumer groups so Job Workers can scale independently while maintaining per-user concurrency limits.

## Data Owned

- **MongoDB `schedules` collection**:
  - `userId`, `platformTargets` (array of platform IDs), `mediaType` (`photo` | `video`), `captionTemplate`, `hashtagSets`, `frequencyCron`, `timezone`, `nextRunAt`, `isActive`, `updatedAt`.

- **MongoDB `outbox` collection**:
  - `_id`: ObjectId (monotonic for time-ordered polling).
  - `aggregateType`: `"schedule"` | `"post"`.
  - `aggregateId`: UUID referencing the originating schedule or draft post.
  - `eventType`: `"post.publish.requested"`.
  - `payload`: BSON document containing `userId`, `platformIds`, `mediaObjectKeys`, `caption`, `hashtags`, `publishAt`, `idempotencyKey`.
  - `createdAt`: ISODate (indexed).
  - `processedAt`: ISODate | `null` (indexed).
  - `streamId`: string | `null` (Redis Stream ID returned by `XADD`).
  - `retryCount`: integer (default `0`, incremented on transient Redis failures).

- **Redis Streams**:
  - Stream key: `queue:publish:v1` (single stream for all platforms; sharding discussed in Scaling).
  - Entry fields: `jobId`, `payload` (compressed JSON), `idempotencyKey`, `scheduledAt`.

- **Redis Cache (auxiliary)**:
  - Key: `outbox:lock:relay` — Redlock for relay leader election (TTL 10s, renewed every 5s).
  - Key: `idempotency:{key}` — Set for 24h after a Job Worker successfully begins processing.

## Interfaces

- **Internal REST API (Scheduler Service)**:
  - `POST /internal/schedules`
    - Body: schedule definition.
    - Behavior: Opens MongoDB transaction, inserts/updates `schedules`, inserts `outbox` row, commits.
  - `POST /internal/schedules/:id/trigger`
    - Body: optional override payload.
    - Behavior: Immediate outbox insertion with `publishAt` set to `now()`.

- **Agenda.js Job Definition**:
  - Job name: `generate-post-from-schedule`.
    - Data: `scheduleId`, `triggeredAt`.
    - Handler: Loads schedule, resolves media and caption, opens MongoDB transaction, inserts `outbox` row with `eventType: "post.publish.requested"`, commits.

- **Outbox Relay Loop**:
  - Polling query: `db.outbox.find({ processedAt: null }).sort({ createdAt: 1 }).limit(100)`.
  - Redis command: `XADD queue:publish:v1 * jobId <uuid> payload <json> idempotencyKey <key> scheduledAt <iso>`.
  - Confirmation query: `db.outbox.updateOne({ _id: <id>, processedAt: null }, { $set: { processedAt: new Date(), streamId: <redis-id> } })`.

## Failure Modes

- **Relay crash after `XADD` but before MongoDB confirmation**:
  - On restart, the relay re-reads the same outbox row because `processedAt` is still `null`.
  - It attempts `XADD` again with the same payload; Job Workers deduplicate via the `idempotencyKey` stored in Redis (`SET idempotency:<key> 1 EX 86400 NX`).
  - Once the stream entry is confirmed processed by the worker, the idempotency key prevents re-execution.

- **MongoDB transaction abort**:
  - The entire transaction rolls back; no `outbox` row exists. Agenda.js marks the Agenda job as failed and retries based on its configured backoff (`defaultLockLimit: 30s`, `processEvery: 5s`).

- **Redis Streams pressure / memory exhaustion**:
  - `XADD` uses the `MAXLEN ~ 100000` approximate trimming strategy. If the stream exceeds the soft limit, old entries are evicted. Job Workers must acknowledge entries via `XACK` before trimming removes them; unacknowledged entries are preserved by Redis.
  - If `XADD` returns a memory error, the relay halts polling and alerts when outbox lag (difference between `now()` and oldest unprocessed `createdAt`) exceeds 5 minutes.

- **Poison pill in outbox payload**:
  - If deserialization fails in the Job Worker, the worker `XACK`s the entry and writes it to a dead-letter stream `queue:publish:dlq` with the original `streamId` and error metadata. A manual replay API can re-inject corrected events.

- **Agenda.js missed firing due to instance restart**:
  - Agenda.js persists job definitions and last-run times in its own `agendaJobs` collection in MongoDB. On Scheduler Service restart, Agenda re-evaluates overdue jobs and fires them if the lock has expired, preventing silent skips.

- **Clock skew across Scheduler Service nodes**:
  - All `publishAt` and `nextRunAt` values are computed in UTC. Nodes run `ntpd` and health checks fail if drift exceeds 100ms, ensuring Agenda.js and the relay do not schedule jobs into the past or future incorrectly.

## Scaling Considerations

- **Outbox Relay Throughput**:
  - The relay is single-leader to preserve causal ordering per `aggregateId`. It can process approximately 2,000 events/second with a covered index on `{ processedAt: 1, createdAt: 1 }`.
  - If throughput exceeds this, shard the relay by `aggregateId` modulo N using N independent Redis locks (`outbox:lock:relay:0`, `:1`, etc.), each polling a partitioned outbox query (`aggregateId % N == shard`).

- **Redis Streams Partitioning**:
  - A single stream `queue:publish:v1` is sufficient for launch. When platform-specific backpressure or ordering is required, partition into `queue:publish:instagram`, `queue:publish:twitter`, etc. The relay selects the stream key based on the first platform ID in the payload.

- **MongoDB Working Set**:
  - The `outbox` collection receives high write volume. Use a TTL index on `processedAt` (or a nightly cron that moves processed rows to `outbox_archive`) to keep the active working set small and polling latency low.
  - The `agendaJobs` collection grows with recurring schedules; index `nextRunAt` and `lockedAt` as recommended by Agenda.js documentation.

- **Scheduler Service Horizontal Scaling**:
  - The Express API layer scales horizontally without restriction.
  - Agenda.js must run on only one instance. Use the `SCHEDULER_LEADER=true` environment variable on a single pod, or rely on the Redis distributed lock used by the Outbox Relay to colocate Agenda and the relay on the leader pod. Non-leader pods expose the API but do not start Agenda.

- **Redis Cache**:
  - The distributed lock and idempotency keys are low-memory, high-churn entries. Configure Redis with `allkeys-lru` eviction as a safety valve; idempotency keys are ephemeral and safe to evict before TTL because duplicate delivery is only a risk during the 24-hour window after initial scheduling.

## Related Diagrams
- `diagrams/0350/iter4_overview.mmd`