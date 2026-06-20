# RedisCluster

## Responsibilities

- **Hot URL Mapping Cache**: Persists active short-code-to-long-URL mappings in memory for sub-millisecond access. RedirectEdge queries this as the primary source of truth for 301 redirects; a hit avoids all origin traffic.
- **Distributed Rate-Limit Counter Store**: Centralizes per-client request counters for the APIGateway. Holds atomic increment counters keyed by scope (`ip`, `user`, `apikey`) and time window, enabling stateless rate-limit enforcement across horizontally scaled gateway instances.
- **Revoked-Token Bloom Filter**: Maintains a probabilistic set of revoked JWT fingerprints (e.g., hashed `jti` claims). APIGateway checks this filter on every authenticated request to reject revoked tokens without querying the AuthService or MongoDB.
- **SPOF Elimination**: Replaces a standalone Redis instance with a true Redis Cluster deployment. Data is partitioned across 16,384 hash slots mapped to multiple master nodes, each backed by replicas, eliminating single-node hot-key bottlenecks and single points of failure.

## Data Owned

| Key Pattern | Type | Contents | TTL / Eviction |
|---|---|---|---|
| `url:{shortCode}` | Hash (`HSET`) | `longUrl`, `ownerId`, `expiresAt`, `createdAt` | Aligned to URL expiration or a default cache horizon (e.g., 24 h). |
| `ratelimit:{scope}:{identifier}:{windowTs}` | String (`INCR`) | Integer count of requests in the current window bucket. | Equal to the rate-limit window duration (e.g., 60 s) so keys auto-expire. |
| `revokedtoken:bloom` | Bloom Filter (RedisBloom module) or raw bitmap | Hashed signatures of revoked JWTs. | Long-lived; explicit deletion only when the filter is rebuilt or rotated. |
| Cluster topology metadata | Internal cluster state | Slot-to-node mappings, node IDs, replica health, configuration epochs. | N/A (managed by the cluster bus). |

## APIs / Interfaces

RedisCluster exposes the standard **Redis Serialization Protocol (RESP2/RESP3)**. Services use cluster-aware Node.js drivers (e.g., `ioredis`) that cache the slot-to-node map and transparently handle `MOVED` and `ASK` redirections.

**Application-visible command surface:**

| Consumer | Command | Purpose |
|---|---|---|
| RedirectEdge | `HGETALL url:{shortCode}` or `GET url:{shortCode}` | Resolve a short code to its long URL and metadata. |
| URLService | `HMSET url:{shortCode} ...` + `EXPIRE ...` | Write a new mapping after creation; refresh TTL on updates. |
| URLService | `DEL url:{shortCode}` | Evict a mapping when the URL is deleted or purged. |
| APIGateway | `INCR ratelimit:{...}` then `EXPIRE ...` | Atomically increment and window a request counter. |
| APIGateway | `BF.EXISTS revokedtoken:bloom {hash}` (or `GETBIT` if using raw bitmap) | Test whether a presented JWT fingerprint has been revoked. |
| AuthService | `BF.ADD revokedtoken:bloom {hash}` (or `SETBIT`) | Insert a revoked token fingerprint after logout or explicit revocation. |
| All clients (driver-internal) | `CLUSTER SLOTS` | Refresh topology after failovers or resharding events. |

**Cluster Bus (internal)**
- Nodes communicate over the cluster bus (port 16379) via a binary gossip protocol for heartbeat, failure detection, and configuration propagation. This bus must be reachable between all nodes but is never exposed to application services.

## Failure Modes

- **Hot-key slot saturation**: A single viral short code hashes to exactly one slot on one master. Even with sharding, that master can become CPU/network bound. Mitigated by RedirectEdge’s in-process singleflight coalescing and by allowing read replicas to serve `HGETALL` with `READONLY` (stale reads are acceptable because a miss falls back to URLService).
- **Failover unavailability**: When a master fails, its replica is promoted. During the election window, clients targeting that slot range may receive `CLUSTERDOWN` or connection timeouts. Application drivers must surface these as transient errors and retry with exponential backoff.
- **Replica lag under write burst**: URLService writes a burst of new mappings; replicas may lag. If RedirectEdge reads from a lagging replica immediately after a write, it sees a cache miss and falls back to URLService. This is safe but increases origin load.
- **Memory exhaustion (OOM)**: Because Redis stores all data in RAM, unbounded URL key growth can trigger OOM or forced eviction. If rate-limit counters or the bloom filter are evicted, the APIGateway loses enforcement capability. Mitigation: monitor memory per shard, enforce aggressive TTLs on URL keys, use memory-efficient encodings (e.g., small hashes stored as ziplists), and scale out shards before crossing 80% utilization.
- **Split-brain minority partition**: A network partition isolates a minority of nodes. The majority side continues serving those slots; the minority stops accepting writes. Clients with stale topology may write to the isolated master and lose data when the partition heals. Rate-limit counters tolerate brief loss; URL cache entries are reconstructable from MongoDB on miss.
- **Resharding latency**: Adding shards requires migrating hash slots. During migration, clients receive `ASK` redirections, increasing tail latency. Heavy resharding under peak traffic can degrade RedirectEdge performance. Mitigation: schedule slot migrations during low-traffic windows and throttle migration speed.

## Scaling Considerations

- **Slot-based horizontal sharding**: Redis Cluster partitions the 16,384 hash slots across master nodes. To scale memory or CPU, add master-replica pairs and rebalance slots with `redis-cli --cluster reshard`. Maintain an even distribution; avoid concentrating viral keys on a single node through natural hash distribution.
- **Read-replica scaling**: Provision one to two replicas per master. RedirectEdge can distribute URL lookup load across replicas using `READONLY`, but rate-limit increments and bloom-filter writes must always target the master to guarantee consistency.
- **Connection management**: Node.js services maintain persistent TCP pools via `ioredis`. In a large fleet of APIGateway and RedirectEdge containers, aggregate connection counts can approach the cluster `maxclients` limit. Tune pool size per instance, disable offline queuing (`enableOfflineQueue: false`), and consider a lightweight proxy sidecar if connection counts threaten node stability.
- **Memory efficiency**: Store URL records as Redis Hashes rather than serialized JSON strings to benefit from ziplist encoding when field counts and sizes are small. Use terse key prefixes. Explicitly set TTLs on every URL key so the working set is naturally bounded by active traffic rather than total historical data.
- **Geographic placement**: Deploy master and replica nodes across multiple availability zones within a single region. Do not stretch one Redis Cluster across regions—cluster-bus latency requirements make multi-region consensus unreliable. For multi-region expansion, deploy independent regional clusters and have URLService write to the local cluster.
- **Persistence trade-offs**: Enable periodic RDB snapshots for fast restarts. AOF `everysec` adds durability for rate-limit state at the cost of write throughput. Because URL mappings can be rebuilt from MongoDB and rate limits are soft quotas, RDB-only persistence is usually sufficient; schedule snapshots during off-peak windows.

## Related Diagrams

No paired Mermaid diagram is provided for this component document.