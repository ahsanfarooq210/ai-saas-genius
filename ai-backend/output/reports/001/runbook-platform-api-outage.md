# Runbook: Platform API Outage

## Scope

This runbook covers total or severe degradation of the `api_gateway` and its synchronous downstream dependencies (`auth_service`, `user_service`, `job_scheduler`), resulting in users being unable to authenticate, manage posting preferences, or schedule new content. It addresses Express.js process failures, MongoDB unavailability or latency spikes, JWT validation bottlenecks, and downstream timeout cascades that manifest as 5xx errors or >3s p95 latency on public endpoints.

**Out of scope:** Isolated background publishing failures in `media_processor` or `platform_publisher` that do not affect API availability. Use the dedicated component runbooks for those scenarios.

---

## Severity Levels

| Level | Criteria | Response Time |
|-------|----------|---------------|
| **SEV 1** | 100% of API endpoints return 5xx or timeout; all user traffic blocked. | Immediate |
| **SEV 2** | p95 latency >3s or error rate >5% for >5 minutes; core functions degraded but partially available. | 5 minutes |
| **SEV 3** | Isolated sub-system failure (e.g., job management endpoints only); workarounds exist. | 15 minutes |

---

## Detection & Symptoms

Monitor the following signals to confirm an active API outage:

*   **Load Balancer:** ALB/Nginx `502 Bad Gateway`, `503 Service Unavailable`, or `504 Gateway Timeout` spikes originating from the `api_gateway` target group.
*   **API Gateway Metrics:** Express.js p95 latency >2,000 ms or 5xx rate >1% for 2 consecutive minutes.
*   **Health Checks:** The `GET /health` endpoint fails its deep check (MongoDB + critical downstream ping).
*   **MongoDB Alerts:** `MongoNetworkError`, `MongoServerSelectionError`, or primary failover events in `api_gateway` logs.
*   **Agenda.js Backpressure:** The `agenda` collection shows an abnormal count of jobs with `lockedAt` set but not progressing, indicating the job scheduler is starving the database or event loop.
*   **User Reports:** Surge in support tickets stating inability to log in, save posting preferences, or view scheduled jobs.

---

## Immediate Response (0–5 Minutes)

1.  **Acknowledge** the page in PagerOps/Opsgenie to prevent escalation noise.
2.  **Check the last deployment:** If the outage correlates with a recent `api_gateway` or `auth_service` deploy, consider an immediate rollback to the previous stable container image or Git SHA.
3.  **Do not restart the MongoDB primary** unless it is confirmed unresponsive via `rs.status()`; automatic failover is preferred.
4.  **Verify background job continuity:** Check `job_scheduler` and `platform_publisher` pods. If the API is down but background workers and MongoDB are healthy, scheduled posts may still publish. Communicate this to support to set user expectations.
5.  **Enable circuit breakers** (if implemented via middleware) for `user_service` and `job_scheduler` calls to fail fast and prevent thread pool exhaustion in Express.js.

---

## Investigation Steps

### 1. API Gateway (Express.js) Layer

*   Check pod/process status:
    ```bash
    kubectl get pods -l app=api-gateway
    # or
    pm2 status
    ```
*   Look for OOMKilled (`OOMKilled` in K8s, `out of memory` in PM2) or CrashLoopBackOff. Node.js heap exhaustion can occur during large JSON payload parsing or memory leaks in middleware.
*   Inspect recent uncaught exceptions:
    ```bash
    kubectl logs -l app=api-gateway --tail=500 | grep -E "UnhandledPromiseRejection|Error|fatal"
    ```
*   Verify the Express.js middleware stack is not blocked. If `multer` or body-parser is synchronously writing to `media_storage` on-request, uploads can stall the event loop.

### 2. MongoDB Primary & Query Performance

*   Check connection pool state from the API host perspective:
    ```javascript
    // Attached to a running api_gateway process or via mongo shell
    db.serverStatus().connections
    ```
    If `current` is at `maxPoolSize` (default 100 in Mongoose) and `available` is 0, the API is connection-starved.
*   Identify long-running operations:
    ```javascript
    db.currentOp({ "secs_running": { $gt: 5 }, "active": true })
    ```
*   Common culprits in this architecture:
    *   Missing index on `agenda` collection (`lockedAt`, `nextRunAt`, `name`) causing collection scans.
    *   Missing index on `users` or `preferences` collections queried by `userId` during every authenticated request.
    *   Large `posts` collection aggregation for analytics running on the primary instead of a secondary.
*   Check replication lag:
    ```javascript
    rs.printSecondaryReplicationInfo()
    ```
    If the primary failed and a secondary with >60s lag was promoted, stale reads in `auth_service` or `user_service` can cause validation errors.

### 3. Auth Service & Token Store

*   Verify JWT validation latency. If HMAC verification spikes, check for:
    *   CPU throttling on `auth_service` pods.
    *   Synchronous bcrypt/argon2 hash verification during login storms.
*   Check `token_store` decryption health. If the encryption key service (e.g., AWS KMS, HashiCorp Vault) is unreachable, OAuth token reads fail and social account linking breaks.
*   Look for OAuth provider outages (Meta, X, LinkedIn). While this rarely causes a total API outage, it can flood `auth_service` with retry loops if not handled with circuit breakers.

### 4. Job Scheduler (Agenda.js) Impact

*   If Agenda.js is instantiated inside the `api_gateway` process (in-process job queue), a flood of `agenda.now()` calls or stuck `prepare-media` jobs can block the Node.js event loop.
*   Check the `agenda` collection lock state:
    ```javascript
    db.agendaJobs.countDocuments({ lockedAt: { $exists: true } })
    ```
    A rapidly growing count indicates workers cannot process jobs, often due to DB CPU saturation or missing indexes.
*   Verify `job_scheduler` is not writing high-frequency updates to MongoDB that contend with API reads.

### 5. Downstream Service Timeouts

*   `user_service` depends on `media_storage`. If blob storage (e.g., S3-compatible) latency spikes, profile-media endpoints may hang.
    *   Check HTTP client timeout configuration. Default Node.js/Express timeouts can be 120s; hanging S3 requests will exhaust worker capacity.
*   `api_gateway` → `job_scheduler`: If the job creation endpoint waits for Agenda.js to confirm DB writes under high load, latency cascades.

---

## Mitigation & Recovery

### API Gateway Capacity & Stability

*   **Scale horizontally:** Increase `api_gateway` replica count if CPU/memory thresholds are breached and MongoDB is confirmed healthy.
    ```bash
    kubectl scale deployment api-gateway --replicas=10
    ```
*   **Restart leaking processes:** If specific pods show climbing memory without recovery, cordon and restart them individually.
*   **Rate limiting:** If the outage is caused by a traffic spike or DDoS, enable emergency rate limiting at the Nginx/ALB layer (e.g., limit to 10 req/s per IP) to preserve capacity for legitimate requests.

### MongoDB Remediation

*   **Kill offending operations:** If a slow aggregation or runaway Agenda.js query is identified, terminate it:
    ```javascript
    db.killOp(<opid>)
    ```
*   **Add emergency indexes:** If query analysis reveals a missing index on `users.userId` or `agenda.lockedAt`, create it in the background to avoid locking:
    ```javascript
    db.users.createIndex({ userId: 1 }, { background: true })
    db.agendaJobs.createIndex({ lockedAt: 1, nextRunAt: 1, name: 1 }, { background: true })
    ```
*   **Connection pool relief:** Temporarily raise Mongoose `maxPoolSize` from 100 to 200 in the `api_gateway` config to absorb a connection storm, then investigate the leak root cause.
*   **Storage IOPS:** If MongoDB is I/O bound (high `iowait`), scale the volume IOPS or upgrade the cluster tier immediately via infrastructure-as-code.

### Auth & Token Recovery

*   **Fail-open for JWT reads:** If `token_store` is temporarily unreachable but user sessions are valid, allow cached JWT validation to proceed (accepting the risk of slightly stale revocation lists) rather than hard-failing every request.
*   **Disable OAuth linking:** If a third-party OAuth provider is down and causing login endpoint timeouts, disable the `/api/v1/auth/connect/:platform` route via feature flag to protect the rest of the API.

### Job Scheduler Isolation

*   **Stop in-process job processing:** If Agenda.js is running inside `api_gateway` instances, immediately disable job processing on those nodes and shift all background work to dedicated `job_scheduler` worker pods.
*   **Pause non-critical jobs:** Pause low-priority job types (e.g., `analytics-sync`, `media-cleanup`) to reduce DB write pressure:
    ```javascript
    agenda.cancel({ name: 'analytics-sync' })
    ```

### Downstream Timeout Mitigation

*   **Fail-fast on media storage:** Reduce the `user_service` → `media_storage` HTTP client timeout to 5 seconds and return HTTP 503 with a retry-after header instead of hanging the request.
*   **Serve stale settings:** If `user_service` cannot reach `media_storage`, return the last known user preferences from an in-memory LRU cache or Redis (if available) rather than failing the request.

---

## Communication & Escalation

| Timeframe | Action |
|-----------|--------|
| **0–5 min** | Page the on-call platform engineer. Notify #incidents Slack channel. |
| **5–10 min** | If SEV 1, notify the engineering manager and customer support lead. |
| **15 min** | Post initial external status page update: "Investigating API availability issues. Scheduled posts may still publish." |
| **30 min** | If MongoDB issue is not resolved, escalate to the DBRE / Infrastructure on-call. |
| **Ongoing** | Provide 30-minute updates until resolution. |

---

## Post-Recovery Verification

Before declaring the incident resolved, perform the following synthetic checks:

1.  **Authentication canary:**
    ```bash
    curl -X POST https://api.platform.com/api/v1/auth/login \
      -H "Content-Type: application/json" \
      -d '{"email":"canary@example.com","password":"***"}'
    ```
    Expect HTTP 200 with valid JWT.

2.  **Settings read/write canary:**
    ```bash
    curl -X GET https://api.platform.com/api/v1/users/me/settings \
      -H "Authorization: Bearer $JWT"
    ```
    Expect HTTP 200 with posting preferences payload.

3.  **Job scheduling canary:**
    ```bash
    curl -X POST https://api.platform.com/api/v1/jobs/schedule \
      -H "Authorization: Bearer $JWT" \
      -d '{"platforms":["instagram"],"mediaType":"photo","scheduledAt":"...","caption":"canary"}'
    ```
    Expect HTTP 201 and confirm the job appears in the `agenda` collection with `nextRunAt` set.

4.  **Infrastructure checks:**
    *   MongoDB replication lag < 5 seconds across all secondaries.
    *   `api_gateway` p95 latency < 500 ms for 15 consecutive minutes.
    *   `agenda` collection `lockedAt` count stable and draining normally.
    *   Zero `MongoServerSelectionError` entries in logs for 15 minutes.

---

## Related Diagrams

*   `diagrams/001/iter1_overview.mmd` — High-level system architecture showing the `api_gateway` and its dependencies (`auth_service`, `user_service`, `job_scheduler`, `mongodb`, etc.) relevant to this outage scenario.