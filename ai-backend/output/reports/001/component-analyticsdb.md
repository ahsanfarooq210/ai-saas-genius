## AnalyticsDB

### Responsibilities
- **OLAP Workload Isolation**: Physically segregate high-volume clickstream storage and analytical query processing from the MongoDB OLTP cluster, ensuring that heavy aggregation scans never contend with URL creation, authentication, or redirect resolution.
- **Clickstream Ingestion**: Accept batched click events from the `AnalyticsConsumerGroup` via the ClickHouse HTTP and Native interfaces, persisting them with columnar compression and immutable part semantics.
- **Real-time Aggregation**: Serve low-latency analytical queries for link-level metrics—total clicks, unique visitor estimates, geographic distribution, referrer breakdown, and device/browser splits—through materialized views and pre-aggregated projections.
- **Data Retention & Tiering**: Enforce time-based TTL on raw event tables (e.g., 90 days) while retaining rolled-up hourly and daily summaries for extended historical analysis, automating part drops to reclaim disk space.
- **Immutable Append-Only Store**: Leverage `MergeTree` engine semantics to handle sequential batch inserts efficiently without row-level locking, document-level cache invalidation, or write-ahead log amplification typical of MongoDB.

### Interfaces / APIs
- **Ingestion Interface**
  - **ClickHouse HTTP API** (`8123`): Receives `INSERT INTO click_events ...` requests from `AnalyticsConsumerGroup` nodes. Inserts are issued with `async_insert=1` and `wait_for_async_insert=0` to decouple consumer commit speed from on-disk merge latency.
  - **Batch Contract**: Consumers transmit payloads of up to 10,000 rows or every 5 seconds, whichever comes first, serialized as `JSONEachRow` or `Native` format.
  - **TCP Native Protocol** (`9000`): Optionally used for high-throughput consumers that maintain persistent `@clickhouse/client` connections with pooled sockets and backpressure handling.
- **Query Interface**
  - **ClickHouse SQL over HTTP/TCP**: Internal analytics dashboards and admin APIs execute `SELECT` queries against materialized views.
  - **Read Patterns**: Time-series aggregations grouped by `short_code`, `toStartOfHour(event_time)`, and low-cardinality dimensions (`country_code`, `device_type`).
  - **Query Guardrails**: `max_memory_usage` and `max_execution_time` are enforced per user profile to prevent ad-hoc BI queries from starving ingestion resources.
- **Schema Management**
  - DDL migrations—table creation, materialized view definitions, projection additions, TTL policies, and index changes—are applied via versioned migration scripts executed through the ClickHouse CLI or HTTP DDL endpoint during CI/CD deployment.

### Data Model & Ownership
AnalyticsDB owns all read-only, append-only analytical entities derived from redirect traffic. No other service writes directly to these tables.

- **`click_events`** (`MergeTree`, partitioned by `toYYYYMMDD(event_time)`)
  - `event_time` `DateTime64(3)`
  - `short_code` `LowCardinality(String)`
  - `ip_hash` `UInt64` (hashed IPv4/IPv6 for uniqueness estimation without storing raw PII)
  - `country_code` `LowCardinality(FixedString(2))`
  - `city` `LowCardinality(String)`
  - `referrer_domain` `LowCardinality(String)`
  - `user_agent` `String`
  - `device_type` `LowCardinality(String)`
  - `browser` `LowCardinality(String)`
  - `os` `LowCardinality(String)`
  - `edge_node_id` `LowCardinality(String)`
  - `response_time_ms` `UInt16`
  - `kafka_partition` `UInt32`, `kafka_offset` `UInt64` (idempotency context, part of the `ORDER BY`)

- **`link_stats_hourly`** (MaterializedView → `AggregatingMergeTree`)
  - Continuously populated by a materialized view watching `click_events`.
  - Stores `hour`, `short_code`, `total_clicks` (`AggregateFunction(count)`), `unique_ip_hash` (`AggregateFunction(uniqCombined64, UInt64)`), and `top_referrers` (`AggregateFunction(topK(10), String)`).
  - Owned exclusively by AnalyticsDB; refreshed on each insert batch without external orchestration.

- **`link_stats_daily`** (MaterializedView → `SummingMergeTree` or `AggregatingMergeTree`)
  - Coarser rollup for long-range trend queries, reducing scan volume for dashboard widgets that span 30+ days.

**Retention Policies**
- Raw `click_events`: 90-day TTL; parts are automatically dropped by the merge scheduler.
- Hourly aggregates: 1-year TTL.
- Daily aggregates: No TTL; archived to cold object storage after 2 years via storage policy tiering if required.

### Failure Modes
| Failure | Impact | Mitigation |
|---|---|---|
| **Ingestion Backpressure** | Consumer lag spikes if ClickHouse background merges cannot keep up with insert velocity, causing Kafka offset delays and dashboard staleness. | Monitor `system.merges` and `system.replication_queue` depth; scale ClickHouse shards horizontally; tune `max_parts_in_total` and `parts_to_delay_insert` thresholds; reduce consumer batch size temporarily. |
| **Disk Saturation** | Immutable parts and background merges consume disk faster than TTL drops reclaim it, triggering `TOO_MANY_PARTS` exceptions and write rejections. | Alert on disk utilization >75%; enforce aggressive TTL; add storage volumes; shard data across additional nodes to spread merge I/O. |
| **Hot Partition / Hot Shard** | All writes target the current day’s partition; a time-based sharding key concentrates insert and merge load on a single node. | Shard by `sipHash64(short_code)` (or a composite hash) so each node owns a balanced slice of traffic regardless of timestamp. |
| **Query Memory Exhaustion** | Ad-hoc `SELECT` with high-cardinality `GROUP BY` (e.g., per-IP drilldown) exhausts server RAM, triggering OOM kills or query cancellations. | Enforce `max_memory_usage` per query and per user; restrict raw table access; require dashboard queries to hit materialized views only. |
| **Replication Lag / Keeper Pressure** | `ReplicatedMergeTree` tables stall if ClickHouse Keeper (or ZooKeeper) transaction throughput becomes a bottleneck during viral traffic spikes. | Run Keeper on dedicated, high-IOPS nodes; monitor `system.replication_queue`; consider replicating only aggregate tables if raw event replication overhead is too high. |
| **Duplicate Events** | At-least-once Kafka delivery plus consumer retries can produce duplicate rows because ClickHouse does not enforce unique constraints on raw inserts. | Include deterministic idempotency keys (`kafka_partition`, `kafka_offset`) in the `ORDER BY`; alternatively, use `ReplacingMergeTree` with a version column and deduplicate on the read path. |
| **Network Partition from Consumers** | Transient network blips cause insert timeouts; consumers retry, but large in-flight batches may be rejected as duplicates or lost. | Implement bounded exponential backoff in consumer clients; buffer failed batches to local disk and replay with idempotency keys intact. |

### Scaling Considerations
- **Sharding Strategy**: Distribute `click_events` across multiple ClickHouse nodes using a sharding key such as `sipHash64(short_code)`. This evenly spreads write I/O and prevents hot nodes. A `Distributed` table engine on query nodes fans out `SELECT` operations and aggregates results from all shards.
- **Replication**: Deploy `ReplicatedMergeTree` with at least two replicas per shard to survive node failures. For raw events, use asynchronous replication to maximize ingestion throughput; for aggregate tables, consider `insert_quorum=2` if stronger consistency is required for dashboard reads.
- **Consumer Parallelism Alignment**: The `AnalyticsConsumerGroup` can scale out to N consumers, but partition assignment should align with ClickHouse shard endpoints to avoid cross-AZ traffic. Each consumer instance either targets a specific shard directly or writes through a Distributed table with `internal_replication=true`.
- **Materialized View Fan-out**: Heavy materialized view calculations can bottleneck the insert pipeline. Limit chained MVs; prefer one MV per target granularity. Avoid `OPTIMIZE FINAL` in production; schedule it only during maintenance windows.
- **Tiered Storage**: Configure multi-volume storage policies so partitions older than 7 days are automatically moved from fast NVMe to larger, cost-optimized SSD or S3-backed volumes, controlling infrastructure cost without manual archival jobs.
- **Read Scaling**: Isolate a subset of replicas as query-only nodes by routing dashboard `SELECT` traffic to them through a separate distributed table VIP, keeping ingestion nodes free of concurrent aggregation load.
- **Schema Evolution**: Adding columns to `MergeTree` tables is a metadata-only operation and cheap; removing or altering column types requires table recreation. Plan new tracking dimensions (e.g., UTM parameters) as additive `Nullable` columns to avoid migrations that rewrite parts.

### Related Diagrams
No paired Mermaid diagram was provided for this component document.