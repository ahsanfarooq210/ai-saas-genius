## component-mongodb

## Responsibilities

MongoDB is the sole primary database for the platform. It persists all relational and time-series data required by the Node.js/Express backend and acts as the persistence layer for Agenda.js job scheduling.

Specific responsibilities include:

- **User & Identity Data**: Stores user accounts, credential hashes, profile attributes, and refresh-token metadata managed by `auth_service`.
- **Platform Configuration & Preferences**: Stores per-user posting preferences, target platform lists, media-type rules, caption templates, hashtag sets, timezone-aware publishing windows, and account-specific overrides managed by `user_service`.
- **OAuth Token Vault Backing Store**: Physically stores encrypted OAuth access tokens and refresh tokens written by `token_store`, indexed by `userId` and `platform`.
- **Job Queue Persistence**: Serves as the Agenda.js backend. Maintains job definitions, run history, lock state, failure counts, and retry schedules for the `job_scheduler`.
- **Post & Media Metadata**: Stores post records (status, caption, hashtags, target platforms, scheduled time), and media file metadata (original/processed storage keys, MIME type, dimensions, duration) managed by `media_processor` and `user_service`.
- **Analytics & Engagement Data**: Ingests time-series performance metrics (impressions, reach, likes, shares, comments) and job execution statistics from `analytics_collector`.
- **Transaction Coordination**: Provides multi-document ACID transactions for operations that must mutate user settings and post state atomically.

## Interfaces

- **Driver**: Official MongoDB Node.js driver (v6.x) or Mongoose ODM (v8.x) with schema validation, pre/post middleware, and type definitions.
- **Connection URI**: Replica-set connection string exposed via environment variable:
  ```
  mongodb+srv://<user>:<pass>@<host>/<dbname>?retryWrites=true&w=majority&readPreference=primary&maxPoolSize=50
  ```
- **Connection Pool**: Shared pool across services (default 10, scaled to 50 for the `job_scheduler` and `api_gateway` workers). Pool metrics should be emitted to application logs.
- **Agenda.js Integration**: `job_scheduler` initializes Agenda with `mongo: dbInstance` or connection string, causing Agenda to create and manage its own collections (default names: `agendaJobs`).
- **Query Interface**: Standard CRUD via driver/Mongoose. Key access patterns include:
  - Point lookups by `_id` or `userId`.
  - Range scans on `scheduledAt` / `nextRunAt` for scheduling and dashboard queries.
  - Time-range aggregation pipelines on `analytics` for reporting.
- **Backup Interface**: `mongodump` / `mongorestore` or cloud provider point-in-time snapshots for operational backups.

## Data Model

The following collections are owned and managed within the MongoDB deployment:

| Collection | Owner / Primary Writer | Key Fields | Purpose |
|---|---|---|---|
| `users` | `auth_service` | `_id`, `email`, `passwordHash`, `createdAt`, `profile` (name, timezone, locale) | Core identity records. |
| `user_settings` | `user_service` | `userId`, `platforms`, `postingFrequency`, `mediaType`, `defaultCaptions`, `hashtagSets`, `publishingWindows`, `platformOverrides` | Posting preferences and scheduling rules. |
| `platform_tokens` | `token_store` | `userId`, `platform`, `accessToken` (encrypted), `refreshToken` (encrypted), `expiresAt`, `scope` | Encrypted OAuth credentials. |
| `posts` | `user_service`, `job_scheduler` | `_id`, `userId`, `status` (draft/scheduled/published/failed), `mediaIds[]`, `caption`, `hashtags[]`, `targetPlatforms[]`, `scheduledAt`, `publishedAt`, `platformPostIds`, `jobId` | Content lifecycle and publication tracking. |
| `media_metadata` | `media_processor` | `_id`, `userId`, `originalStorageKey`, `processedVariants[]` (platform, storageKey, width, height, format), `mimeType`, `fileSize`, `duration`, `uploadedAt` | Index of blobs stored in `media_storage`. |
| `agendaJobs` | `job_scheduler` (Agenda.js) | `_id`, `name`, `data` (userId, postId, platforms), `type`, `priority`, `nextRunAt`, `lastRunAt`, `failCount`, `failReason`, `lockedAt`, `lastModifiedBy` | Job queue and execution state. |
| `analytics` | `analytics_collector` | `postId`, `userId`, `platform`, `metrics` (impressions, likes, shares, comments, reach), `collectedAt`, `jobExecutionStats` | Engagement and performance time-series. |
| `refresh_tokens` | `auth_service` | `userId`, `tokenHash`, `issuedAt`, `expiresAt`, `revoked`, `ipAddress`, `userAgent` | Long-lived session metadata for JWT refresh flows. |

**Schema Enforcement**: Mongoose schemas enforce required fields, enums (e.g., `status`, `platform`), and custom validators. Encrypted token fields use Mongoose `transform` or pre-save hooks to ensure plaintext never hits disk.

## Failure Modes

- **Replica Set Primary Failover**: If the primary steps down, writes fail until a new primary is elected. The Node.js driver with `retryWrites=true` will automatically retry idempotent operations, but non-idempotent application logic must handle `MongoServerError` with code 11600/11602 (InterruptedDueToReplStateChange).
- **Connection Pool Saturation**: Heavy concurrency from `job_scheduler` polling and `api_gateway` user requests can exhaust the 50-connection pool, causing cascading latency. Mitigate with pool monitoring, operation-level timeouts (`serverSelectionTimeoutMS`, `socketTimeoutMS`), and circuit breakers.
- **Unbounded Collection Growth**: `agendaJobs` retains failed jobs indefinitely by default; `analytics` grows linearly with posts and platforms. Without TTL indexes or archival jobs, disk space exhaustion and degraded query performance will occur.
- **Missing Index Query Collapse**: Range queries on `posts` by `userId + scheduledAt` or `analytics` by `postId + collectedAt` will trigger collection scans (COLLSCAN) if compound indexes are omitted, spiking CPU and blocking the oplog.
- **Index Build Impact**: Foreground index builds on large `analytics` or `posts` collections block writes. Use `createIndex` with `background: true` (or rolling build procedures in production) to avoid service interruption.
- **Data Inconsistency on Sharding Misconfiguration**: If sharded later, a poorly chosen shard key (e.g., monotonically increasing `_id`) creates hot shards on the primary node, causing uneven load and potential write rejection.
- **Backup/Restore Skew**: Restoring from a snapshot that lags behind `media_storage` or `cdn` state results in orphaned metadata records or missing post references. Backups must be coordinated or metadata must tolerate stale blob references.

## Scaling Considerations

- **Vertical Scaling (Initial)**: Increase RAM, CPU, and IOPS on the replica set primary to handle working-set growth (user settings, active jobs, recent analytics). WiredTiger cache should be sized to ~50% of available RAM.
- **Read Scaling via Secondaries**: Route analytics aggregation pipelines and historical post lookups to secondary nodes (`readPreference: secondaryPreferred`). Avoid secondary reads for `job_scheduler` state checks to prevent stale job execution decisions.
- **Sharding Strategy**:
  - **Tenant Isolation**: Shard `user_settings`, `posts`, and `media_metadata` by `userId` (hashed) to distribute tenant data evenly and localize queries.
  - **Time-Series**: Shard `analytics` by a composite key (`{ platform: 1, collectedAt: 1 }` or `{ userId: 1, collectedAt: 1 }`) to parallelize large aggregation pipelines.
  - **Job Collection**: Keep `agendaJobs` unsharded in a dedicated config server or small replica set unless job volume exceeds tens of millions per day; Agenda.js does not natively support sharded job collections.
- **Indexing Strategy**:
  ```javascript
  // users
  db.users.createIndex({ email: 1 }, { unique: true });
  
  // user_settings
  db.user_settings.createIndex({ userId: 1 }, { unique: true });
  
  // posts
  db.posts.createIndex({ userId: 1, scheduledAt: 1, status: 1 });
  db.posts.createIndex({ jobId: 1 });
  
  // platform_tokens
  db.platform_tokens.createIndex({ userId: 1, platform: 1 });
  db.platform_tokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL for cleanup
  
  // analytics
  db.analytics.createIndex({ postId: 1, platform: 1, collectedAt: -1 });
  db.analytics.createIndex({ userId: 1, collectedAt: -1 });
  ```
- **Data Lifecycle & TTL**:
  - Apply a TTL index on `analytics.collectedAt` (e.g., 90 days) to auto-purge stale metrics per retention policy.
  - Implement an application-level archival job to move completed `posts` and `agendaJobs` older than N days to a cold storage archive collection or S3/parquet before TTL deletion.
- **Storage Engine**: WiredTiger with Snappy compression (default). For analytics-heavy workloads, evaluate `zstd` compression if the MongoDB version supports it.
- **Oplog Sizing**: Size the oplog to cover at least 24–48 hours of write throughput to prevent replication lag from forcing a full resync during high-volume analytics ingestion.
- **Write Concern Tuning**: Use `w: "majority"` for user settings, post state transitions, and token updates. Use `w: 1` and `j: false` (with caution) only for high-frequency, loss-tolerant analytics inserts if latency is critical.

## Related Diagrams

- `diagrams/001/iter1_component-mongodb.mmd`