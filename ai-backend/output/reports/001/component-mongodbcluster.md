## MongoDBCluster

### Responsibilities

MongoDBCluster is the system-of-record OLTP store for the URL shortener. It persists three distinct data domains:

- **URL mappings** – The canonical `shortCode → longUrl` records, ownership metadata, and optional expiration timestamps.
- **User identities** – Authentication credentials, profile data, and role claims consumed exclusively by `AuthService`.
- **KGS counter ranges** – Atomic, monotonically increasing integer ranges that `KGS` allocates via `findAndModify` to generate non-colliding Base58 short codes.

The cluster is deployed as a **sharded replica set fronted by `mongos` query routers**. This topology hides shard placement from the Node.js services and allows horizontal data partitioning as the link corpus grows. Read preferences are explicitly tuned so that cache-miss lookups (e.g., `URLService` fallback reads for `RedirectEdge`) target **secondaries**, keeping write pressure isolated on shard primaries for link creation and counter increments.

### APIs / Interfaces

MongoDBCluster does not expose REST or gRPC endpoints; interaction is through the MongoDB wire protocol and driver-level semantics.

| Interface | Details |
|-----------|---------|
| **MongoDB Wire Protocol** | TCP port `27017` (default) between application nodes and `mongos` routers. |
| **`mongos` Routers** | Stateless L7 query proxies that perform target shard routing, broadcast scatter-gather when necessary, and merge sorted results. Services connect to a load-balanced pool of `mongos` rather than individual shards. |
| **Node.js Driver / Mongoose** | `URLService`, `AuthService`, and `KGS` connect via the native MongoDB Node.js driver or Mongoose ODM with tunable connection pools (recommended: `minPoolSize: 10`, `maxPoolSize: 100` per process). |
| **Read Preferences** | `secondaryPreferred` for cache-miss redirect lookups and user-profile reads. `primary` for KGS counter allocations and new-link insertions to guarantee immediate consistency. |
| **Write Concern** | `w: "majority"`, `j: true` for URL and user mutations. `w: 1` acceptable only for idempotent KGS range bookkeeping where duplicates are harmless. |
| **Indexing API** | B-tree indexes maintained natively; application services rely on compound and unique indexes for query performance (see *Data Owned*). |

### Data Owned

#### `url_mappings` collection
Core entity for the shortener.

- **`shortCode`** (string, **shard key** – hashed) – The public Base58 slug.
- **`longUrl`** (string) – Destination URL.
- **`createdBy`** (ObjectId) – Reference to `users._id`.
- **`createdAt` / `expiresAt`** (Date) – TTL-driven expiration supported via a TTL index on `expiresAt`.
- **`isActive`** (boolean) – Soft-delete flag.

**Indexes:**
- Unique index on `shortCode` (enforced by shard key uniqueness when hashed).
- Compound index `{ createdBy: 1, createdAt: -1 }` for paginated “my links” listings in `ReactSPA`.

#### `users` collection
Managed by `AuthService`.

- **`email`** (string, unique) – Login identifier.
- **`passwordHash`** / **`salt`** (string) – Argon2id or bcrypt outputs.
- **`role`** (string) – e.g., `user`, `admin`.
- **`createdAt`** (Date).

**Indexes:**
- Unique index on `email`.
- Index on `_id` (default).

#### `kgs_counters` collection
Coordination surface for `KGS`.

- **`_id`** (ObjectId) – Range document identifier.
- **`rangeStart`** / **`rangeEnd`** (Number, `NumberLong`) – Inclusive/exclusive bounds of a pre-allocated integer block.
- **`allocatedTo`** (string) – `KGS` pod/instance identifier.
- **`allocatedAt`** (Date) – Range lease timestamp.

**Indexes:**
- Index on `{ allocatedAt: 1 }` for stale-range reclamation logic.
- No unique constraints required; atomicity is enforced client-side via `findAndModify` with `$inc`.

### Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Shard primary election** | Writes to the affected shard stall for 10–30s until a new primary is elected. Cache-miss reads may also lag if secondaries step up. | Deploy each shard as a 3-node PSA or PSS replica set across fault domains. Driver retryable writes automatically reattempt. |
| **Secondary replication lag** | `URLService` reads from a secondary may return stale data (e.g., a newly created short code appears missing). | Monitor `replSetGetStatus.members[].optimeDate` lag. If lag exceeds 5s, degrade read preference to `primary` for redirect lookups or accept brief cache inconsistency. |
| **Hot shard / jumbo chunks** | A poorly chosen monotonic shard key (e.g., ascending `createdAt`) concentrates inserts on one shard, creating I/O hotspots and un-splittable jumbo chunks. | Use a **hashed shard key** on `shortCode` (high cardinality, uniform distribution) to spread writes evenly. |
| **`mongos` pool exhaustion** | All `mongos` routers become unreachable or overloaded, severing the application’s ability to route queries despite healthy shards. | Run 3+ `mongos` instances behind an internal TCP load balancer. Auto-scale `mongos` pods horizontally with CPU/memory thresholds. |
| **Disk saturation** | Unbounded growth of URL metadata exhausts storage and degrades WiredTiger cache efficiency. | Enable TTL indexes for ephemeral links. Archive soft-deleted/expired documents to cold storage after 90 days. Use WiredTiger compression (`snappy` or `zstd`). |
| **KGS counter contention** | A single counter document mutated by every `KGS` instance becomes a write hotspot. | `KGS` allocates wide ranges (e.g., 100k codes per `findAndModify`), reducing MongoDB write frequency to once per range rather than once per key. |

### Scaling Considerations

- **Horizontal sharding** – Add new shard nodes and allow the balancer to migrate chunks. Because `shortCode` is hashed, rebalancing is naturally uniform and avoids range-bound data motion storms.
- **Read replica expansion** – Increase secondary node count per shard to absorb viral traffic spikes where `RedirectEdge` cache misses spike and `URLService` queries secondaries.
- **Connection budgeting** – Each Node.js service maintains its own driver connection pool. Total inbound connections to a shard must stay below the 64k-per-node practical limit; scale `mongos` count linearly with application pod count.
- **WiredTiger cache sizing** – Size RAM so the working set (hot indexes + recent URL mappings) fits in cache. A rule of thumb is `(RAM - 1 GB) * 0.5` for WiredTiger; otherwise page eviction stalls latency.
- **Backup & recovery** – Use MongoDB Ops Manager or per-block storage snapshots for point-in-time recovery. Schedule snapshots during low-traffic windows to minimize wiredTiger checkpoint pressure.

### Related Diagrams

- `diagrams/001/iter4_component-mongodbcluster.mmd`