## Responsibilities

- **Profile Management**: Persist and mutate core user identity records, enforcing uniqueness constraints on `email` and `username` at the MongoDB layer. Mutable fields include `displayName`, `timezone` (IANA-validated), and `locale`.
- **Posting Preferences Ownership**: Maintain the canonical automation rules that drive content generation: target platforms (`instagram`, `twitter`, `youtube`, `tiktok`), allowed media types (`photo`, `video`, `reel`, `story`), posting frequency limits, caption templates with replaceable placeholders (`{hashtags}`, `{date}`), default hashtag sets, and timezone-aware publishing windows (`day`, `startTime`, `endTime`).
- **Platform Configuration**: Store per-account publishing behavior for each connected social platform, including feed-vs-story targeting, aspect-ratio overrides, and auto-thread settings. Tracks an `isActive` boolean so users can pause a platform without revoking OAuth credentials held in the Token Store.
- **Media Ownership Index**: Curate a `user_media_index` collection that maps `userId` to blob keys residing in `media_storage`. Tracks `mimeType`, `uploadedAt`, `fileSize`, and `processingStatus` (`pending`, `ready`, `consumed`), enabling the service to list eligible media without scanning the blob store.
- **Constraint Validation**: Reject invalid preference permutations before persistence, such as video-only configurations paired with text-only platforms, overlapping publishing windows that wrap inconsistently across midnight, or hashtag sets exceeding platform-specific character limits.
- **Downstream Data Contract**: Own the MongoDB schema for `user_preferences`, `platform_configs`, and `user_media_index`. The Job Scheduler and Media Processor consume these collections directly; User Service guarantees backward-compatible schema versions via an explicit `schemaVersion` field.

## APIs / Interfaces

The service exposes an internal REST API consumed by the API Gateway. Background workers read preference data directly from the MongoDB collections owned by this service.

### REST Endpoints

```http
GET /v1/users/:userId/profile
```
Returns the user identity document (excludes internal MongoDB metadata).

```http
PATCH /v1/users/:userId/profile
Content-Type: application/json

{
  "displayName": "Jane Doe",
  "timezone": "America/Los_Angeles",
  "locale": "en-US"
}
```
Partial update of mutable profile fields. Rejects non-IANA timezones with `400 Bad Request`.

```http
GET /v1/users/:userId/preferences
```
Returns the full `user_preferences` document, including platform targets, posting frequency, captions, hashtags, and publishing windows.

```http
PUT /v1/users/:userId/preferences
Content-Type: application/json

{
  "platforms": ["instagram", "twitter"],
  "mediaTypes": ["photo", "video"],
  "postingFrequency": { "type": "daily", "maxPosts": 3 },
  "publishingWindows": [
    { "day": "tuesday", "startTime": "09:00", "endTime": "11:00" }
  ],
  "defaultCaptions": ["Morning update! {hashtags}"],
  "defaultHashtags": ["#tech", "#auto"],
  "maxDailyPosts": 3
}
```
Upserts posting preferences. Runs platform-compatibility and business-rule validation atomically; returns `400` on constraint violations.

```http
GET /v1/users/:userId/platforms
```
Returns active platform configurations from `platform_configs`.

```http
PATCH /v1/users/:userId/platforms/:platformKey/settings
Content-Type: application/json

{
  "isActive": true,
  "settings": {
    "instagram": { "targetFeed": "main", "aspectRatio": "4:5" }
  }
}
```
Updates per-platform overrides. `:platformKey` is enum-restricted to supported platforms.

```http
GET /v1/users/:userId/media
```
Queries the `user_media_index` and returns metadata for blobs awaiting or already associated with scheduled posts, including `storageKey`, `processingStatus`, and `scheduledJobId`.

### Internal Database Contract

- **`users`** — Source of truth for identity.
- **`user_preferences`** — Consumed by Job Scheduler to determine what content to create and when to queue Agenda.js jobs.
- **`platform_configs`** — Consumed by Platform Publisher to resolve per-platform posting behavior (e.g., `feed` vs. `story`).
- **`user_media_index`** — Consumed by Media Processor to claim `pending` media for background processing and by Job Scheduler to verify media readiness before finalizing publish jobs.

## Data Owned

| Collection | Purpose | Key Fields |
|---|---|---|
| `users` | Core identity and locale | `_id`, `email`, `username`, `displayName`, `timezone`, `locale`, `createdAt` |
| `user_preferences` | Automation rules and content templates | `userId`, `schemaVersion`, `platforms[]`, `mediaTypes[]`, `postingFrequency`, `publishingWindows[]`, `defaultCaptions[]`, `defaultHashtags[]`, `maxDailyPosts`, `updatedAt` |
| `platform_configs` | Per-platform publishing behavior | `userId`, `platform`, `accountId`, `isActive`, `settings` (flexible subdocument), `createdAt` |
| `user_media_index` | User-to-media mapping and lifecycle | `userId`, `storageKey`, `originalName`, `mimeType`, `fileSize`, `processingStatus`, `scheduledJobId`, `uploadedAt` |

- **Media Storage Relation**: User Service does not store binary objects. It persists metadata and blob keys in `user_media_index`; the actual bytes reside in `media_storage`. On upload, the API Gateway streams bytes to `media_storage`, then User Service records the resulting key with `processingStatus: pending`.
- **Schema Versioning**: `user_preferences` documents carry an integer `schemaVersion` (current `2`). Downstream consumers inspect this field before parsing to tolerate rolling updates without service-wide lockstep deployments.

## Failure Modes

- **Stale Preference Reads During Scheduling**: If a user updates preferences while the Job Scheduler is scanning `user_preferences` to generate Agenda.js jobs, the scheduler may operate on a partially mutated document.  
  *Mitigation*: User Service performs atomic full-document replacement updates (`$set`) and increments `schemaVersion`. The Job Scheduler snapshots queries or targets a stable `schemaVersion` range during batch reads.

- **Invalid Timezone or Window Configuration**: Clients may submit non-existent timezones or publishing windows with `startTime` after `endTime`.  
  *Mitigation*: API-layer validation using IANA timezone lookups and window boundary checks rejects the request with `400 Bad Request` before any MongoDB write.

- **Orphaned Documents on User Deletion**: Removing a user from `users` without cascading to `platform_configs`, `user_preferences`, and `user_media_index` leaves orphaned records that downstream workers may still reference.  
  *Mitigation*: A post-deletion async cleanup worker deletes all documents matching `userId` within 60 seconds of user deletion, with idempotent retry logic.

- **Media Index Drift**: If the Media Processor updates a blob in `media_storage` but the `user_media_index` status update fails (network partition), the Job Scheduler may attempt to schedule media still marked `pending`.  
  *Mitigation*: Media Processor writes `processingStatus: ready` to `user_media_index` before completing its Agenda.js job. The Job Scheduler filters strictly on `processingStatus: ready` when building publish jobs.

- **Unbounded Document Growth**: Users could append unlimited hashtags or publishing windows, degrading query performance or approaching the 16 MB document limit.  
  *Mitigation*: Hard API-level limits: max 30 hashtags, max 7 publishing windows per document. Requests exceeding limits are rejected rather than silently truncated.

- **Write Concern Loss**: A preference update acknowledged to the client could be lost during a primary failover if write concern is insufficient.  
  *Mitigation*: All `PUT /preferences` and `PATCH /platforms` operations use `writeConcern: { w: "majority", j: true }` because these documents directly drive paid publishing actions.

## Scaling Considerations

- **Stateless Horizontal Scaling**: The Node.js/Express layer holds no session state. Scale out by adding instances behind the API Gateway load balancer; all persistence is delegated to MongoDB.
- **Read Optimization for Background Workers**: The Job Scheduler polls `user_preferences` and `platform_configs` to generate upcoming jobs. To prevent scheduler polling from impacting user-facing write latency, route worker queries to MongoDB secondary nodes, or maintain a read-optimized projection collection populated by change streams.
- **Indexing Strategy**:
  - `users`: `{ email: 1 }` (unique), `{ username: 1 }` (unique)
  - `user_preferences`: `{ userId: 1 }` (unique), `{ userId: 1, updatedAt: -1 }`
  - `platform_configs`: `{ userId: 1, platform: 1 }` (unique), `{ userId: 1, isActive: 1 }`
  - `user_media_index`: `{ userId: 1, processingStatus: 1 }`, `{ storageKey: 1 }`
- **Sharding Path**: If `user_media_index` volume exceeds single-node capacity due to high media upload throughput, shard the collection by hashed `userId`. `user_preferences` can remain unsharded longer because it is bounded to one document per user.
- **Publishing Window Pre-computation**: Converting timezone-aware windows into UTC for Agenda.js is CPU-intensive during bulk scheduling. Denormalize the next 7-day UTC execution matrix inside the `user_preferences` document whenever it is updated, so the Job Scheduler performs a simple read instead of repeated timezone arithmetic.

## Related Diagrams

No paired Mermaid diagram is provided for this component document.