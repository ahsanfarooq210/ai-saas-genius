## Overview

The Job Worker is a horizontally scalable, stateless consumer process that executes the publish-ready tasks enqueued by the `scheduler_service` in the `redis_streams_queue`. It serves as the execution engine of the automation platform, enforcing per-user concurrency limits to prevent individual accounts from monopolizing worker capacity or overwhelming downstream social media APIs. The worker orchestrates media preparation via the `media_processor`, retrieves OAuth credentials from the `token_vault`, and delegates platform-specific publication to the `publisher_service`.

## Responsibilities

- **Stream Consumption**: Joins a Redis Streams consumer group to claim publish jobs via `XREADGROUP`, using blocking reads with configurable batch sizes.
- **Concurrency Enforcement**: Maintains per-user in-flight job counters in `redis_cache` using atomic Redis operations (Lua scripts or `INCR`/`DECR` with `WATCH`) to ensure a single user never exceeds their allocated parallel job limit.
- **Media Orchestration**: Evaluates whether a job requires CPU-bound transcoding. If so, it submits work to the `media_processor` and correlates the response using a `mediaJobId` before proceeding.
- **Credential Resolution**: Retrieves decrypted platform OAuth tokens from the `token_vault` on a per-job basis; it does not persist tokens locally.
- **Publication Delegation**: Invokes the `publisher_service` with an idempotency key, platform target, processed media URL, caption, and hashtags.
- **Job State Management**: Drives the lifecycle from `claimed` → `processing` → `completed`, `failed`, or `dead-letter`, updating transient state in Redis and acknowledging (`XACK`) or reclaiming (`XCLAIM`) stream entries accordingly.
- **Idempotency Guard**: Checks a Redis idempotency set (`job_worker:idempotency:{jobId}`) before executing publication to prevent duplicate posts during consumer rebalances or retries.
- **Observability**: Exposes Prometheus-compatible metrics for job throughput, per-user latency, retry rates, and stream pending entry depth to drive autoscaling.

## APIs and Interfaces

### Internal Consumer Interface (Redis Streams)
- **Consumer Group**: `publish_jobs_group` on the `redis_streams_queue` stream.
- **Claim**: `XREADGROUP GROUP publish_workers {workerId} BLOCK 5000 COUNT 10 STREAMS publish_jobs >`
- **Acknowledge**: `XACK publish_jobs {messageId}` upon successful publication.
- **Retry / Reclaim**: Uses `XPENDING` followed by `XCLAIM` to take over stalled jobs from dead consumers after a visibility timeout (default 5 minutes).
- **Dead-letter**: Moves entries exceeding max retries to `publish_jobs:dlq` via `XADD` and `XDEL`.

### Media Processor Interface
- **Request**: HTTP/gRPC call to `media_processor` with `userId`, `mediaObjectKey`, `targetPlatform`, `requiredFormat`, and `outputQuality`.
- **Response Correlation**: Worker polls a Redis key (`media_job:{mediaJobId}:status`) or receives a webhook callback. Timeout: 60 seconds for images, 300 seconds for video.

### Publisher Service Interface
- **Request**: `POST /internal/publish` with payload:
  ```json
  {
    "userId": "string",
    "platform": "instagram|twitter|linkedin|tiktok",
    "mediaUrls": ["string"],
    "caption": "string",
    "hashtags": ["string"],
    "idempotencyKey": "uuid-v4",
    "scheduledAt": "ISO-8601"
  }
  ```
- **Response**: `202 Accepted` with `publishJobId`, or `429`/`503` for rate-limit / circuit-breaker events.

### Token Vault Interface
- **Request**: `GET /internal/tokens/{userId}/{platform}` with mTLS client certificate.
- **Response**: Decrypted access token, refresh token, and expiry timestamp.

### Redis Cache Interface
- `INCR job_worker:user:{userId}:inflight` / `DECR` on completion.
- `SET job_worker:idempotency:{jobId} 1 EX 3600` for duplicate suppression.
- `SET job_worker:worker:{workerId}:heartbeat {timestamp} EX 30` for liveness tracking.

### Control Plane
- `GET /health`: Liveness probe for Kubernetes. Returns 200 if event loop is responsive.
- `GET /ready`: Readiness probe. Returns 200 only if Redis connection is active and consumer group membership is confirmed.
- `GET /metrics`: Prometheus exposition format with counters for `jobs_completed_total`, `jobs_failed_total`, `jobs_retried_total`, and histogram `job_duration_seconds`.

## Data Ownership

The Job Worker does not own persistent operational data; all durable user and content metadata resides in `mongodb_ops`. It owns transient execution state:

| Data | Storage | Purpose |
|------|---------|---------|
| Per-user in-flight counters | `redis_cache` | Enforce `maxConcurrentJobsPerUser` (e.g., 3) |
| Idempotency tokens | `redis_cache` | Prevent duplicate publishes (TTL: 1 hour) |
| Worker heartbeats | `redis_cache` | Enable detection of crashed consumers for `XCLAIM` |
| Job retry counts | `redis_cache` or stream entry metadata | Track attempts before dead-lettering |
| Dead-letter context | `redis_streams_queue` (DLQ stream) or `mongodb_ops` | Structured failure logs for manual replay |

## Job Lifecycle

1. **Claim**: Worker issues `XREADGROUP`. If the stream returns an entry, it atomically increments the user's in-flight counter. If the counter exceeds the limit, the worker issues `XACK` (or leaves unacknowledged based on strategy) and skips to the next user's jobs.
2. **Validate**: Schema-validate the payload. If invalid, move immediately to DLQ. If valid, check `job_worker:idempotency:{jobId}` in Redis.
3. **Media Resolution**: If `mediaStatus` is `pending_processing`, enqueue to `media_processor` and block until `mediaStatus` transitions to `ready` in Redis or via callback.
4. **Token Fetch**: Call `token_vault`. On failure, decrement inflight counter and release the job back to the stream for retry.
5. **Publish**: Call `publisher_service`. 
   - **Success (2xx)**: `XACK` the stream entry, decrement inflight counter, delete idempotency key.
   - **Retryable Failure (5xx, timeout, rate limit)**: Leave entry pending (or `XCLAIM` with new owner), increment retry counter, decrement inflight counter.
   - **Terminal Failure (auth revoked, malformed media)**: `XACK` original entry, `XADD` to DLQ, decrement inflight counter.
6. **Dead-letter**: After 3 retry attempts or 15 minutes in pending state, the job is moved to `publish_jobs:dlq` with metadata: `lastError`, `attemptTimestamps[]`, `originalStreamId`.

## Failure Modes and Mitigation

- **Redis Streams Partition / Consumer Rebalance**: If a worker pod crashes, its pending messages remain in `XPENDING`. Surviving workers run a background task every 30 seconds to `XCLAIM` entries whose idle time exceeds the 5-minute visibility timeout.
- **Per-user Concurrency Exhaustion**: A power user scheduling 1,000 posts could clog the queue. Mitigation: The worker uses a best-effort skip strategy—if `INCR` returns a value above the limit, the worker immediately `DECR` and does not claim that specific message, allowing other users' jobs to be processed. A fair-scheduling variant can use a round-robin claim across user IDs.
- **Media Processor Timeout**: If transcoding exceeds the deadline, the worker releases the concurrency slot and re-enqueues the job with a `RETRYCOUNT` increment. After 3 failures, it dead-letters the job and notifies the user via the `user_service` (async outbox).
- **Token Vault Unavailability**: Short-term unavailability triggers a retry with exponential backoff. If the vault returns a 404 (token revoked/deleted), the job is terminal-failed to avoid infinite loops.
- **Publisher Service Circuit Breaker Open**: The worker detects `503 Circuit Open` responses. It pauses claiming jobs for that specific platform by checking a `circuit_breaker` flag in `redis_cache`, preserving capacity for platforms that are healthy.
- **Poison Pill (Malformed Payload)**: JSON schema validation fails at claim time. The entry is immediately `XACK`ed and written to the DLQ with a `MALFORMED_PAYLOAD` reason, preventing infinite retry loops.
- **Split-Brain Concurrency Violation**: During a network partition, two workers might simultaneously increment a user's counter. Mitigation: Use a Redis Lua script that atomically checks the current value against the limit before incrementing, or use a Redis distributed lock (`SET NX EX`) per `userId` during the claim phase.

## Scaling Considerations

- **Horizontal Pod Autoscaling**: Workers should scale on a custom metric—`redis_streams_pending_entries` for the `publish_jobs_group`—rather than CPU. Target: 1 worker pod per 100 pending entries, with a minimum of 2 pods for availability.
- **Per-User Concurrency as a Bottleneck**: Because each user has a fixed parallel job cap (e.g., 3), total system throughput is bounded by `activeUsers × maxConcurrency`. Capacity planning must ensure worker count × batch size does not exceed the aggregate concurrency budget, or workers will waste cycles attempting to claim blocked jobs.
- **Resource Profile**: Workers are I/O-bound (Redis, HTTP to vault/publisher). Allocate 0.5 vCPU and 512 MiB memory baseline. Increase memory if batch sizes exceed 50 messages per `XREADGROUP` call to accommodate buffered HTTP request bodies.
- **Connection Management**: 
  - Redis: Use a single shared client per worker process with connection pooling (min 2, max 10 connections).
  - HTTP: Keep-alive pools to `publisher_service` and `token_vault` with a max of 50 sockets per host.
- **Backpressure**: If `publisher_service` p99 latency exceeds 2 seconds, workers should reduce `COUNT` in `XREADGROUP` from 10 to 2 and increase blocking timeout to reduce memory pressure from accumulated in-flight promises.
- **Graceful Shutdown**: On `SIGTERM`, the worker:
  1. Stops the `XREADGROUP` polling loop.
  2. Waits up to 30 seconds for in-flight jobs to complete and `XACK`.
  3. Closes Redis and HTTP connections.
  4. Exits. Unacknowledged jobs remain in `XPENDING` for other workers to reclaim.

## Related Diagrams

No paired diagram was provided for this document.