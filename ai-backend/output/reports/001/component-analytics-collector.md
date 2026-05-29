## Analytics Collector

### Responsibilities
- **Metric ingestion**: Receive publish confirmations from `platform_publisher`—including `platformPostId`, `platform`, `userId`, and `publishedAt`—to initialize tracking records for each published post.
- **Platform polling**: Execute scheduled background jobs that query social media platform APIs (e.g., Instagram Graph API, X API, Facebook Graph API) to retrieve post-level performance data such as impressions, reach, likes, comments, shares, saves, and video views.
- **Normalization**: Map heterogeneous platform-specific response schemas into a unified domain model before persistence, handling unit differences and deprecated fields.
- **Time-series capture**: Store periodic engagement snapshots to enable trend analysis and historical reporting for user dashboards.
- **Job telemetry**: Record execution metadata for publish and prepare jobs (start time, end time, duration, attempt count, terminal status, error codes) as they complete through the publishing pipeline.
- **Query serving**: Expose filtered read interfaces for downstream services that render analytics summaries, user-facing reports, or administrative operational dashboards.

### APIs and Interfaces
- **`POST /internal/analytics/ingest`**  
  Called by `platform_publisher` immediately after a post is confirmed live or after a publish attempt terminates. Accepts:
  ```json
  {
    "userId": "string",
    "postId": "string",
    "platform": "enum",
    "platformPostId": "string",
    "publishedAt": "ISO-8601",
    "jobMeta": { "jobId": "string", "durationMs": "number", "status": "enum", "errorCode": "string?" }
  }
  ```
- **`GET /internal/analytics/posts/:postId/latest`**  
  Returns the most recent normalized metric set for a given post, including aggregated engagement totals and the `lastPolledAt` timestamp.
- **`GET /internal/analytics/users/:userId/summary`**  
  Returns rolled-up engagement and publishing statistics across all active platforms and recent time windows for dashboard rendering.
- **Agenda.js job definitions** (registered with `job_scheduler`):
  - `analytics.fetch-metrics` — Polls platform APIs for all posts within a configurable lookback window (e.g., last 30 days) and upserts snapshot documents.
  - `analytics.aggregate-daily` — Computes daily rollups from raw engagement snapshots and writes them to a separate summary collection to accelerate reads.
- **MongoDB driver** — Direct CRUD operations against analytics collections using indexed queries on `userId`, `postId`, and `capturedAt`.

### Data Ownership
All data is persisted in MongoDB under isolated collections:

- **`analytics.posts`**  
  Canonical record per published post. Contains `postId`, `userId`, `platform`, `platformPostId`, `publishedAt`, latest normalized metrics (impressions, reach, engagement totals), and `lastUpdatedAt`.

- **`analytics.engagement`**  
  Append-only time-series documents keyed by `postId` and `capturedAt`. Stores raw metric values retrieved during each polling cycle to support trend graphs and historical correction.

- **`analytics.job_runs`**  
  Telemetry records for pipeline execution. Fields include `jobId`, `jobName` (e.g., `publish-to-instagram`), `userId`, `scheduledAt`, `startedAt`, `completedAt`, `status` (`completed`, `failed`, `cancelled`), `attempt`, and `errorCode`.

- **`analytics.ingest_log`**  
  Short-term buffer of raw platform API responses (retained for 7 days) used for debugging normalization failures and replaying ingestion on schema updates.

### Failure Modes
- **Platform API rate limiting**: Social media APIs enforce strict request quotas. Hitting a limit stalls the `analytics.fetch-metrics` job queue, causing engagement snapshots to lag behind real-time data and producing stale dashboard figures.
- **Token scope revocation**: If a user removes an application permission or the stored OAuth token expires, polling requests return 401/403 errors. Without graceful degradation, the system repeatedly retries failed posts, wasting workers and triggering platform penalties.
- **Schema drift**: Platforms may rename, deprecate, or restructure metric fields without warning. Unmapped fields result in `null` normalized values and incomplete user reports until the mapping layer is patched.
- **Silent job loss**: If an Agenda.js worker processing `analytics.fetch-metrics` crashes between dequeue and acknowledgment, the job may not be rescheduled automatically, leaving affected posts without updated metrics indefinitely.
- **Write hotspotting**: Viral posts generating high comment velocity can create concurrent polling cycles that bombard a single `postId` shard key, spiking MongoDB write latency on the `analytics.engagement` collection.
- **Clock skew**: Discrepancies between the application’s `publishedAt` timestamp and the platform’s recorded creation time can misalign time-series buckets, producing anomalous spike/dip artifacts in daily aggregations.

### Scaling Considerations
- **Database sharding**: Shard `analytics.engagement` on a composite key such as `{ userId: 1, postId: 1 }` to distribute the high write throughput of snapshot inserts across multiple MongoDB shards.
- **TTL indexes and retention policies**: Apply a 90-day TTL index to `analytics.engagement` raw snapshots and a 30-day TTL to `analytics.ingest_log`. Keep `analytics.posts` and rolled-up daily aggregates indefinitely to balance storage cost with query performance.
- **Bulk operations**: Use MongoDB bulk writes (`initializeUnorderedBulkOp`) when persisting batches of platform metrics, and leverage platform-specific batch API endpoints (e.g., Facebook Graph API batch requests) where available to minimize HTTP round-trips.
- **Worker isolation**: Run analytics Agenda.js workers on separate Node.js processes from `platform_publisher` and `media_processor` workers. This prevents polling I/O from competing with time-sensitive publish jobs.
- **Read replica routing**: Direct all dashboard aggregation queries (`GET /internal/analytics/users/:userId/summary`) to MongoDB secondary nodes, reserving the primary for write-heavy ingestion and snapshot inserts.
- **Circuit breaking and backoff**: Implement per-platform circuit breakers and exponential backoff in the polling layer. If a platform endpoint returns persistent 5xx or rate-limit errors, the breaker opens and polling pauses for that platform, preventing queue saturation and allowing upstream jobs to drain.

## Related Diagrams

No paired Mermaid diagram was provided for this component.