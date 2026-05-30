# MongoDB

## Responsibilities

MongoDB serves as the primary operational database for the social media automation platform. Its core responsibilities include:

- **User and Identity Persistence**: Storing user account records, profile attributes, and authentication credentials (hashed passwords).
- **Platform Connection State**: Maintaining metadata for linked social accounts—platform type, external account IDs, connection status, and references to encrypted OAuth tokens held in the `token_store` abstraction.
- **Posting Preferences**: Persisting user-defined automation rules, including target platforms, posting frequency (interval or cron-based), media type constraints (photo/video/mixed), caption templates, hashtag pools, timezone-aware preferred publishing windows, and per-platform overrides.
- **Content and Post Lifecycle**: Recording assembled post content (captions, hashtags), media references (object storage keys), and the full lifecycle state of each post: draft, scheduled, publishing, published, or failed.
- **Agenda.js Job Backend**: Acting as the persistence layer for the job queue. The `agendaJobs` collection stores job definitions, schedule metadata, worker lock state, repeat intervals, and execution history.
- **Media Metadata**: Tracking uploaded photo and video assets with original filenames, MIME types, storage keys, byte sizes, processing status, and ownership linkage.

## Data Model

MongoDB owns the following collections, each with specific indexing and schema constraints:

### `users`
- `_id` (ObjectId)
- `email` (String, unique, sparse index)
- `password_hash` (String, bcrypt)
- `timezone` (String, e.g., `"America/New_York"`)
- `created_at`, `updated_at` (ISODate)

### `platform_connections`
- `_id` (ObjectId)
- `user_id` (ObjectId, indexed)
- `platform` (String enum: `twitter`, `instagram`, `facebook`, `linkedin`)
- `platform_account_id` (String)
- `token_ref` (ObjectId, reference to `tokens._id`)
- `connection_status` (String enum: `active`, `revoked`, `expired`)
- `connected_at`, `updated_at` (ISODate)
- **Index**: `{ user_id: 1, platform: 1 }`

### `posting_preferences`
- `_id` (ObjectId)
- `user_id` (ObjectId, unique sparse index)
- `platforms` (String array)
- `frequency` (Subdocument: `{ type: "interval"|"cron", value: String }`)
- `media_type` (String enum: `photo`, `video`, `mixed`)
- `caption_templates` (String array)
- `hashtag_sets` (Array of string arrays)
- `preferred_times` (String array, HH:MM format)
- `timezone` (String)
- `account_overrides` (Map: platform → subdocument)

### `posts`
- `_id` (ObjectId)
- `user_id` (ObjectId, indexed)
- `content_id` (ObjectId, reference to `content._id`)
- `platform_connection_ids` (ObjectId array)
- `caption` (String)
- `hashtags` (String array)
- `media_object_keys` (String array, pointers to object storage)
- `status` (String enum: `draft`, `scheduled`, `publishing`, `published`, `failed`)
- `scheduled_at` (ISODate, indexed)
- `published_at` (ISODate)
- `platform_post_ids` (Map: platform → external post ID string)
- `error_log` (Embedded array: `{ platform, message, timestamp }`, capped to last 20 entries in application logic)
- `created_at`, `updated_at` (ISODate)
- **Indexes**: `{ user_id: 1, scheduled_at: -1 }`, `{ status: 1, scheduled_at: 1 }`

### `content`
- `_id` (ObjectId)
- `user_id` (ObjectId, indexed)
- `caption` (String)
- `hashtags` (String array)
- `media_refs` (Array of subdocuments: `{ media_id, storage_key, type }`)
- `assembly_status` (String enum: `pending`, `ready`, `failed`)
- `created_at` (ISODate)

### `media`
- `_id` (ObjectId)
- `user_id` (ObjectId, indexed)
- `filename` (String)
- `storage_key` (String, unique)
- `mime_type` (String)
- `size_bytes` (Number)
- `processing_status` (String enum: `uploaded`, `processing`, `ready`, `failed`)
- `created_at` (ISODate)
- **Index**: `{ user_id: 1, created_at: -1 }`

### `agendaJobs` (managed by Agenda.js)
- `_id` (ObjectId)
- `name` (String, indexed)
- `data` (Subdocument containing `user_id`, `post_id`, and job-specific payload)
- `type` (String: `normal`, `single`)
- `priority` (Number)
- `nextRunAt` (ISODate, indexed)
- `lastModifiedBy` (String, worker identifier)
- `lockedAt` (ISODate, indexed)
- `lastFinishedAt` (ISODate)
- `lastRunAt` (ISODate)
- `failCount` (Number)
- `failReason` (String)
- `repeatInterval` (String)
- `repeatTimezone` (String)

### `tokens` (backing store for `token_store`)
- `_id` (ObjectId)
- `user_id` (ObjectId, indexed)
- `platform_connection_id` (ObjectId, indexed)
- `encrypted_access_token` (Binary or String)
- `encrypted_refresh_token` (Binary or String)
- `expires_at` (ISODate)
- `created_at`, `updated_at` (ISODate)

## APIs and Interfaces

- **MongoDB Wire Protocol / Mongoose ODM**: All Node.js services connect via Mongoose (v8.x) over TLS. Connection strings target a replica set (`mongodb://host1,host2,host3/db?replicaSet=rs0`).
- **Connection Pooling**: Each service instance configures `maxPoolSize: 20` (tunable via `MONGODB_MAX_POOL_SIZE`). In containerized deployments, this is reduced to `10` to prevent aggregate connection saturation.
- **Write and Read Concerns**:
  - User-facing writes (`users`, `platform_connections`, `posts`) use `retryWrites=true` and `w=majority`.
  - General queries use `readPreference: primaryPreferred`.
  - Historical post lookups and analytics-style reads use `readPreference: secondaryPreferred` to offload the primary.
- **Agenda.js Integration**: The `scheduler_service` and `agenda_worker` initialize Agenda with `agenda.mongo(mongooseConnection.db, 'agendaJobs')`, ensuring both services share the same job collection for coordination.
- **Schema Validation**: Mongoose schemas enforce required fields, enums, and custom validators (e.g., ensuring `preferred_times` entries match a HH:MM regex). Pre-save hooks normalize `hashtags` to lowercase and trim whitespace.

## Failure Modes

- **Replica Set Failover**: During a primary election, writes fail with `MongoServerError: not primary`. Retryable writes (`retryWrites=true`) mitigate transient failures, but services must still handle initial errors gracefully to avoid dropping user preference updates.
- **Connection Pool Exhaustion**: If aggregate connections across all service replicas exceed MongoDB’s practical limits, operations fail with `MongoWaitQueueTimeoutError`. This is mitigated by tuning per-process `maxPoolSize` and avoiding per-request connection creation.
- **Agenda Lock Contention**: High job volume causes hot-spotting on the `agendaJobs` collection, particularly around `lockedAt` and `nextRunAt`. Symptoms include delayed job execution and CPU spikes on the primary. Mitigation requires tuning `lockLifetime`, avoiding sub-minute repeat intervals, and ensuring job processing is idempotent.
- **BSON Document Size Limit (16 MB)**: Unbounded growth in `posts.error_log` or extremely large `media_object_keys` arrays can approach the 16 MB document cap. The application caps error logs to the last 20 entries and paginates media references across documents if necessary.
- **Orphaned Data on Deletion**: Without multi-document ACID transactions, deleting a user could leave dangling `platform_connections`, `posts`, and `media` records if the process crashes mid-operation. Critical deletion paths must use MongoDB 4.0+ transactions spanning the `users`, `platform_connections`, `posts`, and `media` collections.
- **Index Build Interruption**: Creating indexes on high-volume collections (e.g., `agendaJobs` with millions of documents) can lock the collection or fail in progress. Index builds should run with `background: true` during maintenance windows, or use cloud provider rolling index build features.
- **Disk Space Exhaustion**: Indefinite retention of job history and published posts leads to storage bloat. Mitigation includes Agenda’s built-in job purging, TTL indexes on `posts.published_at` (e.g., 90 days), and automated cleanup of unreferenced `media` records after 7 days.

## Scaling Considerations

- **Replica Sets**: A minimum 3-node replica set (1 primary, 2 secondaries) is required for production. Read-heavy reporting queries (e.g., post history) are directed to secondaries to preserve primary capacity for writes and job scheduling.
- **Sharding**:
  - The `posts` collection should be sharded by hashed `user_id` to distribute per-user write and read load evenly.
  - `agendaJobs` is challenging to shard due to Agenda’s query patterns. If job volume exceeds single-replica capacity, isolate Agenda to a dedicated MongoDB cluster or shard by `name` (hashed) after thorough query pattern validation.
- **TTL and Archival**:
  - TTL index on `posts.published_at` for automatic expiration of published records after the business-defined retention period.
  - TTL index on `media.created_at` for temporary upload garbage collection.
  - Scheduled purge of completed `agendaJobs` older than 30 days to prevent unbounded collection growth.
- **Backup and Recovery**:
  - Continuous cloud snapshots with oplog-based point-in-time recovery (PITR) are required for `users`, `platform_connections`, and `posting_preferences` (RPO < 1 hour).
  - `agendaJobs` can be reconstructed from `posting_preferences` if lost, but PITR is still recommended to avoid re-scheduling storms.
- **Observability**:
  - Enable the MongoDB Database Profiler for operations slower than 100 ms to detect missing indexes.
  - Monitor `connections.current`, `globalLock.activeClients`, `wiredTiger.cache.bytes dirty in the cache cumulative`, and `opcounters` to correlate application behavior with database load.

## Related Diagrams

No paired Mermaid diagram was provided for this document.