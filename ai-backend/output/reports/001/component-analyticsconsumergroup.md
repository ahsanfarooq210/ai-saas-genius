# AnalyticsConsumerGroup

## Responsibilities

- **Poll clickstream partitions**: Act as a Kafka consumer group member, continuously fetching events from the `clickstream` topic on `KafkaCluster`.
- **Idempotent event processing**: Normalize and enrich raw redirect events (e.g., parse user-agent, bucket timestamps, hash IPs) and write them to `AnalyticsDB` without introducing duplicate rows during retries or consumer rebalances.
- **Drain queue under load**: Process messages concurrently within each consumer instance and distribute partitions across the group so that viral traffic spikes do not create unbounded lag.
- **Offset lifecycle management**: Manually or semi-automatically commit partition offsets to Kafka only after `AnalyticsDB` acknowledges a batch, ensuring at-least-once delivery semantics.
- **Observability**: Expose consumer lag, events-per-second throughput, batch flush latency, and memory buffer depth so operators can detect pipeline backpressure before it cascades.

## APIs / Interfaces

- **Kafka Consumer Protocol (TCP)**
  - Joins the consumer group `analytics-consumers` via the Kafka Broker API.
  - Subscribes to topic `clickstream` with manual offset commit strategy.
  - Configuration surface (env vars):
    - `KAFKA_BROKERS` — seed list for `KafkaCluster`
    - `KAFKA_GROUP_ID=analytics-consumers`
    - `KAFKA_MAX_POLL_RECORDS` — records fetched per poll loop
    - `KAFKA_SESSION_TIMEOUT_MS` / `HEARTBEAT_INTERVAL_MS`

- **ClickHouse Batch Ingest Interface (HTTP Native or TCP Native)**
  - Sends compressed, batched `INSERT` queries to `AnalyticsDB`.
  - Uses `async_insert=0` with explicit multi-row syntax for predictable backpressure, or `async_insert=1` with `wait_for_async_insert=1` depending on cluster tuning.
  - Connection pool sized independently from OLTP pools to isolate analytics I/O.

- **Operational Health & Metrics (HTTP)**
  - `GET /health/live` — liveness probe (event loop responsive).
  - `GET /health/ready` — readiness probe (consumer group joined, at least one partition assigned, recent successful DB flush).
  - `GET /metrics` — Prometheus-compatible endpoint exporting:
    - `analytics_consumer_records_lag_max`
    - `analytics_db_flush_duration_seconds`
    - `analytics_events_processed_total{status="ok\|error"}`
    - `analytics_batch_buffer_size_bytes`

## Data It Owns

`AnalyticsConsumerGroup` does not hold durable source-of-truth data; it is a stateful stream processor with transient in-memory artifacts only:

| Data | Lifetime | Description |
|---|---|---|
| Uncommitted event batches | Seconds to sub-minute | Buffered click events awaiting a `AnalyticsDB` batch insert. Bounded by `MAX_BATCH_SIZE` and `FLUSH_INTERVAL_MS`. |
| Partition offset checkpoints | Ephemeral (in Kafka `__consumer_offsets`) | Last committed offsets per partition; replayed on restart if not yet committed. |
| Deduplication window (optional) | Configurable TTL (e.g., 300 s) | In-memory LRU cache of `event_id` hashes used to suppress duplicates caused by rebalances or at-least-once retries. If memory is constrained, deduplication is delegated to `AnalyticsDB` engine semantics. |

**Event schema processed** (from `RedirectEdge`):
```json
{
  "eventId": "uuid-v4",
  "shortCode": "aB3dE",
  "timestamp": "2024-05-20T14:30:00Z",
  "ipHash": "sha256-truncated",
  "userAgent": "Mozilla/5.0 ...",
  "geoRegion": "US-EAST",
  "referer": "https://example.com"
}
```

Normalized and inserted into `AnalyticsDB` as OLAP rows with derived columns (`device_family`, `hour_bucket`, `is_mobile`).

## Failure Modes

- **Consumer lag spike / eviction**: If ClickHouse insert latency exceeds `max.poll.interval.ms`, the coordinator evicts the consumer from the group. This pauses processing for that partition and can trigger a rebalance replay.  
  *Mitigation*: Decouple Kafka polling from DB flushing with an internal bounded buffer; tune `max.poll.interval.ms` and `session.timeout.ms` generously; keep batch flushes under a strict deadline.

- **Rebalance storm during auto-scaling**: Rapid addition or removal of consumer pods causes constant partition reassignments and stop-the-world pauses.  
  *Mitigation*: Use cooperative sticky partition assignment; configure HPA with scale-out cooldowns of ~30 s and scale-in stabilization windows of ~5 min; pre-scale ahead of anticipated spikes.

- **ClickHouse backpressure**: `AnalyticsDB` may throttle inserts (e.g., `Too many parts`, `Memory limit exceeded`). Unbounded retry loops cause heap growth and OOM in the Node.js consumer.  
  *Mitigation*: Implement a circuit breaker on the ClickHouse client; apply exponential backoff with jitter; bound in-flight batches; route exhausted messages to a `clickstream.deadletter` topic after N failures.

- **Poison-pill deserialization**: A single malformed JSON record can crash the consumer or block a partition if the error is uncaught.  
  *Mitigation*: Strict schema validation (e.g., Zod) per message; on validation failure, immediately commit the offset and emit the raw payload to a dead-letter topic.

- **Duplicate analytics rows**: At-least-once delivery plus retry logic can double-count clicks if the insert succeeds but the offset commit fails.  
  *Mitigation*: Generate a deterministic `event_id` at `RedirectEdge`; rely on `AnalyticsDB` deduplication (e.g., `ReplicatedReplacingMergeTree` with `event_id` as version key, or `insert_deduplicate` token) so reprocessing is harmless.

- **Offset commit timeout**: Network blip to Kafka brokers prevents committing offsets after a successful DB write. On consumer restart, the partition rewinds to the last commit.  
  *Mitigation*: Keep processing idempotent (see above); optionally store per-partition watermark offsets inside `AnalyticsDB` alongside data and use them on startup to skip already-persisted ranges.

## Scaling Considerations

- **Partition ceiling**: The maximum useful consumer instance count equals the number of partitions in the `clickstream` topic. Provision partitions for 10× expected peak throughput (e.g., 100+ partitions) so the group can scale out horizontally during viral events. Monitor partition skew to avoid hot partitions.

- **Batched ingestion tuning**: ClickHouse throughput favors large batches over frequent small inserts. The consumer should accumulate events up to a byte/time threshold (e.g., 10,000 rows or 1 s) before flushing. During spikes, dynamically raise the batch ceiling while clamping maximum memory per buffer.

- **Backpressure & memory safety**: Cap concurrent in-flight DB batches per instance (e.g., 3). If ClickHouse p99 latency grows beyond `FLUSH_INTERVAL_MS`, reduce `max.poll.records` or pause polling to prevent Node.js heap exhaustion.

- **CPU parallelism in Node.js**: JSON parsing and UA-string normalization are CPU-intensive at high throughput. If the event loop saturates, offload normalization to a `worker_threads` pool so the main thread remains responsive to Kafka heartbeats and I/O.

- **Network isolation**: The consumer group runs on a separate subnet or VPC from the OLTP redirect path. This prevents analytics bulk inserts from contending for bandwidth or connection slots with `URLService` → `MongoDBCluster` traffic.

- **Lag-driven auto-scaling**: Use Kubernetes HPA based on `kafka_consumer_records_lag_max` (exposed via Kafka exporter) rather than CPU. Lag is the direct signal of pipeline congestion and scales the consumer group faster than load-based metrics.

## Related Diagrams

- `diagrams/001/iter4_component-analyticsconsumergroup.mmd` — component internals and interfaces with `KafkaCluster` and `AnalyticsDB`
- `diagrams/001/iter4_data-pipeline.mmd` — end-to-end data flow from `RedirectEdge` through `KafkaCluster` to `AnalyticsDB`