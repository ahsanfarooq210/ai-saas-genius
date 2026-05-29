## Platform Publisher

### Overview
The `platform_publisher` is a stateless background worker responsible for the final mile of content delivery. It consumes prepared publishing jobs from the Agenda.js queue (managed by `job_scheduler`), retrieves platform credentials from `token_store`, fetches optimized media from the `cdn`, and executes outbound API calls to connected social media platforms. Upon completion, it reports outcomes to `analytics_collector` and triggers user alerts via `notification_service`.

---

### Responsibilities

- **Job Consumption**: Register Agenda.js processors for `publish:photo` and `publish:video` job types queued by `job_scheduler`.
- **Credential Retrieval**: Fetch decrypted OAuth access tokens from `token_store` for the target user and platform.
- **Media Ingestion**: Stream media bytes from `cdn` URLs embedded in the job payload; never store media locally on disk.
- **Platform API Execution**: Construct and send platform-specific publish requests (e.g., Graph API for Instagram/Facebook, REST API for LinkedIn, API v2 for Twitter/X).
- **Payload Normalization**: Map generic internal post schemas to platform-specific requirements, including caption truncation, hashtag placement, aspect ratio metadata, and video chunking protocols.
- **Retry & Backoff**: Classify errors as retryable (network timeouts, 429 rate limits) or terminal (401 auth failures, payload rejected) and act accordingly.
- **Side Effect Coordination**: Fire publish events to `analytics_collector` and status notifications to `notification_service` without letting sidecar failures compromise the core publish operation.
- **Idempotency Guardrails**: Detect and suppress duplicate publishes caused by exactly-once delivery failures in the job queue.

---

### APIs and Interfaces

#### Internal Interfaces

| Interface | Protocol / Mechanism | Purpose |
|-----------|---------------------|---------|
| **Agenda.js Job Queue** | MongoDB-backed job processor (via `job_scheduler`) | Consumes job documents containing `userId`, `platform`, `contentType`, `mediaCdnUrl`, `caption`, `hashtags`, `scheduledAt`, and `jobId`. |
| **Token Store** | Internal HTTP/GRPC (`GET /internal/v1/tokens/{userId}/{platform}`) | Retrieves active OAuth credentials and expiry metadata. `token_store` handles decryption at rest. |
| **CDN** | HTTPS GET | Streams optimized media from signed/public URLs. No persistent connection; fetch-on-demand per job. |
| **Notification Service** | Internal HTTP (`POST /internal/v1/notifications`) | Fire-and-forget (with timeout) requests to alert users of success or failure. Payload includes `userId`, `event` (`publish.succeeded` \| `publish.failed`), `platform`, and `errorCode`. |
| **Analytics Collector** | Internal HTTP (`POST /internal/v1/analytics/events`) | Records structured publish events including `jobId`, `userId`, `platform`, `externalPostId`, `status`, and latency metrics. |

#### External Platform APIs

The component integrates directly with platform-native publishing endpoints. Examples of supported targets include:

- **Facebook/Instagram Graph API**: `POST /{api-version}/{ig-user-id}/media` (container creation) and `POST /{api-version}/{ig-user-id}/media_publish`.
- **Twitter/X API v2**: `POST /2/tweets` with media IDs obtained via `POST media/upload.json` (chunked upload for videos > 5 MB).
- **LinkedIn REST API**: `POST /v2/ugcPosts` for personal shares; `POST /v2/posts` for organization pages.
- **TikTok Research/Publishing API**: `POST /v2/post/publish/video/init/` followed by file upload to returned URLs.

All outbound calls use platform-specific SDKs or handcrafted HTTPS agents with configurable timeouts, TLS settings, and custom headers (e.g., `X-Restli-Protocol-Version` for LinkedIn).

---

### Data Ownership

The `platform_publisher` does **not** own any MongoDB collections. It is a stateless processing node. Transient data handled during execution includes:

- **In-Memory Rate Limit State**: Platform-specific `x-rate-limit-remaining` and `x-rate-limit-reset` headers cached in an LRU for the duration of the process lifetime.
- **Circuit Breaker State**: Per-platform endpoint health (closed/open/half-open) stored in local memory.
- **Streaming Buffers**: Node.js `stream.PassThrough` buffers used to pipe video bytes from the CDN to platform upload endpoints without writing to disk.

Persistent post metadata (external post IDs, publish timestamps, job statuses) is owned by `job_scheduler`, `analytics_collector`, or `user_service`.

---

### Failure Modes

| Failure | Behavior | Mitigation |
|---------|----------|------------|
| **Expired / Revoked OAuth Token** | Platform returns `401`/`403`. The publisher immediately fails the job with code `TOKEN_INVALID`. | Halts retry to prevent account lockout. Emits a failure notification via `notification_service` so the user can re-authenticate via `auth_service`. |
| **Rate Limiting (429)** | Platform returns `429` or quota exhaustion headers. | Reads `Retry-After` (or uses platform-specific backoff) and reschedules the job in `job_scheduler` for a future time. Logs a throttling event to `analytics_collector`. |
| **CDN Media Inaccessible** | The `mediaCdnUrl` returns `404`/`403` (expired signed URL). | Fails permanently with `MEDIA_INACCESSIBLE`. No retry is attempted because the URL cannot self-heal without `media_processor` regenerating the asset. |
| **Platform Payload Rejection** | Invalid codec, caption length exceeded, or unsupported aspect ratio. | Fails permanently with `PLATFORM_REJECTED`. The error detail is forwarded to the user notification. |
| **Partial Multi-Platform Success** | A composite job targets three platforms; two succeed, one fails. | Marks the job `completed_with_errors`. Successful platform `postId`s are still reported to `analytics_collector`; only the failed platform triggers an alert. |
| **Duplicate Publish Risk** | A network timeout occurs, but the platform accepted the request. On retry, a second post could be created. | Uses platform idempotency keys (e.g., Twitter `media_category` keys, Facebook `published` state checks) or pre-flight existence lookups where supported. |
| **Sidecar Degradation** | `notification_service` or `analytics_collector` times out or returns 500. | The publish is **not** rolled back. A circuit breaker opens for the degraded sidecar; the publisher logs a warning and continues. |

---

### Scaling Considerations

- **Platform-Isolated Concurrency**: Run distinct Agenda.js processor pools (or tagged worker groups) per platform. Instagram’s strict 200 calls/hour/user limit must not block LinkedIn jobs that permit higher throughput. Concurrency limits should be configurable per platform via environment variables.
- **Horizontal Pod Autoscaling**: Because the worker is stateless, replicas can be scaled out based on the depth of the `platform_publisher` job queue in MongoDB. Queue lag metrics should drive HPA decisions.
- **Streaming Uploads**: Video files must be streamed directly from the CDN URL to the platform API using `stream.pipeline()` to keep memory footprint constant regardless of file size. Avoid loading media into memory buffers.
- **Persistent HTTP Agents**: Reuse HTTPS keep-alive agents per platform domain (e.g., `graph.facebook.com`, `api.twitter.com`) to eliminate TLS handshake overhead when publishing thousands of posts per hour.
- **Regional Routing**: For platforms with geo-fenced APIs (e.g., WeChat, Kakao), route jobs to publisher replicas deployed in the required region. `job_scheduler` can attach region affinity labels to job data.
- **Circuit Breakers & Bulkheads**: Implement per-platform circuit breakers. If Facebook API latency exceeds 5 seconds or error rate exceeds 50%, the breaker opens and new Facebook jobs fast-fail while Twitter/LinkedIn jobs continue unaffected.
- **Observability**: Emit structured JSON logs on every publish attempt containing `jobId`, `userId`, `platform`, `durationMs`, and `externalPostId`. Correlate these traces with `job_scheduler` and `media_processor` via a shared `traceId` propagated in job metadata.

---

## Related Diagrams

- `diagrams/001/iter1_component-platform-publisher.mmd`