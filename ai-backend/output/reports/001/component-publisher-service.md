## Responsibilities

The `publisher_service` is the execution layer responsible for delivering prepared content to connected social media platforms. Its core duties include:

- **Job-Driven Publishing**: Accepts publish commands initiated by the `agenda_worker` and carries out the final API call to each target platform (Instagram, Twitter/X, Facebook, TikTok, LinkedIn).
- **Platform Payload Assembly**: Transforms generic post drafts from `content_service` into platform-specific request schemas, enforcing per-platform constraints such as caption length, media aspect ratios, video duration limits, and hashtag rules.
- **Authenticated API Dispatch**: Delegates signed HTTP requests to the `platform_api_clients`, ensuring each call carries valid OAuth credentials for the target user account.
- **Publish State Management**: Maintains a durable state machine for every publish attempt (`pending` → `publishing` → `published` | `failed`), persisting transition history and platform-assigned post IDs in MongoDB.
- **Retry & Idempotency Coordination**: Evaluates platform responses to classify errors as retryable or terminal; collaborates with the `agenda_worker` to reschedule retryable jobs while preventing duplicate posts via idempotency checks.
- **User Notification Triggers**: Emits structured success and failure events to the `notification_service` so users receive email/push alerts for publish outcomes and account issues.
- **Token Health Monitoring**: Detects expired or revoked OAuth tokens (HTTP 401/403 responses) and flags the associated platform connection as invalid, halting further attempts until re-authentication.

## APIs / Interfaces

The service is primarily an internal worker-facing component. It does not expose public REST endpoints directly to the API gateway, but it defines strict internal contracts.

### Internal Publish Interface (consumed by `agenda_worker`)

```typescript
interface PublishJobData {
  contentId: string;      // MongoDB ObjectId referencing the post draft
  userId: string;         // MongoDB ObjectId of the account owner
  platform: 'instagram' | 'twitter' | 'facebook' | 'tiktok' | 'linkedin';
  mediaVariantIds: string[]; // Processed media references from media_service
  scheduledAt: Date;
  idempotencyKey: string; // contentId + platform composite
}

interface PublishResult {
  platformPostId: string;
  permalink?: string;
  publishedAt: Date;
}
```

- **`PublisherService.execute(job: PublishJobData): Promise<PublishResult>`**
  - Entry point invoked by the Agenda worker. Performs validation, state checks, platform dispatch, and post-action logging.
  - Throws `PublishError` for terminal failures or `RetryableError` for transient issues that should be rescheduled.

### Service Internals

- **`buildPlatformPayload(platform, content, mediaUrls): PlatformPayload`**
  - Maps generic captions, hashtags, and media references into the JSON/multipart bodies required by each social API.
- **`validatePreconditions(userId, platform): Promise<void>`**
  - Confirms that the user’s platform connection is active and that token freshness is within acceptable bounds via `platform_api_clients`.
- **`recordAttempt(attemptDoc): Promise<void>`**
  - Atomically inserts or updates the publish attempt record in MongoDB before and after the API call.
- **`notifyOutcome(userId, platform, status, errorDetails?): Promise<void>`**
  - Fires notification events to the `notification_service` on terminal success or failure.

### Health & Observability

- **`GET /internal/health`**
  - Lightweight Kubernetes liveness/readiness probe. Returns 200 when the Node.js process and MongoDB connection pool are healthy.

## Data it Owns

The service writes to and owns the following MongoDB collections:

### `publish_attempts`

| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | Primary key |
| `contentId` | ObjectId | Reference to the post draft in `content_service` |
| `userId` | ObjectId | Reference to the user profile |
| `platform` | String | Target platform enum |
| `status` | String | `pending`, `publishing`, `published`, `failed`, `cancelled` |
| `platformPostId` | String | Post ID returned by the social platform API (nullable) |
| `permalink` | String | Canonical URL of the live post (nullable) |
| `attemptCount` | Number | Incremented on every execution attempt |
| `lastAttemptedAt` | ISODate | Timestamp of the most recent try |
| `publishedAt` | ISODate | Final success timestamp (nullable) |
| `errorDetails` | Embedded Object | `{ code, message, httpStatus, isRetryable }` (nullable) |
| `createdAt` | ISODate | Record creation timestamp |
| `updatedAt` | ISODate | Last mutation timestamp |

- **Idempotency Guarantee**: A unique compound index on `{ contentId: 1, platform: 1 }` prevents duplicate publish records and serves as the idempotency key for the service.

### `platform_rate_limit_shadow` (optional cache)

| Field | Type | Description |
|-------|------|-------------|
| `platform` | String | Platform identifier |
| `userId` | ObjectId | Scoped rate limit bucket per user |
| `remaining` | Number | Estimated remaining calls |
| `resetAt` | ISODate | Window reset timestamp |

- Used to short-circuit requests locally before hitting hard platform rate limits.

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Transient Platform Timeout** | Publish attempt hangs; user post is delayed. | Enforce strict HTTP timeouts (e.g., 30s). Catch network errors, throw `RetryableError`, and let Agenda reschedule with exponential backoff up to a maximum of 5 attempts. |
| **Expired / Revoked OAuth Token (401/403)** | All subsequent publishes for that user-platform pair will fail. | Classify as terminal `TOKEN_INVALID`. Update `publish_attempts.status` to `failed` with `errorDetails.isRetryable = false`. Trigger `notification_service` to prompt user re-authorization. |
| **Platform Rate Limit (429)** | Temporary block; retries too aggressively worsen the ban. | Inspect `Retry-After` header. If present, pass the delay back to Agenda via `job.schedule(delay)`. If absent, apply a default exponential backoff starting at 60s. |
| **Content Policy Rejection** | Media or caption violates platform rules. | Terminal failure. Capture the platform error code (e.g., Instagram media aspect ratio violation). Do not retry. Notify user with specific remediation guidance. |
| **Missing / Deleted Media** | Object storage URL returns 404 before dispatch. | Pre-flight HEAD check on media URLs. Fail fast with `MEDIA_NOT_FOUND` terminal error. |
| **Partial Multi-Platform Publish** | One platform succeeds while another fails, leaving inconsistent state. | Each platform is treated as an independent `publish_attempts` record within the same content transaction. Success on one does not mask failure on another. |
| **Duplicate Publish on Worker Retry** | Agenda may invoke the job twice if a worker crashes after the API call but before job completion. | Atomic state guard: update `status` to `publishing` with `attemptCount` increment using MongoDB `findOneAndUpdate` with the idempotency key. If the guard detects an in-flight or completed record, skip the API call and return idempotently. |
| **Database Unavailability During Logging** | Publish succeeds but state is not recorded, risking a duplicate on next retry. | Use a two-phase commit pattern: write `publishing` state before the API call. On success, update to `published`. If the DB is unreachable at update time, the next retry will see `publishing` and perform a reconciliation lookup against the platform API before re-attempting. |

## Scaling Considerations

- **Stateless Workers**: The service itself holds no in-memory publish state. All job context is stored in MongoDB and Agenda’s job collection, allowing horizontal scaling of both `agenda_worker` and `publisher_service` pods behind a load balancer.
- **Platform-Specific Concurrency Limits**: Each social network imposes distinct rate limits (e.g., Instagram Graph API vs. Twitter/X API v2). Use Agenda named queues (e.g., `publish:instagram`, `publish:tiktok`) with per-queue concurrency caps to prevent thundering-herd violations against a single platform.
- **I/O-Bound Throughput**: Publishing is predominantly HTTP request latency. Node.js’s event loop is well-suited, but video uploads to TikTok or Instagram Reels require streaming multipart uploads. Avoid buffering large files in memory; stream directly from `object_storage` through `platform_api_clients`.
- **Circuit Breakers**: Integrate per-platform circuit breakers in the `platform_api_clients`. If a platform endpoint errors above a threshold (e.g., 50% failure rate over 60s), fail fast for a cooldown window rather than consuming worker threads on doomed requests.
- **Database Backpressure**: High publish volumes generate frequent writes to `publish_attempts`. Ensure MongoDB write concern is tuned for throughput (`w: majority` for state guards, `w: 1` for non-critical audit logs if acceptable). Index `{ userId: 1, status: 1 }` and `{ scheduledAt: 1 }` to support dashboard queries without table scans.
- **Observability**: Attach correlation IDs from the Agenda job into every `publisher_service` log and outgoing HTTP request header. This enables end-to-end tracing from scheduler → publisher → platform API.

## Related Diagrams

No paired diagram was provided for this document.