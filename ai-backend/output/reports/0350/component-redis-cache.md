# Redis Cache

## Responsibilities

- **Hot Data Cache**: Stores frequently accessed data to reduce read load on MongoDB Ops and the Token Vault.
- **Distributed State Store**: Maintains shared, mutable state across horizontally scaled Node.js/Express instances, specifically rate-limit token buckets and circuit breaker health states.
- **Temporary OAuth State**: Holds short-lived authorization flow nonces, PKCE code verifiers, and correlation IDs during social platform OAuth handshakes.
- **Presigned URL Index**: Caches temporary object-storage access URLs so the Media Service and Media Processor avoid redundant signature generation.
- **Session Backing Store**: Provides server-side session storage for the Auth Service’s Express-based session management.
- **Explicitly Not**: A durable job queue (see Redis Streams Queue), a primary database, or a long-term secrets vault. All data in this cache is ephemeral and mastered elsewhere.

## Data Ownership

Redis owns TTL-bound, denormalized copies of data whose source of truth resides in other components. It does not own durable records.

| Keyspace | Data Structure | Source of Truth | TTL Strategy |
|---|---|---|---|
| `token:{platform}:{userId}` | String (encrypted blob or reference) | Token Vault | 5–15 minutes, refreshed on active use |
| `session:{sid}` | Hash | Auth Service / MongoDB Ops | 24 hours with sliding expiration |
| `oauth:state:{nonce}` | String | Auth Service (transient) | 10 minutes |
| `user:pref:{userId}` | Hash | MongoDB Ops | 1 hour, explicitly invalidated on upstream mutation |
| `presign:{mediaId}:{variant}` | String | Object Storage / Media Service | 5–10 minutes (shorter than underlying URL expiry) |
| `ratelimit:{platform}:{accountId}` | Hash or String | Rate Limiter (derived) | Rolling window equal to platform rate-limit interval |
| `cb:{platform}` | Hash | Circuit Breaker | Duration of the configured circuit timeout |
| `lock:{resource}` | String | Distributed Lock | 10–30 seconds |

## APIs and Interfaces

Redis Cache exposes no public REST or gRPC API. Internal services interact via Redis commands using `ioredis` clients following platform-wide conventions.

### Connection Contract

- **Client Library**: `ioredis` with Cluster mode enabled.
- **Connection Pooling**: Each Node.js service maintains a dedicated connection pool sized to its concurrency (default max 20 connections per instance).
- **Serialization**: JSON stringification for complex values; base64 encoding for binary token blobs.
- **Key Prefixing**: All keys are prefixed with an environment namespace (`prod:`, `staging:`) to prevent cross-environment collisions.

### Core Operations

| Pattern | Command Family | Consumers |
|---|---|---|
| Token replica read/write | `GET` / `SET` / `EXPIRE` | Auth Service, Token Vault, Publisher Service |
| Session CRUD | `HGETALL` / `HMSET` / `EXPIRE` / `DEL` | Auth Service |
| OAuth state insertion/lookup | `SET` `NX` `EX` / `GET` / `DEL` | Auth Service |
| Preference cache | `HGETALL` / `HMSET` / `HDEL` | Scheduler Service, Job Worker |
| Presigned URL cache | `GET` / `SET` `EX` | Media Service, Media Processor |
| Rate limit buckets | `HINCRBY` / `HGET` / `EXPIRE` | Rate Limiter, Publisher Service |
| Circuit breaker state | `HSET` / `HGETALL` | Circuit Breaker, Publisher Service |
| Distributed locks | `SET` `NX` `EX` / `DEL` (Lua-checked) | Job Worker, Media Processor, Token Vault |

### Cache Invalidation Hooks

Services must synchronously or asynchronously invalidate Redis entries when mastering data changes. The preferred mechanism is an application-level invalidation message published to `cache:invalidate:{type}:{id}`, consumed by all service instances to purge local and remote cache entries. Direct `DEL`/`UNLINK` is permitted for synchronous invalidation paths.

## Failure Modes

### Cache Stampede on Hot Keys
High-traffic user preference hashes (`user:pref:{userId}`) or viral media presigned URLs can attract concurrent requests during TTL expiry, causing multiple Node.js workers to simultaneously recompute expensive values. **Mitigation**: Apply probabilistic early expiration (jittered TTLs) or Lua-scripted per-key recomputation locks.

### Memory Eviction of Critical State
If Redis reaches `maxmemory` and evicts keys, rate limit counters or circuit breaker states may disappear, causing burst traffic to platform APIs or delayed failure detection. **Mitigation**: Configure `maxmemory-policy volatile-lru` with explicit TTLs on all cache-only keys; isolate critical state to a dedicated Redis logical database or separate cluster with appropriate persistence/replication policies.

### Token Exposure via Cache
OAuth tokens cached for fast access by the Publisher Service are high-value secrets. **Mitigation**: Token values must be encrypted at the application layer (using the Token Vault’s encryption scheme) before storage; Redis runs in a private subnet with TLS in transit and Redis AUTH enabled; plaintext access tokens are never stored.

### Split-Brain in Cluster Mode
Network partitions in Redis Cluster can stall key migrations or create transient dual-master scenarios. **Mitigation**: Use properly configured Redis Cluster with `cluster-require-full-coverage no`; clients must gracefully handle `MOVED` and `ASK` redirections. For smaller footprints, Redis Sentinel can be used with explicit failover handling.

### Thundering Herd on Token Refresh
When a cached OAuth token expires, many concurrent Job Workers or Publisher Service instances may simultaneously request a refresh from the Auth Service and Token Vault. **Mitigation**: Implement a per-token refresh lock (`lock:token:{userId}`) so only one instance performs the vault refresh; others wait or temporarily use a stale-while-revalidate value.

## Scaling Considerations

### Horizontal Scaling via Cluster Mode
Redis Cache runs as a Redis Cluster (minimum 3 master nodes + 3 replicas) to distribute keyspaces across 16,384 hash slots. Rate limit counters for the same platform/account must map to the same hash slot; use Redis hash tags (e.g., `ratelimit:{platform}:{accountId}` where `{platform}` is the tag) to ensure key locality and avoid cross-slot multi-key operation errors.

### Read Replica Offloading
Presigned URL and user preference reads can be served from read replicas. Write-heavy keyspaces—rate limit counters and circuit breaker state—must target the master node.

### Connection Multiplexing
Node.js services use `ioredis` with `enableOfflineQueue: false` and `lazyConnect: true` to prevent event-loop blocking during cluster topology changes. Pipelining is used for batch invalidations and preference field updates.

### Memory Optimization
- User preference hashes should exclude large historical arrays (e.g., past hashtag sets); store only active scheduling parameters.
- Presigned URL strings are typically 500+ bytes; keep TTL aggressive (≤ 50% of the underlying signature validity) to control churn.
- Enable active memory defragmentation (`activedefrag yes`) on instances with datasets larger than 8 GB.

### Separation of Concerns
Redis Cache is strictly segregated from `redis_streams_queue`. They run on independent clusters with different persistence, memory, and failover policies. This prevents queue backpressure or stream growth from evicting hot cache data or destabilizing the operational cache tier.

## Related Diagrams

No paired diagram was provided for this component.