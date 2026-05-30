## component-mongodb

### Responsibilities

MongoDB serves as the sole primary database for the social media automation platform. Its concrete responsibilities include:

- **User and Identity Data**: Persisting user accounts, hashed credentials, profile attributes, and timezone preferences.
- **Social Platform State**: Storing active, expired, and revoked social media connections (`platform_connections`), including per-account metadata such as platform type, external account ID, handle, and connection health.
- **Automation Configuration**: Owning `posting_preferences` documents that encode each user’s scheduling rules—target platforms, posting frequency (interval or cron-based), media type filters, default captions, hashtag groups, and time-window constraints.
- **Content Lifecycle**: Recording post drafts, scheduled posts, and published post outcomes in the `posts` collection, including caption text, hashtag arrays, media references, intended platforms, and per-platform publish results.
- **Media Catalog**: Maintaining `media_metadata` records that map user uploads to keys in the external object storage layer, tracking MIME types, file sizes, thumbnail variants, and asynchronous processing state.
- **Job Orchestration Backing Store**: Acting as the persistence layer for Agenda.js. The `agendaJobs` collection holds job definitions, repeat intervals, next-run timestamps, distributed locks (`lockedAt`), failure counts, and payload data (e.g., `postId`, `userId`) required by the `agenda_worker`.
- **Token Persistence**: Hosting the encrypted credential documents managed by the `token_store` component, ensuring OAuth refresh and access tokens are durably stored with their associated metadata and encryption key references.
- **Publish Audit Trail**: Retaining `publish_logs` that capture every API attempt to external platforms—response codes, error payloads, retry numbers, and completion timestamps—to support debugging and user-facing history.

### Interfaces

MongoDB exposes no HTTP API directly; access is mediated through driver-level interfaces used by the Node.js backend services.

- **MongoDB Node.js Driver** (`mongodb`): All services use the native driver for direct CRUD, aggregation pipelines, bulk writes, and change stream consumption.
- **Mongoose ODM**: Services such as `user_service`, `content_service`, and `media_service` define strict schemas, validation hooks, and middleware through Mongoose models to enforce structure over the schemaless store.
- **Agenda.js Direct Connection**: `scheduler_service` and `agenda_worker` initialize Agenda with a dedicated or shared MongoDB connection. Agenda performs its own `findAndModify` operations against the `agendaJobs` collection for atomic job locking and scheduling.
- **Change Streams**: `notification_service` and `publisher_service` consume MongoDB Change Streams on the `posts` and `agendaJobs` collections to react to state transitions (e.g., `status` moving to `failed`) without relying on synchronous callbacks or polling loops.
- **Connection URI**: Services connect via standard `mongodb+srv://` or `mongodb://` URIs against a replica set. Read and write concerns are configured per operation; for example, post-status updates use `w: majority` to prevent stale reads by the scheduler, while dashboard analytics may use `readPreference: secondaryPreferred`.

### Data Ownership

The following collections are owned and governed by this component:

| Collection | Purpose | Key Fields / Indexes |
|---|---|---|
| `users` | Core account records | `email` (unique, sparse), `createdAt` |
| `profiles` | Extended user attributes | `userId` (unique, indexed) |
| `platform_connections` | Linked social accounts per user | Compound `{ userId: 1, platform: 1, connectionStatus: 1 }` |
| `posting_preferences` | Automation rules and defaults | `userId` (unique, indexed) |
| `posts` | Drafts, scheduled, and published content | Compound `{ userId: 1, status: 1, scheduledAt: -1 }`; `scheduledAt` (indexed) for scheduler range queries |
| `media_metadata` | Media file catalog and processing state | Compound `{ userId: 1, processingStatus: 1 }` |
| `agendaJobs` | Agenda.js job definitions and locks | `nextRunAt` (indexed), `name` (indexed), `lockedAt` (indexed); Agenda requires `{ name: 1, lockedAt: 1, nextRunAt: 1, priority: -1 }` |
| `publish_logs` | Per-platform API attempt history | `postId` (indexed), `attemptedAt` (TTL-candidate, indexed) |
| `oauth_tokens` | Encrypted OAuth credentials | `platformConnectionId` (unique, indexed), `userId` (indexed) |

**Schema Notes**
- `posts.platformResults` is an embedded array capturing the outcome per target platform (external post ID, published timestamp, error message). It is bounded by the number of platforms (≤5), so embedding remains efficient.
- `media_metadata.thumbnails` stores an array of variant objects (`{ key, width, height, format }`) referencing paths in object storage.
- `posting_preferences.frequencyRule` stores an embedded document with `type: 'interval' | 'cron'` and a `value` string, parsed by `scheduler_service` when generating Agenda jobs.

### Failure Modes

- **Replica Set Primary Failover**: Loss of the primary triggers an automatic election (typically 10–30 seconds). During the transition, writes fail with `MongoNotPrimaryError` or `MongoTimeoutError`. Services without idempotent retry logic may drop state updates or duplicate job enqueue requests.
- **Connection Pool Saturation**: Bursty traffic (e.g., bulk media imports) can exhaust the driver’s connection pool, yielding `MongoWaitQueueTimeoutError`. Default pool sizes (often 5–10) are insufficient for the `publisher_service` under concurrent platform bursts; each service must tune `maxPoolSize` (recommended 50–100 for workers, 20–30 for stateless API services).
- **Agenda Lock Contention and Double-Publish**: If the `agendaJobs` collection lacks the required compound index or if clock skew exists across `agenda_worker` nodes, Agenda’s find-and-modify locking fails. This can result in the same job being picked up by two workers, leading to duplicate posts on external platforms.
- **Unindexed Query Storms**: Dashboard queries filtering `posts` by `userId + status + scheduledAt` without a covering index cause collection scans. During peak hours, this spikes CPU and IOPS, delaying the `scheduler_service` reads and causing publish latency.
- **Disk Pressure from Unbounded Growth**: `publish_logs` and completed `agendaJobs` accumulate indefinitely. Without TTL indexes or an archival process, disk exhaustion halts all writes. The `agendaJobs` collection is particularly sensitive because Agenda does not prune completed jobs by default.
- **Partial Update Tears**: A post may succeed on Instagram’s API, but a subsequent MongoDB update (to `posts.status` and `platformResults`) may fail due to a network blip. The system then believes the post failed, triggering unnecessary retries. Mitigation: wrap the external API call and the status update in a saga pattern, or at minimum ensure the MongoDB update is retried independently.
- **Oplog Overrun**: Heavy write throughput from `agendaJobs` lock renewals and `publish_logs` inserts can cause secondaries to lag. If lag exceeds the oplog window, secondaries require full resyncs, degrading availability and breaking Change Stream consumers.

### Scaling Considerations

- **Working Set and RAM**: The hottest data paths—`users` logins, `posts` scheduler queries, and `agendaJobs` locks—must remain in WiredTiger cache. Vertical scaling (increasing RAM and IOPS on the primary) is the first line of defense before sharding.
- **Read Scaling with Secondaries**: Analytics dashboards and historical post browsing can target secondary nodes via `readPreference: secondaryPreferred`. **Critical exception**: `agendaJobs` reads and lock updates **must** remain directed to the primary to preserve Agenda’s consistency guarantees.
- **Sharding Strategy**:
  - Shard `posts` and `media_metadata` on a hashed `userId` shard key. This distributes tenant data evenly and keeps a single user’s posts co-located, optimizing dashboard queries.
  - **Do not shard `agendaJobs`**. Agenda.js relies on atomic find-and-modify operations that are not supported across shards in the same way. The job collection must reside on an unsharded replica set, or on a separate dedicated MongoDB cluster if the main cluster is sharded.
- **Archival and TTL**:
  - Implement a nightly job to migrate `publish_logs` and successfully completed `posts` older than 90 days to cold object storage (e.g., Parquet in S3).
  - Apply a TTL index on `publish_logs.attemptedAt` (e.g., 180 days) to automate pruning, after confirming compliance requirements.
- **Connection Budgeting**: In a containerized deployment, total connections to MongoDB equal `replica_count × process_count × maxPoolSize`. The aggregate must remain below the MongoDB host’s `ulimit` and RAM-derived connection ceiling. Favor shared singleton connections per service process over per-request instantiation.
- **Oplog Sizing**: Size the oplog to withstand at least 24–48 hours of peak write throughput. This ensures secondary resilience and uninterrupted Change Streams used by the notification pipeline.
- **Monitoring**: Track `wiredTiger.cache.bytes dirty in the cache`, `globalLock.currentQueue.total`, `opcounters`, and `db.collection.stats().avgObjSize` (watch for `posts` document growth due to large `platformResults` arrays). Alert on `agendaJobs` documents with abnormally high `failCount` or stale `lockedAt` values, which indicate worker stalls.