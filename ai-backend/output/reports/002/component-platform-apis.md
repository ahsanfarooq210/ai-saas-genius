## Component: Platform APIs

**Type:** External Boundary / Third-Party Integration Surface  
**Scope:** Instagram, Facebook, Twitter/X, LinkedIn, TikTok, and other supported social networks.

---

### Responsibilities

The Platform APIs component represents the external social media interfaces consumed by the automation platform. It is not a service built by the platform team, but rather the aggregate boundary of third-party endpoints that the internal `Publish_Service` and `Auth_Service` interact with.

- **Authorization & Token Exchange:** Provide OAuth 2.0 authorization and token refresh endpoints used during social account connection and session maintenance.
- **Content Ingestion:** Accept published posts, media uploads, and metadata (captions, hashtags, alt text) on behalf of connected users.
- **Platform Constraint Enforcement:** Enforce externally-owned rules including media formats (e.g., MP4/H.264 for TikTok, JPEG/PNG for Instagram), aspect ratios, file size ceilings, caption length limits, and rate quotas.
- **Status & Identity Retrieval:** Return platform-assigned post IDs, media container IDs, publishing state, and user profile metadata required for confirmation and audit trails.
- **Policy & Compliance Gatekeeping:** Reject content that violates copyright, community standards, or API terms of service.

---

### APIs / Interfaces

The internal system does not call platform APIs directly from multiple services. Instead, `Publish_Service` maintains a platform-adapter abstraction layer that normalizes the heterogenous third-party contracts into a single internal interface.

#### Internal Adapter Interface (`Publish_Service` → Platform APIs)
Each platform adapter implements a common TypeScript contract:

```typescript
interface PlatformPublisher {
  authenticate(credentials: PlatformCredentials): Promise<<AuthContext>;
  uploadMedia(
    media: PlatformMediaPayload, 
    context: AuthContext
  ): Promise<<MediaReference>;
  publishPost(
    content: ContentPayload, 
    context: AuthContext
  ): Promise<PublishResult>;
  getStatus(
    platformJobId: string, 
    context: AuthContext
  ): Promise<<PlatformStatus>;
}
```

- `PlatformCredentials` — Access tokens, refresh tokens, and token expiry timestamps managed by `Auth_Service` and retrieved from `Redis_Cache` / `MongoDB`.
- `PlatformMediaPayload` — Pre-processed media URLs from `CDN`, MIME type, file size, and platform-specific metadata (e.g., Instagram `media_type`).
- `ContentPayload` — Caption text, hashtag arrays, scheduled timestamp, and optional location tags.
- `PublishResult` — Platform-assigned post ID (`platformPostId`), permalink URL, and immediate status (`PUBLISHED`, `PROCESSING`, `FAILED`).

#### External Endpoints Consumed

| Platform | Primary API Surface | Key Endpoints / Behaviors |
|----------|---------------------|---------------------------|
| **Meta (Facebook/Instagram)** | Graph API v18.0+ | `POST /{page-id}/photos`, `POST /{ig-user-id}/media`, `POST /{ig-user-id}/media_publish` |
| **Twitter / X** | X API v2 | `POST /2/tweets`, `POST /2/media/upload` (chunked for video) |
| **LinkedIn** | LinkedIn REST API (v2) | `POST /v2/ugcPosts`, `POST /v2/assets?action=registerUpload` |
| **TikTok** | TikTok API for Business / Content Publishing | `POST /v1.2/post/publish/video/init/`, `POST /v1.3/business/video/upload/` |

**Authentication:** All platforms use OAuth 2.0 (authorization code flow). `Auth_Service` stores tokens and injects `Authorization: Bearer <token>` headers into requests sent by `Publish_Service`.

**Versioning:** Platform adapters pin to explicit API versions. Version upgrades are treated as deployable code changes in `Publish_Service` to accommodate schema drift.

---

### Data Ownership

This component owns **no data** within the automation platform. It is a transient conduit.

- **Platform-owned data:** User social profiles, friend/follower graphs, published content, engagement metrics (likes, shares, comments), and platform-side rate-limit counters.
- **System-owned references:** The platform stores foreign identifiers returned by these APIs, such as:
  - `platformPostId` (e.g., tweet ID, LinkedIn `ugcPost` URN)
  - `mediaContainerId` (Instagram staging container)
  - `mediaKey` (X media ID)
- These identifiers are persisted in `MongoDB` by `Content_Service` and `Job_Service` to enable status polling, deduplication, and user-facing audit logs.

---

### Failure Modes

Failures originating at the Platform APIs boundary are propagated back to `Publish_Service` and surfaced via `Notification_Service` and `Agenda_Queue` job state.

| Failure | HTTP Signal | System Impact | Mitigation |
|---------|-------------|---------------|------------|
| **Rate Limiting** | `429 Too Many Requests` | Job deferred; queue backpressure triggered. | Per-platform, per-user token buckets tracked in `Redis_Cache`. `Job_Service` pauses the affected platform queue and retries with exponential backoff. |
| **Expired / Revoked Token** | `401 Unauthorized` | Immediate job failure. | `Auth_Service` attempts proactive refresh. If refresh fails, the user account is marked `disconnected` and a re-auth email is dispatched via `Notification_Service`. |
| **Content Policy Rejection** | `400 Bad Request` / `403 Forbidden` | Terminal job failure. | `Publish_Service` captures the error sub-code and surfaces it to the user (e.g., “Instagram: unsupported aspect ratio”). |
| **Media Format Rejection** | `400` (platform-specific) | Terminal failure if `Media_Service` pre-processing was incorrect. | `Media_Service` must produce platform-compliant outputs before queueing. |
| **Async Publishing Delay** | `202 Accepted` / `IN_PROGRESS` | Job remains in `running` state. | `Publish_Service` polls `getStatus()` on a cadence defined by `Job_Service` until the platform reports `PUBLISHED` or `EXPIRED`. |
| **Platform Outage** | `5xx` / timeout | Job marked for retry. | Circuit breakers in `Publish_Service` temporarily halt outbound requests to the failing platform. |
| **API Deprecation / Breaking Change** | `400` (unknown field) | Mass job failures post-platform change. | Pinned API versions and adapter integration tests in the CI pipeline for `Publish_Service`. |

---

### Scaling Considerations

- **Rate Limit Budgeting:** The system must treat platform rate limits as a shared, scarce resource. `Redis_Cache` maintains sliding-window counters for per-app and per-user quotas. `Publish_Service` consults these counters before issuing requests; if the budget is exhausted, the job remains in `Agenda_Queue` with a delayed next-run time.
- **Queue Isolation per Platform:** `Job_Service` uses distinct Agenda.js job definitions (e.g., `publish-to-instagram`, `publish-to-x`) so that a platform-level outage or rate-limit saturation does not block publishing to other networks.
- **Proactive Token Refresh:** `Auth_Service` runs a background job to refresh tokens before expiry. This prevents a thundering herd scenario where hundreds of scheduled posts fail simultaneously at midnight due to expired OAuth sessions.
- **Media Pre-Staging:** For platforms that support it (e.g., Instagram media containers), `Media_Service` uploads assets ahead of the scheduled publish time. This decouples large file transfers from the critical publish path and reduces latency.
- **Circuit Breakers & Bulkheads:** `Publish_Service` should implement circuit breakers per platform adapter. After a threshold of consecutive failures, the breaker opens for a cooldown period, preventing cascading resource exhaustion inside the Node.js event loop.
- **Idempotency on Retry:** Where supported by the platform (e.g., X `idempotency-key` header), `Publish_Service` generates deterministic keys from the internal `jobId` to prevent duplicate posts during retries.
- **Backpressure Signals:** `Job_Service` should expose platform health metrics to the API Gateway. If a platform is degraded, the Gateway can reject new bulk-scheduling requests with a `503` to prevent queue overload.

---

### Related Diagrams

No dedicated paired component diagram is provided for this external boundary. This component is depicted within the system architecture context in:

- `diagrams/002/iter1_overview.mmd` (system architecture overview)

Relevant interaction flows involving this component are also illustrated in:

- `diagrams/002/iter1_auth-flow.mmd`
- `diagrams/002/iter1_data-pipeline.mmd`
- `diagrams/002/iter1_event-flow.mmd`