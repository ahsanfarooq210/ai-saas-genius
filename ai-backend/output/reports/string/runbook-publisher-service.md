# Publisher Service

## Responsibilities

The Publisher Service is a stateless background worker layer that executes the final delivery of assembled content to external social media platforms. It is invoked exclusively by job definitions managed in the Agenda.js `jobScheduler`.

Specific duties include:

- **Job Execution**: Processing Agenda.js job instances emitted by the scheduler, each carrying a `userId`, `platform`, `accountId`, and `contentJobId`.
- **Credential Resolution**: Retrieving active OAuth tokens and platform-specific account metadata from the `accountService` immediately before each publish attempt.
- **Payload Retrieval**: Fetching finalized post payloads—base media URLs, resized asset pointers, captions, hashtags, and platform-specific metadata—from the `contentBuilder`.
- **External API Integration**: Translating internal payloads into platform-native requests (e.g., Instagram Graph API container creation, Twitter/X v2 media upload + tweet creation, LinkedIn UGC Posts) and dispatching them over HTTPS.
- **Outcome Reporting**: Returning discrete status codes to the scheduler (`success`, `retryable`, `permanent_failure`) so Agenda.js can apply the correct retry policy or dead-letter the job.
- **Platform Constraint Enforcement**: Rejecting or correcting payloads that violate per-platform rules (caption length limits, media aspect ratios, maximum file sizes) before external transmission to avoid unnecessary API calls.

## APIs and Interfaces

### Inbound Interface

The service exposes **no public HTTP routes**. It registers processor functions with the Agenda.js engine inside the `jobScheduler`:

```javascript
// publisherService/jobRegistry.js
agenda.define('publish-to-platform', { priority: 10, concurrency: 5 }, async (job) => {
  await publisherService.publish(job.attrs.data);
});
```

The job data payload contract:

| Field | Type | Description |
|-------|------|-------------|
| `userId` | `ObjectId` | MongoDB user identifier |
| `accountId` | `ObjectId` | Linked social account document ID |
| `platform` | `string` | Target platform key (`instagram`, `twitter`, `facebook`, `linkedin`) |
| `contentJobId` | `ObjectId` | Reference to the content assembly job record |

### Outbound Dependencies

- **`accountService`**: Internal module call (`accountService.getValidCredentials(accountId)`) to fetch decrypted OAuth tokens and API keys. The publisher expects a token bundle including `accessToken`, `refreshToken`, and `expiresAt`.
- **`contentBuilder`**: Internal module call (`contentBuilder.getAssembledPayload(contentJobId, platform)`) returning a normalized payload object containing `mediaUrls`, `caption`, `hashtags`, and platform-specific metadata.
- **External Platform APIs**: Authenticated HTTPS requests using platform SDKs or raw `axios`/`fetch` calls. All outbound traffic is routed through an egress proxy with TLS 1.2+.

## Data Ownership

The Publisher Service **does not own any MongoDB collections** and maintains no durable state between job runs.

Transient data it holds in memory during execution:

- **Platform API response bodies** for the duration of a single job (logged, then discarded).
- **Streaming media buffers** when chunk-uploading large video files to platforms that require multi-part upload (e.g., Twitter chunked media upload).

All persistent records—OAuth tokens, user preferences, job history, and media storage paths—remain under the ownership of `accountService`, `preferenceService`, `jobScheduler`, and `mediaStorage` respectively.

## Failure Modes

| Failure | Cause | Impact | Mitigation |
|---------|-------|--------|------------|
| **OAuth Token Expiry** | Platform revokes or expires the token mid-request | `401 Unauthorized`; publish fails | Call `accountService` to trigger a refresh-token flow before retry; if refresh fails, surface to user and mark `permanent_failure`. |
| **Platform Rate Limit (429)** | Exceeding platform’s posting quota | Job must back off | Catch `429`, read `Retry-After` header, and return a `retryable` status with calculated delay to Agenda.js. |
| **Media Rejection** | Asset violates platform rules (format, duration, size) | Post rejected before publish | Validate against platform matrices at the `contentBuilder` stage, but defensively catch errors and return `permanent_failure` with a detailed reason string. |
| **Partial Publish** | Multi-platform job succeeds on one platform but fails on another | Data inconsistency across platforms | Each platform target is a discrete Agenda.js sub-job; failures are isolated to the individual job record. |
| **Idempotency Collision** | Duplicate Agenda.js job execution publishes twice | Duplicate public post | Generate a deterministic platform-native idempotency key (e.g., `userId + contentJobId + platform`) and pass it in API headers or metadata where supported. |
| **Network Timeout / Egress Partition** | Transient connectivity loss | Hang or `ETIMEDOUT` | Enforce a 30-second connection timeout and a 120-second read timeout; circuit-break after 5 consecutive failures to a platform. |
| **Invalid Payload Contract** | `contentBuilder` returns missing `mediaUrls` or `caption` | `500` or undefined behavior | Validate payload schema at the entry point; fail fast with `permanent_failure` and alert. |

## Scaling Considerations

- **Horizontal Worker Scaling**: Because the service is stateless, publisher worker processes can be scaled independently of the API Gateway. In a containerized environment, run dedicated publisher pods that connect to the same MongoDB-backed Agenda.js queue.
- **Concurrency Control**: Limit per-platform concurrency in Agenda.js job definitions (e.g., `concurrency: 3` for Instagram) to stay well below API rate limits. Use platform-specific queues if traffic volumes diverge significantly.
- **Event Loop Blocking**: Large video uploads (>100 MB) can monopolize the Node.js event loop. Offload uploads to streams or child-worker threads, or use platform-specific resumable upload endpoints to keep chunks small.
- **Circuit Breakers**: Implement per-platform circuit breakers (using a library like `opossum`) to halt outbound requests for 60 seconds after sustained `5xx` or timeout errors, preventing cascading retry storms.
- **Memory Management**: Avoid buffering entire video files into memory. Stream from `mediaStorage` (e.g., S3 presigned URL) directly into the platform upload request.
- **Observability**: Emit structured logs with `jobId`, `userId`, `platform`, and `durationMs` for every publish attempt; aggregate metrics on publish latency and per-platform error rates to detect quota exhaustion early.

## Related Diagrams

- `diagrams/string/iter1_overview.mmd`