## Incident Response Runbook

This runbook covers operational incident detection, triage, mitigation, and recovery procedures for the social media automation platform. It is organized by severity, component, and common failure scenarios specific to the Node.js/Express, MongoDB, and Agenda.js architecture.

---

## Severity Definitions

| Severity | Criteria | Response Time | Communication |
|----------|----------|---------------|---------------|
| **P1** | Complete publishing pipeline halt across all users; OAuth token vault compromise; data loss in progress. | 15 min | Immediate war room + user status page |
| **P2** | Major platform connector down (e.g., Instagram API publishing fails); scheduler backlog > 1 hour for >25% users. | 30 min | Status page update + internal alert |
| **P3** | Degraded media processing; single-platform rate limiting; isolated user account sync failures. | 2 hours | Internal ticket, batch user comms if needed |
| **P4** | Notification delivery delays; non-critical monitoring gaps; cosmetic UI/API issues. | Next business day | Internal tracking only |

---

## On-Call Response Workflow

1. **Acknowledge** the page in PagerDuty/Opsgenie within SLA.
2. **Classify** using the severity table above.
3. **Isolate** the failing component using the component-specific sections below.
4. **Mitigate** via documented playbooks before attempting root-cause fixes.
5. **Communicate** using the templates in the Communication section.
6. **Record** all commands and observations in the incident channel.
7. **Resolve** only after 10 minutes of stable green metrics and confirmed recovery.

---

## Component-Specific Response Procedures

### API Gateway (Express.js)

**Symptoms:** 502/503 from load balancer, latency spike > 5s, connection pool exhaustion.

**Investigation:**
- Check pod/container CPU/memory and restart counts.
- Verify upstream service health (`/health` endpoints for `auth_service`, `user_service`, `scheduler_service`).
- Review Express error logs for uncaught exceptions or middleware timeouts.

**Mitigation:**
- Scale gateway replicas horizontally if CPU > 70%.
- If a downstream service is timing out, enable circuit breaker fallback (return 503 with `Retry-After` header) to prevent cascading failure.
- Rollback to previous deployment image if a bad release is suspected.

### Auth Service & Token Vault

**Symptoms:** Users cannot link accounts; JWT validation failures; OAuth callback errors.

**Investigation:**
- Verify MongoDB connectivity for user session store.
- Check `token_vault` decryption service health and key rotation status.
- Inspect OAuth provider status pages (Meta, X, etc.) for API outages.
- Query MongoDB for spike in `authFailures` by provider.

**Mitigation:**
- If JWT signing key is misconfigured, immediately restore from secrets manager; do not rotate under active incident.
- For OAuth provider outage: disable new account linking in `user_service` config (feature flag) to prevent user frustration, while preserving existing tokens.
- If refresh token logic is failing, manually trigger batch refresh for affected users via admin script.

### Scheduler Service (Agenda.js)

**Symptoms:** Jobs not firing; duplicate jobs; `agendaJobs` collection lock timeout; publishing delays.

**Investigation:**
- Check Agenda.js worker process logs for `job queue stalled` or MongoDB disconnects.
- Query MongoDB:
  ```javascript
  db.agendaJobs.find({ lastRunAt: { $exists: false }, nextRunAt: { $lt: new Date() } }).count()
  ```
- Verify `lockLifetime` and `concurrency` settings match worker capacity.
- Confirm no clock skew between scheduler nodes and MongoDB primary.

**Mitigation:**
- If workers are dead-locked, gracefully restart scheduler pods one at a time.
- For backlog: temporarily increase `scheduler_service` replicas and raise Agenda.js concurrency (max 20 per worker to avoid MongoDB pressure).
- If a specific job type is failing (e.g., `publish-post`), pause that job queue via Agenda.js UI or CLI until the downstream fix is deployed.
- **Never** manually edit `lockedAt` in production without understanding the job dependency chain.

### Media Service & Object Storage

**Symptoms:** Upload timeouts; processed media missing; `413 Payload Too Large`; video transcode failures.

**Investigation:**
- Check object storage (S3-compatible) bucket permissions and pre-signed URL expiration.
- Review media service queue depth and disk usage for temp processing space.
- Validate platform-specific format requirements (e.g., Instagram video max 60s, aspect ratios) against recent code changes.

**Mitigation:**
- If object storage is unreachable, fail open: mark jobs as `pending-media` and retry with exponential backoff. Do not drop the upload request.
- For processing backlog: spin up additional media worker nodes with dedicated temp volumes.
- If a specific codec/format is rejected by a platform API, apply an emergency transform template via feature flag and re-queue affected jobs.

### Post Service

**Symptoms:** Posts published without captions; hashtag truncation; metadata mismatch between platforms.

**Investigation:**
- Check MongoDB `posts` collection for `contentVersion` drift.
- Verify `post_service` is reading from the correct `media_service` output URL and not a stale cache.

**Mitigation:**
- If caption composition logic is buggy, disable auto-caption generation and fall back to user-provided raw text.
- For metadata issues, halt publishing to the affected platform and queue posts for manual review.

### Platform Connector & Rate Limiter

**Symptoms:** 401/403 from social APIs; 429 rate limit errors; posts marked failed with `platformError`.

**Investigation:**
- Check `rate_limiter` MongoDB collection for platform quota exhaustion.
- Verify `platform_connector` token headers against `token_vault` records.
- Review external API status dashboards (Meta Graph API, X API v2).

**Mitigation:**
- On 429: immediately pause new jobs to that platform for the duration specified in the `Retry-After` header. The `rate_limiter` should enforce this, but verify via:
  ```javascript
  db.rateLimits.find({ platform: "instagram" }).sort({ windowReset: -1 }).limit(1)
  ```
- On 401: trigger token refresh for the affected user. If refresh fails, mark account as `reauth_required` and notify via `notification_service`.
- If a platform API is globally down, set platform-wide circuit breaker to `OPEN` in `platform_connector` config.

### MongoDB

**Symptoms:** Query timeouts; replication lag; connection pool exhaustion; primary failover.

**Investigation:**
- Check `db.currentOp()` for slow queries or long-running locks on `agendaJobs`.
- Review replica set status: `rs.status()`.
- Monitor WiredTiger cache eviction rates.

**Mitigation:**
- If `agendaJobs` collection is causing pressure, ensure the compound index on `{ name: 1, nextRunAt: 1, priority: -1, lockedAt: 1 }` exists.
- For connection saturation: restart non-critical analytics readers first; scale `mongoose` pool size temporarily in app configs.
- If primary fails, allow automatic failover. Do not force a step-down unless the primary is physically unrecoverable and causing data corruption.

### Notification Service

**Symptoms:** Users not alerted to publish failures; on-call not paged for P1s.

**Investigation:**
- Verify SMTP/push provider API keys and quota.
- Check `notification_service` consumer lag if using a message bus.

**Mitigation:**
- If provider is down, switch to backup provider via feature flag.
- For critical alerts, fall back to direct PagerDuty integration from the monitoring layer if notification service is degraded.

---

## Common Failure Scenario Playbooks

### Scenario 1: Publishing Pipeline Stall (Agenda.js Backlog)

1. Check MongoDB `agendaJobs` for jobs stuck in `locked` state with old `lockedAt`.
2. If count > 1000 and growing, identify if `scheduler_service` workers crashed.
3. Restart workers in rolling fashion (1 pod at a time).
4. If backlog persists, scale workers 2x and monitor MongoDB CPU.
5. After recovery, audit for duplicate publishes by checking `post_service` idempotency keys.

### Scenario 2: OAuth Token Cascade Failure

1. Detect via spike in `platform_connector` 401 errors grouped by `userId`.
2. Query `token_vault` for tokens nearing expiry or with failed refresh flags.
3. Run emergency refresh script for affected users.
4. For users where refresh fails (revoked grants), update `user_service` account status to `disconnected` and trigger `notification_service` email.
5. Update status page: "Reconnect Instagram/Twitter required."

### Scenario 3: Rate Limit Breach (429 Storm)

1. Identify platform from `rate_limiter` logs.
2. Immediately reduce `scheduler_service` concurrency for that platform to 1.
3. Pause all non-urgent job types (e.g., `draft-sync`) to preserve quota for `publish-post`.
4. Verify `Retry-After` compliance in `platform_connector` outbound requests.
5. Resume normal scheduling only after the rate limit window resets + 5 minutes buffer.

### Scenario 4: Media Processing Backlog

1. Check object storage ingress/egress metrics.
2. If media workers are CPU-throttled on video transcoding, verify node instance type and temp disk I/O.
3. Prioritize jobs with `nextRunAt` within 30 minutes; deprioritize bulk uploads.
4. If a specific file is crashing the processor, quarantine its `mediaId` and skip to next job to prevent worker death loops.

---

## Escalation Matrix

| Role | Contact | Escalation Trigger |
|------|---------|-------------------|
| L1 On-Call | Primary/Secondary pager | All P1/P2 pages |
| Backend Lead | Slack `#incidents-escalation` | P1 > 30 min unresolved; data integrity suspected |
| Platform/API Partner | Provider support portal | External API bug or mass token revocation |
| Security | security@company.com | Token vault anomaly, unauthorized OAuth grants |

---

## Communication Templates

### P1 Status Page Update
> We are investigating an issue affecting automated publishing across all platforms. Scheduled posts may be delayed. We will provide an update within 30 minutes.

### OAuth Reconnect Required (Batch Email)
> Due to a recent update with [Platform], we need you to reconnect your account to restore automated publishing. No posts have been lost; they will resume once reconnected.

### Incident Resolved
> Automated publishing has resumed. All queued posts are processing. We will publish a post-mortem within 24 hours.

---

## Post-Incident Review

Within 24 hours of P1/P2 resolution:

1. Export Grafana/Prometheus metrics for the incident window.
2. Capture MongoDB slow query logs and Agenda.js job execution histograms.
3. Document the timeline, detection lag, and mitigation effectiveness.
4. File action items in the backlog for:
   - Missing alerts or runbook gaps.
   - Code fixes to prevent recurrence.
   - Infrastructure scaling adjustments.

---

## Related Diagrams

- `diagrams/0320/iter1_overview.mmd` — System architecture overview showing component relationships and data flow relevant to incident isolation paths.