## Content Service

The Content Service is an Express.js microservice that owns the lifecycle of post drafts. It composes captions, hashtags, and ordered media references into platform-targeted publish payloads, validates content against per-platform constraints, and coordinates with the Media Service and Scheduler Service to ensure only ready, resolvable content enters the publishing pipeline.

---

### Responsibilities

*   **Draft Lifecycle Management:** Provides CRUD operations for post drafts. A draft is the canonical unit of work before it is handed to the Scheduler Service.
*   **Content Composition:** Stores and normalizes user-supplied captions, hashtag arrays, and ordered lists of media references (`mediaIds`). Supports platform-specific overrides (e.g., a shorter caption for Twitter/X).
*   **Media Orchestration:** Validates that every referenced media asset exists in the Media Service, has finished processing, and has reachable CDN URLs before allowing a draft to transition to `ready`.
*   **Platform Constraint Validation:** Enforces rules such as Twitter/X character limits, Instagram hashtag limits (30), and maximum media counts per platform. Blocks scheduling until all violations are resolved.
*   **State Machine Enforcement:** Manages strict status transitions: `draft` → `ready` → `scheduled` → `publishing` → `published` or `failed`. Prevents destructive edits to drafts that are already scheduled or actively publishing.
*   **Publish Record Keeping:** After the Publisher Service confirms delivery, stores returned platform post IDs, permalinks, and timestamps inside the draft document for audit and analytics.
*   **Internal Payload Resolution:** Exposes an internal interface used by the Scheduler Service and Agenda Worker to retrieve the finalized, normalized publish payload at job execution time, ensuring workers do not cache stale caption or media data inside the job definition.

---

### API & Interfaces

#### Public REST API

All routes require a valid JWT in the `Authorization` header. The `userId` is extracted from the token and enforced on every query.

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/v1/drafts` | Create a new draft. Body: `caption`, `hashtags[]`, `mediaIds[]`, `targetPlatforms[]`, optional `platformOverrides`. Returns `201` with the draft ID. |
| `GET` | `/v1/drafts` | List drafts for the authenticated user. Query params: `status`, `targetPlatform`, `limit`, `offset`, `sort`. Returns enriched drafts with resolved media metadata. |
| `GET` | `/v1/drafts/:draftId` | Retrieve a single draft. Performs a live lookup to the Media Service to confirm current `cdnUrl` values. |
| `PATCH` | `/v1/drafts/:draftId` | Update an existing draft. Allowed only when `status` is `draft` or `ready`. Body fields are merged; `updatedAt` is bumped. |
| `DELETE` | `/v1/drafts/:draftId` | Hard-delete a draft. Rejected with `409 Conflict` if `status` is `scheduled` or `publishing`. |
| `POST` | `/v1/drafts/:draftId/validate` | Trigger synchronous platform validation. Returns the current `validationErrors` array. |
| `POST` | `/v1/drafts/:draftId/clone` | Create a deep copy of an existing draft with `status` reset to `draft`. Useful for templating recurring content. |

#### Internal Service Interfaces

*   **Media Service Client (HTTP)**  
    An internal HTTP client module communicates with the Media Service:
    *   `validateMediaRefs(mediaIds: string[]): Promise<{ valid: boolean; missing: string[] }>` — called during draft updates and before status transitions.
    *   `getMediaMetadata(mediaIds: string[]): Promise<MediaMetadata[]>` — called when enriching draft list responses.

*   **Scheduler / Worker Interface (HTTP)**  
    Exposed on an internal port (not exposed through the API Gateway):
    *   `GET /internal/drafts/:draftId/publish-payload` — returns the normalized payload required by the Publisher Service:
        ```json
        {
          "draftId": "...",
          "userId": "...",
          "caption": "...",
          "hashtags": ["#automation"],
          "media": [
            { "type": "image", "cdnUrl": "https://cdn.example.com/...", "order": 0 }
          ],
          "targetPlatforms": ["instagram", "twitter"],
          "platformOverrides": { ... }
        }
        ```
    This endpoint is consumed by the Agenda Worker at job execution time so that the job definition itself only stores the `draftId`, avoiding payload drift.

---

### Data Ownership

The service owns the `content_drafts` collection in MongoDB.

**Primary Schema (`content_drafts`)**

```json
{
  "_id": "ObjectId",
  "userId": "ObjectId",
  "title": "string",
  "caption": "string",
  "hashtags": ["string"],
  "mediaRefs": [
    {
      "mediaId": "ObjectId",
      "type": "image | video | reel",
      "cdnUrl": "string",
      "thumbnailUrl": "string",
      "order": "number"
    }
  ],
  "targetPlatforms": ["instagram", "twitter", "facebook", "tiktok", "linkedin"],
  "platformOverrides": {
    "twitter": {
      "caption": "string",
      "hashtags": ["string"]
    }
  },
  "status": "draft | ready | scheduled | publishing | published | failed",
  "validationErrors": [
    {
      "platform": "string",
      "field": "string",
      "message": "string"
    }
  ],
  "scheduledJobId": "string",
  "publishResults": [
    {
      "platform": "string",
      "platformPostId": "string",
      "permalink": "string",
      "publishedAt": "ISODate"
    }
  ],
  "version": "number",
  "createdAt": "ISODate",
  "updatedAt": "ISODate"
}
```

**Indexes**

```javascript
db.content_drafts.createIndex({ userId: 1, status: 1, createdAt: -1 }); // list queries
db.content_drafts.createIndex({ scheduledJobId: 1 });                   // worker lookups
db.content_drafts.createIndex({ userId: 1, title: "text", caption: "text" }); // search
db.content_drafts.createIndex({ status: 1, updatedAt: 1 });             // archival cleanup
```

---

### Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Stale Media Reference** | Draft references a `mediaId` that was deleted or never finished processing. Scheduler creates a job that fails at publish time. | On every `PATCH` and before transitioning to `ready`, call `validateMediaRefs`. Reject the transition if any asset is missing or has `status !== "active"`. |
| **Concurrent Edit During Publish** | User updates caption while the Agenda Worker is reading the payload, causing a mismatch between what was reviewed and what is published. | Enforce optimistic locking via the `version` field. Block updates to `caption`, `hashtags`, and `mediaRefs` when `status` is `scheduled` or `publishing`. Require an explicit "unschedule" flow to return to `draft`. |
| **Platform Constraint Violation** | A 500-character caption is scheduled for Twitter/X, guaranteeing an API rejection. | Synchronous validation runs on every save and `validate` call. Store errors in `validationErrors` and reject `ready` → `scheduled` transitions until the array is empty. |
| **Orphaned Drafts** | User account is deleted, but drafts remain in MongoDB, consuming storage and indexes. | Implement a background sweeper that queries for `userId`s no longer present in the `users` collection (or consume User Service deletion events if an event bus is introduced) and hard-deletes associated drafts. |
| **MongoDB Write Timeout** | Draft creation spikes during onboarding, causing `w: majority` writes to stall. | Set a write timeout (e.g., `wtimeoutMS: 5000`). Return `503` to the client so the API Gateway can trigger a retry with exponential backoff. |
| **Hashtag Injection** | Malicious hashtags or HTML in captions stored and later rendered in admin dashboards or emails. | Strict input sanitization: strip HTML, enforce UTF-8, limit individual hashtag length (e.g., 100 chars) and total count (e.g., 60), and block non-alphanumeric patterns except `#` and `_`. |

---

### Scaling Considerations

*   **Stateless Horizontal Scaling:** The service holds no in-memory session state. Deploy behind a load balancer and scale via CPU/request-count autoscaling.
*   **Read Replica Offloading:** Draft listing (`GET /v1/drafts`) is read-heavy. Route these queries to MongoDB secondaries using `readPreference: secondaryPreferred` to preserve primary node capacity for writes.
*   **Media Metadata Denormalization:** To avoid calling the Media Service on every draft retrieval, cache resolved `cdnUrl` and `thumbnailUrl` inside the `mediaRefs` array at write time. Media assets are immutable after processing; if re-processing occurs, the Media Service can emit a lightweight invalidation that Content Service handles asynchronously.
*   **Sharding:** If the `content_drafts` collection exceeds single-node capacity, shard by `userId`. This colocates all drafts for a user on the same shard, keeping list queries single-shard and performant.
*   **Archival:** Published drafts older than 90 days are rarely mutated. Move them to a `content_drafts_archive` collection or export to cold object storage. Retain only a lightweight index of `draftId`, `userId`, `publishedAt`, and `platformPostId` in the hot database for quick permalink lookups.
*   **Batch Operations:** Support batch validation endpoints (`POST /internal/drafts/validate-batch`) so the Scheduler Service can validate hundreds of drafts in a single request when generating recurring jobs, reducing network overhead.
*   **Rate Limiting:** Enforce per-user rate limits on draft creation (e.g., 100 drafts per minute) to prevent storage saturation from runaway automation loops or abusive clients.