# Platform API Circuit Breaker

## Responsibilities

- **Platform Health Monitoring**: Track real-time availability and error rates for each external social media API endpoint (e.g., Instagram Graph API, X API v2, Facebook Graph API, LinkedIn REST API, TikTok API). Maintain distinct circuit state per platform to isolate failures.
- **Fast Failure Propagation**: When a platform API exhibits sustained errors, immediately fail subsequent publish requests without attempting the network call, preventing thread pool exhaustion in the `publisher_service` and `job_worker` tiers.
- **Automatic Recovery Detection**: Transition circuits from `OPEN` to `HALF-OPEN` after a configurable reset timeout, allowing a controlled number of probe requests to test platform recovery before fully closing the circuit.
- **Distributed State Coordination**: Use `redis_cache` as the single source of truth so that all horizontally scaled `publisher_service` instances share a consistent view of each platform's circuit state.
- **Operational Visibility**: Expose circuit state metrics (trips, failure rates, open duration) to the monitoring stack to trigger pages during extended platform outages.

## APIs and Interfaces

The circuit breaker is implemented as a shared Node.js module consumed by the `publisher_service`. It does not expose a standalone HTTP port; instead, it provides a programmatic interface and Redis-backed storage schema.

### Programmatic Interface (Publisher Service Integration)

```javascript
// Wraps an arbitrary platform API call with circuit breaker logic
await circuitBreaker.execute(
  platform: 'instagram' | 'twitter' | 'facebook' | 'linkedin' | 'tiktok',
  operationId: string,          // idempotency key for the publish attempt
  asyncFn: () => Promise<T>,    // the actual platform API call
  options?: {
    timeoutMs?: number;         // per-call timeout override
    fallback?: () => T;         // synchronous fallback value if OPEN
  }
): Promise<T>
```

- **`execute`**: Checks Redis for the platform's current state. If `CLOSED`, invokes `asyncFn` and records success/failure. If `OPEN`, rejects immediately with `CircuitBreakerOpenError` (HTTP 503 equivalent) or returns `fallback` if provided. If `HALF-OPEN`, permits the call only if the probe quota has not been exhausted.
- **`getState(platform)`**: Returns the current circuit state, failure count, last failure timestamp, and configured thresholds. Used by the publisher service's health check endpoint and operational dashboards.
- **`recordSuccess(platform) / recordFailure(platform)`**: Low-level hooks called by the publisher service when it chooses to manage its own retry loop but still wants to update breaker state.
- **`forceState(platform, state)`**: Admin/ops interface used in runbooks to manually open a circuit during known platform maintenance, or force-close after an incident.

### Redis Storage Schema

All data is stored in `redis_cache` using atomic operations and Lua scripts for state transitions.

| Key | Type | Purpose |
|---|---|---|
| `cb:state:{platform}` | Hash | `state` (OPEN/CLOSED/HALF-OPEN), `failures` (int), `successes` (int), `lastFailure` (unix ms), `openedAt` (unix ms) |
| `cb:config:{platform}` | Hash | `failureThreshold` (int), `resetTimeoutMs` (int), `halfOpenMaxCalls` (int), `probeTimeoutMs` (int) |
| `cb:halfopen:quota:{platform}` | String (integer) | Atomic decrementing counter for probe slots in HALF-OPEN state |

- **State transitions** use a Lua script evaluated on Redis to ensure that `OPEN → HALF-OPEN` resets the failure counter and initializes the probe quota atomically.
- **TTL**: `cb:state:{platform}` keys are set with a TTL of `resetTimeoutMs + 300s` so that abandoned platform circuits do not leak memory. Config keys have no TTL.

## Data Ownership

The circuit breaker owns **transient operational state** only; it is not a system of record.

- **Owned Data**:
  - Per-platform circuit state machine snapshots.
  - Sliding-window failure counters (last N minutes, not historical logs).
  - Probe quotas during half-open recovery.
  - Runtime configuration overrides (e.g., emergency timeout changes pushed via admin API).
- **Not Owned**:
  - OAuth tokens (owned by `token_vault`).
  - Publish job definitions (owned by `redis_streams_queue` and `scheduler_service`).
  - Platform API response payloads (owned by `publisher_service` logs, if retained).
  - Persistent metrics history (owned by the external monitoring/TSDB).

## Failure Modes

| Failure Mode | Impact | Mitigation |
|---|---|---|
| **Redis Unavailability** | Circuit breaker cannot read or update state. Without fallback, publisher instances may blindly hammer a failing platform API, or conversely reject all traffic to healthy platforms. | Module falls back to an in-memory LRU cache per `publisher_service` instance. Writes to Redis are retried asynchronously. If Redis is down for >30s, an alert fires and on-call engineers can enable a "fail-closed" mode (allow all traffic) via env var to prioritize liveness over safety. |
| **Split-Brain State (Replication Lag)** | In a Redis Cluster with replica reads, one publisher instance sees `OPEN` while another sees `CLOSED`, causing inconsistent fast-fail behavior and potential API quota exhaustion. | All circuit breaker reads and writes go to the Redis primary node. Reads are not offloaded to replicas. Lua scripts execute on the primary to guarantee atomicity. |
| **Half-Open Thundering Herd** | When the reset timeout expires, hundreds of publisher workers may simultaneously probe a recovering platform, overwhelming it and re-opening the circuit. | The `HALF-OPEN` transition initializes a Redis-backed semaphore (`cb:halfopen:quota:{platform}`) equal to `halfOpenMaxCalls` (default 3). Each `execute` call atomically decrements the counter; if zero, the request is rejected until the next probe window. |
| **False-Positive Tripping** | A transient blip (e.g., 502 from Instagram for 5 seconds) opens the circuit for the full reset timeout (e.g., 60s), unnecessarily delaying publishes. | Platform-specific defaults require 5 consecutive failures within a 30-second window before tripping. Network timeouts (ETIMEDOUT, ECONNRESET) count as failures; HTTP 429s from the platform are handled by the `rate_limiter`, not the circuit breaker, to avoid conflating rate limits with outages. |
| **Clock Skew on Timeout Calculation** | If `publisher_service` host clocks drift, local comparisons of `lastFailure + resetTimeout` become unreliable, causing premature or delayed state transitions. | The Lua transition script uses `Redis TIME` to calculate elapsed time, not the client clock. |
| **Key Space Pollution** | Creating per-account or per-endpoint circuits (e.g., `cb:state:{userId}:{platform}`) explodes Redis memory and degrades performance. | Keys are strictly per-platform. Per-account isolation is handled upstream by the `rate_limiter`. |

## Scaling Considerations

- **Horizontal Scaling of Publisher Service**: Because state lives in `redis_cache`, adding `publisher_service` replicas does not require sticky sessions or circuit breaker state migration. Throughput scales linearly with Redis primary capacity.
- **Redis Primary Bottleneck**: All state transitions hit the primary. At high publish volume (>10k platform calls/second), Lua script execution CPU on the Redis primary can become the bottleneck. Mitigation: keep Lua scripts O(1); avoid iterating over keys. If needed, shard by platform using Redis Cluster hash tags (`{cb:twitter}:state`, `{cb:instagram}:state`) to distribute primary load across cluster nodes.
- **Latency Overhead**: Each wrapped call incurs 1–2 Redis round-trips (GET state, optional DECR quota). Target p99 overhead < 5ms. Use Redis pipelining when the publisher service batches multiple platform checks.
- **Cold Start / Cache Warming**: New `publisher_service` instances start with an empty local fallback cache. They must fetch state from Redis on the first request; no warm-up phase is required.
- **Observability Cardinality**: Circuit state metrics emit labels for `platform` only (5–10 values). Do not include `accountId` or `jobId` to avoid high cardinality in Prometheus/TSDB.

## Related Diagrams

- `diagrams/0350/iter4_overview.mmd`