# ADR-001: Redis Streams as the Dedicated Job Queue for Publish and Media Processing

**Status:** Accepted  
**Scope:** Cross-cutting — affects `scheduler_service`, `job_worker`, `media_processor`, and `redis_cache` infrastructure.

## Context

The social media automation platform must schedule and execute background jobs for two high-volume pipelines:

1. **Publish pipeline** — preparing and posting photos/videos to connected social platforms (Instagram, Twitter, LinkedIn, etc.) based on user-defined preferences (frequency, captions, hashtags, time slots).
2. **Media processing pipeline** — CPU-bound FFmpeg transcoding of user uploads before they enter the publish pipeline.

Initial requirements mentioned Agenda.js for background job management. However, Agenda.js stores job state in MongoDB and relies on collection polling. At scale, this couples queue throughput to the operational `mongodb_ops` cluster, creates write contention on job documents, and does not natively support horizontally balanced consumers or per-user concurrency limits.

Redis is already a required system component (`redis_cache`, `rate_limiter`, `token_vault`). Redis Streams provides append-only log semantics, consumer groups, and pending-entry-list (PEL) tracking without introducing a separate message broker (e.g., RabbitMQ, Kafka, SQS).

## Decision

Adopt **Redis Streams** as the canonical, MongoDB-decoupled job queue for all user-facing background work.

- **Agenda.js is excluded** from the hot-path publish and media-processing pipelines. It may be retained only for low-frequency, non-user-facing cron triggers (e.g., nightly preference reconciliation) if absolutely necessary.
- **Stream topology**:
  - `stream:publish` — consumed by `job_worker` for social media publish tasks.
  - `stream:media-process` — consumed by `media_processor` for FFmpeg transcoding.
- **Scheduler integration** — `scheduler_service` persists job intent in MongoDB via the Outbox pattern, then writes the job command to the appropriate Redis Stream only after the outbox transaction commits.
- **Consumer groups** — `job_worker` and `media_processor` join named consumer groups so Redis auto-balances entries across horizontally scaled instances and tracks unacknowledged work in the PEL.

## Consequences

**Positive:**
- Enqueue/dequeue latency is sub-millisecond; no MongoDB polling overhead.
- Native horizontal scaling via consumer groups — add worker pods without partition rebalancing logic.
- Reuses existing Redis infrastructure; no new broker operational overhead.
- Stream commands (`XREADGROUP`, `XACK`, `XCLAIM`, `XPENDING`) integrate directly with Node.js Redis clients (ioredis).

**Negative:**
- Redis is memory-bound; unbounded streams can trigger OOM.
- No built-in dead-letter exchange — must be implemented manually.
- Durability depends on Redis persistence configuration (AOF/RDB); stream data is not as durably committed as MongoDB documents by default.
- Requires explicit stream trimming (`MAXLEN`, `XTRIM`) to prevent unbounded growth.

## Responsibilities

- **Stream durability** — Retain job entries until explicitly acknowledged or moved to a dead-letter stream.
- **Ordering** — Provide approximate FIFO ordering within a single stream key. No global ordering guarantee across `stream:publish` and `stream:media-process`.
- **Consumer coordination** — Track last-delivered IDs, consumer names, and idle times per consumer group.
- **Decoupling** — Isolate queue state from `mongodb_ops` and `object_storage`; the stream owns only job commands and metadata, never media bytes.

## APIs / Interfaces

### Producer (`scheduler_service` → Redis)
```javascript
XADD stream:publish MAXLEN ~ 500000 * \
  jobId "job_abc123" \
  userId "u_987" \
  platform "instagram" \
  mediaObjectKey "processed/u_987/vid_001.mp4" \
  caption "Launch day!" \
  hashtags "#startup" \
  idempotencyKey "idem_abc123" \
  scheduledAt "2024-01-15T09:00:00Z"
```

### Consumer (`job_worker` / `media_processor` → Redis)
```javascript
// Blocking read for next unclaimed entry
XREADGROUP GROUP publish_workers worker_1 COUNT 1 BLOCK 5000 STREAMS stream:publish >

// Successful completion
XACK stream:publish publish_workers 1705312345678-0

// Failure / retry with visibility timeout
XCLAIM stream:publish publish_workers worker_1 600000 1705312345678-0
```

### Observability & Admin
```javascript
// Inspect backlog and stalled jobs
XPENDING stream:publish publish_workers
XINFO GROUPS stream:publish
XLEN stream:publish
```

## Data It Owns

- **Job command payloads** — Immutable field maps containing:
  - `jobId`, `userId`, `platform`
  - `mediaObjectKey` (reference to `object_storage`, never base64 media)
  - `caption`, `hashtags`
  - `idempotencyKey` (for deduplication and exactly-once publish semantics)
  - `scheduledAt`, `retryCount`
- **Consumer group metadata** — Group name, last delivered ID, registered consumer IDs, idle timestamps.
- **Pending Entries List (PEL)** — Entries read by a consumer but not yet acknowledged.
- **Dead-letter streams** — `stream:publish:dlq` and `stream:media-process:dlq` holding jobs that exceeded the maximum delivery threshold.

## Failure Modes

| Scenario | System Impact | Mitigation |
|---|---|---|
| **Redis node failure / failover** | Enqueue and dequeue pause; PEL entries temporarily unavailable | Deploy Redis Sentinel or Redis Cluster for HA; producers implement short-term buffering with exponential backoff; workers reconnect automatically |
| **Worker crash mid-processing** | Job remains in PEL; not lost but stalled until reclaimed | Idle entry reaping: after 10 minutes idle, another worker claims the entry via `XCLAIM` |
| **Poison message / malformed payload** | Worker crashes on every delivery attempt | Max delivery count = 3; on exceed, `XADD` entry to DLQ and emit operational alert; do not re-insert into source stream |
| **Stream unbounded growth** | Redis memory exhaustion, eviction of unconsumed jobs | `MAXLEN ~` on every `XADD` (approximate cap: 500k entries for publish, 100k for media); nightly `XTRIM` reconciliation if needed |
| **Per-user concurrency semaphore leak** | User slots never released, halting their personal queue | Semaphore keys (e.g., `concurrency:u_987`) use Redis TTL = 2× max job duration; `job_worker` releases semaphore atomically in a Lua script on `XACK` |
| **Scheduler outbox drift** | MongoDB committed job record but missing stream entry | `scheduler_service` runs a reconciliation scan every 60s on `scheduledJobs` collection where `streamEnqueued: false` |

## Scaling Considerations

- **Horizontal worker scaling** — Add `job_worker` or `media_processor` pods; Redis consumer groups automatically shard stream entries across consumers. No partition assignment logic is required in application code.
- **Pipeline isolation** — `stream:publish` and `stream:media-process` are separate keys so CPU-heavy FFmpeg workers cannot starve lightweight HTTP publish jobs. Each stream can be scaled and trimmed independently.
- **Payload size discipline** — Stream entries must reference S3 `object_storage` keys and CDN URLs. Keep entries under 1 KB. Never embed base64 media or long caption strings; store captions in `mongodb_ops` and reference them by `jobId`.
- **Memory sizing** — Size Redis memory at 2× projected peak stream depth. For example, 500,000 publish entries at ~500 bytes each ≈ 250 MB per stream, plus PEL and consumer overhead.
- **Rate-limit back-pressure** — Before calling `publisher_service`, `job_worker` consults the `rate_limiter` (distributed token bucket in Redis). If the platform API quota is exhausted, the worker does not acknowledge the job; it releases the claim so the entry remains in the stream for retry after the bucket refills. This prevents draining the stream into failed API calls.
- **Cross-region** — In a multi-region deployment, use Redis Cluster in the primary region or implement deduplication via `idempotencyKey` to guard against duplicate enqueues during failover. Stream entries should be treated as idempotent commands.

## Related Diagrams
- `diagrams/0350/iter4_overview.mmd`