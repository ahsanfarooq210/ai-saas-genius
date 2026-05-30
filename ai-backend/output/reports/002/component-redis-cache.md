## Redis Cache

### Responsibilities

- **Active Session Cache**: Stores short-lived session bindings (e.g., JWT ID → userId, roles, connected platform list) to spare MongoDB from auth lookups on every API request.
- **OAuth Token Cache**: Caches encrypted social-media access tokens retrieved by Auth_Service. Publish_Service and Auth_Service read these to sign platform API requests without querying MongoDB.
- **Real-Time Job Status Buffer**: Holds transient, high-churn status updates emitted by Job_Service (`queued`, `processing`, `published`, `failed`) with short TTLs. Consumed by Notification_Service and WebSocket_Gateway for live dashboards.
- **WebSocket Pub/Sub Backbone**: Provides channel pub/sub so horizontally scaled WebSocket_Gateway nodes can broadcast job-completion events to connected clients without direct node-to-node coupling.
- **Rate-Limit & Concurrency Counters**: Optional backing store for API Gateway sliding-window rate-limit counters and Job_Service distributed concurrency locks.

### APIs and Interfaces

- **Wire Protocol**: Redis RESP2/RESP3 over TCP/TLS on port 6379.
- **Node.js Client**: `ioredis` is used across all Express services for cluster awareness, Sentinel support, and connection pooling.

```javascript
const Redis = require('ioredis');
const redis = new Redis.Cluster([
  { host: 'redis-cache-1.internal', port: 6379 },
  { host: 'redis-cache-2.internal', port: 6379 }
], {
  redisOptions: { password: process.env.REDIS_PASSWORD, tls: {} }
});
```

- **Key Schema & Operations**:
  - `sess:{jwtId}` → Hash (`userId`, `scopes`, `platformAccounts`). TTL: 15 minutes. Accessed by API Gateway session middleware via `HGETALL` / `DEL` on logout.
  - `oauth:{provider}:{userId}` → Hash (`accessTokenEnc`, `refreshTokenEnc`, `expiresAt`). TTL: 50–55 minutes (shorter than the platform’s 60-minute token lifetime). Accessed by Auth_Service (`HMSET` on refresh) and Publish_Service (`HGETALL` on publish).
  - `job:status:{agendaJobId}` → Hash (`state`, `progress`, `message`, `updatedAt`). TTL: 24 hours. Written by Job_Service (`HMSET`, `EXPIRE`) and read by Notification_Service (`HGETALL`).
  - `ws:events:{userId}` → Pub/Sub channel. WebSocket_Gateway subscribes (`SUBSCRIBE`); Job_Service and Notification_Service publish (`PUBLISH`) completion alerts.
  - `ratelimit:{clientId}:{endpoint}` → String counter for sliding-window checks. Accessed by API Gateway (`INCR`, `EXPIRE`).

- **Atomic Operations**: Lua scripts (`EVALSHA`) enforce compare-and-set logic during OAuth token refreshes so that concurrent refreshes from Publish_Service and Auth_Service do not overwrite a newer token with an older one.

### Data Ownership

Redis owns **no authoritative business data**; it stores performance-optimized, reconstructible views of data mastered in MongoDB or external platform APIs.

- **Active Sessions**: `sess:*` keys are ephemeral. Loss forces users to re-authenticate; MongoDB stores the underlying account credentials and trust relationships.
- **OAuth Token Cache**: `oauth:*` keys are a read-through cache. Auth_Service decrypts tokens from MongoDB on cold miss and repopulates Redis. The external social platform is the ultimate token authority.
- **Job Status Snapshots**: `job:status:*` keys are operational telemetry. MongoDB (via Agenda_Queue) persists the canonical job definitions and outcomes; Redis holds the live dashboard view.
- **Pub/Sub Backlog**: Fire-and-forget channel messages are not retained. If a WebSocket_Gateway node is offline, it misses the message; Notification_Service must persist critical alerts in MongoDB for later delivery.

### Failure Modes

- **Cold Start / Cache Miss Storm**: If Redis restarts empty, every request hits MongoDB for sessions and OAuth tokens. Mitigation: lazy-load with short-circuit breakers in Auth_Service and API Gateway; pre-warm critical OAuth tokens during failover.
- **Stale OAuth Token Propagation**: A platform token may be refreshed by Auth_Service while Publish_Service reads the old cached version, causing an API rejection. Mitigation: set Redis TTL 5–10% shorter than the platform `expires_in`; use a distributed lock (Redis `Redlock`) around the refresh-write path.
- **Memory Eviction & OOM**: If `maxmemory-policy` is `noeviction`, write operations fail when memory is exhausted, breaking session creation and job status updates. Mitigation: enforce `allkeys-lru` or `volatile-lru`, monitor memory with `used_memory_dataset`, and right-size the cluster before launch.
- **Hot-Key Contention**: A single popular key (e.g., a global rate-limit counter or a celebrity user’s job-status channel) can saturate one Redis hash slot. Mitigation: shard naturally by high-cardinality identifiers (`userId`, `jobId`); avoid global counters in Redis.
- **Replication Split-Brain**: In Redis Sentinel mode, failover can promote a replica with slightly stale data. Reading stale OAuth tokens from a replica may trigger unnecessary refresh loops. Mitigation: route OAuth token reads to the master; allow job-status reads from replicas.
- **Pub/Sub Backpressure**: A burst of job-completion events can overwhelm WebSocket_Gateway subscribers, causing dropped messages. Mitigation: switch high-volume streams to Redis Streams with consumer groups if backpressure becomes routine.

### Scaling Considerations

- **Redis Cluster**: Distribute data across multiple master nodes using hash slots. Keys such as `sess:{uuid}`, `oauth:ig:{userId}`, and `job:status:{ObjectId}` already contain high-cardinality segments and distribute evenly across 16,384 slots without manual hash tags.
- **Workload Separation**: Run two logical Redis topologies:
  1. **Cache Tier** (sessions, OAuth tokens) — optimized for low-latency, high-availability reads.
  2. **Pub/Sub Tier** (WebSocket events, job notifications) — optimized for throughput and tolerant of slightly higher latency.
  This prevents a burst of real-time notifications from evicting user session keys.
- **Read Replicas**: Offload WebSocket_Gateway subscription polling and Notification_Service status checks to replica nodes. Keep writes (session creation, token refresh, job updates) on the master.
- **Connection Management**: With ~10 Express service pods each maintaining 10 connections, plan for ~100 persistent connections plus replica links. Use `ioredis` with `lazyConnect: true`, `keepAlive: 30000`, and `enableOfflineQueue: false` to prevent event-loop blocking during topology changes.
- **Memory Right-Sizing**: Estimate dataset size. Example: 100k active sessions × 1 KB + 50k OAuth tokens × 2 KB + 1M job statuses × 0.5 KB ≈ ~700 MB baseline. Provision 2× headroom for Redis overhead and growth.
- **Persistence Strategy**: Enable AOF (`appendfsync everysec`) and periodic RDB snapshots to accelerate warm restarts, but design all consumers to degrade to MongoDB if Redis is unavailable for extended periods.

### Security Considerations

- **Encryption in Transit**: TLS 1.2+ is required for all Redis client connections.
- **Encryption at Rest in Memory**: Auth_Service encrypts OAuth access and refresh tokens (AES-256-GCM with a KMS-managed key) before writing to Redis. A memory dump or `MONITOR` output must never expose plaintext platform credentials.
- **Network Isolation**: Redis resides in a private VPC subnet with security groups restricting port 6379 to backend service subnets only; no public endpoint is exposed.
- **ACLs**: Redis 6+ ACLs restrict command profiles per service. For example, WebSocket_Gateway is limited to `SUBSCRIBE`/`PSUBSCRIBE`, while Publish_Service is limited to `HGET` on `oauth:*` keys.

## Related Diagrams

No paired component diagram was provided for this document. The Redis Cache component appears in the system overview and related service diagrams.