# Publish Service

## Responsibilities

The Publish Service is a stateless execution engine responsible for the final-mile delivery of scheduled content to external social media platforms. Its core duties include:

- **Receiving publish triggers** from the Job Service and executing them against the appropriate Platform APIs.
- **Retrieving valid access tokens** from the Auth Service for each target social account at execution time.
- **Normalizing payloads** per platform specification: mapping generic post schemas to Instagram Graph API media containers, Twitter/X API v2 tweets, Facebook Graph API feed objects, LinkedIn UGC posts, and TikTok publish endpoints.
- **Enforcing platform constraints** in the request path: caption character truncation, hashtag count limits, aspect ratio validation, video codec/duration checks, and permitted URL formats.
- **Handling media hand-off**: referencing CDN-optimized URLs in API payloads or performing direct multi-part video uploads to platform endpoints when required.
- **Guarding against duplicate posts** by enforcing idempotency via deterministic `jobId` tracking and, where platform APIs allow, client-supplied idempotency keys.
- **Capturing platform-native identifiers** (`postId`, `permalink`, `publishedAt`) from successful API responses and returning them to the caller.
- **Emitting lifecycle events** to the Notification Service and Job Service for success confirmation, hard failures, and account-level errors (e.g., revoked permissions).

## APIs & Interfaces

### Internal Inbound API (Job Service)

The service exposes an internal REST API consumed exclusively by the Job Service within the cluster.

- `POST /internal/v1/publish/execute`
  - **Request Body:**
    ```json
    {
      "jobId": "agenda_job_abc123",
      "userId": "user_987",
      "accountId": "acct_instagram_001",
      "platform": "instagram",
      "mediaType": "carousel",
      "mediaUrls": ["https://cdn.example.com/img1.jpg", "https://cdn.example.com/img2.jpg"],
      "caption": "Launch day! #buildinpublic",
      "hashtags": ["buildinpublic", "startuplife"],
      "scheduledAt": "2024-05-20T14:00:00Z"
    }
    ```
  - **Response (200 OK):**
    ```json
    {
      "platformPostId": "17921474200912345",
      "permalink": "https://instagram.com/p/ABC123/",
      "publishedAt": "2024-05-20T14:00:03Z",
      "status": "published"
    }
    ```
  - **Response (4xx/5xx failure):** Returns structured error codes (`TOKEN_REVOKED`, `RATE_LIMITED`, `MEDIA_REJECTED`, `PLATFORM_ERROR`) so the Job Service can determine retry vs. fatal failure.

### Outbound Interfaces

- **Auth Service** — `GET /internal/v1/auth/token?accountId={accountId}`
  - Retrieves the current OAuth access token. On `401` from a Platform API, the Publish Service may invoke `POST /internal/v1/auth/refresh` once before failing the job.
- **Notification Service** — `POST /internal/v1/notify/publish-event`
  - Fire-and-forget event delivery. Payload includes `userId`, `jobId`, `platform`, `eventType`, and `metadata` (error stack or post permalink).
- **Platform APIs** — HTTPS/REST and GraphQL clients per adapter:
  - **Instagram:** `POST /v1/{ig-user-id}/media` (create container) → `POST /v1/{ig-user-id}/media_publish`.
  - **Twitter/X:** `POST /2/tweets` with `media.media_keys`.
  - **Facebook:** `POST /v18.0/{page-id}/photos` or `/videos`.
  - **LinkedIn:** `POST /v2/ugcPosts` (legacy) or `/rest/posts` (current).
  - **TikTok:** `POST /v2/post/publish/video/init/` followed by direct upload.

## Data Ownership

The Publish Service **does not own persistent database records** and has no direct MongoDB connection per architecture boundaries. All durable state is delegated to upstream services.

Data handled in-flight:

- **Transient execution context:** In-memory `Map<string, AbortController>` keyed by `jobId` to cancel slow platform uploads.
- **Idempotency window:** A local LRU cache (TTL 120s) of recently successful `jobId` values to reject duplicate execute calls caused by Agenda.js at-least-once delivery semantics.
- **Platform response buffer:** Temporary streaming buffers for chunked video uploads; memory is flushed immediately after the Platform API returns a `2xx` or terminal error.

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Expired / Revoked OAuth Token** | Hard failure; user must reconnect account. | Publish Service requests token refresh from Auth Service once. If refresh fails, it returns `TOKEN_REVOKED` to Job Service and triggers a Notification Service alert. |
| **Platform Rate Limit (HTTP 429)** | Publish blocked for a time window. | Service reads `x-rate-limit-reset` or `Retry-After` headers and returns `RATE_LIMITED` to Job Service, which reschedules the Agenda job for the recommended backoff time. |
| **Media Rejection** | Post cannot be published. | Returns `MEDIA_REJECTED` with the platform’s sub-error code (e.g., Instagram `2207023` for invalid aspect ratio) so User Service can surface actionable UI messaging. |
| **Partial Carousel/Thread Upload** | Orphaned platform media objects (e.g., 2 of 5 Instagram items created before a network error). | Adapter tracks created container IDs; on failure, attempts best-effort deletion of orphaned objects before returning failure to Job Service. |
| **Network Timeout to Platform API** | Ambiguous publish state. | Returns `PLATFORM_TIMEOUT`. Job Service treats as retryable. Idempotency cache prevents accidental duplicate posts if the first request actually succeeded late. |
| **Notification Service Unreachable** | User not alerted, but post may have succeeded. | Publish Service logs the event to stdout with structured JSON; a log-based sidecar or deferred retry can pick up missed notifications. |
| **Platform API Breaking Change** | Sudden field deprecation or auth scope change. | Adapters are version-pinned. Unrecognized HTTP `400` errors route to `PLATFORM_ERROR` and page the on-call for adapter updates. |
| **Duplicate Execution (Queue Redelivery)** | Risk of double-posting. | In-memory idempotency cache + pre-flight search (e.g., Twitter recent tweets by caption hash) within a 5-minute window. |

## Scaling Considerations

- **Stateless Horizontal Scaling:** Node.js/Express processes are fully stateless. Replicas can be scaled via HPA on CPU and on custom metrics such as `http_client_request_duration_seconds` to Platform APIs.
- **Platform Bulkheading:** Isolate Platform API adapters using Node.js `worker_threads` or separate microservice shards so Instagram Graph API congestion does not exhaust the connection pool for LinkedIn publishers.
- **Circuit Breakers:** Per-platform circuit breakers (e.g., using the `opossum` library) trip after 50% failure rate over 30 seconds. While open, requests fast-fail and Agenda jobs are re-queued rather than hammering dead endpoints.
- **Rate Limit Coordination:** Global and per-`accountId` token-bucket rate limiters. The service inspects Platform API response headers (e.g., Twitter’s `x-rate-limit-remaining`) and proactively throttles to avoid hard bans.
- **Streaming Uploads:** For video content, stream directly from CDN-signed URLs to Platform APIs using `pipeline()` to keep memory footprint constant regardless of file size; never buffer full media files in the Publish Service heap.
- **Regional Affinity:** Deploy publish workers in the same AWS region as the majority of Platform API edge locations (e.g., `us-east-1`) to minimize TLS latency and tail timeouts.
- **Observability:** Emit high-cardinality metrics labeled by `platform`, `status_code`, and `error_code` to detect per-platform degradation. Traces must propagate `jobId` from Agenda through to the external Platform API request headers where permitted.