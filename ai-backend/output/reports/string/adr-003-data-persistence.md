## ADR-003: Data Persistence Strategy

### Status
Accepted

### Context
The social media automation platform must persist four distinct categories of data:
1. **User identity and credentials** managed by `authService`.
2. **OAuth tokens and platform connectivity state** managed by `accountService`.
3. **Posting schedules, captions, hashtags, target platforms, and media-type rules** managed by `preferenceService`.
4. **Background job definitions, execution state, and history** managed by `jobScheduler` via Agenda.js.
5. **Binary media assets** (photos and videos) uploaded by users for pending and published posts.

The backend is Node.js/Express. All operational metadata must be queryable by JSON-like expressions, and the job scheduler requires a persistence layer that supports atomic locking and polling-based job acquisition.

### Decision
We will use **MongoDB** as the sole primary operational database and a separate **Object Storage** service (e.g., AWS S3, MinIO, or Cloudflare R2) for binary media assets.

MongoDB will host all application collections *and* the Agenda.js job collection. We will enforce data ownership boundaries at the service level, with each service accessing only its designated collections.

### Data Ownership & Schema Design

| Service | Collection | Key Fields | Purpose |
|---|---|---|---|
| `authService` | `users` | `_id`, `email`, `passwordHash`, `createdAt`, `updatedAt` | User registration and JWT subject claims. |
| `accountService` | `accounts` | `_id`, `userId` (ObjectId, indexed), `platform` (String), `oauthAccessToken` (encrypted), `oauthRefreshToken` (encrypted), `tokenExpiresAt` (Date), `platformUserId` (String), `isActive` (Boolean) | Linked social platform credentials and connectivity status. |
| `preferenceService` | `preferences` | `_id`, `userId` (ObjectId, unique, indexed), `targetPlatforms` (Array<String>), `postingFrequency` (Object/cron), `mediaType` (Enum: `photo`, `video`, `mixed`), `captionTemplates` (Array<String>), `hashtagSets` (Array<Array<String>>), `publishingTimes` (Array<{ start: String, end: String, timezone: String }>) | Per-user automation rules. |
| `jobScheduler` | `agendaJobs` | `name`, `data` (embedded: `{ userId, preferenceId, mediaKey, platform }`), `type`, `priority`, `nextRunAt` (Date, indexed), `lastRunAt`, `lastFinishedAt`, `lockedAt` (Date, indexed), `failCount` (Number), `failReason` | Agenda.js-managed background jobs for content generation and publishing. |

**Schema Constraints**
- `accounts.userId` + `accounts.platform` has a compound unique index to prevent duplicate linkages per platform.
- `preferences.userId` has a unique index enforcing one preference document per user.
- `authService` encrypts `passwordHash` using bcrypt; `accountService` encrypts `oauthAccessToken` and `oauthRefreshToken` at the application layer using AES-256-GCM before writing to MongoDB.
- Binary media is **never** stored in MongoDB. `mediaStorage` persists objects under keys formatted as `{userId}/{timestamp}-{uuid}.{ext}`.

### Interfaces & Access Patterns

**MongoDB Access**
- `authService`, `accountService`, and `preferenceService` use **Mongoose** ODM models with strict schemas and pre-save hooks for encryption.
- `jobScheduler` uses the native **Agenda.js** driver, which directly manages the `agendaJobs` collection. Application services do not write to `agendaJobs` directly; they invoke `agenda.schedule()` or `agenda.now()` through the `jobScheduler` API.

**Object Storage Access**
- `mediaStorage` exposes an internal SDK/client interface:
  - `putObject(key, stream, contentType): Promise<{ etag, url }>`
  - `getSignedUrl(key, expirySeconds): string`
  - `deleteObject(key): Promise<void>`
- `contentBuilder` and `publisherService` read media via presigned URLs or direct internal endpoint access, depending on platform API requirements.

**Job Data Flow**
- When `preferenceService` updates posting rules, it calls `jobScheduler` to recompute the job queue.
- `jobScheduler` embeds minimal references inside `job.data`: `{ userId: ObjectId, preferenceId: ObjectId, mediaKey: String, platform: String }`. It does not embed full preference documents or media blobs, keeping job documents small.

### Failure Modes & Mitigations

| Failure | Impact | Mitigation |
|---|---|---|
| **MongoDB primary node outage** | All API writes and job processing halt. | Deploy as a replica set with automatic failover. Application connections use `retryWrites=true` and `w=majority` for critical token updates. |
| **Agenda.js collection bloat** | Degraded job query performance as completed jobs accumulate. | Run a nightly pruning job that removes successfully completed Agenda.js jobs older than 30 days. Keep failed jobs for 7 days for inspection. |
| **Object storage unavailability** | Users cannot upload media; pending jobs without cached media fail. | API layer returns `503` with `Retry-After` on upload failures. `publisherService` marks jobs as failed with `failReason: MEDIA_UNAVAILABLE` and retries per exponential backoff. |
| **OAuth token expired mid-job** | `publisherService` receives 401 from social platform APIs. | `publisherService` catches auth errors, calls `accountService.refreshToken()`. If refresh succeeds, the job retries immediately. If refresh fails, the job is marked failed and the user is notified. |
| **Encryption key rotation** | Existing encrypted tokens in `accounts` become unreadable. | Store a `keyVersion` field alongside encrypted fields. Decrypt using the version-matched key from a secret manager. Rotate proactively during low-traffic windows. |
| **Write contention on `agendaJobs`** | Multiple job scheduler instances compete for locks. | Agenda.js uses atomic `findAndModify` on `lockedAt`. Ensure the compound index `{ nextRunAt: 1, lockedAt: 1, name: 1 }` exists. Scale horizontally by adding stateless scheduler nodes, not by sharding jobs manually. |

### Scaling & Operational Considerations

- **Indexing**: Beyond the Agenda.js required indexes, maintain:
  - `accounts`: `{ userId: 1, platform: 1 }`
  - `preferences`: `{ userId: 1 }`
  - `users`: `{ email: 1 }` (unique)
- **Read Scaling**: Offload analytics or admin reporting to MongoDB secondary nodes; all transactional writes go to the primary.
- **Media Storage Scaling**: Use a CDN origin-pull from the object store to serve media directly to external platform upload endpoints without proxying through application servers.
- **Backup Strategy**: MongoDB snapshots must be taken at a consistent point-in-time. Object storage versioning should be enabled. Because `mediaStorage` keys are referenced in job documents, a cross-system backup window must align to prevent orphaned media or dangling references.
- **TTL Cleanup**: Implement a TTL index on a `pendingUploadExpiresAt` field in a temporary metadata collection (if tracking incomplete uploads) to auto-purge abandoned multipart uploads.
- **Sharding**: If the `users` collection exceeds tens of millions, shard by `region` or `userId` hash. Do **not** shard `agendaJobs` by `userId`; Agenda.js does not support custom shard keys natively. If job volume requires sharding, migrate to a dedicated job store cluster rather than co-locating with application data.

## Related Diagrams

- `diagrams/string/iter1_overview.mmd`