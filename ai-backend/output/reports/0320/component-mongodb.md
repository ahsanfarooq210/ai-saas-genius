## Overview

MongoDB serves as the primary document database and system of record for the social media automation platform. It persists all transactional domain data—including user accounts, posting preferences, composed posts, media metadata, Agenda.js job definitions, rate-limit windows, and notification logs. Because Agenda.js uses MongoDB as its backend store, the database is also the durable ledger for the background job queue that drives automated publishing.

## Responsibilities

- **Domain Persistence**: Store and retrieve documents for users, social account linkages, posting preferences, posts, and media assets.
- **Job Queue Storage**: Provide the underlying collection infrastructure for Agenda.js to schedule, lock, and track background publishing jobs.
- **Operational Metadata**: Maintain rate-limit counters per platform and audit logs for notifications and job lifecycle events.
- **Consistency for Critical Updates**: Support atomic single-document updates and multi-document transactions where cross-collection consistency is required (e.g., marking a job completed and a post published).
- **Indexing & Query Performance**: Enforce indexes that support tenant-scoped lookups, time-range queries for scheduling, and platform-specific rate-limit windows.

## Data Owned

The following collections (and their core fields) are owned and managed within MongoDB:

### `users`
- `_id`, `email` (unique), `passwordHash`, `isVerified`, `createdAt`, `updatedAt`
- Links to application-level roles and onboarding state.

### `posting_preferences`
- `userId` (ref), `targetPlatforms` (array: `instagram`, `twitter`, `facebook`, etc.)
- `frequency` (cron string or structured interval), `mediaTypes` (`photo`, `video`)
- `captionTemplates` (ordered strings), `hashtagPools` (grouped arrays)
- `timezone`, `activeHours` (array of `{ start, end }`), `accountOverrides` (platform-specific maps)

### `social_accounts`
- `userId` (ref), `platform`, `platformUserId`, `tokenVaultRef` (opaque key to the Token Vault)
- `isActive`, `linkedAt`, `unlinkedAt`

### `agendaJobs` (Agenda.js managed)
- `name`, `data` (embeds `userId`, `postId`, `mediaIds`, `platforms`), `type`, `priority`
- `nextRunAt`, `lastRunAt`, `lastFinishedAt`, `lockedAt`, `lastModifiedBy`
- `failCount`, `failReason`, `repeatInterval`, `repeatTimezone`

### `posts`
- `userId` (ref), `status`: `draft` | `scheduled` | `publishing` | `published` | `failed`
- `caption`, `hashtags` (string array), `mediaRefs` (array of `{ storageKey, variant, contentType }`)
- `targetPlatforms`, `platformResponses` (array of `{ platform, externalPostId, postUrl, publishedAt }`)
- `scheduledAt`, `publishedAt`, `jobId` (ref), `failureReason`

### `media_assets`
- `userId` (ref), `originalFilename`, `contentType`, `sizeBytes`
- `storageBucket`, `storageKey` (pointer to Object Storage)
- `variants`: array of processed outputs (`{ platform, storageKey, width, height, format, sizeBytes, processedAt }`)
- `status`: `uploaded` | `processing` | `ready` | `failed`

### `rate_limit_buckets`
- `platform`, `endpointCategory` (e.g., `publish`, `media_upload`), `windowStart` (Date)
- `requestCount`, `limit`, `resetAt`
- Compound unique index on `[platform, endpointCategory, windowStart]`

### `notifications`
- `userId` (ref), `channel`: `email` | `push`, `type`: `job_failed` | `publish_success` | `account_issue`
- `payload` (structured), `status`: `pending` | `sent` | `failed`, `sentAt`, `error`

## APIs and Interfaces

MongoDB is not exposed via public REST endpoints. Services interact with it through internal drivers and ODM layers:

- **Driver / ODM**: Services use the native MongoDB Node.js driver or Mongoose ODM over TLS-encrypted connections within the private VPC.
- **Connection Topology**:
  - **Agenda.js**: Maintains its own dedicated connection pool to the same replica set, targeting the `agendaJobs` collection.
  - **Application Services** (`user_service`, `post_service`, etc.): Use distinct connection pools to prevent queue backpressure from starving API request handling.
- **Access Patterns**:
  - **CRUD via Repository Pattern**: Each service encapsulates queries within repository modules (e.g., `PostRepository.createScheduledPost()`).
  - **Partial Updates**: Rate-limiter service uses atomic operators (`$inc`, `$set`) on `rate_limit_buckets` to avoid write skew.
  - **Aggregation Pipelines**: Used for dashboard analytics (e.g., publish success rate per user over time) and for joining-like lookups across `posts` and `media_assets`.
  - **Transactions**: Multi-document ACID transactions (`session.startTransaction()`) are used when a job completion must atomically update both the Agenda job log and the `posts` status to prevent duplicate publishes on retry.

## Failure Modes

| Failure | Impact | Mitigation |
|---|---|---|
| **Replica set primary failover** | Writes stall; Agenda.js pauses job processing; API writes may throw transient errors. | Configure services with `retryWrites=true` and exponential backoff; use secondaries for reads where stale data is acceptable. |
| **Connection pool exhaustion** | Operation latency spikes and cascading timeouts across services. | Isolate pools (Agenda vs. API); size pools based on `((core count × 2) + effective spindle count)` formula or managed-cluster defaults; monitor `connections.current` vs. `connections.available`. |
| **Write skew on rate limits** | Two concurrent job workers read the same counter, both increment, and exceed the platform’s hard limit. | Always use `$inc` on the counter document; use `findAndModify` or transactions for read-modify-write patterns on window state. |
| **Unbounded collection growth** | Disk exhaustion and degraded query performance as `agendaJobs`, `notifications`, and `posts` accumulate indefinitely. | Implement TTL indexes on `notifications.createdAt` and completed job history; archive or soft-delete old published posts per retention policy. |
| **Missing / suboptimal indexes** | Collection scans on `posts` or `agendaJobs` cause CPU saturation and slow HTTP responses. | Maintain compound indexes for tenant-scoped queries (`{ userId: 1, status: 1, scheduledAt: -1 }`) and Agenda’s required access pattern (`{ nextRunAt: 1, lockedAt: 1, name: 1 }`). |
| **16 MB BSON document limit** | Embedding base64-encoded media or large video chunks into a post or media document triggers a write error. | Store only lightweight metadata and Object Storage keys; never embed binary blobs. |
| **Replication lag on secondaries** | Services reading from secondaries see stale job state, risking duplicate publish attempts. | Force primary read preference (`primary`) for job state transitions and post-status reads involved in publishing decisions. |

## Scaling Considerations

- **Read/Write Split**: Route high-volume analytics reads to secondary members with `readPreference: 'secondaryPreferred'`. All job state mutations and rate-limit increments must target the primary.
- **Sharding**: For high tenant counts, shard write-heavy collections by `userId`:
  - `posts` and `agendaJobs` are prime candidates for hashed sharding on `userId` to distribute the scheduling and publishing load.
  - `rate_limit_buckets` can be sharded by `[platform, endpointCategory]` if platform-level contention becomes a bottleneck.
- **Index Strategy**:
  - `users`: unique ascending `email`.
  - `posts`: compound `{ userId: 1, status: 1, scheduledAt: -1 }` and `{ userId: 1, createdAt: -1 }`.
  - `agendaJobs`: `{ nextRunAt: 1, lockedAt: 1, name: 1 }` (required by Agenda.js), plus `{ 'data.userId': 1 }` for operational queries.
  - `media_assets`: `{ userId: 1, status: 1 }`, `{ storageKey: 1 }`.
  - `rate_limit_buckets`: `{ platform: 1, endpointCategory: 1, windowStart: 1 }` (unique).
- **TTL & Archival**:
  - TTL index on `notifications.createdAt` (e.g., 90 days).
  - Batch archival job to move `posts` with `status: published` and age > N months to cold storage.
  - Regular pruning of Agenda.js completed non-recurring jobs to keep the working set small.
- **Storage & Hardware**:
  - Deploy on SSD-backed storage (NVMe preferred) to support WiredTiger’s high I/O patterns.
  - Size the oplog to cover at least 24–48 hours of write throughput given the high churn from Agenda.js heartbeats and job updates.
- **Operational Monitoring**:
  - Track WiredTiger cache pressure, `queries` hitting `COLLSCAN` in the profiler, replication lag, and disk queue depth.
  - Alert on `failCount` spikes in `agendaJobs`, which may indicate systemic DB connectivity or locking issues.