## component-rate-limiter

### Responsibilities

- Enforce distributed token bucket rate limits for every outbound request to external `platform_apis`, scoped per social platform and per connected user account.
- Protect platform API quotas (e.g., Instagram Graph API, X API, TikTok Publishing API) from exhaustion caused by concurrent `job_worker` and `publisher_service` instances.
- Provide synchronous `ALLOW` / `DENY` decisions with sub-10 ms latency to prevent publish jobs from blocking on slow platform handshakes.
- Support variable request costs: assign higher token costs to expensive operations such as video uploads or carousel posts versus simple text status updates.
- Coordinate atomic token bucket state updates via `redis_cache` using server-side Lua scripts to eliminate race conditions during concurrent refill and acquisition.
- Emit structured limit metadata (remaining tokens, reset timestamp, retry-after) to upstream callers so `publisher_service` can apply precise back-off scheduling.
- Maintain platform-specific default configurations (bucket capacity, refill rate per second) that are applied when a user first connects an account.

### APIs / Interfaces

**Internal Service Interface (Node.js module consumed by `publisher_service` and `job_worker`)**

| Method | Signature | Description |
|--------|-----------|-------------|
| `acquireTokens` | `async (platform: string, accountId: string, cost: number = 1): Promise<AcquireResult>` | Atomically deducts `cost` tokens if available. Returns `allowed`, `remainingTokens`, `resetAt`, and `retryAfterMs`. |
| `peekStatus` | `async (platform: string, accountId: string): Promise<BucketStatus>` | Returns current bucket state without modifying it. Used for pre-flight checks and dashboard metrics. |
| `updateConfig` | `async (platform: string, accountId: string, config: BucketConfig): Promise<void>` | Overrides bucket capacity and refill rate for a specific account. Invoked during onboarding or admin intervention. |
| `releaseReservation` | `async (platform: string, accountId: string, cost: number): Promise<void>` | Returns reserved tokens to the bucket when a publish operation fails before reaching the platform API (e.g., network timeout), preventing artificial quota drain. |

**Redis Lua Script Interface**

- `EVALSHA <sha1> 1 rl:tokens:{platform}:{accountId} <cost> <capacity> <refillRatePerSec> <refillIntervalMs> <redisServerTimeMs>`
  - Atomically calculates elapsed time since last refill, adds tokens up to `capacity`, deducts `cost`, and updates the last-refill timestamp.
  - Returns an array: `[allowedBool, remainingTokens, newLastRefillMs]`.
- All timestamp dependencies use `TIME` returned by the Redis server to avoid clock skew between Node.js instances.

### Data Owned

All state is ephemeral and stored exclusively in `redis_cache`. No documents are persisted to `mongodb_ops`.

- **`rl:tokens:{platform}:{accountId}`** (Redis Hash)
  - `remaining`: float/string representing current token count.
  - `lastRefill`: Unix timestamp in milliseconds of the last successful refill.
  - TTL: 24 hours after last write; inactive accounts automatically shed state.
- **`rl:config:{platform}:{accountId}`** (Redis Hash)
  - `capacity`: maximum tokens the bucket can hold (burst size).
  - `refillRate`: tokens added per second.
  - `defaultCost`: baseline cost for a standard publish operation.
  - TTL: 7 days or until explicitly overwritten.
- **`rl:global:{platform}`** (Redis String / Hash, optional)
  - Tracks application-wide platform limits when the external API imposes a shared quota across all accounts (e.g., Meta Business-use rate limits).
  - Updated via a separate atomic decrement script to avoid hot-key contention with per-account keys.

### Failure Modes

- **Redis Unavailability**
  - If `redis_cache` is unreachable, the limiter cannot safely evaluate quota. It fails **closed** (`allowed: false`) to prevent platform ban risk.
  - To avoid total pipeline stall, `publisher_service` may consult a short-lived in-memory LRU fallback (5-second TTL) containing the last known bucket state, but only for read-only `peekStatus`; `acquireTokens` still requires Redis confirmation.
- **Clock Skew**
  - Node.js application clocks drifting relative to each other can cause incorrect refill calculations. Mitigated by exclusively using `redis.call('TIME')` inside Lua scripts.
- **Hot-Key Contention**
  - Viral accounts or platform-wide global limits can concentrate load on a single Redis key. Mitigated by:
    - Hash-tagging keys with `{accountId}` to ensure slot locality in Redis Cluster without cross-slot Lua restrictions.
    - For global limits, applying a sharded counter pattern (e.g., 10 sub-keys `rl:global:{platform}:0..9` summed at check time) to distribute writes.
- **Key Eviction Under Memory Pressure**
  - If Redis reaches `maxmemory` and evicts rate limit keys, buckets reset to full capacity, risking a quota burst. Mitigated by:
    - Setting explicit TTLs on all keys so Redis can use `volatile-lru` eviction.
    - Alerting when memory usage exceeds 80 %.
- **Lua Script Rejection**
  - If a Lua script fails due to a Redis replication conflict or `BUSY` state, the limiter returns `allowed: false` and increments an error metric. `job_worker` treats this as a transient failure and re-queues the job with exponential back-off.
- **Misaligned Platform Limits**
  - If a platform silently lowers its API quota, the local token bucket may still admit requests that the platform rejects. The limiter consumes platform `429` responses reported by `publisher_service` and auto-tightens the local refill rate via a proportional controller (decrease refill rate by 10 % per 429 spike).

### Scaling Considerations

- **Stateless Horizontal Scaling**
  - The rate limiter logic is entirely stateless; any Node.js process can execute the Lua scripts against `redis_cache`. `publisher_service` and `job_worker` pods can scale independently without limiter configuration changes.
- **Redis Cluster Topology**
  - All keys for a given `(platform, accountId)` pair use a consistent hash tag (e.g., `rl:tokens:{platform}:{accountId}`) to guarantee they reside in the same Redis Cluster slot, enabling atomic multi-key Lua operations.
- **Pipelining and Batching**
  - `job_worker` can pipeline `acquireTokens` checks for the next N jobs in its local queue, reducing per-request Redis round-trips from N to 1.
- **Local Config Cache**
  - `BucketConfig` values change infrequently. Each `publisher_service` instance caches configs in an in-memory LRU (TTL 60 s) to avoid redundant Redis `HGET` calls on every `peekStatus`.
- **Metric Cardinality Control**
  - Per-account metrics are aggregated into platform-level histograms at runtime. High-cardinality labels (raw `accountId`) are logged to structured logs, not exported to Prometheus counters, to prevent TSDB overload.
- **Cross-Region Latency**
  - If the platform is deployed across multiple regions, rate limit checks should target a co-located Redis replica. For writes (token acquisition), use the regional Redis primary or employ a CRDT-based counter if using Redis Enterprise; otherwise, accept a small cross-region RTT penalty to maintain global consistency.

## Related Diagrams

No paired diagram was provided for this component.