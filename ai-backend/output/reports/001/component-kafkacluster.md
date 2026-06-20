## KafkaCluster

### Responsibilities

- **Ingest high-volume clickstream events** emitted asynchronously from RedirectEdge nodes, capturing every redirect without blocking the hot-path 301 response.
- **Ingest cache-invalidation topics** published on URL mutations so that downstream edge workers (or CDN purge orchestrators) can consume stale-entry notifications.
- **Provide partitioned, at-least-once delivery** with disk persistence, acting as a durable buffer that decouples spiky redirect traffic from the AnalyticsConsumerGroup processing rate.
- **Replicate data across brokers** to tolerate individual node loss without event loss or cluster unavailability.
- **Maintain consumer group coordination** so that AnalyticsConsumerGroup members can scale horizontally across partitions without double-processing or orphaned offsets.

### APIs / Interfaces

- **Kafka Producer Protocol (TCP 9092/9093)**  
  Exposed to RedirectEdge producers. The client configuration enforces:
  - `acks=all`
  - `enable.idempotence=true`
  - `compression.type=lz4`
  - `linger.ms=50` to batch high-frequency click events and reduce per-request broker overhead.

- **Kafka Consumer Protocol (TCP 9092/9093)**  
  Consumed by the AnalyticsConsumerGroup. Each member subscribes to the clickstream topic using a shared group ID and commits offsets only after idempotent writes to AnalyticsDB.

- **Kafka Admin API**  
  Used for operational tasks: creating topics with explicit partition counts, inspecting consumer group lag, and triggering partition reassignments during broker expansion.

- **Topics**
  | Topic | Purpose | Payload Summary |
  |-------|---------|-----------------|
  | `urlshortener.clicks.v1` | Redirect audit trail | `shortCode`, `timestamp`, `edgeNodeId`, `correlationId`, `userAgent`, `ipHash`, `geoRegion` |
  | `urlshortener.cache-invalidation.v1` | CDN purge commands | `shortCode`, `invalidatedAt`, `cdnFlushTarget` |

### Data Ownership

- **Transient event streams** — Kafka is not the source of truth for URL mappings or user data; it owns durably replicated but time-bounded queues.
- **`urlshortener.clicks.v1`** — Retains raw redirect events for a bounded window (e.g., 72 hours). After consumption and persistence into AnalyticsDB, data ages out automatically.
- **`urlshortener.cache-invalidation.v1`** — Retains mutation notifications until consumed by cache-purge workers or until a short TTL expires (e.g., 24 hours).
- **Consumer offsets** — Stored in the internal `__consumer_offsets` topic, owned and compacted by Kafka itself.

### Failure Modes

- **Broker disk saturation** — Unbounded clickstream volume can exhaust NVMe storage if retention policies are misconfigured. Mitigation: enforce `retention.bytes` per partition and alert on disk usage > 75 % per broker.
- **Leader election stall** — Loss of a majority controller quorum (ZooKeeper or KRaft) freezes metadata operations. Mitigation: deploy an odd-numbered controller set (3 or 5) across independent failure domains.
- **Hot partition** — A viral `shortCode` can skew write traffic to a single partition if the partition key is derived solely from `shortCode`. Mitigation: salt the key with `edgeNodeId` or `correlationId`, or over-partition (e.g., 48 partitions) to diffuse spikes.
- **Consumer group rebalance storm** — Rapid scaling of AnalyticsConsumerGroup pods triggers stop-the-world rebalances. Mitigation: use the ` CooperativeStickyAssignor` and scale in small increments.
- **Duplicate ingestion** — At-least-once semantics combined with producer retries can yield duplicate click events. Downstream consumers must deduplicate on `correlationId` before inserting into AnalyticsDB.
- **Cross-AZ bandwidth cost** — Inter-broker replication across availability zones incurs cloud egress charges. Mitigation: set `broker.rack` to enable rack-aware replica placement, keeping two replicas in-zone where possible.

### Scaling Considerations

- **Horizontal broker scaling** — Add brokers to increase aggregate disk IOPS and network throughput. Rebalance partitions after each expansion; target ≤ 4,000 partitions per broker to prevent metadata overhead.
- **Partition count for `urlshortener.clicks.v1`** — Size partitions so that each AnalyticsConsumerGroup member handles 5–10 partitions. Target throughput per partition around 10 MB/s; with a 24-partition topic, the cluster can absorb ~240 MB/s of clickstream ingress.
- **Replication and durability** — Run with replication factor `RF=3` and `min.insync.replicas=2`. This tolerates single-broker loss without write unavailability and avoids data loss on double-broker failure.
- **Retention as backpressure relief** — Keep short retention (24–72 hours) to bound disk usage and force the analytics pipeline to maintain pace; canonical data is already persisted in AnalyticsDB.
- **Producer batching** — RedirectEdge nodes buffer events locally (up to 50–100 ms) to improve compression ratios and amortize Kafka round-trip latency.
- **Network isolation** — Bind the broker listener to an internal VPC endpoint; redirect traffic never traverses public IPs, reducing attack surface and data-transfer costs.

## Related Diagrams

- `diagrams/001/iter4_component-kafkacluster.mmd`