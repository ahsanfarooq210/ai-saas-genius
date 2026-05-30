## Redis Streams Queue

### Responsibilities

- **Decoupled job queue**: Acts as the dedicated, high-throughput message bus for asynchronous publish and media-processing tasks, deliberately isolated from MongoDB operational data to prevent database contention.
- **Stream-based durability**: Persists job entries as Redis Stream messages with ordered IDs, ensuring at-least-once delivery semantics even if consumers crash mid-processing.
- **Consumer group orchestration**: Manages Redis Consumer Groups (`XREADGROUP`) that allow multiple `job_worker` and `media_processor` instances to read the same stream without duplicate delivery to a single consumer.
- **Pending entry lifecycle**: Tracks unacknowledged messages in the Pending Entries List (PEL) and supports reclamation of stalled jobs via `XCLAIM`.
- **Backpressure boundary**: Absorbs spikes in scheduled job volume from `scheduler_service` so that downstream workers and platform APIs can consume at a steady rate.

### APIs / Interfaces

The component exposes standard Redis Streams commands consumed by Node.js services via the Redis client (e.g., `ioredis` or `node-redis`). All interfaces are key-scoped to specific stream names such as `stream:publish` or `stream:media`.

| Command | Caller | Purpose |
|---------|--------|---------|
| `XADD <stream> MAXLEN ~ 1000000 * jobType <type> payload <json> userId <id> idempotencyKey <key>` | `scheduler_service`, `media_service` | Appends a new job to the stream with approximate trimming to cap memory. |
| `XREADGROUP GROUP <group> <consumer> BLOCK 5000 COUNT 10 STREAMS <stream> >` | `job_worker`, `media_processor` | Blocking read for consumer group members to claim new entries. |
| `XACK <stream> <group> <id> ...` | `job_worker`, `media_processor` | Acknowledges successful processing and removes entries from the PEL. |
| `XCLAIM <stream> <group> <consumer> <min-idle-time> <id> ...` | Janitor / recovery worker | Reassigns entries that have been idle in the PEL beyond a threshold (e.g., 60 s) after a worker crash. |
| `XPENDING <stream> <group> IDLE <ms>` | Monitoring / janitor | Lists stalled messages to trigger `XCLAIM` or alerts. |
| `XTRIM <stream> MAXLEN ~ <threshold>` | Automated cron / admin | Explicitly trims stream length if `XADD` maxlen is insufficient. |
| `XINFO GROUPS <stream>` | Observability stack | Exposes consumer group lag and active consumer counts for autoscaling signals. |

### Data Ownership

- **Active job backlog**: Stream entries representing pending publish tasks (target platform, content metadata ID, scheduled timestamp, idempotency key) and media-processing tasks (source S3 key, target format, processing parameters).
- **Consumer group state**: Group names (`job_workers`, `media_processors`), registered consumer IDs, last-delivered message IDs, and the Pending Entries List (PEL) containing in-flight jobs.
- **Stream topology metadata**: Stream length, radix tree structure, and trimming cursors.
- **Does not own**: OAuth tokens (stored in `token_vault`), user preferences or content metadata (stored in `mongodb_ops`), presigned URLs or rate-limit counters (stored in `redis_cache`), or media blobs (stored in `object_storage`).

### Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Unbounded stream growth** | Redis memory exhaustion if producers outpace consumers and `MAXLEN` trimming is absent or misconfigured. | Enforce `MAXLEN ~` on every `XADD`; monitor `XLEN` with alerts; archive completed job context to MongoDB if audit history is required. |
| **Orphaned PEL entries** | A worker crashes between `XREADGROUP` and `XACK`, leaving jobs stuck in `XPENDING` indefinitely. | Run a background janitor (or Agenda.js job) that queries `XPENDING` with an `IDLE` threshold and issues `XCLAIM` to healthy consumers; alert if PEL depth exceeds a threshold. |
| **Hot-key contention** | A single stream key (e.g., `stream:publish`) becomes a Redis hot key under high load, throttling throughput on a single cluster node. | Shard streams by tenant or hash of `userId` (e.g., `stream:publish:{0..15}`) to distribute keys across cluster slots; route producers deterministically. |
| **Split-brain on Redis failover** | During a primary failover with asynchronous replication, unacknowledged stream entries may be lost or duplicated. | Configure Redis AOF with `appendfsync everysec` (or `always` for stricter durability) and use idempotency keys in job payloads so duplicate deliveries are harmless. |
| **Consumer group imbalance** | Uneven message distribution causes some `job_worker` instances to starve while others backlog, breaking per-user concurrency assumptions. | Ensure consumers share a common group and use `COUNT` and `BLOCK` parameters appropriately; monitor `XINFO CONSUMERS` and rebalance pods via HPA if lag grows. |
| **Backpressure cascade** | If `publisher_service` or `platform_apis` degrade, streams back up and Redis memory spikes, potentially evicting cache keys from `redis_cache` if co-located. | Isolate this Redis instance from `redis_cache` (dedicated node/cluster); implement producer throttling when `XLEN` exceeds high-water marks. |

### Scaling Considerations

- **Horizontal worker scaling**: Consumer groups allow `job_worker` and `media_processor` pods to scale independently based on `XPENDING` lag metrics exposed by `XINFO GROUPS`. Autoscaling policies should target pending entry count per consumer group.
- **Stream sharding**: For platforms with millions of daily posts, shard by `userId` modulo or consistent hashing across multiple stream keys. This prevents single-key bottlenecks and aligns with Redis Cluster slot distribution.
- **Memory-bound trimming**: Use approximate trimming (`MAXLEN ~ 1000000`) rather than exact trimming to keep `XADD` O(1) amortized. Set the threshold high enough to cover peak backpressure windows (e.g., 2–4 hours of normal volume).
- **Dedicated Redis topology**: Run this queue on a separate Redis cluster or node type from `redis_cache` to avoid cache eviction or latency spikes caused by queue memory pressure and high write throughput.
- **PEL janitor frequency**: Tune the `XCLAIM` idle threshold (e.g., 30–90 seconds) to balance fast recovery from crashed workers against premature redelivery of slow-but-valid jobs. The janitor itself must be singleton or use distributed locking to prevent claim storms.
- **Job payload size**: Keep stream entries under 1 KB by referencing large documents in `mongodb_ops` and media in `object_storage`. Large payloads bloat Redis memory and slow replication.
- **Priority isolation**: Consider separate streams (`stream:publish:high`, `stream:publish:default`) or separate consumer groups rather than mixing media transcoding and social publishing in the same stream, since their processing latencies and retry policies differ.

## Related Diagrams

- `diagrams/0350/iter4_component-redis-streams-queue.mmd`