# Notification Service

## Responsibilities

- **Event Ingestion via MongoDB Change Streams**: Monitors the `jobs`, `posts`, and `accounts` collections for terminal state transitions—specifically job failures, successful publish completions, and account authentication issues—to determine when a user alert is required.
- **Multi-Channel Delivery**: Dispatches email (via SMTP/SES) and push (via FCM/APNs) notifications based on user preferences and the severity of the triggering event.
- **Preference Enforcement**: Respects per-user notification settings stored in MongoDB, including enabled event types, active channels, platform-specific overrides, and timezone-aware quiet hours.
- **Reliable Delivery**: Guarantees at-least-once delivery through an internal MongoDB-backed queue with idempotency controls, retry logic, and dead-letter handling for failed attempts.
- **Audit and Observability**: Persists an immutable log of every notification attempt, including provider responses and error codes, to support debugging and compliance review.

## APIs / Interfaces

- **MongoDB Change Stream Consumers**: Long-running cursors on the `jobs`, `posts`, and `accounts` collections with `$match` pipelines filtering for relevant update operations (e.g., `status: "failed"`, `publishState: "completed"`, `authStatus: "invalid"`). Uses `fullDocument: "updateLookup"` only when the delta is insufficient to render the notification payload. Resume tokens are persisted to a dedicated `notification_resume_tokens` collection after every successfully processed batch to survive restarts without event loss.
- **Notification Queue Worker**: Polls the `notification_queue` collection for documents where `status: "pending"` and `scheduledAt <= now`. Workers atomically claim items using `findAndModify` with `status: "processing"` to prevent duplicate dispatch across horizontally scaled instances.
- **Provider Adapter Interface**:
  - **Email Adapter**: `dispatchEmail({ recipient, subject, htmlBody, textBody, metadata }) -> Promise<{ messageId, provider }>`
  - **Push Adapter**: `dispatchPush({ deviceTokens, title, body, payload, platform }) -> Promise<{ messageId, provider }>`
- **Operational Health Probe**: Exposes `GET /health` for container orchestration. Returns 200 only when MongoDB connectivity is active and at least one configured provider adapter is ready.

## Data Ownership

Collections owned and managed exclusively by this service:

- **notification_preferences**: Per-user channel configuration, event type subscriptions, quiet hours, and platform-specific overrides.
- **notification_queue**: Pending alert work items. Schema includes `eventType`, `userId`, `payload`, `channel`, `idempotencyKey`, `attempts`, `maxAttempts`, `scheduledAt`, and `status`.
- **notification_logs**: Immutable dispatch audit trail containing provider response, error codes, delivery timestamp, and latency. Protected by a TTL index set to 90 days.
- **notification_templates**: Versioned content templates per `eventType` and `channel`, supporting variable interpolation for user name, post title, platform name, and failure reason.
- **notification_resume_tokens**: Stores the latest MongoDB change stream resume token per watched collection to ensure exactly-once ingestion across service restarts and failovers.

## Failure Modes

- **Change Stream Interruption**: If a change stream cursor dies and the resume token is stale or corrupted, the service may miss state transitions. Mitigation: heartbeat monitoring on each cursor; if no event is processed within a configurable threshold, the service restarts the stream from the last known valid token and pages an operator.
- **Duplicate Event Ingestion**: MongoDB change streams may redeliver the same change event after an election or network blip. Mitigation: deterministic idempotency keys (`{userId}:{eventType}:{entityId}:{timestampBucket}`) enforced via a unique index on `notification_queue.idempotencyKey`.
- **Provider Outage or Rate Limiting**: External email or push providers may return 429/5xx or timeout. Mitigation: exponential backoff retry with jitter (up to 5 attempts over approximately 6 hours). After exhaustion, the item moves to a `notification_dlq` collection for manual review.
- **Template Rendering Failure**: Missing template variables or malformed syntax can crash the worker mid-dispatch. Mitigation: pre-flight validation of all variables against the template schema; fallback to a generic plain-text template if rendering fails.
- **Preference Drift**: A user may disable a channel between enqueue and dispatch. Mitigation: re-query `notification_preferences` at dispatch time and silently drop the item if the channel is no longer active.
- **MongoDB Poll Pressure**: Aggressive polling of `notification_queue` can increase load on the MongoDB primary. Mitigation: adaptive polling interval that backs off when the queue is empty, combined with small batch sizes (≤ 100) per worker claim.

## Scaling Considerations

- **Change Stream Parallelism**: A single change stream per collection is inherently ordered and cannot be parallelized. If event volume exceeds a single worker's ingestion capacity, shard the workload by creating multiple change streams with disjoint `$match` filters (e.g., one stream for job failures, another for publish successes) and route them to separate consumer processes.
- **Queue Worker Horizontal Scaling**: `notification_queue` consumers are stateless and scale horizontally. Shard the collection by a hashed `userId` key to distribute load evenly and prevent hot shards during bulk campaigns.
- **Channel-Isolated Worker Pools**: Email and push dispatch have different latency profiles and provider rate limits. Deploy independent worker pools for each channel so a slowdown in SMTP delivery does not block push notifications.
- **Provider Connection Management**: Maintain per-provider connection pools and circuit breakers. If a provider error rate exceeds a threshold, halt new attempts for that provider and queue items until health recovers.
- **Log Write Throughput**: High-frequency notification generation creates significant write pressure on `notification_logs`. Complement the TTL index with a capped collection for recent analytics or archive records older than 30 days to object storage to keep the working set small.
- **Cursor Resource Management**: Change stream cursors hold server-side resources. Ensure the service gracefully closes cursors on shutdown and avoids keeping large batches in memory to prevent MongoDB connection accumulation.