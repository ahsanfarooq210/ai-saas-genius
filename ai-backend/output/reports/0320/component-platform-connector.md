# Platform Connector

## Responsibilities

The Platform Connector is an internal OAuth-integrated adapter that abstracts all outbound communication with external social media APIs (Instagram Graph API, Twitter API v2, Facebook Graph API, etc.). Its core duties include:

- **Credential Retrieval**: Fetching decrypted OAuth tokens from the Token Vault at runtime using the user’s `accountId` and target platform as lookup keys.
- **Rate Limit Coordination**: Consulting the Rate Limiter before every outbound request to acquire quota tickets and prevent account-level or platform-level throttling.
- **Platform-Specific Publishing Flows**: Executing multi-step platform protocols such as Instagram media container creation followed by publishing, Facebook Page feed posts, and Twitter chunked media upload (INIT/APPEND/FINALIZE).
- **Payload Transformation**: Mapping internal post schemas into platform-compliant payloads, applying caption truncation, hashtag placement, media tagging, and locale-specific formatting rules.
- **Media Upload Streaming**: Transmitting photo and video bytes from Object Storage to platform CDNs using streaming HTTP clients to minimize memory footprint.
- **Error Classification**: Categorizing HTTP and network errors into retryable (5xx, 429, timeout) and non-retryable (401 revoked scope, 400 invalid media, 404 deleted account) classes for the Scheduler Service.
- **Structured Receipts**: Returning normalized publish results—platform post IDs, permalink URLs, published timestamps—or detailed failure metadata back to the calling Agenda.js job worker.

## APIs and Interfaces

The Platform Connector is consumed as a Node.js service module by the Scheduler Service. It does not expose a public REST interface.

### Internal Service Methods

```typescript
class PlatformConnector {
  // Primary entry point invoked by Agenda.js job processors
  async publish(job: PublishJob): Promise<PublishResult>;

  // Streams media to platform upload endpoints; returns platform-specific media handle
  async uploadMedia(
    mediaStream: Readable,
    metadata: MediaMetadata,
    account: SocialAccount
  ): Promise<PlatformMediaId>;

  // Validates that stored tokens still have required scopes/permissions
  async verifyCredentials(account: SocialAccount): Promise<VerificationStatus>;

  // Optional cleanup for rollback scenarios
  async deletePost(platformPostId: string, account: SocialAccount): Promise<void>;
}
```

### Cross-Service Interfaces

- **Token Vault**: Internal HTTPS/gRPC call to fetch `access_token`, `refresh_token`, and scope metadata. The Connector does not cache tokens durably; it requests them per job batch or workflow phase.
- **Rate Limiter**: Pre-flight call to `acquire(platform, accountId, cost)` before each API request. The Connector commits quota on success and releases it on retryable failure.
- **Scheduler Service (caller)**: Direct module dependency within the same Node.js runtime. Failures are thrown as typed exceptions (`AuthRevokedError`, `RateLimitError`, `PlatformTimeoutError`) that Agenda.js job definitions catch and handle.

## Data Ownership

The Platform Connector is intentionally stateless and owns no persistent MongoDB collections.

- **Transient Request Telemetry**: Emits structured logs (correlation ID, platform, endpoint, HTTP status, latency, job ID) to stdout for ingestion by the centralized logging pipeline. These logs are short-lived and used for debugging, not business logic.
- **Platform API Registry**: Maintains an in-memory map of API base URLs, version paths, and capability flags (e.g., max video file size, allowed aspect ratios, caption character limits) loaded from environment variables at startup.
- **Circuit Breaker State**: Tracks per-platform failure counters and breaker status (closed, open, half-open) in memory. State is lost on process restart and is intended only as a local pressure valve, not a source of truth.

## Failure Modes

- **Expired or Revoked OAuth Tokens**: External APIs return HTTP 401/403 when a user revokes access or a refresh token expires. The Connector maps this to an `AUTH_REVOKED` error and returns it immediately to the Scheduler Service. This is non-retryable and triggers the Notification Service to alert the user to re-authenticate.
- **Rate Limit Exhaustion (HTTP 429)**: Despite Rate Limiter gating, race conditions or sudden platform quota reductions can cause throttling. The Connector inspects the `Retry-After` header when available and signals the Scheduler Service to defer the job.
- **Platform API Timeouts and Downtime**: Network partitions or upstream outages produce `ECONNRESET`, `ETIMEDOUT`, or 5xx responses. A per-platform circuit breaker trips after a configurable failure threshold (e.g., 5 errors in 60 seconds), fast-failing subsequent jobs for a cooldown period to protect both the platform and local resources.
- **Media Validation Rejection**: Platforms may reject video codec, resolution, duration, or container format after upload begins. The Connector classifies these as `MEDIA_INVALID` (HTTP 400 with platform-specific sub-codes), causing the Scheduler to mark the job as permanently failed without further retries.
- **Token Vault Unavailability**: If the Token Vault is unreachable, the Connector cannot resolve credentials. Jobs fail fast with `DEPENDENCY_UNAVAILABLE`, allowing Agenda.js to apply its configured retry/backoff policy.
- **Partial Publish State**: In multi-step flows (e.g., Instagram media container created successfully but the publish call fails), the Connector must either return the container ID so the Scheduler can retry the publish step idempotently, or explicitly delete the orphaned container to prevent duplicate content.
- **Permission Scope Reduction**: If a user removes a required scope (e.g., `pages_manage_posts` for Facebook), the Connector translates platform permission errors into actionable error codes rather than generic 403 messages.

## Scaling Considerations

- **Rate-Limit-Bound Concurrency**: The Connector’s throughput is gated by external API quotas, not internal CPU. Horizontal scaling of Scheduler Service workers increases concurrency, but the Rate Limiter must enforce per-account and per-platform caps to avoid API bans.
- **Streaming Uploads for Large Media**: Video files must be transmitted as Node.js `Readable` streams using HTTP clients with streaming support (e.g., `axios` with `responseType: 'stream'` or `undici`). Buffering large files in memory will exhaust the Node.js heap under Agenda.js job load.
- **Per-Platform Circuit Breakers**: Circuit breakers must be scoped individually to Instagram, Twitter, Facebook, etc. Degradation or outage on one platform should not degrade publish capability for others.
- **Connection Reuse and Keep-Alive**: Configure persistent HTTPS agents per platform domain to reuse TLS sessions and TCP connections. This reduces latency and file descriptor exhaustion when thousands of jobs run per minute.
- **Idempotency Keys**: For platforms that support idempotency (e.g., Twitter `Idempotency-Key` header), the Connector should generate deterministic keys derived from `accountId + contentHash + scheduledTime` to prevent duplicate posts during Scheduler retries or job processor restarts.
- **Token Vault Read Optimization**: While tokens must not be cached in plain text indefinitely, a short-lived in-memory cache (bounded to active jobs, TTL ≤ 5 minutes) can reduce vault load. Cached entries must be held in memory only and never written to logs or external stores.
- **Non-Blocking I/O Isolation**: Because media uploads are long-running and I/O-bound, ensure they run inside async functions that yield to the event loop. If Agenda.js job concurrency is high, isolate long uploads to a dedicated worker thread pool or separate worker process so job polling and heartbeat updates are not blocked.

## Related Diagrams

No paired Mermaid diagram was provided for this document.