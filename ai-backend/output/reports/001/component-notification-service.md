## component-notification-service

### Responsibilities

The **Notification Service** handles all user-facing communication regarding the lifecycle of background jobs and content publishing. It operates as an event-driven dispatch layer that translates internal system events into actionable email and push notifications.

Key responsibilities include:

- **Event-driven dispatch**: Receives publishing outcomes from the `platform_publisher` and job state transitions from the `job_scheduler`, then triggers the appropriate user notification.
- **Multi-channel delivery**: Orchestrates email (via SMTP, AWS SES, or SendGrid) and push notifications (via Firebase Cloud Messaging or APNs) based on user preferences.
- **Template rendering**: Maintains channel-specific templates for each event type (e.g., `post.published`, `job.failed`) and renders them with contextual data such as platform name, media URL, scheduled time, and error messages.
- **Preference enforcement**: Filters outgoing messages against per-user notification settings (opt-in/opt-out, channel selection, quiet hours) before dispatch.
- **Delivery tracking**: Records per-notification metadata including provider, message ID, timestamp, and terminal status (`delivered`, `bounced`, `failed`) for diagnostic auditing.
- **Failure escalation**: Sends high-priority alerts to operations channels when systemic publishing failures or job backlog anomalies are detected.

### APIs / Interfaces

#### Internal REST API (Inbound)

The service exposes an internal Express endpoint consumed by the `job_scheduler` and `platform_publisher`.

**`POST /internal/v1/notifications/dispatch`**
Dispatches a notification to a user through one or more channels.

Request headers:
- `Content-Type: application/json`
- `Authorization: Bearer <internal-service-token>`

Request body:
```json
{
  "userId": "507f1f77bcf86cd799439011",
  "eventType": "post.published | post.failed | job.completed | job.failed",
  "channels": ["email", "push"],
  "priority": "normal | high",
  "idempotencyKey": "550e8400-e29b-41d4-a716-446655440000",
  "payload": {
    "jobId": "job-12345",
    "postId": "post-67890",
    "platforms": ["instagram", "twitter"],
    "mediaUrl": "https://cdn.example.com/processed/photo.jpg",
    "caption": "Summer launch",
    "errorMessage": "OAuth token expired",
    "scheduledAt": "2024-06-01T14:00:00Z"
  }
}
```

Response (`202 Accepted`):
```json
{
  "notificationId": "notif-abc123",
  "acceptedChannels": ["email"],
  "rejectedChannels": ["push"],
  "status": "queued"
}
```

**`GET /internal/v1/notifications/preferences/:userId`**
Returns the effective notification preferences for a user, including enabled channels and event-type subscriptions. This may be cached locally or fetched from the `user_service`.

**`POST /webhooks/v1/notifications/:provider/status`**
Inbound webhook for bounce, delivery, and complaint events from email/push providers. Updates the internal dispatch log and triggers endpoint cleanup if a token is invalid.

#### Outbound Provider Interfaces

- **Email**: HTTP REST clients for SendGrid, AWS SES, or SMTP submission.
- **Push**: HTTP/2 client for APNs; HTTP v1 client for Firebase Cloud Messaging.

### Data Owned

The service is stateless in its core dispatch path but owns the following operational datasets:

- **Notification Templates**: Versioned, event-specific templates for each channel (HTML/text email bodies, push JSON payloads, localized strings). Stored in the service’s configuration store or a dedicated MongoDB collection.
- **Dispatch Logs**: Immutable audit records tracking every notification attempt. Each record includes:
  - `notificationId` (UUID)
  - `userId` (ObjectId reference)
  - `eventType` and `idempotencyKey`
  - `channel` (`email` | `push`)
  - `provider` (e.g., `sendgrid`, `fcm`)
  - `providerMessageId`
  - `dispatchedAt`, `deliveredAt`, `status`
  - `failureReason` (if applicable)
- **Idempotency Index**: A short-lived deduplication index (backed by a TTL-enabled MongoDB collection or ephemeral cache) keyed by `idempotencyKey` to prevent duplicate dispatches during upstream retries.

*Note: Master user contact data (email addresses, push tokens) is owned by the `user_service`; the Notification Service reads them at dispatch time and does not mutate the source of truth.*

### Failure Modes

| Failure | Impact | Mitigation |
|---|---|---|
| **Provider outage or degradation** | Notifications delayed or lost; users unaware of job/publishing status. | Implement circuit breakers per provider, exponential backoff retries, and a fallback provider (e.g., SES primary, SendGrid fallback). Queue messages persistently until acknowledged. |
| **Invalid contact endpoint** | Bounced email or expired push token; future notifications fail repeatedly. | Consume provider webhook events to detect bounces. Flag invalid endpoints and publish a cleanup event to the `user_service` to remove stale tokens. |
| **Missing template variable** | Rendered notification contains broken placeholders, degrading user trust. | Enforce JSON Schema validation on the `payload` field of dispatch requests. Use fallback templates with safe defaults for optional fields. |
| **Upstream event loss** | `job_scheduler` or `platform_publisher` crashes before emitting the dispatch call, resulting in silent failures. | Monitor notification volume per event type with anomaly detection. Require upstream services to emit notifications only after the primary transaction is durably logged. |
| **Duplicate dispatch** | User receives multiple identical emails/pushes due to retries or duplicate events. | Enforce idempotency using the `idempotencyKey`; reject or skip duplicate requests within a 24-hour window. |
| **Provider rate limiting** | Throttling errors (e.g., SES sandbox limits) cause queue backup. | Implement token-bucket rate limiters per provider. Expose queue-depth metrics to trigger backpressure on upstream job scheduling if needed. |

### Scaling Considerations

- **Decoupled queueing**: Place a persistent message queue (e.g., RabbitMQ, AWS SQS, or Redis Streams) between the internal REST API and the dispatch workers. This isolates the service from burst traffic when the `job_scheduler` completes hundreds of jobs simultaneously.
- **Horizontal worker scaling**: Run notification dispatch workers as separate Node.js processes or containers that can be scaled independently based on queue depth and target channel latency.
- **Channel segregation**: Maintain separate worker pools and queues for email and push. A slow SMTP provider must not block high-priority push notifications.
- **Batching and digests**: Support a digest mode where non-urgent events (e.g., `job.completed`) are accumulated over a 15-minute window and coalesced into a single summary email, reducing API call volume.
- **Template caching**: Precompile and cache Handlebars/Mustache templates in memory at startup to avoid repeated database reads during high-throughput periods.
- **Push multicast**: Where supported by the provider, batch push tokens into multicast requests to reduce per-device HTTP overhead.
- **Observability**: Export queue depth, dispatch latency per provider, and channel failure-rate metrics to drive autoscaling policies and paging alerts.

## Related Diagrams

No paired Mermaid diagram is provided for this component.