## Publisher Service

### Overview
The **Publisher Service** is the execution engine responsible for delivering assembled content to external social media platforms. Triggered by the `jobScheduler` (Agenda.js), it coordinates with the `accountService` for OAuth credentials and the `contentBuilder` for platform-specific post payloads, then performs the actual HTTPS request to the target platform’s publishing API on behalf of the user.

### Responsibilities
- **Job Execution**: Accept and run publishing jobs dispatched by the `jobScheduler`.
- **Credential Resolution**: Retrieve encrypted OAuth tokens and account metadata from `accountService` for the target social account.
- **Payload Retrieval**: Obtain fully assembled post bundles (media URLs, captions, hashtags, metadata) from `contentBuilder`.
- **Platform Adaptation**: Translate generic post bundles into the correct request shape and encoding for each external platform (e.g., Facebook Graph API, Twitter API v2, LinkedIn UGC Posts, TikTok Publishing API).
- **Authenticated Publishing**: Execute signed HTTPS requests, including multipart file uploads when binary media is required.
- **Response Interpretation**: Parse platform responses to extract post IDs, permalinks, rate-limit headers, and error codes.
- **Failure Classification**: Categorize failures as `retryable` (network blips, 429 rate limits) or `permanent` (revoked tokens, policy violations) and return the verdict to `jobScheduler`.
- **Idempotency Guarding**: Prevent duplicate posts during Agenda.js retries by attaching deterministic idempotency keys or consulting the job log for an existing `platformPostId`.

### APIs / Interfaces

#### Internal Service Interface (consumed by `jobScheduler`)

```typescript
interface PublishJobRequest {
  jobId: string;
  userId: string;
  accountId: string;
  contentManifestId: string;
  targetPlatform: 'facebook' | 'instagram' | 'twitter' | 'linkedin' | 'tiktok';
  scheduledAt: Date;
}

interface PublishJobResult {
  status: 'success' | 'retryable' | 'permanent_failure';
  platformPostId?: string;
  postUrl?: string;
  publishedAt?: Date;
  error?: {
    code: 'RATE_LIMITED' | 'TOKEN_REVOKED' | 'MEDIA_REJECTED' | 'INVALID_PAYLOAD' | 'PLATFORM_ERROR';
    message: string;
    platformStatusCode?: number;
    retryAfterSeconds?: number;
  };
}

// Primary entry point invoked by Agenda.js job processor
async function executePublishJob(req: PublishJobRequest): Promise<PublishJobResult>;
```

#### Downstream Dependencies

- `accountService.getCredentials(accountId): Promise<AccountCredentials>`  
  Returns decrypted OAuth 2.0 access tokens, refresh tokens, and API keys for the user’s linked account.

- `contentBuilder.getPlatformPayload(contentManifestId, targetPlatform): Promise<PlatformPayload>`  
  Returns the finalized caption, media references, and platform-specific metadata required for the post.

#### External Platform APIs
- **Facebook Graph API** — `POST /{page-id}/photos`, `POST /{page-id}/videos`, `POST /{page-id}/feed`
- **Instagram Content Publishing API** — `POST /{ig-user-id}/media`, `POST /{ig-user-id}/media_publish`
- **Twitter API v2** — `POST /2/tweets` (with `media.media_ids` for attached media)
- **LinkedIn REST API** — `POST /v2/ugcPosts` or `/v2/posts`
- **TikTok Publishing API** — Video upload and publish endpoints with chunked upload support where applicable.

### Data Owned
The Publisher Service is **stateless** and does not maintain primary persistent storage in MongoDB. It operates entirely on transient, short-lived data:

- **In-memory circuit breaker state** — Per-platform API health (`closed`, `open`, `half-open`) to fail fast during outages.
- **Rate-limit caches** — Volatile, TTL-cached `x-rate-limit-remaining` and `x-rate-limit-reset` headers per `(platform, accountId)`.
- **Binary read streams** — Temporary streams from `mediaStorage` piped directly into multipart HTTPS requests; never buffered to local disk.
- **No owned collections** — Published post metadata (e.g., `platformPostId`, permalink) is returned to the `jobScheduler` for persistence in the Agenda.js job collection or a dedicated posts collection elsewhere.

### Failure Modes

| Failure | Cause | Impact | Mitigation |
|---|---|---|---|
| **OAuth Token Expired / Revoked** | User revokes app permission or refresh token fails | Permanent publish failure | Return `permanent_failure` with `TOKEN_REVOKED`; `accountService` marks the account as disconnected and alerts the user. |
| **Platform Rate Limit (429)** | Quota exceeded for the account or app | Delayed post | Return `retryable`; consume the `Retry-After` header (or exponential backoff if absent) and let Agenda.js reschedule. |
| **Media Rejection** | Platform rejects codec, dimensions, duration, or copyright | Permanent failure | Return `permanent_failure` with `MEDIA_REJECTED`; surface error to user for content adjustment. |
| **Network Timeout / ECONNRESET** | Transient platform or ISP degradation | Lost or incomplete publish | Return `retryable`; HTTP client timeout set to 30–60s with retryable TCP errors caught. |
| **Payload Schema Drift** | `contentBuilder` output incompatible with updated platform API | 4xx client error | Return `permanent_failure` with `INVALID_PAYLOAD`; emit critical alert for engineering intervention. |
| **Duplicate Execution** | Agenda.js retries after successful publish but before result acknowledgment | Duplicate public post | Derive an idempotency key from `jobId + accountId + contentManifestId`; pass to platform if supported (e.g., `client-provided-key`), otherwise skip publish if `platformPostId` already exists in the job log. |
| **Partial Multi-Platform Failure** | One of several scheduled platforms fails while others succeed | Inconsistent post state | Each platform runs as an independent Agenda.js job; failures are isolated and retried per platform without affecting siblings. |

### Scaling Considerations

- **Stateless Horizontal Scaling** — Deploy the Publisher Service across multiple Node.js processes or containers. Because it holds no session state, any instance can pick up any job from the `jobScheduler`.
- **Distributed Rate Limiting** — External API quotas are the hard bottleneck. Implement a Redis-backed token bucket per `(platform, accountId)` so that scaling out workers does not violate platform limits.
- **HTTP Connection Pooling** — Reuse platform-specific `https.Agent` instances with `keepAlive: true` and tuned `maxSockets` to avoid TCP handshake overhead and port exhaustion during peak publishing windows.
- **Circuit Breakers** — Use per-platform circuit breakers (e.g., `opossum`). If error rates exceed a threshold (e.g., 50% over 60 seconds), fail fast for a cooldown period to prevent saturating job workers with doomed requests.
- **Direct Media Streaming** — For video posts, stream bytes from `mediaStorage` directly into the platform HTTPS request. Avoid buffering large binaries into Node.js heap to prevent memory pressure and garbage-collection pauses.
- **Queue Segregation by Platform** — The `jobScheduler` should use discrete Agenda.js job names or queues per platform (`publish:twitter`, `publish:instagram`). This prevents slow, upload-heavy platforms (e.g., TikTok) from head-of-line blocking lightweight text-based platforms (e.g., Twitter).
- **Outbound Observability** — Attach trace IDs and platform/account tags to every external request. Emit metrics for publish latency, throughput, and `error.code` counters to detect platform-specific degradation quickly.

## Related Diagrams

No paired Mermaid diagram was provided for this component.