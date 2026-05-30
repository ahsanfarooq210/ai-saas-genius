## Component: Notification Service

### Responsibilities

- **Event-Driven Alerting**: Consume asynchronous status events from the Job Service, Publish Service, and User Service to generate contextual user alerts (e.g., publish success, token expiration, job retry exhaustion).
- **Real-Time Delivery**: Push instantaneous, low-latency messages to the WebSocket Gateway so that active clients receive live updates without polling.
- **Email Orchestration**: Compose transactional and digest emails and dispatch them through the external Email Provider for offline users or summarized reporting.
- **Preference Enforcement**: Respect per-user channel toggles and frequency rules (immediate, hourly digest, daily digest) before attempting delivery on any channel.
- **Notification History**: Persist every generated notification to MongoDB to support an in-app notification center with read/unread tracking and searchable history.
- **Template Rendering**: Maintain channel-specific templates (HTML/text for email, JSON payload shapes for WebSocket) and hydrate them with dynamic variables such as `platform`, `postId`, `errorCode`, and `scheduledAt`.
- **Resilient Delivery**: Implement retry policies with exponential backoff for transient email failures, and dead-letter persistent failures for operator inspection.

### APIs and Interfaces

#### Internal Service API
Consumed directly by the Job Service, Publish Service, and User Service over the internal network.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/internal/v1/notifications` | `POST` | Dispatch a single notification. Idempotent via `X-Idempotency-Key`. |
| `/internal/v1/notifications/bulk` | `POST` | Ingest a batch of related events for aggregation into a digest. |
| `/internal/v1/users/:userId/preferences` | `GET` | Retrieve resolved notification preferences so upstream services can filter before emitting. |

**`POST /internal/v1/notifications` Example:**
```json
{
  "userId": "507f1f77bcf86cd799439011",
  "type": "publish.failure",
  "severity": "critical",
  "channels": ["websocket", "email"],
  "payload": {
    "jobId": "agenda-job-9a2b",
    "platform": "instagram",
    "mediaType": "video",
    "errorCode": "PLATFORM_RATE_LIMIT",
    "timestamp": "2024-01-15T14:32:00Z"
  },
  "idempotencyKey": "pub-fail-9a2b-507f1f77"
}
```

#### User-Facing API
Exposed through the API Gateway for authenticated clients.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/notifications` | `GET` | Paginated, filterable list of the authenticated user's notifications. |
| `/v1/notifications/:id/read` | `PATCH` | Mark a specific notification as read. |
| `/v1/notifications/read-all` | `POST` | Bulk mark all unread notifications as read. |
| `/v1/notifications/preferences` | `PUT` | Update channel enablement and digest frequency. |

#### WebSocket Gateway Interface
- **Protocol**: Fire-and-forget `POST /internal/v1/broadcast` to the WebSocket Gateway, or publish to a Gateway-managed Redis Pub/Sub channel keyed by `userId`.
- **Payload Contract**:
  ```json
  {
    "userId": "507f1f77bcf86cd799439011",
    "event": "notification.incoming",
    "data": {
      "notificationId": "657a1b...",
      "type": "publish.failure",
      "title": "Instagram publish failed",
      "body": "Your scheduled video encountered a rate limit.",
      "createdAt": "2024-01-15T14:32:00Z"
    }
  }
  ```

#### Email Provider Interface
- **Transport**: HTTPS REST API (e.g., SendGrid, AWS SES).
- **Contract**: Submit `from`, `to`, `subject`, `html`, and `text` bodies. Respect provider rate limits via an internal token-bucket throttle.

### Data Model (MongoDB)

#### `notifications`
```javascript
{
  _id: ObjectId,
  userId: ObjectId,            // indexed
  type: String,                // e.g., "job.completed", "account.disconnected", "media.processed"
  severity: String,            // "info" | "warning" | "critical"
  title: String,
  body: String,
  metadata: {
    jobId: ObjectId,
    platform: String,
    postId: ObjectId,
    errorCode: String
  },
  channelsDelivered: [String], // ["websocket", "email"]
  read: Boolean,               // default false
  readAt: Date,
  createdAt: Date,             // TTL index: auto-expire after 90 days
  expiresAt: Date
}
```

#### `notification_preferences`
```javascript
{
  userId: ObjectId,            // unique index
  channels: {
    websocket: { enabled: Boolean },
    email: {
      enabled: Boolean,
      digestFrequency: String  // "immediate" | "hourly" | "daily"
    }
  },
  typeOverrides: [
    {
      type: "publish.failure",
      minSeverity: "critical",
      channel: "email",
      enabled: true
    }
  ],
  timezone: String,            // for digest scheduling
  updatedAt: Date
}
```

#### `notification_templates`
```javascript
{
  templateId: String,          // e.g., "publish_failure_email_en"
  channel: String,             // "email" | "websocket"
  locale: String,
  subject: String,             // email only
  bodyHtml: String,            // Handlebars template
  bodyText: String,
  payloadSchema: Object        // JSON Schema for runtime variable validation
}
```

#### `delivery_logs`
```javascript
{
  notificationId: ObjectId,
  channel: String,
  provider: String,
  status: String,              // "pending" | "sent" | "failed" | "bounced"
  attempts: Number,
  lastError: String,
  sentAt: Date,
  providerMessageId: String,
  providerResponse: Object
}
```

### Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Email Provider Outage or Throttling** | Critical alerts never reach offline users. | Stage emails in `delivery_logs` with `status: pending`; retry with exponential backoff (5 min, 15 min, 1 h). Dead-letter after 24 hours and surface a banner in the notification center. |
| **WebSocket Gateway Unreachable** | Real-time UI updates stall. | Log the failure; for `severity: critical`, automatically escalate to email if the WebSocket push is not acknowledged within 30 seconds. |
| **Duplicate Upstream Events** | Users receive identical notifications multiple times. | Enforce idempotency using the `idempotencyKey`; maintain a unique MongoDB index on `{ idempotencyKey, userId }`. |
| **Template Variable Mismatch** | Messages render with broken placeholders, degrading trust. | Validate the event payload against `payloadSchema` before rendering; fallback to a static generic template if validation fails. |
| **Notification Bursts** | MongoDB write pressure and user spam during mass platform outages. | Token-bucket rate limit per user (max 10 WebSocket + 5 email notifications per minute). Collapse rapid identical `type` events into a single aggregated alert. |
| **Preference Lookup Latency** | Blocking MongoDB reads on the hot path slow down event ingestion. | Maintain an in-memory LRU cache of user preferences (5-minute TTL, max 10k entries) inside each service replica. |

### Scaling Considerations

- **Stateless Replicas**: The Notification Service holds no connection state. Scale horizontally behind a load balancer; each replica can independently process events.
- **Database Partitioning**: The `notifications` collection is high-write. Shard by `userId` hash or use a time-series MongoDB pattern to distribute load. The TTL index on `createdAt` (90 days) prevents unbounded storage growth.
- **WebSocket Offloading**: This service must not manage long-lived socket connections. Push to the WebSocket Gateway via its internal broadcast API and let the Gateway handle client fan-out and connection lifecycle.
- **Digest Aggregation**: Hourly and daily digests require a background sweep. Use Agenda.js (or a dedicated worker loop) to query `notifications` with `channelsDelivered: []` and `type` eligibility, aggregate them per user, and send a single batched email.
- **Email Throttling**: Smooth outbound traffic to the Email Provider using a local token-bucket algorithm (e.g., 10 emails/second per provider API key) to avoid hard rate-limit rejections.
- **Backpressure Absorption**: During upstream spikes (e.g., a platform API outage generating thousands of failure events), use an internal in-memory queue (per replica) or a MongoDB-backed staging buffer to absorb bursts without dropping messages or blocking the event publisher.

## Related Diagrams

- `diagrams/002/iter1_component-notification-service.mmd`