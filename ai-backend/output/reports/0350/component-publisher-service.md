# Publisher Service

## Responsibilities

The Publisher Service is the platform-specific publish orchestrator responsible for executing social media posts on behalf of users. It translates internal job payloads into authenticated API calls against external social platforms, enforcing safety and consistency guarantees throughout the dispatch lifecycle.

Core duties include:

- **Platform Adapter Orchestration**: Abstracts platform-specific publish protocols (e.g., Instagram Graph API container creation and publish, Twitter API v2 media upload + tweet creation, Facebook Graph API photo/video posts) behind a unified internal interface.
- **Credential Retrieval**: Fetches decrypted OAuth access tokens from the Token Vault at request time, ensuring the latest rotated credential is used for every publish attempt.
- **Idempotency Enforcement**: Generates and validates idempotency keys (e.g., `SHA-256(userId + contentId + platform + scheduledAt)`) stored in Redis to prevent duplicate posts during job worker retries or duplicate queue deliveries.
- **Rate Limit Coordination**: Consults the distributed Rate Limiter (token bucket per platform/account) before initiating external API calls to avoid 429 violations and account-level throttling.
- **Circuit Breaker Compliance**: Checks the Circuit Breaker state (via Redis) for target platform endpoints; rejects jobs immediately with a `deferred` status when a platform is unhealthy.
- **Media URL Resolution**: Retrieves presigned object-storage URLs or CDN URLs from Redis Cache to attach media binaries or remote references to platform payloads.
- **Transient Failure Handling**: Classifies platform errors into retryable (429, 5xx, timeout) and non-retryable (400, 401/403 invalid token, payload too large) categories, returning structured status codes to the Job Worker.
- **Publish State Persistence**: Writes terminal and intermediate publish states (attempt count, platform post ID, error metadata) back to MongoDB Ops so the Scheduler Service and User Service can reflect accurate job history.

## APIs and Interfaces

### Inbound (Internal)

The service exposes an internal REST API consumed exclusively by the Job Worker. All routes are mounted on the internal Express router without public gateway exposure.

- **`POST /internal/v1/publish`**
  - **Headers**: `X-Job-ID`, `X-Idempotency-Key`, `X-Platform-Target`
  - **Body**:
    ```json
    {
      "userId": "string",
      "accountId": "string",
      "platform": "instagram|twitter|facebook|...",
      "mediaType": "photo|video|carousel",
      "mediaObjectKeys": ["string"],
      "caption": "string",
      "hashtags": ["string"],
      "scheduledAt": "ISO-8601",
      "targetSettings": { "aspectRatio": "1:1", "allowComments": true }
    }
    ```
  - **Response**:
    ```json
    {
      "status": "published|failed|deferred",
      "platformPostId": "string|null",
      "errorCode": "RATE_LIMITED|CIRCUIT_OPEN|INVALID_TOKEN|PAYLOAD_REJECTED|PLATFORM_ERROR",
      "retryAfter": 120,
      "attempt": 3
    }
    ```

- **`GET /internal/v1/health`**
  - Returns service readiness and platform adapter circuit states for load-balancer health checks.

### Outbound Dependencies

- **Token Vault**
  - `GET /internal/v1/tokens/:accountId` — Retrieves the current OAuth access token and token version. The Publisher Service does not cache tokens locally; it requests them per job to avoid using revoked credentials.

- **Redis Cache**
  - `GET presigned:url:{objectKey}` — Fetches a cached presigned URL for media retrieval. TTL is aligned with the object-storage signature expiration (default 15 minutes).
  - `SETEX idempotency:{key} 86400 {jobId:..., status:...}` — Atomically registers an idempotency key with a 24-hour TTL after a successful publish.
  - `GET circuit:{platform}:state` — Reads the current circuit breaker status (`CLOSED`, `OPEN`, `HALF_OPEN`) before dispatch.

- **Rate Limiter (via Redis)**
  - `RLA.take(platform:{platform}:account:{accountId})` — Acquires a permit from the distributed token bucket. Returns `allowed: true/false` and `retryAfter` if the bucket is exhausted.

- **Platform APIs**
  - Internal adapter methods:
    - `InstagramAdapter.publish(mediaUrls, caption, token)`
    - `TwitterAdapter.publish(mediaUrls, text, token)`
    - `FacebookAdapter.publish(mediaUrl, message, token)`
  - Adapters handle platform-specific multipart encoding, chunked video upload (for Twitter), and container polling (for Instagram).

- **MongoDB Ops**
  - `PATCH /internal/v1/content/:contentId/publish-status` — Updates the persistent publish record with attempt metadata, platform post IDs, and terminal status.

## Data Ownership

The Publisher Service is stateless and does not own primary operational collections in MongoDB. It generates and manages transient, high-churn runtime data:

- **Idempotency Registry** (`idempotency:{key}` in Redis)
  - Maps idempotency keys to job IDs and final status. Owned with a strict 24-hour TTL to prevent unbounded growth.
- **In-Flight Publish Locks** (`publish:lock:{accountId}:{platform}` in Redis)
  - Short-lived mutexes (30-second TTL) used to serialize concurrent publish attempts against the same social account when per-user concurrency limits allow multiple Job Worker threads.
- **Platform Response Cache** (`platform:resp:{platform}:{jobId}` in Redis)
  - Temporary storage of platform API intermediate identifiers (e.g., Instagram `creation_id`, Twitter `media_id_string`) during multi-step upload flows. TTL matches the platform session timeout (typically 10 minutes).
- **Publish Telemetry Counters** (`metrics:publish:{platform}:{status}` in Redis)
  - Incremental counters for success/failure rates consumed by the Circuit Breaker and monitoring dashboards.

Persistent publish records (content metadata, history, user preferences) reside in MongoDB Ops and are updated but not owned by this service.

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Invalid / Revoked OAuth Token** (401/403 from platform) | Publish fails permanently for the account. | Return `INVALID_TOKEN` to Job Worker. The Auth Service must detect this via out-of-band token health checks or webhook events and refresh/revoke the credential in Token Vault. |
| **Platform Rate Limiting** (429) | Job cannot proceed; account may be penalized. | Consult `Retry-After` header (or platform-specific rate limit metadata). Return `RATE_LIMITED` with `retryAfter` to Job Worker for deferred requeue. Rate Limiter backfills the token bucket. |
| **Circuit Breaker Open** | Healthy jobs rejected to prevent cascading load during platform outages. | Return `CIRCUIT_OPEN` immediately. Job Worker requeues with exponential backoff. Publisher Service does not attempt the API call. |
| **Media URL Expiration** | Platform cannot retrieve media, causing a 400 or timeout. | Validate presigned URL TTL before dispatch. If expired, request a fresh URL from Media Service via Redis Cache refresh. |
| **Idempotency Collision** | Duplicate publish job executes after a successful post. | Check `idempotency:{key}` in Redis before any external API call. If key exists with status `published`, return cached platform post ID without network call. |
| **Partial Multi-Platform Publish** | A single content item targets multiple platforms; some succeed, others fail. | Each platform dispatch uses a unique idempotency key scoped to `contentId + platform`. Per-platform status is tracked independently in MongoDB Ops so retries target only failed platforms. |
| **Platform Payload Rejection** (400, unsupported format, size limit) | Non-retryable failure due to user configuration or media incompatibility. | Return `PAYLOAD_REJECTED`. Job Worker marks the job as permanently failed and surfaces the error to the User Service. |
| **Redis Cache Partition** | Cannot verify idempotency or circuit state. | Degrade to fail-safe: reject the job with `PLATFORM_ERROR` and force the Job Worker to retry. Do not publish without idempotency verification. |
| **Token Vault Latency / Timeout** | Publish thread blocks waiting for secrets. | Enforce a 2-second timeout on Token Vault requests. On timeout, return `deferred` so the Job Worker can retry on another Publisher Service instance. |

## Scaling Considerations

- **Horizontal Pod Autoscaling**: The service is fully stateless; scale out based on CPU utilization and request queue depth (target 60% CPU). No session affinity is required.
- **I/O-Bound Concurrency**: Publishing is network-bound (waiting on external social APIs). Node.js async event loops handle high concurrency, but avoid blocking the event loop with large media buffer transformations. Stream media uploads directly from Object Storage to Platform APIs where supported.
- **Platform API Quotas Are the Bottleneck**: Adding Publisher Service instances beyond the aggregate platform rate limit (e.g., Instagram Graph API’s 200 calls/hour per user) yields no throughput gain. The Rate Limiter and per-account token buckets must be the governing throttle.
- **Distributed Circuit Breaker**: Circuit state is stored in Redis (not local memory) so that an open circuit on one instance protects the entire fleet from hammering a degraded platform endpoint.
- **Connection Pooling**: Maintain persistent HTTP/2 or keep-alive connections to platform APIs via the internal `platform_apis` adapter layer to reduce TLS handshake overhead under high load.
- **Regional Affinity**: Deploy Publisher Service instances in the same region as the majority of external platform API endpoints (e.g., US-East for Meta and Twitter) to minimize cross-region latency and timeout risk.
- **Backpressure Handling**: If platform latency spikes (p95 > 5s), the service should shed load by returning `deferred` rather than accumulating in-flight requests. Set `server.timeout` on the Express internal server to 10 seconds and a max request concurrency limit per instance (e.g., 500 concurrent publishes).
- **Redis Clustering**: Idempotency and circuit breaker reads are high-frequency. Deploy Redis in Cluster mode with replica reads to prevent the Publisher Service from overwhelming a single Redis primary node.

## Related Diagrams

No paired Mermaid diagram was provided for this component document.