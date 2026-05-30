## component-mongodb-ops

### Responsibilities

`mongodb_ops` is the primary operational database for the Node.js/Express backend. It serves as the system of record for all durable state that outlives individual request or job-worker cycles.

- **User and account registry**: Stores authentication credentials, profile attributes, timezone preferences, and account lifecycle state.
- **Social connection metadata**: Maintains linkage between a user and their connected platforms, including external platform user IDs, connection timestamps, and references to encrypted tokens held in `token_vault`.
- **Content metadata authority**: Tracks every photo and video post from inception through scheduling, transcoding, publishing, and final archival, including captions, hashtags, target platforms, and publish outcome history.
- **Posting preferences store**: Persists user-defined automation rules such as target platforms, posting frequency caps, daily time windows, media type filters, and caption templates.
- **Scheduler outbox**: Implements the transactional outbox pattern by atomically recording job intent alongside business data changes, allowing the `scheduler_service` to hand off durable jobs to `redis_streams_queue` without dual-write anomalies.
- **Platform configuration catalog**: Holds supported social network definitions, API version compatibility flags, content specification limits (e.g., max video duration, image aspect ratios), and default rate-limit baselines.
- **Media metadata index**: Stores lightweight references to objects in `object_storage`, including original filenames, checksums, MIME types, transcoding variant mappings, and processing state.

### Data Ownership

| Collection | Key Documents / Fields | Purpose |
|---|---|---|
| `users` | `email` (unique, sparse), `passwordHash`, `timezone`, `isActive`, `createdAt`, `updatedAt` | Core identity and profile data for the platform. |
| `social_connections` | `userId` (indexed), `platform` (e.g., `instagram`, `tiktok`), `platformUserId`, `connectionStatus` (`active`, `revoked`, `expired`), `tokenVaultRef`, `connectedAt`, `disconnectedAt` | Mapping between local users and external OAuth identities. |
| `content_items` | `userId`, `status` (`draft`, `scheduled`, `processing`, `published`, `failed`), `mediaType` (`photo`, `video`), `caption`, `hashtags` (array), `targetPlatforms` (array), `scheduledAt`, `publishedAt`, `failureReason`, `mediaRefs` (array of `storageKey` + `variant`), `publishResults` (array of platform-specific API response summaries) | Canonical record for every post. |
| `posting_preferences` | `userId` (unique), `platforms` (array with per-platform enablement), `frequency` (posts per day/week), `timeWindows` (array of `{ startHour, endHour, timezone }`), `mediaTypeFilter`, `captionTemplate`, `hashtagSets` | Automation rules that drive the scheduler. |
| `scheduler_outbox` | `jobType` (`publish`, `transcode`), `payload` (denormalized snapshot), `status` (`pending`, `processed`), `createdAt`, `processedAt`, `workerNodeId` | Transactional outbox consumed by the scheduler to emit Redis Streams messages. |
| `media_metadata` | `userId`, `contentItemId`, `originalFilename`, `mimeType`, `storageKey` (unique), `fileSizeBytes`, `checksum`, `variants` (array of `{ resolution, codec, storageKey }`), `processingStatus`, `uploadedAt` | Lightweight index of media assets without storing binary data. |
| `platform_configs` | `platform`, `apiVersion`, `maxVideoDurationSeconds`, `maxImageDimensions`, `supportedAspectRatios`, `featureFlags`, `defaultRateLimit` | Static and semi-static configuration for platform integrations. |

### APIs and Interfaces

- **Driver Interface**: Accessed through the Node.js native `mongodb` driver (v6.x) or Mongoose ODM. Services initialize a singleton `MongoClient` with connection pooling shared across the Express process.
- **Connection Topology**: Replica set URI (`mongodb://host1:27017,host2:27017,host3:27017/appdb?replicaSet=rs0&retryWrites=true&w=majority`) with SRV discovery enabled for dynamic node resolution.
- **Write Concerns**:
  - `w: "majority"`, `j: true` for `content_items` state transitions, `scheduler_outbox` inserts, and `social_connections` updates.
  - `w: 1` for `media_metadata` progress updates where transient loss is recoverable via re-processing.
- **Read Preferences**:
  - `primary` for scheduler queries and any reads participating in subsequent writes (to avoid stale reads causing duplicate jobs).
  - `secondaryPreferred` for user dashboard analytics and historical post listings where sub-second staleness is acceptable.
- **Transactions**: Multi-document ACID transactions (`client.startSession` + `session.withTransaction`) are used when updating `content_items.status` and inserting into `scheduler_outbox` to guarantee exactly-once job creation.
- **Change Streams**: The `scheduler_service` opens a persistent change stream on `scheduler_outbox` filtered to `{ fullDocument: { status: "pending" } }` to trigger near-real-time handoff to `redis_streams_queue`.
- **Aggregation Pipelines**: Dashboard endpoints use compound aggregations with `$lookup` into `media_metadata` and `$facet` for paginated post history plus per-platform success-rate metrics.
- **Indexing Contract**:
  - `users`: `{ email: 1 }` (unique), `{ createdAt: 1 }`
  - `content_items`: `{ userId: 1, status: 1, scheduledAt: 1 }`, `{ userId: 1, createdAt: -1 }`, `{ status: 1, scheduledAt: 1 }` (for scheduler sweep queries)
  - `scheduler_outbox`: `{ status: 1, createdAt: 1 }`, `{ processedAt: 1 }`
  - `media_metadata`: `{ userId: 1, contentItemId: 1 }`, `{ storageKey: 1 }` (unique), `{ processingStatus: 1, uploadedAt: 1 }`

### Failure Modes

- **Primary Failover / Election Loss**: If the replica set primary steps down, writes fail with `MongoServerError: not primary` for 2–10 seconds. Node.js driver retry logic (`retryWrites: true`) mitigates idempotent operations, but non-idempotent outbox inserts may require application-level deduplication on re-attempt.
- **Connection Pool Exhaustion**: Default `maxPoolSize: 100` per service instance can saturate when `job_worker` scales horizontally, causing `MongoNetworkTimeoutError` cascades. Pool metrics must be exposed via `mongoClient.options.maxPoolSize` and active connection counts.
- **Write Concern Timeout**: A lagging secondary can stall `w: "majority"` commits. The scheduler’s outbox writes will block, backing up the job creation pipeline until the lagging node catches up or is removed.
- **Document Bloat / 16 MB Cap**: Appending unbounded `publishResults` or retry history arrays to `content_items` risks approaching the BSON document limit. Application code must cap result arrays or offload detailed logs to a separate `publish_attempts` collection.
- **Index Miss Collscan**: Missing or mis-ordered compound indexes on `{ userId, status, scheduledAt }` causes the scheduler’s range queries to scan entire user partitions, spiking CPU and IOPS on the primary node during peak posting windows.
- **Oplog Window Pressure**: Burst writes from `media_processor` status updates or bulk preference imports can outpace secondary replication. If a secondary falls off the oplog, it requires a full resync, reducing redundancy.
- **Backup Inconsistency**: Logical backups (`mongodump`) captured without `--oplog` yield inconsistent snapshots across collections that participate in multi-document transactions, complicating point-in-time recovery.
- **Schema Drift**: As a schemaless store, uncoordinated schema changes (e.g., renaming `scheduledAt` to `publishAt`) can leave stale documents that crash Mongoose strict-mode validations or cause `undefined` field errors in aggregation pipelines.

### Scaling Considerations

- **Replica Set Read Scaling**: Route analytics, dashboard history, and `media_metadata` listing queries to secondaries with `readPreference: secondaryPreferred`. Pin scheduler polling and job-state updates to the primary to maintain causal consistency.
- **Sharding Strategy**: When `content_items` exceeds single-node storage or write throughput, shard by hashed `userId`. This distributes per-user write load evenly and keeps a user’s posts co-located for efficient range queries. Avoid monotonically increasing shard keys (e.g., `createdAt`) which create hot shards.
- **Outbox Collection Design**: `scheduler_outbox` is high-churn (insert-heavy, then deleted or marked processed). If using WiredTiger, monitor collection fragmentation. For extreme scale, consider a TTL index on `createdAt` (24-hour retention) plus an archival job rather than physical deletion.
- **Storage Growth Management**: Media metadata and content history are append-only. Implement a tiered retention policy: hot data in MongoDB for 90 days, then archive to `object_storage` as compressed JSON. Use TTL indexes on soft-deleted `content_items` after the user retention window expires.
- **Connection Budgeting**: Aggregate pool demand across all Node.js services (`api_gateway`, `auth_service`, `scheduler_service`, `media_service`, etc.). If 20 service replicas each open 50 connections, the cluster must support 1,000 sustained connections plus headroom for secondary sync and administrative shells.
- **Index Hot Spots**: High-velocity inserts into `scheduler_outbox` with a monotonic `createdAt` index can bottleneck the WiredTiger cache. Use a compound leading key with low cardinality prefix (e.g., `jobType`) or rely on hashed `_id` if ordering is not required for outbox polling.
- **Monitoring & Alerting**:
  - Replication lag: `replSetGetStatus.members[].optimeDate` delta > 10 seconds.
  - Slow queries: `db.currentOp({ "secs_running": { $gt: 0.1 } })` and profiler entries > 100 ms.
  - Cache pressure: WiredTiger `tracked dirty bytes in the cache` approaching 20% of RAM.
  - Oplog window: Ensure oplog size covers at least 24 hours of peak write volume.

### Related Diagrams

No paired Mermaid diagram was provided for this component document.