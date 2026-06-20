## URLService

### Overview
`URLService` is an Express/Node.js origin API that manages the full lifecycle of short URL mappings and acts as the authoritative fallback for redirect resolution when edge caches miss. It coordinates with the Key Generation Service (KGS) for unique Base58 short codes, persists canonical mappings to the sharded MongoDB cluster, hydrates RedisCluster, and purges the CDN edge on mutations.

### Responsibilities

- **Short URL CRUD**: Authenticated endpoints to create, read, update, and delete URL mappings. Creation consumes unique short codes from KGS (via a locally buffered range) to avoid MongoDB unique-index contention.
- **Origin Redirect Resolution**: Internal fallback endpoint consumed exclusively by `RedirectEdge` when a short code is absent from RedisCluster. Uses in-process singleflight to coalesce concurrent requests for the same code, preventing thundering-herd reads against MongoDB secondaries.
- **Cache Hydration & Invalidation**: On creation, writes the mapping to RedisCluster with a TTL aligned to the URL expiration. On update or deletion, synchronously updates or removes the Redis key and asynchronously purges the CDN edge.
- **Circuit-Breaker Protected Reads**: Cache-miss lookups read from MongoDB secondaries behind a circuit breaker. If secondaries are degraded or excessively stale, the breaker opens and the service fails fast rather than propagating tail latency.
- **Schema Enforcement**: Owns the MongoDB `urls` collection via Mongoose, enforcing maximum long URL length, valid URI formats, expiration constraints, and an `isActive` soft-delete flag.

### APIs / Interfaces

#### Public REST API (routed via APIGateway)
All public endpoints expect a JWT already validated by the gateway.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/urls` | Create a new short URL. |
| `GET`  | `/api/v1/urls/:shortCode` | Retrieve metadata (not the redirect itself) for a short code. |
| `PUT`  | `/api/v1/urls/:shortCode` | Update the destination or metadata. |
| `DELETE` | `/api/v1/urls/:shortCode` | Deactivate a short URL. |

**Create Request Body**
```json
{
  "longUrl": "https://example.com/very/long/path",
  "customAlias": "optionalCustom",
  "expiresAt": "2025-12-31T23:59:59Z"
}
```

**Create Response Body**
```json
{
  "shortCode": "aB3x9Y",
  "shortUrl": "https://cdn.example.com/aB3x9Y",
  "longUrl": "https://example.com/very/long/path",
  "expiresAt": "2025-12-31T23:59:59Z",
  "createdAt": "2024-01-15T10:00:00Z"
}
```

#### Internal Fallback API (private network / mTLS)
Consumed exclusively by `RedirectEdge`; not exposed through the public APIGateway.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/internal/resolve/:shortCode` | Resolve a short code to its canonical long URL and active status. |

**Resolve Response Body**
```json
{
  "longUrl": "https://example.com/very/long/path",
  "isActive": true,
  "expiresAt": "2025-12-31T23:59:59Z"
}
```

#### Dependency Interfaces

- **KGS**: Internal HTTP/gRPC client that atomically allocates Base58 counter ranges. `URLService` maintains a local in-memory FIFO buffer of pre-allocated codes to eliminate per-creation KGS round-trips.
- **MongoDBCluster**: Mongoose ODM connecting through `mongos` routers. Writes use the primary with `w: majority`; cache-miss fallback reads use `readPreference: secondaryPreferred`.
- **RedisCluster**: `ioredis` cluster client. Stores mappings as `STRING` keys (`url:<shortCode> -> <longUrl>`) with TTLs matching the URL expiration or a default hot-cache window.
- **CDNEdge**: Asynchronous purge calls (surrogate-key or cache-tag based) triggered on `PUT`/`DELETE`. Uses a bounded retry queue to absorb CDN API rate limits.

### Data Ownership

- **`urls` Collection (MongoDB)**: Canonical OLTP records.
  - `shortCode`: `String`, unique index, Base58 encoded.
  - `longUrl`: `String`, indexed, max length 2,048 characters.
  - `userId`: `ObjectId`, referencing the owning user.
  - `isActive`: `Boolean`, default `true`.
  - `expiresAt`: `Date`, optional.
  - `createdAt` / `updatedAt`: `Date`, managed by Mongoose timestamps.
- **Local Code Buffer**: Thread-safe in-memory queue of pre-fetched short codes from KGS. Ephemeral; lost on process restart.
- **Singleflight Registry**: Per-process map of in-flight `shortCode` resolution promises. Prevents duplicate MongoDB queries during concurrent cache misses. Bounded to an LRU of 10,000 entries to mitigate memory pressure from random code scanning.
- **Circuit Breaker State**: Ephemeral per-dependency state (MongoDB secondary reads, KGS, CDN purge) maintained by a library such as `opossum`.

### Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **KGS unreachable** | New URL creation fails with `503`. Redirects are unaffected. | Local code buffer absorbs transient KGS outages. If the buffer empties, fail fast and alert. |
| **MongoDB primary write timeout** | Create/update/delete fails; no partial writes occur. | Mongoose retryable writes return explicit `500` without caching stale data. |
| **MongoDB secondary stale read** | Fallback resolution returns an outdated long URL immediately after an update. | Use `readConcern: majority` and `maxStalenessSeconds` on secondary reads; accept a small latency trade-off. |
| **RedisCluster write failure** | Mapping persists in MongoDB but is absent from cache. | Resolve path still functions via MongoDB fallback. A background reconciliation job can repopulate Redis. |
| **CDN purge rejection** | Stale 301 redirects survive at the edge longer than intended. | Use short `Cache-Control` on 301 responses (e.g., 1 hour) as a backstop; implement exponential-backoff retry for purges. |
| **Singleflight key accumulation** | Attackers requesting millions of unique non-existent codes inflate in-flight maps. | Registry uses an LRU with automatic eviction; non-existent codes resolve once and are not retained. |
| **Circuit breaker flapping on secondaries** | Intermittent `503`s on cache-miss resolution. | Tuned thresholds: 50% error rate or >2s latency over 30s, with a 10s half-open probe interval. |
| **RedirectEdge fallback flood** | Mass Redis expiry floods `URLService` with misses. | Singleflight coalesces identical codes. Cache-warming scripts preload hot mappings after a Redis cold start. |

### Scaling Considerations

- **Stateless Horizontal Scaling**: Nodes are stateless and scale behind the APIGateway using HPA based on CPU and p99 latency. No sticky sessions are required.
- **Connection Pool Sizing**: Each instance maintains a Mongoose pool of 10–20 connections. Total `mongos` connections scale linearly with pod count; monitor router connection limits and CPU.
- **KGS Range Buffering**: Under high creation throughput (>1,000 URLs/sec), requesting one code per KGS call creates a bottleneck. `URLService` should allocate ranges (e.g., 1,000 codes) atomically from KGS and generate locally, reducing KGS QPS by three orders of magnitude.
- **Read/Write Traffic Separation**: The internal `/internal/resolve` fallback competes with CRUD traffic for the event loop and MongoDB connections. At extreme scale, split the resolve handler into a separate deployable unit or isolate it on a dedicated port/cluster with its own secondary read connections.
- **Redis Write Fan-out**: Creation spikes generate independent `SET` calls sharded across RedisCluster nodes. Write throughput scales linearly with Redis node count; no hot-key risk exists on writes unless a single code is repeatedly mutated.
- **CDN Purge Batching**: High mutation velocity can exceed CDN purge rate limits. Aggregate purges by surrogate tag or debounce per-code purge requests within a 5-second window.
- **Payload & Index Limits**: Enforce `longUrl` length limits at the API layer to prevent oversized documents and index key violations. The `shortCode` unique index remains but is low-contention because KGS guarantees uniqueness before insertion.

### Related Diagrams

No paired Mermaid diagram was provided for this document.