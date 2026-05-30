## Post Service

### Overview
The Post Service is the content authority for the social media automation platform. It is responsible for assembling publishable post payloads from user-defined captions, hashtags, and account-specific preferences, and for resolving media asset references through the Media Service. It serves two primary traffic patterns: user-facing draft management routed through the API Gateway, and automated composition requests initiated by the Scheduler Service during background job execution.

---

### Responsibilities

- **Post Draft Lifecycle Management** — Creates, updates, retrieves, and soft-deletes post drafts on behalf of users. Maintains a canonical document that tracks the evolution of a post from `draft` through `composed`, `publishing`, `published`, or `failed`.
- **Content Composition** — Aggregates captions, hashtag arrays, platform targets, and account-specific metadata into a normalized, platform-aware payload. This is the core operation invoked by the Scheduler Service before publishing.
- **Media Reference Resolution** — Validates that linked `mediaIds` correspond to fully processed assets in the Media Service. Retrieves final optimized URLs, MIME types, dimensions, and platform-specific variants required by downstream connectors.
- **Platform Constraint Enforcement** — Applies per-platform rules (e.g., Twitter character budgets, Instagram hashtag caps, alt-text requirements) during the `compose` phase so that invalid content is rejected before it reaches the Platform Connector.
- **Optimistic Concurrency Control** — Prevents race conditions between user edits and automated scheduler composition by versioning post documents and enforcing atomic state transitions.
- **Composition Auditability** — Stores the finalized `composedPayload` snapshot and timestamps to provide an immutable record of exactly what was sent to the publisher in case of downstream failures or user disputes.

---

### APIs / Interfaces

#### User-Facing REST Endpoints (via API Gateway)
- `POST /posts` — Creates a new post draft. Accepts `userId`, `caption`, `hashtags`, `mediaIds`, `platformTargets`, and `accountPreferences`. Returns `201 Created` with the post ID.
- `GET /posts/:postId` — Retrieves the post document and eagerly resolves live media metadata from the Media Service for UI preview.
- `PATCH /posts/:postId` — Updates editable draft fields (caption, hashtags, media IDs, preferences). Rejected if `status` is `composing`, `publishing`, or `published`.
- `DELETE /posts/:postId` — Soft-deletes a draft by setting `status` to `archived`. Hard deletion is prohibited to retain audit history.

#### Internal Service Endpoints (Scheduler & Media Service)
- `POST /internal/posts/:postId/compose` — **Idempotent composition trigger**. Called by the Scheduler Service. Atomically transitions the post to `composing`, validates media readiness, applies platform formatting, writes the `composedPayload`, and transitions to `composed`. Returns the full publishable payload. Returns `409 Conflict` if media is still processing, signaling the Scheduler to retry with backoff.
- `GET /internal/media/status?ids=` — Client interface to the Media Service. Batch-resolves processing status and platform-optimized URLs for all `mediaIds` attached to a post.

#### Data Transfer Objects

**Composed Payload (returned to Scheduler Service)**
```json
{
  "postId": "507f1f77bcf86cd799439011",
  "userId": "507f1f77bcf86cd799439010",
  "status": "composed",
  "content": {
    "caption": "Launch day! 🚀",
    "hashtags": ["#startup", "#b2b"],
    "platformSpecific": {
      "instagram": { "caption": "Launch day! 🚀\n\n#startup #b2b", "mediaOrder": ["m1", "m2"] },
      "twitter": { "text": "Launch day! 🚀 #startup #b2b", "card": null }
    }
  },
  "media": [
    {
      "mediaId": "m1",
      "url": "https://cdn.internal/optimized/m1_ig.jpg",
      "type": "image/jpeg",
      "width": 1080,
      "height": 1080
    }
  ],
  "metadata": {
    "composedAt": "2024-05-01T12:00:00Z",
    "version": 3
  }
}
```

---

### Data Owned (MongoDB Collections)

#### `posts`
The primary collection persisted in MongoDB.

| Field | Type | Description |
|---|---|---|
| `_id` | ObjectId | Primary key |
| `userId` | ObjectId | Indexed. Owner of the post |
| `status` | String | `draft`, `pending_media`, `composing`, `composed`, `publishing`, `published`, `failed`, `archived` |
| `caption` | String | Raw user caption |
| `hashtags` | [String] | Ordered array of hashtags |
| `mediaIds` | [ObjectId] | References to Media Service assets |
| `platformTargets` | [String] | e.g., `["instagram", "twitter", "facebook"]` |
| `accountPreferences` | EmbeddedDocument | Per-platform overrides (alt text, disable comments, link stickers) |
| `composedPayload` | EmbeddedDocument | Immutable snapshot generated at composition time |
| `version` | Number | Optimistic locking version; incremented on every update |
| `scheduledAt` | Date | Indexed. Desired publish time from user preferences |
| `createdAt` | Date | Document creation timestamp |
| `updatedAt` | Date | Last mutation timestamp |

#### `composition_audit_log` *(secondary collection)*
Tracks every invocation of the `compose` endpoint for traceability and debugging.

| Field | Type | Description |
|---|---|---|
| `postId` | ObjectId | Indexed |
| `requestedByJobId` | String | Agenda.js job ID that triggered composition |
| `statusBefore` | String | Pre-composition state |
| `statusAfter` | String | Post-composition state |
| `errorCode` | String | Populated on failure (e.g., `MEDIA_NOT_READY`, `CAPTION_TOO_LONG`) |
| `timestamp` | Date | Indexed |

---

### Failure Modes

1. **Media Processing Lag**
   - *Scenario*: The Scheduler invokes `compose` while the Media Service is still transcoding a video or generating platform variants.
   - *Impact*: Post cannot be finalized.
   - *Mitigation*: Post Service queries Media Service for batch status. If any asset is not `ready`, it returns `409 Conflict` with code `MEDIA_NOT_READY`. The Scheduler retries with exponential backoff. The post remains in `pending_media`.

2. **Dangling Media References**
   - *Scenario*: A user deletes a media asset in the UI, but the Post Service still holds the old `mediaId`; or a MongoDB write propagates before Media Service cleanup.
   - *Impact*: Permanent composition failure.
   - *Mitigation*: Validate all `mediaIds` at creation time and re-validate at `compose`. If an ID is missing, transition the post to `failed` with error `INVALID_MEDIA_REFERENCE` and emit an event to the Notification Service so the user can correct the draft.

3. **Platform Constraint Violations**
   - *Scenario*: Caption and hashtags exceed Twitter’s 280-character limit, or more than 30 hashtags are supplied for Instagram.
   - *Impact*: If unchecked, the Platform Connector receives invalid content and the external API rejects the publish, wasting rate-limited quota.
   - *Mitigation*: Enforce strict length/count validations during `PATCH` and `compose`. Return `422 Unprocessable Entity` with specific error codes (`CAPTION_TOO_LONG`, `HASHTAG_LIMIT_EXCEEDED`). These are treated as hard failures; the Scheduler does not retry.

4. **Concurrent User Edit During Composition**
   - *Scenario*: A user saves a caption change via the UI at the same moment the Scheduler locks the post for composition.
   - *Impact*: Race condition could result in publishing content that does not match the user’s latest intent.
   - *Mitigation*: Optimistic locking via the `version` field. The `compose` operation performs a `findOneAndUpdate` requiring the expected version. If the version has changed, the operation aborts with `409 Conflict`, and the Scheduler retries the job in the next cycle after re-fetching the updated document.

5. **MongoDB Replica Set Degradation**
   - *Scenario*: A network partition or primary step-down occurs while the Post Service is updating the `composedPayload`.
   - *Impact*: Composition jobs hang and Scheduler retry queues grow.
   - *Mitigation*: MongoDB driver configuration uses a `5s` server selection timeout and `30s` socket timeout. The Post Service is stateless; failed connections surface as `503` to the Scheduler, which defers the job via Agenda.js. Connection pooling is capped per instance to prevent cascading exhaustion.

6. **Stale Payload Retry**
   - *Scenario*: The Scheduler retries a failed publish job and reuses a previously cached `composedPayload` after the user updated hashtags.
   - *Impact*: Out-of-sync content is published.
   - *Mitigation*: The `compose` endpoint is invoked on every publish attempt; `composedPayload` is overwritten atomically with the latest document state and versioned. Scheduler is prohibited from caching the payload across retries.

---

### Scaling Considerations

- **Stateless Horizontal Scaling** — Post Service nodes are fully stateless. Scale out behind the API Gateway or alongside Scheduler worker pools based on CPU and MongoDB connection utilization. No session affinity is required.
- **Database Index Strategy** — Compound indexes on `{ userId: 1, status: 1 }` support user dashboard queries, while `{ scheduledAt: 1, status: 1 }` optimizes the Scheduler’s polling for posts ready to compose. A partial index on `{ status: 1 }` where `status == "pending_media"` accelerates retry scans.
- **Batch Media Resolution** — When the Scheduler processes high-volume job batches, the Post Service must resolve media metadata in bulk (`GET /internal/media/status?ids=a,b,c`) rather than serializing N requests to the Media Service. This prevents O(n) network amplification.
- **Document Size Discipline** — All heavy binary assets remain in Object Storage. The `posts` collection stores only text, IDs, and lightweight metadata, ensuring documents remain orders of magnitude below the 16 MB BSON limit even for multi-image carousel posts.
- **Rate-Limit Awareness** — Although rate limiting is handled by the dedicated Rate Limiter service, the Post Service can pre-emptively tag `composedPayload` with per-platform priority hints when multiple posts target the same account, helping the Scheduler sequence jobs to avoid throttling.
- **Regional Latency** — If media is stored in multi-region Object Storage, the Post Service should request region-aware CDN URLs from the Media Service during composition, minimizing upload latency when the Platform Connector eventually pushes content to social APIs.