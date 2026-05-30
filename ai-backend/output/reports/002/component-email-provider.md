## Email Provider

### Responsibilities

The Email Provider is an external transactional and marketing email service (e.g., AWS SES, SendGrid, Mailgun, or Postmark) responsible for delivering all email-based communications initiated by the internal **Notification Service**. Its duties include:

*   **Sending immediate transactional alerts** for critical system events: failed Agenda.js background jobs, OAuth token expirations, disconnected social accounts, and publish-time errors from the **Publish_Service**.
*   **Delivering scheduled digest emails**: daily or weekly summaries of upcoming queued posts, recently published content per platform, and account health status to end users.
*   **Rendering and transmitting templated messages**: applying dynamic variables—such as `{{userName}}`, `{{platformName}}`, `{{jobId}}`, `{{failureReason}}`, and `{{postUrl}}`—into HTML/text templates for "Job Failed", "Token Expired", and "Weekly Digest" communications.
*   **Ingesting asynchronous delivery events** via webhooks (bounces, drops, spam complaints, deliveries, and deferrals) and propagating these statuses back to the **Notification Service** for audit logging and user-contact hygiene.
*   **Enforcing deliverability best practices**: DKIM/SPF signing, unsubscribe link injection for digests, and IP reputation management for the sending domain.

### APIs / Interfaces

The Email Provider does not expose a user-facing API; all interaction is machine-to-machine between the provider and the **Notification Service**.

**Outbound Injection (Notification Service → Provider)**
*   **REST API or SMTP endpoint**: The **Notification Service** authenticates using a stored API key (rotated via environment secrets) and submits JSON payloads containing:
    *   `to`, `from`, `reply_to`
    *   `subject`
    *   `html` and/or `text` body (or a provider-hosted `template_id` with `dynamic_template_data`)
    *   `attachments` metadata (e.g., thumbnail preview URLs, not raw S3 binaries)
    *   `custom_args` / `metadata`: `userId`, `jobId`, `notificationId`, `accountId` for downstream tracing
*   **Batch send endpoints**: For digest campaigns, the provider’s bulk API is used to submit up to 1,000 recipients per call rather than issuing individual HTTP requests.

**Inbound Event Webhooks (Provider → Notification Service)**
*   **Webhook POST endpoint** (hosted by **Notification Service**, secured with HMAC signature verification): consumes event batches from the provider.
*   **Supported event types**:
    *   `delivered` – confirms inbox acceptance.
    *   `bounce` (hard/soft) – indicates invalid mailbox or temporary failure.
    *   `dropped` – provider refused to send (e.g., invalid address, suppression list hit).
    *   `deferred` – temporary delay; retry handled by provider.
    *   `spam_report` – recipient flagged message as spam.
*   **Webhook response contract**: The **Notification Service** must return `2xx` within 10 seconds; otherwise, the provider will retry delivery of the event batch.

### Data It Owns

As an external SaaS boundary, the Email Provider does not own any MongoDB collections or primary application state. However, it transiently processes and generates the following data artifacts:

*   **Message payloads**: ephemeral email envelopes containing recipient PII, subject lines, rendered HTML bodies, and attachment references. These are retained by the provider for a limited time (typically 3–7 days) for redelivery and debugging.
*   **Provider-side event logs**: message IDs (`messageId`), timestamps, IP addresses, and event types associated with each send. These are accessible via the provider’s dashboard or event API but should be mirrored into MongoDB by the **Notification Service** for long-term retention.
*   **Suppression lists**: global unsubscribe lists, bounce lists, and spam-complaint lists maintained by the provider. The **Notification Service** must query or ingest these to prevent re-sending to dead addresses.
*   **Template revisions**: if using provider-hosted dynamic templates, version history and layout markup are stored within the provider’s infrastructure.

### Failure Modes

*   **Provider API unavailability (5xx / timeout)**: If the Email Provider experiences an outage, the **Notification Service** loses the ability to dispatch emails. Undelivered messages must be retained in an internal MongoDB outbox and retried with exponential backoff.
*   **Rate-limit throttling (429)**: Digest windows (e.g., 08:00 UTC daily) can trigger thousands of concurrent sends, exceeding per-second or per-day caps. Excess traffic must be shape-limited by the **Notification Service** or spilled into a deferred queue.
*   **Authentication failure (401/403)**: Expired or revoked API keys cause immediate hard failures. The system must fail-fast, halt email dispatch to avoid log noise, and page the operations team via an alternative channel.
*   **Hard bounces and suppressions**: Sending to an invalid or blocked address wastes quota and harms sender reputation. The **Notification Service** must mark the user profile (`emailValid: false`) in MongoDB and pivot to **WebSocket_Gateway** alerts for that user.
*   **Content rejection / spam filtering**: Overly promotional digest wording or malformed HTML can trigger provider-side content filters or recipient spam folders. Monitor provider reputation dashboards and maintain separate subdomains/IPs for transactional vs. digest traffic.
*   **Webhook ingestion lag or loss**: If the **Notification Service** webhook handler is down, bounce events may be missed, leading to repeated sends to invalid addresses. Implement idempotent webhook processing and alert on ingestion lag via metrics.
*   **Template rendering errors**: Missing template variables (e.g., undefined `failureReason`) can cause provider-side rendering to abort. Validate payload schemas in the **Notification Service** before injection.

### Scaling Considerations

*   **Batching and buffering**: The **Notification Service** should aggregate digest recipients into provider bulk-sends (e.g., 500–1,000 per batch) rather than firing individual requests. Use a MongoDB-backed outbox collection to buffer email jobs during traffic spikes.
*   **Rate-limit shaping**: Implement a token-bucket or leaky-bucket algorithm in the **Notification Service** to respect the provider’s per-second throughput limits (e.g., 10,000 emails/second for SES, 600/minute for lower-tier plans).
*   **Multi-provider fallback**: For critical transactional paths (job failure, security alerts), configure a primary provider and a secondary fallback provider. If the primary returns a 5xx or persistent 429, failover to the secondary within 30 seconds.
*   **Asynchronous event handling**: Webhook events from the provider must be ingested by a lightweight endpoint that immediately acknowledges (`202 Accepted`) and places the event onto an internal queue for processing, preventing provider timeouts during high event volume.
*   **Suppression caching**: Cache known-bad email addresses in **Redis_Cache** with a TTL of 24 hours so the **Notification Service** can reject sends locally without wasting API calls.
*   **Cost optimization**: Purge old provider-side message logs aggressively; retain only essential delivery metadata in MongoDB. Use the provider’s dedicated IP pooling only after daily volume exceeds reputation-threshold tiers to avoid unnecessary cost.

## Related Diagrams

- Component structure: `diagrams/002/iter1_component-email-provider.mmd`