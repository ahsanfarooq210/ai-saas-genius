# MongoDB

## Responsibilities
- Serve as the primary operational database for the social media automation platform, persisting all relational metadata required by the Node.js/Express backend.
- Store user identity and authentication credentials consumed by `authService`.
- Persist OAuth tokens, platform identifiers, and connectivity state for social media accounts managed by `accountService`.
- Maintain per-user posting rules—schedules, captions, hashtags, target platforms, media types, and account-specific overrides—managed by `preferenceService`.
- Act as the persistence backend for the Agenda.js job queue, storing job definitions, scheduling metadata, execution locks, retry state, and completion logs managed by `jobScheduler`.
- Enforce data integrity through application-level schema validation (Mongoose or native JSON Schema) and multi-document ACID transactions where cross-collection consistency is required (e.g., platform disconnections that must invalidate related preferences).
- Provide indexed query paths to support high-frequency lookups by `userId`, `platform`, `nextRunAt`, and job `name`.

## APIs and Interfaces
MongoDB does not expose a REST interface; backend services connect via the **MongoDB Wire Protocol** using the Node.js driver or Mongoose ODM.

**Connection Contract**
- **URI Pattern**: `mongodb[+srv]://<user>:<pass>@<host>:<port>/<database>?replicaSet=<rsName>&w=majority&readPreference=primary`
- **Pool Configuration** (per service instance):
  - `maxPoolSize: 50`
  - `minPoolSize: 10`
  - `serverSelectionTimeoutMS: 5000`
  - `socketTimeoutMS: 45000`
  - `heartbeatFrequencyMS: 10000`
- **Consistency Settings**:
  - **Write Concern**: `w: "majority"` and `j: true` for all account token updates, preference mutations, and Agenda job state transitions to prevent rollback of committed data during failover.
  - **Read Preference**: `primary` for `jobScheduler` and `accountService` token reads to avoid stale OAuth credentials or stale job locks. `primaryPreferred` is acceptable for read-heavy user preference lookups if slight staleness is tolerable.
- **Transaction Boundaries**: MongoDB 4.0+ multi-document transactions wrapped in `session.withTransaction()` for operations touching both `accounts` and `preferences` collections atomically.
- **Schema Enforcement**: Application-level Mongoose schemas with strict mode, supplemented by MongoDB JSON Schema validators on critical fields (e.g., `userId` required, `platform` enum constraint in `accounts`).

**Service Access Patterns**
| Service | Collections Accessed | Access Type |
|---|---|---|
| `authService` | `users` | Read/Write |
| `accountService` | `accounts` | Read/Write |
| `preferenceService` | `preferences` | Read/Write |
| `jobScheduler` | `agendaJobs` (or custom) | Read/Write/Update (lock management) |

## Data Model
The following collections are owned and managed within the MongoDB deployment:

### `users`
Stores identity data for platform authentication.
- `_id` (ObjectId)
- `email` (String, unique, indexed)
- `passwordHash` (String, bcrypt)
- `createdAt` (Date)
- `updatedAt` (Date)
- `lastLoginAt` (Date, optional)

### `accounts`
Stores linked social media platform credentials and status.
- `_id` (ObjectId)
- `userId` (ObjectId, indexed) — reference to `users._id`
- `platform` (String, enum: `['twitter', 'instagram', 'facebook', 'linkedin', ...]`, indexed)
- `platformUserId` (String) — external platform identifier
- `oauthAccessToken` (String, encrypted at application layer)
- `oauthRefreshToken` (String, encrypted at application layer)
- `tokenExpiry` (Date) — UTC expiration of access token
- `connectedAt` (Date)
- `isActive` (Boolean) — soft-delete flag for disconnected accounts
- `updatedAt` (Date)

### `preferences`
Stores content strategy and scheduling rules per user.
- `_id` (ObjectId)
- `userId` (ObjectId, unique, sparse index) — one preference document per user (or array-based if multiple profiles)
- `targetPlatforms` (String[]) — subset of linked platforms to post to
- `mediaType` (String, enum: `['photo', 'video', 'mixed']`)
- `postingFrequency` (Object) — e.g., `{ interval: 'daily', count: 2 }` or cron expression
- `optimalPostingTimes` (Object[]) — `{ dayOfWeek: Number, hour: Number, minute: Number, timezone: String }`
- `captionTemplates` (String[])
- `hashtagSets` (String[][])
- `accountOverrides` (Object) — platform-specific key/value overrides
- `updatedAt` (Date)

### `agendaJobs` (Agenda.js default)
Stores queue metadata for background publishing tasks.
- `_id` (ObjectId)
- `name` (String, indexed) — job type, e.g., `publish-content`
- `data` (Object) — payload including `userId`, `accountIds[]`, `mediaStorageKey`, `caption`, `hashtags`
- `type` (String) — `normal`, `single`, etc.
- `priority` (Number)
- `nextRunAt` (Date, indexed) — determines job eligibility for pickup
- `lastModifiedBy` (String) — scheduler instance identifier
- `lockedAt` (Date) — null when available; set when a worker claims the job
- `lastRunAt` (Date)
- `lastFinishedAt` (Date)
- `failCount` (Number)
- `failReason` (String)
- `repeatInterval` (String) — human-interval or cron for recurring schedules
- `repeatTimezone` (String)

## Failure Modes

- **Connection Pool Exhaustion**: If `authService`, `accountService`, `preferenceService`, and `jobScheduler` instances collectively open more connections than `mongod` can handle (default ~64,000 but memory-bound before that), new requests block until `serverSelectionTimeoutMS` elapses, causing cascading HTTP 504s from the API Gateway. Mitigation: enforce `maxPoolSize` caps and monitor `connPool` metrics.
- **Replication Lag and Stale Reads**: Reading OAuth tokens or job locks from a secondary replica that lags behind the primary can result in `publisherService` attempting to publish with expired tokens, or `jobScheduler` executing jobs already claimed by another instance. All token and job-lock queries must use `readPreference: primary`.
- **Write Conflicts on Token Refresh**: Concurrent OAuth refresh flows for the same user account can overwrite each other if `accountService` does not use optimistic locking (e.g., versioning via `$inc: { __v: 1 }` or `findOneAndUpdate` with pre-condition). This can leave the stored token out of sync with the platform.
- **Job Lock Contention and Missed Execution Windows**: Agenda.js relies on a find-and-modify operation against `lockedAt`. Under high load or slow disk I/O, the operation latency increases; jobs may pass their `nextRunAt` without being locked, or two scheduler nodes may briefly contend for the same lock if timing drifts.
- **Unbounded Storage Growth**: Agenda.js retains job history indefinitely by default. A high-volume platform generating thousands of photo/video posts per day will bloat the `agendaJobs` collection with completed/failed job documents, increasing storage costs and degrading index performance.
- **Index Build Blocking**: Adding a new index on the `agendaJobs` collection (e.g., to optimize a new query pattern) acquires an exclusive lock on the collection in older MongoDB versions, halting all job scheduling and updates.
- **Primary Failover Interruption**: During a replica set election (network partition or primary crash), writes pause for several seconds. Agenda.js ceases job processing, and API mutations (preference updates, token refreshes) fail unless services implement retry loops with exponential backoff.
- **Insufficient Backup Coverage**: Because MongoDB holds encrypted OAuth tokens and user scheduling rules, a catastrophic cluster failure without point-in-time oplog backups results in irrecoverable loss of all social account connections and configured automation preferences.

## Scaling Considerations

- **Working Set and RAM Sizing**: The hottest data paths are `nextRunAt` job queries and `userId`-based lookups. Ensure the combined size of indexes on `agendaJobs(nextRunAt, name)` and `accounts(userId, platform)` fits in RAM to avoid page faults during scheduling cycles.
- **Read/Write Separation**: Offload analytics or admin reporting queries to secondary nodes. Keep all operational job scheduling and token refresh traffic pinned to the primary.
- **Horizontal Sharding**:
  - **User Data (`users`, `accounts`, `preferences`)**: Shard by `userId` hashed to distribute tenant load evenly.
  - **Agenda Jobs**: Agenda.js is not natively sharding-aware. At very high job volumes, run a dedicated MongoDB replica set (or a separate database on the same cluster) solely for `agendaJobs` to isolate I/O. If sharding is unavoidable, choose a high-cardinality shard key (e.g., `data.userId` hashed) and monitor for jumbo chunks caused by large job payloads embedding media metadata.
- **Index Strategy**:
  - `accounts`: `{ userId: 1, platform: 1 }` (unique or sparse), `{ platformUserId: 1 }`
  - `preferences`: `{ userId: 1 }` (unique)
  - `agendaJobs`: `{ nextRunAt: 1, name: 1, priority: -1 }`, `{ lockedAt: 1 }`, `{ name: 1, 'data.userId': 1 }`
- **Connection Pool Tuning**: With potentially dozens of API Gateway workers and job scheduler nodes, aggregate connection counts can explode. Prefer a centralized connection manager or cap per-service pools at 10–20, and use `minPoolSize` to amortize connection setup costs.
- **Storage Growth Management**: Enable Agenda.js `processEvery` tuning and implement a TTL index or nightly cleanup batch on `lastFinishedAt` to purge completed job documents older than 30 days. Pre-allocate storage volumes and enable auto-expansion to avoid halting writes during peak viral content campaigns.
- **Backup and Recovery**: Use oplog-based continuous backup (e.g., MongoDB Atlas, Percona Backup, or custom `mongodump` + oplog capture) to support point-in-time recovery. Encrypt backups at rest because they contain OAuth credentials and user PII.

## Related Diagrams
- Component diagram: `diagrams/string/iter1_component-mongo-db.mmd`