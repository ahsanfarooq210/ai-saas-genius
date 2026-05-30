## Content Service

The Content Service is responsible for the lifecycle of post content—from initial draft through final media assembly. It persists captions, hashtag arrays, and media references; validates posts against per-platform constraints; and coordinates with the Media Service to produce a publishable asset bundle that the Scheduler Service and Agenda Worker can later execute.

---

## Responsibilities

- **Draft and persist post content records** comprising captions, hashtag arrays, media references, and target platform lists.
- **Validate content against per-platform constraints** (e.g., Twitter/X character limits, Instagram hashtag ceilings, LinkedIn formatting rules) and reject or flag violations before scheduling.
- **Coordinate media assembly** by requesting the Media Service to bundle, transcode, or composite referenced photos and videos into platform-ready assets.
- **Generate platform-specific variants** of a post (e.g., truncated captions for Twitter/X, hashtag-reduced variants for LinkedIn) and store them as embedded sub-documents.
- **Manage content lifecycle states**: `draft` → `assembling` → `ready` → `published` | `failed`.
- **Enforce idempotent creation** so that retried or duplicate requests from the API Gateway or Scheduler Service do not spawn redundant post records.
- **Guard concurrent mutations** by rejecting updates to content that is already frozen for imminent publishing.

---

## APIs and Interfaces

### External REST API (via API Gateway)

All routes are prefixed under `/v1/content` and require a valid JWT forwarded by the API Gateway.

- **`POST /v1/content`**
  - Creates a new content record.
  - Body: `{ userId, caption, hashtags[], mediaIds[], targetPlatforms[], scheduledAt?, templateId? }`
  - Behavior: Runs platform constraint validation. If `mediaIds` are supplied, status is set to `assembling` and an asynchronous assembly request is dispatched to the Media Service.
  - Response: `201 Created` with the content `_id`.

- **`GET /v1/content/:contentId`**
  - Retrieves a single record, including assembly status, assembled media URLs, and platform-specific variants.

- **`GET /v1/content?userId={uid}&status={status}&limit={n}&offset={n}`**
  - Paginated dashboard query. Supports filtering by `status` to show drafts, ready posts, or published history.

- **`PATCH /v1/content/:contentId`**
  - Partial update of `caption`, `hashtags`, `mediaIds`, or `targetPlatforms`.
  - Rejected with `409 Conflict` if the record `status` is `freezing`, `published`, or `failed`.

- **`POST /v1/content/:contentId/validate`**
  - Re-runs platform constraint checks against the current record state.
  - Response: `{ valid: boolean, violations: [{ platform, field, message }] }`.

- **`DELETE /v1/content/:contentId`**
  - Soft delete; sets `status` to `deleted` and populates `deletedAt`. Hard-rejected if already `published`.

### Internal Service Interfaces

- **Media Service Client (HTTP)**
  - `POST /internal/media/assemble` — Submits a request to bundle the referenced `mediaIds` into a publishable asset. Payload includes `contentId`, `mediaIds[]`, and `targetPlatforms[]`. Returns an `assemblyJobId`.
  - `GET /internal/media/assemble/:assemblyJobId` — Polls or retrieves the result of an assembly job (used by background reconciliation if webhooks are missed).
  - `GET /internal/media/:mediaId/metadata` — Fetches dimensions, MIME type, and duration to drive validation logic.

- **MongoDB Interface**
  - Primary persistence for `content_records`, `content_templates`, and `hashtag_sets`.
  - Multi-document updates (e.g., writing assembly results and transitioning `status` to `ready`) use MongoDB transactions to maintain atomicity.

---

## Data Model

### `content_records`

| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | Primary key |
| `userId` | ObjectId | Owner reference (indexed) |
| `status` | String Enum | `draft`, `assembling`, `ready`, `freezing`, `published`, `failed`, `deleted` (indexed) |
| `caption` | String | Base caption text |
| `hashtags` | String[] | Ordered array of hashtags |
| `mediaIds` | ObjectId[] | References to assets owned by Media Service |
| `assembledMedia` | Embedded Object | `{ assemblyJobId, url, etag, completedAt }` |
| `targetPlatforms` | String[] | Platforms to publish to (e.g., `twitter`, `instagram`, `linkedin`) |
| `platformVariants` | Embedded Map | Keyed by platform name; stores tailored captions and hashtags |
| `scheduledAt` | Date | Intended publish time (indexed) |
| `publishJobId` | String | Sparse unique index referencing the Agenda job created by Scheduler Service |
| `validationResult` | Embedded | `{ valid, checkedAt, violations[] }` |
| `version` | Number | Optimistic locking field; incremented on every update |
| `failureReason` | String | Populated when `status` is `failed` |
| `createdAt`, `updatedAt` | Date | Audit timestamps |

### `content_templates`

| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | Primary key |
| `userId` | ObjectId | Owner (indexed) |
| `name` | String | Template display name |
| `templateBody` | String | Caption template with `{{variable}}` placeholders |
| `defaultHashtags` | String[] | Hashtags automatically appended when template is used |
| `targetPlatforms` | String[] | Platforms this template is valid for |

### `hashtag_sets`

| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | Primary key |
| `userId` | ObjectId | Owner (indexed) |
| `name` | String | Set label |
| `hashtags` | String[] | Reusable hashtag collection |
| `usageCount` | Number | Analytics counter for UI sorting |

### Key Indexes

- `{ userId: 1, status: 1, createdAt: -1 }` — Dashboard list queries.
- `{ status: 1, scheduledAt: 1 }` — Scheduler Service polling for `ready` content.
- `{ publishJobId: 1 }` — Sparse unique index to enforce one-to-one mapping with Agenda jobs.
- `{ "assembledMedia.assemblyJobId": 1 }` — Lookup when Media Service callbacks arrive.

---

## Failure Modes and Mitigation

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Media assembly timeout** | Content record stuck in `assembling`; publish job cannot proceed. | TTL index on `assemblyStartedAt`; cron job transitions stale records older than 5 minutes to `failed` with `failureReason: assembly_timeout`. Client can retry. |
| **Concurrent edit during publish** | User updates caption while Agenda Worker is reading the record, causing inconsistent published output. | `PATCH` rejects updates when `status` is `freezing`. Scheduler Service transitions records to `freezing` 60 seconds before the scheduled publish window. |
| **Orphaned media references** | `mediaIds` point to assets deleted in Media Service after content creation. | Validation endpoint queries Media Service metadata before scheduling. Assembly step re-verifies existence and fails fast if assets are missing. |
| **Duplicate content creation** | Network retry or duplicate scheduler event creates two post records for the same slot. | Clients must supply an `Idempotency-Key` header. The service stores the key in a transient MongoDB collection (`idempotency_keys` with 24-hour TTL) and returns the existing record on replay. |
| **MongoDB write conflict** | Two concurrent assembly callbacks attempt to update the same content record. | Optimistic locking via the `version` field; updates use `version` in the query filter. Conflicts trigger an automatic retry with exponential backoff. |
| **Media Service degradation** | Synchronous calls to Media Service block the Express event loop, cascading latency to the API Gateway. | All assembly requests are asynchronous (fire-and-forget with callback polling). The `POST /v1/content` endpoint returns immediately with `status: assembling` and never waits on Media Service completion. |

---

## Scaling Considerations

- **Database growth**: `content_records` grows linearly with every scheduled post. When the working set exceeds memory capacity, shard the collection by `userId`. Archive records with `status: published` and `publishedAt > 90 days` to a cold-storage collection to keep indexes compact.
- **Read load**: Dashboard queries are read-heavy. Ensure the compound index `{ userId: 1, createdAt: -1 }` is in place. If MongoDB secondary reads cannot keep pace, distribute read traffic across replica set secondaries for non-real-time list queries.
- **Media assembly callbacks**: The service must remain stateless so that any instance in a horizontal pod can handle a callback from Media Service. All assembly context is persisted in MongoDB; in-memory state is never assumed.
- **Bulk scheduling**: When users bulk-create hundreds of posts, use unordered `insertMany` operations and batch-validation to avoid N+1 metadata lookups to Media Service.
- **Memory constraints**: The service never loads media binaries into Node.js memory. It only manipulates captions, hashtags, and asset references, keeping the heap footprint low and suitable for standard event-loop scaling.

---

## Related Diagrams

No paired diagram is provided for this document.