## Content Service

## Responsibilities

The Content Service owns the post lifecycle from draft creation through scheduling handoff. It is responsible for:

- **Post Draft Management**: Creating, updating, and retrieving post drafts with captions, hashtags, platform targets, and media references.
- **Content Template Engine**: Managing reusable templates (`bodyTemplate`, default hashtags, default platforms) and rendering them into concrete post content.
- **Caption/Hashtag Generation**: Orchestrating AI or rule-based generation of captions and hashtag suggestions, storing results as suggestions until the user confirms or edits them.
- **Platform Constraint Validation**: Enforcing per-platform rules (e.g., Twitter/X character limits, Instagram hashtag count, media slot limits) before a post is allowed to transition to the `scheduled` state.
- **Media Attachment Coordination**: Linking posts to media assets processed by the Media Service via `mediaIds`; verifying media readiness before scheduling.
- **Scheduling Handoff**: Transitioning a validated post to `scheduled` and delegating job creation to the Job Service, which inserts the actual Agenda.js job into the queue.
- **Duplicate & Clone Workflows**: Supporting bulk workflows by duplicating existing posts or applying templates to generate new drafts.

## APIs / Interfaces

### REST Endpoints (Internal)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/posts` | Create a new post draft. Accepts `caption`, `hashtags`, `mediaIds`, `platforms`, optional `templateId`. |
| `GET` | `/api/v1/posts/:postId` | Retrieve a post draft. Enriches media metadata by querying the Media Service. |
| `PATCH` | `/api/v1/posts/:postId` | Partial update of post fields. Validates platform constraints on change. |
| `DELETE` | `/api/v1/posts/:postId` | Soft-delete a draft; hard-delete is blocked if the post is already `scheduled` or `published`. |
| `GET` | `/api/v1/posts` | List posts for the authenticated user. Supports filters: `status`, `platform`, `from`, `to`, `limit`, `offset`. |
| `POST` | `/api/v1/posts/:postId/duplicate` | Clone an existing post into a new `draft` with a fresh `_id`. |
| `POST` | `/api/v1/posts/:postId/schedule` | Validate, transition status to `scheduled`, and call the Job Service to create an Agenda.js job. Idempotent via `clientRequestId`. |
| `POST` | `/api/v1/posts/:postId/generate` | Request caption/hashtag generation. Returns a `generationId` for async polling. |
| `GET` | `/api/v1/generations/:generationId` | Retrieve the result of a caption/hashtag generation request. |
| `POST` | `/api/v1/templates` | Create a content template. |
| `GET` | `/api/v1/templates` | List templates for the user. |
| `GET` | `/api/v1/templates/:templateId` | Retrieve a single template. |
| `PATCH` | `/api/v1/templates/:templateId` | Update template fields. |
| `DELETE` | `/api/v1/templates/:templateId` | Archive or delete a template. |

### Service-to-Service Interfaces

- **Media Service**: `GET /media/batch?ids=...` is called when retrieving a post to resolve `mediaIds` into CDN URLs, dimensions, and processing status. `POST /posts` validates that each `mediaId` exists before persisting.
- **Job Service**: `POST /jobs/schedule` is called from the `schedule` endpoint. Payload includes `postId`, `userId`, `executeAt`, `timezone`, and `platforms`. On success, the Job Service returns the Agenda.js `jobId`, which the Content Service stores in the post document.
- **Callbacks from Job Service**: `PATCH /api/v1/posts/:postId/job-status` (internal hook) receives status transitions from the Job Service (`publishing`, `published`, `failed`) to update the post's ground truth.

### Data Contracts

- **Post Status Enum**: `draft` → `pending_media` → `ready` → `scheduled` → `publishing` → `published` | `failed`.
- **Platform Config**: Each element in `platforms` contains `platform` (e.g., `instagram`, `twitter`), `enabled`, `captionOverride`, and `hashtagsOverride`.
- **Generation Result**: `{ generationId, type, status: pending|completed|failed, result: { caption, hashtags } }`.

## Data It Owns

Stored in MongoDB in the `content` logical database (collections described below):

### `posts` Collection

| Field | Type | Notes |
|-------|------|-------|
| `_id` | `ObjectId` | Primary key. |
| `userId` | `ObjectId` | Indexed for user-scoped queries. |
| `caption` | `String` | Base caption; max 2200 chars (Instagram upper bound). |
| `hashtags` | `[String]` | Ordered array; max 30 items enforced at application layer. |
| `mediaIds` | `[ObjectId]` | References to the Media Service; posts may not own media binary. |
| `platforms` | `[Object]` | Target platforms and per-platform overrides. |
| `status` | `String` | Enum controlling lifecycle transitions. |
| `schedule` | `Object` | `{ executeAt: Date, timezone: String }`. |
| `jobId` | `String` | Agenda.js job ID returned by the Job Service; indexed. |
| `templateId` | `ObjectId` | Optional reference to the originating template. |
| `clientRequestId` | `String` | Idempotency key for the schedule operation; unique index with `userId`. |
| `failedReason` | `String` | Populated if the Job Service reports a terminal failure. |
| `createdAt` | `Date` | Auto-generated. |
| `updatedAt` | `Date` | Auto-generated. |

### `templates` Collection

| Field | Type | Notes |
|-------|------|-------|
| `_id` | `ObjectId` | Primary key. |
| `userId` | `ObjectId` | Owner of the template. |
| `name` | `String` | Display name. |
| `bodyTemplate` | `String` | Template string with placeholders (e.g., `{{productName}}`). |
| `defaultHashtags` | `[String]` | Hashtags applied when the template is used. |
| `defaultPlatforms` | `[String]` | Platforms pre-selected when the template is instantiated. |
| `mediaSlotCount` | `Number` | Expected number of attachments. |
| `isArchived` | `Boolean` | Soft-delete flag. |
| `createdAt`, `updatedAt` | `Date` | Audit timestamps. |

### `generations` Collection

| Field | Type | Notes |
|-------|------|-------|
| `_id` | `ObjectId` | Primary key. |
| `userId` | `ObjectId` | Requester. |
| `postId` | `ObjectId` | Target post (may be null for free-form generation). |
| `type` | `String` | `caption` or `hashtags`. |
| `prompt` | `String` | Input context provided by the user. |
| `result` | `Object` | Generated output. |
| `status` | `String` | `pending`, `completed`, `failed`. |
| `createdAt` | `Date` | Audit timestamp. |

## Failure Modes

| Failure | Cause | Mitigation |
|---------|-------|------------|
| **Media Not Ready** | User schedules a post while attached media is still processing in the Media Service. | Block `schedule` transition; require `mediaStatus: ready` verified via Media Service lookup. Return `409 Conflict` with `mediaPending` details. |
| **Job Service Handoff Timeout** | Network partition or Job Service overload when calling `POST /jobs/schedule`. | Transition post to `schedule_pending` instead of `scheduled`. Run a reconciliation loop every 60 seconds to retry `schedule_pending` posts with exponential backoff. Store `clientRequestId` to ensure idempotency. |
| **Platform Constraint Violation** | Caption exceeds Twitter/X 280-character limit, or Instagram hashtag count exceeds 30. | Validate at the application layer during `PATCH` and `schedule`. Return `422 Unprocessable Entity` with a `platformErrors` array detailing per-platform failures. |
| **Template Rendering Error** | Missing placeholder variables or malformed template syntax. | Validate templates on creation using a strict regex parser. Render templates with safe defaults (`N/A`) for missing keys. |
| **Generation Provider Failure** | External AI/LLM provider for captions/hashtags is unavailable or rate-limited. | Implement a circuit breaker around the generation call. On failure, return `503 Service Unavailable` and allow the user to proceed with manual input. |
| **Concurrent Update Collision** | Two clients edit the same post draft simultaneously. | Use MongoDB atomic operators (`$set`, `$inc`) for updates. For multi-field updates, use an optimistic `version` field and reject stale writes with `409`. |
| **Orphaned Scheduled Post** | Post marked `scheduled` but Job Service never confirms job creation. | Reconciliation worker scans `schedule_pending` and `scheduled` posts without a `jobId` older than 2 minutes and re-issues the job request. |
| **Media Reference Dangling** | Media Service deletes or hard-fails an asset, but `mediaIds` still references it. | Before any status transition to `ready`, re-validate all `mediaIds` against the Media Service. If a media record is missing, transition post to `pending_media` and notify the user. |

## Scaling Considerations

- **Stateless Horizontal Scaling**: The Content Service runs as stateless Node.js/Express containers. Scale by adding replicas behind the API Gateway. No session affinity is required.
- **Database Indexing**: Maintain a compound index on `{ userId: 1, status: 1, "schedule.executeAt": -1 }` to support high-cardinality post listings on the user dashboard. Maintain an index on `{ jobId: 1 }` for fast lookup during Job Service callbacks.
- **Read vs. Write Separation**: Post listing endpoints are read-heavy. Use MongoDB read preferences directed to secondary replicas for `GET /api/v1/posts` when eventual consistency is acceptable; direct writes and status transitions to the primary.
- **Media Enrichment Cost**: Populating `mediaIds` on every post fetch requires an outbound call to the Media Service. Cache media metadata in an in-memory LRU for 60 seconds per `mediaId` to reduce duplicate cross-service calls.
- **Bulk Operations**: Support bulk duplicate/schedule endpoints to reduce per-request overhead. Use MongoDB bulk writes for inserting cloned posts.
- **Job Service Decoupling**: The call to the Job Service during scheduling must use a dedicated HTTP agent with keep-alive and a short timeout (5 seconds). If the Job Service is degraded, the Content Service should accept the user’s schedule request, write `schedule_pending`, and rely on the reconciliation loop rather than failing the user request.
- **Template Sharding**: If templates become globally shared (not just user-scoped), add a `{ isGlobal: 1, isArchived: 1 }` index and cache the global template list in Redis.
- **Post Collection Growth**: The `posts` collection grows unbounded with user activity. If a single user's post volume exceeds tens of millions, shard the collection by `userId` using MongoDB hashed sharding to keep a single user’s documents on one shard and preserve query locality.

## Related Diagrams

No paired Mermaid diagram is provided for this document.