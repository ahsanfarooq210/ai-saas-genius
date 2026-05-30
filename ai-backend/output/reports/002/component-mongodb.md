## MongoDB

### Responsibilities

MongoDB serves as the primary persistent datastore for the social media automation platform. Its responsibilities include:

*   **User & Identity Storage**: Persisting user credentials, profile metadata, and account lifecycle state.
*   **Social Account Registry**: Storing connected platform accounts (Instagram, Twitter/X, Facebook, LinkedIn, TikTok), platform-specific user identifiers, and encrypted OAuth refresh token references.
*   **Preferences & Configuration**: Hosting user-defined posting preferences including target platforms, media type, caption templates, hashtag sets, timezone-aware publishing windows, and frequency rules.
*   **Content & Media Metadata**: Recording post drafts, scheduled content records, captions, hashtags, publishing status, and pointers to objects stored in S3.
*   **Job State & Queue Backing**: Acting as the durable storage layer for Agenda.js, maintaining job definitions, scheduling metadata, lock state, execution history, and failure counters.
*   **Notification History**: Retaining notification payloads, delivery status, and read/unread state for in-app and email digests.
*   **Transactional Integrity**: Providing multi-document ACID transactions where cross-collection updates must be atomic (e.g., marking a post as `published` and recording the platform's returned `postId`).

### Interfaces

Other platform services interact with MongoDB through the following interfaces:

*   **Node.js Native Driver / Mongoose ODM**: Services use the official `mongodb` driver or Mongoose schemas to model collections, enforce validation, and manage middleware hooks.
*   **Connection Pool**: Each service instance maintains a configurable connection pool (default `maxPoolSize: 10–50`) via a shared replica set URI (`mongodb://host1,host2,host3/db?replicaSet=rs0`).
*   **Read/Write Concerns**: Services specify concerns at the operation level:
    *   Critical writes (OAuth token updates, job completion, post state transitions): `w: "majority"`, `j: true`.
    *   High-throughput inserts (audit events): `w: 1`.
*   **Change Streams**: The `Job_Service` and `Notification_Service` may optionally consume change streams on the `posts` and `jobs` collections to trigger side effects without polling.
*   **Operational Interfaces**: `mongodump` / `mongorestore` for point-in-time backups, and the MongoDB shell for administrative index management and schema migrations.

### Data Model

The following collections are owned and managed within the platform database:

#### `users`
Core identity records.
*   **Fields**: `_id` (ObjectId), `email` (unique, indexed), `passwordHash`, `fullName`, `timezone`, `locale`, `isActive`, `createdAt`, `updatedAt`.
*   **Indexes**: Unique ascending on `email`.

#### `socialAccounts`
Connected third-party platform credentials.
*   **Fields**: `_id`, `userId` (ObjectId, ref), `platform` (string enum), `platformUserId` (string), `accountName`, `encryptedRefreshToken`, `tokenExpiryDate`, `scopes` (array), `isActive`, `connectedAt`, `disconnectedAt`.
*   **Indexes**: `{ userId: 1 }`, `{ platform: 1, platformUserId: 1 }` (unique), `{ isActive: 1 }`.

#### `preferences`
Posting schedule and content rules.
*   **Fields**: `_id`, `userId` (ObjectId, unique ref), `targetPlatforms` (array of strings), `postingFrequency` (embedded: `{ count: Number, period: String }`), `mediaType` (enum: `photo`, `video`, `mixed`), `defaultCaption`, `hashtagSets` (array of strings), `publishingTimes` (array of `{ dayOfWeek: Number, hour: Number, minute: Number }`), `timezone`.
*   **Indexes**: Unique ascending on `userId`.

#### `posts`
Content lifecycle records.
*   **Fields**: `_id`, `userId` (ObjectId, ref), `status` (enum: `draft`, `scheduled`, `publishing`, `published`, `failed`), `caption`, `hashtags` (array), `mediaIds` (array of ObjectId refs to `media`), `scheduledAt` (Date), `publishedAt` (Date), `platformResponses` (embedded array: `{ platform, externalPostId, url, publishedAt }`), `failureReason`, `createdAt`.
*   **Indexes**: `{ userId: 1, status: 1 }`, `{ scheduledAt: 1 }`, `{ status: 1, scheduledAt: 1 }` (for Job_Service polling).

#### `media`
Media asset metadata.
*   **Fields**: `_id`, `userId` (ObjectId, ref), `filename`, `originalS3Key`, `processedS3Key`, `mimeType`, `sizeBytes`, `dimensions` (embedded: `{ width, height }`), `durationSeconds` (for video), `cdnUrl`, `createdAt`.
*   **Indexes**: `{ userId: 1, createdAt: -1 }`.

#### `agendaJobs` (Agenda.js managed)
Background job queue storage.
*   **Fields**: `name` (string), `data` (embedded: `{ userId, postId, platform, ... }`), `type` (normal/single), `priority` (Number), `nextRunAt` (Date), `lastModifiedBy` (string), `lockedAt` (Date), `lastRunAt` (Date), `lastFinishedAt` (Date), `failCount` (Number), `failReason`, `repeatInterval`, `repeatTimezone`.
*   **Indexes**: Managed automatically by Agenda.js. Critical compound index: `{ lockedAt: 1, nextRunAt: 1, priority: -1, name: 1 }`.

#### `notifications`
User-facing alert records.
*   **Fields**: `_id`, `userId` (ObjectId, ref), `type` (enum: `email`, `push`, `in_app`), `title`, `message`, `isRead` (Boolean), `relatedJobId`, `relatedPostId`, `createdAt`.
*   **Indexes**: `{ userId: 1, createdAt: -1 }`, `{ userId: 1, isRead: 1 }`.

### Failure Modes

*   **Replica Set Primary Election**: If the primary node fails, write availability pauses during election (typically 2–12 seconds). Services must surface `MongoServerSelectionError` as a transient fault and retry with exponential backoff.
*   **Agenda.js Lock Contention**: Under high concurrency, multiple `Job_Service` workers may compete for the same job document. Misconfigured `lockLifetime` or slow queries can cause jobs to stall, duplicate execution, or fail with `timeout` errors.
*   **Unindexed Query Performance**: Missing indexes on hot query patterns—such as `Job_Service` polling `{ status: "scheduled", scheduledAt: { $lte: now } }`—result in collection scans and CPU saturation on the primary.
*   **Write Conflict Hotspots**: WiredTiger storage engine throws write conflicts when concurrent operations modify the same document (e.g., incrementing a global counter or updating a shared job state). High-frequency single-document updates must be redesigned as idempotent operations or distributed across documents.
*   **Disk Saturation**: MongoDB enforces a hard stop on writes when available disk space drops below configured thresholds. The `media` and `posts` collections grow linearly with user activity and require proactive capacity monitoring.
*   **Replication Lag Stale Reads**: If services use `readPreference: secondaryPreferred` for notification or analytics queries, replication lag may expose recently created posts or completed jobs as missing. Strongly consistent workflows (e.g., job state machines) must read from the primary.
*   **Foreground Index Builds**: Creating indexes without `background: true` on large collections (e.g., `agendaJobs` or `posts`) acquires an exclusive database lock, halting all client operations for that database.

### Scaling Considerations

*   **Working Set & RAM**: Ensure the total size of hot indexes and frequently accessed documents fits in RAM. The `posts` and `agendaJobs` collections are high-velocity and should be sized to keep working sets in memory.
*   **Sharding Strategy**:
    *   `users`, `posts`, `media`, and `socialAccounts` can be sharded by `userId`. A **hashed** `userId` shard key distributes write load evenly but sacrifices data locality. A **ranged** `userId` shard key preserves locality per user but risks hot shards for high-activity accounts.
    *   The `agendaJobs` collection **must remain unsharded**; Agenda.js does not support sharded job collections. If job volume exceeds the IOPS of a single shard, partition jobs horizontally by creating separate Agenda.js namespaces (e.g., `agendaJobsTier1`, `agendaJobsTier2`) or offload to a dedicated MongoDB cluster.
*   **Read Scaling**: Offload analytics, notification history, and media gallery lookups to secondary nodes using `secondaryPreferred`. Never use secondaries for transactional job state transitions.
*   **TTL & Capped Collections**:
    *   Apply a TTL index on `notifications.createdAt` to expire records older than 90 days.
    *   Consider capped collections for high-volume webhook audit logs if only recent events are relevant.
*   **Connection Pool Budget**: With seven services connecting to the replica set, total inbound connections scale as `poolSize × serviceInstances × serviceCount`. Monitor against `net.maxIncomingConnections` and OS file descriptor limits.
*   **Storage Engine Tuning**: Use WiredTiger with compression enabled. The `platformResponses` and `hashtagSets` arrays in `posts` can inflate document size; compression reduces storage overhead and I/O.
*   **Backup & Recovery**: Use EBS snapshots or filesystem-consistent backups for point-in-time recovery. `mongodump` is acceptable for smaller collections but impractical for multi-terabyte `media` metadata stores; rely on snapshotting the underlying volumes.

### Related Diagrams

No paired component diagram was provided for this document. MongoDB appears across multiple architecture diagrams, including the system overview.