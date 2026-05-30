## Component: Platform API Clients

### Responsibilities

The Platform API Clients component provides OAuth-authenticated HTTP adapters for each supported social network. It abstracts platform-specific protocol details away from the `publisher_service` and enforces the unique constraints of each external API.

* **Authenticated Request Orchestration**: Injects valid access tokens retrieved from the `token_store` into every outgoing request. Handles token refresh signaling when a platform returns `401 Unauthorized` or invalid-grant errors.
* **Multi-Platform Publishing**: Implements platform-specific publish flows:
  * **Instagram**: Graph API Content Publishing container creation, media upload to container, and publish with user tags and location.
  * **Twitter/X**: v2 Tweets API with media upload via chunked upload for videos > 5MB, including category-based media processing wait loops.
  * **Facebook**: Graph API Page posts with `published` flags, video upload via `/videos` edge, and reel publishing support.
  * **TikTok**: Research and Content Publish API video upload with publish status polling and creator info validation.
  * **LinkedIn**: REST API shares (UGC Posts) with media asset registration and multi-part upload completion callbacks.
* **Content Validation**: Pre-flight checks against platform limits (e.g., Instagram 2200-character caption, Twitter 280-character tweet, TikTok 4GB video size, LinkedIn 8-minute video duration) before initiating network calls.
* **Idempotency & Deduplication**: Generates and attaches platform-native idempotency keys or client-provided keys to prevent duplicate posts during retries.
* **Error Normalization**: Maps heterogeneous platform error codes (Facebook subcodes, Twitter error arrays, LinkedIn serviceErrorCodes) into a standardized internal error taxonomy consumed by the `publisher_service` and `notification_service`.
* **Rate Limit Awareness**: Inspects response headers (`x-ratelimit-remaining`, `x-app-rate-limit`, `x-user-rate-limit`) and exposes current quota state to callers.

### APIs / Interfaces

This component exposes a typed Node.js module interface consumed directly by the `publisher_service`. It does not expose HTTP endpoints.

#### Core Interface

```typescript
interface PlatformApiClient {
  publishPost(params: PublishRequest): Promise<PublishResult>;
  uploadMedia(params: MediaUploadRequest): Promise<MediaReference>;
  validateConnection(accountId: string): Promise<AuthStatus>;
  getRateLimitStatus(accountId: string): Promise<RateLimitSnapshot>;
}

type SupportedPlatform = 
  | 'instagram' 
  | 'twitter' 
  | 'facebook' 
  | 'tiktok' 
  | 'linkedin';
```

#### Method Specifications

* `publishPost(PublishRequest)`
  * Accepts a normalized payload containing `accountId`, `mediaRefs`, `caption`, `hashtags`, `scheduledTime`, and platform-specific options (e.g., `twitterReplySettings`, `facebookTargeting`, `linkedinVisibility`).
  * Returns a `PublishResult` containing the platform-native post ID, permalink URL, and published timestamp.
  * Throws `PlatformRateLimitError`, `TokenInvalidError`, `ContentRejectedError`, or `PlatformUnavailableError`.

* `uploadMedia(MediaUploadRequest)`
  * Accepts a readable stream or buffer, MIME type, file size, and optional thumbnail.
  * For Twitter/X videos, automatically negotiates chunked upload sessions (INIT, APPEND, FINALIZE, STATUS).
  * For TikTok, initiates a publisher upload and polls the query creator info endpoint until processing completes.
  * Returns a `MediaReference` containing the platform media ID and CDN URL required by `publishPost`.

* `validateConnection(accountId)`
  * Performs a lightweight API call (e.g., `GET /me` or `GET /2/users/me`) to verify that the stored token still has required scopes and has not been revoked by the user.
  * Returns `valid`, `expired`, or `scopes_insufficient`.

* `getRateLimitStatus(accountId)`
  * Returns the remaining quota for the current window, derived from the most recent API response headers or a shared cache.

#### Internal Module Structure

```
platform-api-clients/
├── clients/
│   ├── instagram-client.ts
│   ├── twitter-client.ts
│   ├── facebook-client.ts
│   ├── tiktok-client.ts
│   └── linkedin-client.ts
├── errors/
│   ├── platform-error-codes.ts
│   └── normalized-error-factory.ts
├── types/
│   └── publish-contracts.ts
└── index.ts                 # Factory exporting client instances by platform name
```

### Data Owned

The Platform API Clients component is stateless with respect to user business data, but it owns and manages the following operational artifacts:

* **Platform API Configuration Registry**: Base URLs, API version paths, sandbox endpoints, and feature flags per platform (e.g., whether Instagram stories publishing is enabled for the app). Stored as static configuration or environment-bound JSON, not in MongoDB.
* **OAuth App Credentials**: The client ID and client secret for the platform app registrations (e.g., Instagram App ID, Twitter API Key). These are read from environment variables or a secrets manager at startup; the component does not store user tokens.
* **Rate Limit Cache (Ephemeral)**: Per-account, per-platform rate limit snapshots (`remaining`, `resetTime`, `limit`). If the `publisher_service` scales horizontally, this cache must be backed by Redis to prevent quota overruns across multiple Node.js processes.
* **Content Constraint Manifests**: Platform-specific validation rules such as maximum file sizes, accepted codecs (H.264 for Instagram/Twitter, AAC audio), aspect ratio enums, and maximum caption lengths. These are hardcoded schemas version-locked to the current API revision.
* **Retry & Timeout Policies**: Per-platform axios/fetch client configurations—e.g., Twitter 30-second timeout with 3 retries, LinkedIn 60-second timeout with 2 retries, and TikTok long-poll intervals.

### Failure Modes

| Failure | Cause | Impact | Mitigation |
|---|---|---|---|
| **Token Expired / Revoked** | User revokes access via platform settings; refresh token expired. | Publish job fails permanently for that account. | Catch `401`/`403` auth errors, signal `token_store` to invalidate the connection, and emit an event to `notification_service` prompting the user to reconnect. |
| **Rate Limit Exceeded (429)** | Quota exhausted for app or user tier. | Job fails immediately; repeated retries worsen the ban. | Read `retry-after` or `x-rate-limit-reset` headers. Throw `PlatformRateLimitError` back to `publisher_service`, which defers the Agenda.js job to the reset timestamp. |
| **Media Format Rejected** | Platform encoder rejects codec, dimensions, or duration. | Post cannot be published; media must be reprocessed. | Return granular `ContentRejectedError` with a `reason` enum (`codec_unsupported`, `duration_exceeded`, etc.) so `publisher_service` can alert the user without retrying. |
| **Duplicate Publish** | Network timeout caused `publisher_service` to retry, but the first request succeeded. | Two identical posts appear on the user's profile. | Attach idempotency keys (Facebook `feed` idempotency, Twitter `Client-Id`, Instagram client-provided token) on every mutating request. |
| **Platform API Deprecation** | External platform sunsets an endpoint (e.g., Instagram Basic Display). | All publishes for that platform fail. | Feature flags in the configuration registry allow the `publisher_service` to disable a platform globally while the client adapter is updated. |
| **Scope Insufficiency** | OAuth token lacks `instagram_content_publish` or `tweet.write`. | Operation fails with authorization error. | `validateConnection` checks scopes during account linking; if caught at publish time, fail fast and notify the user to re-authenticate with elevated scopes. |
| **Partial Upload Failure** | Chunked upload (Twitter/TikTok) fails mid-stream due to connection drop. | Corrupt or incomplete media on platform servers. | Maintain upload session state; on retry, resume from the last successful chunk rather than restarting. |
| **Platform Outage** | Meta or Twitter API returns 5xx or is unreachable. | Publish queue stalls for that platform. | Per-platform circuit breakers. After 5 consecutive failures, the client opens the circuit for 60 seconds, returning `PlatformUnavailableError` immediately so Agenda.js jobs can be deferred without wasting resources. |

### Scaling Considerations

* **Horizontal Pod/Process Scaling**: The client module is instantiated within each `publisher_service` worker. Because it holds no local job state, it scales linearly with worker count. However, the rate limit cache must be externalized (Redis) so that 10 concurrent workers do not collectively exceed a single account's quota.
* **Connection Pooling**: Each platform client maintains a persistent HTTPS agent (e.g., `https.Agent` in Node.js) with `keepAlive: true` and tuned `maxSockets` (e.g., 50 per platform) to avoid TCP handshake overhead during high-volume publishing windows.
* **Token Refresh Serialization**: If 100 jobs for the same Instagram account trigger simultaneously and the token is near expiry, only one refresh request should execute. Implement a distributed lock (Redis Redlock or MongoDB atomic update via `token_store`) around `refreshAccessToken` to prevent race conditions and token invalidation cascades.
* **Large Media Streaming**: Video uploads to Facebook and TikTok can exceed 500MB. The client must support streaming from `object_storage` presigned URLs directly to the platform API without buffering the entire file in Node.js memory. Use `pipeline()` with backpressure-aware streams.
* **Async Publish Polling**: Instagram and TikTok require asynchronous publishing (container status checks). The client should expose a `pollForStatus(mediaId)` method that performs bounded exponential backoff (e.g., 5s, 10s, 20s, up to 60s) rather than blocking an Agenda.js job worker indefinitely.
* **Timeout Heterogeneity**: LinkedIn media registration can take 30+ seconds; Twitter tweet creation is typically <2s. Avoid a global HTTP timeout. Instead, configure per-platform and per-operation timeouts:
  * Twitter publish: 10s
  * Instagram container check: 15s
  * Facebook video upload: 120s
  * TikTok upload status poll: 30s
* **Observability**: Emit structured metrics per platform—`platform_api_request_duration`, `platform_api_error_rate`, and `platform_api_rate_limit_remaining`—so that scaling decisions (e.g., adding more workers for LinkedIn vs throttling Twitter) can be data-driven.