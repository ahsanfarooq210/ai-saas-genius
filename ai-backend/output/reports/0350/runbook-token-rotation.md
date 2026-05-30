# Token Rotation Runbook

## Purpose
This runbook defines the operational procedures, failure modes, and scaling constraints for rotating OAuth tokens across connected social media platforms. The `auth_service`, `token_store`, and `agenda_worker` coordinate to refresh access tokens before or immediately after expiry, ensuring the `publisher_service` can publish content on behalf of users without interruption.

## Responsibilities

- **`auth_service`**
  - Exposes internal endpoints to trigger, validate, and complete token rotation.
  - Implements platform-specific OAuth refresh logic for Twitter/X, Instagram, Facebook, and LinkedIn.
  - Enforces encryption/decryption boundaries when communicating with the `token_store`.

- **`token_store`**
  - Owns the secure persistence of `accessToken`, `refreshToken`, and expiry metadata.
  - Provides atomic read-update primitives to prevent race conditions during rotation.
  - Encrypts tokens at rest using AES-256-GCM and manages data-key versioning.

- **`scheduler_service`**
  - Creates proactive Agenda.js background jobs (`job-name: rotate-platform-token`) when a token is within 24 hours of expiry.
  - Staggers rotation jobs to avoid thundering herd against external platform APIs.

- **`agenda_worker`**
  - Executes rotation jobs by calling `auth_service` refresh flows.
  - Updates job status in MongoDB and handles retry/backoff on platform rate limits.

- **`publisher_service`**
  - Detects HTTP 401/403 authentication errors during publish attempts.
  - Emits an on-demand rotation request to the `agenda_worker` queue before failing a publish job permanently.

## Data Owned

The `token_store` persists the following fields in MongoDB (collection: `platform_connections`):

| Field | Type | Description |
|-------|------|-------------|
| `userId` | ObjectId | Reference to the user document |
| `platform` | String | Enum: `twitter`, `instagram`, `facebook`, `linkedin` |
| `accessToken` | Encrypted String | Short-lived platform access token |
| `refreshToken` | Encrypted String | Long-lived refresh token |
| `expiresAt` | Date | UTC expiry of the current access token |
| `rotatedAt` | Date | UTC timestamp of last successful rotation |
| `rotationAttempts` | Number | Consecutive failed rotation attempts |
| `status` | String | Enum: `active`, `rotating`, `failed`, `revoked` |
| `scope` | [String] | Granted OAuth scopes |

## Rotation Triggers

1. **Scheduled (Proactive)**
   - `scheduler_service` queries `token_store` for tokens where `expiresAt < now + 24h` and `status == active`.
   - Creates an Agenda.js job with `unique: { 'data.connectionId': 1 }` to prevent duplicates.

2. **On-Demand (Reactive)**
   - `publisher_service` receives a 401/403 from a `platform_api`.
   - Before marking the publish job as failed, it queues a high-priority rotation job.
   - If rotation succeeds within 3 attempts, the publish job retries immediately.

3. **Manual (Administrative)**
   - Admins can call `POST /internal/auth/tokens/rotate` with `connectionId` to force rotation after security incidents or key rotation events.

## APIs / Interfaces

### Internal Endpoints (`auth_service`)

```http
POST /internal/auth/tokens/rotate
Content-Type: application/json

{
  "connectionId": "507f1f77bcf86cd799439011",
  "trigger": "scheduled | on-demand | manual"
}
```

Response:
```json
{
  "connectionId": "507f1f77bcf86cd799439011",
  "status": "active",
  "expiresAt": "2024-12-20T08:00:00Z",
  "rotatedAt": "2024-12-19T08:00:00Z"
}
```

```http
GET /internal/auth/tokens/health?connectionId=<id>
```

Returns `expiryHoursRemaining` and `status` for monitoring and scheduling decisions.

### `token_store` Interface

```javascript
// Atomic fetch with status lock
await tokenStore.getConnectionForRotation(connectionId, expectedStatus = 'active');

// Atomic update after successful platform refresh
await tokenStore.updateTokens(connectionId, {
  accessToken: ciphertext,
  refreshToken: ciphertext,
  expiresAt: newDate,
  rotatedAt: newDate,
  status: 'active',
  $inc: { rotationAttempts: 0 } // reset on success
});
```

### Platform OAuth Endpoints

- **Twitter/X:** `POST https://api.twitter.com/2/oauth2/token` (grant_type=refresh_token)
- **Facebook:** `GET https://graph.facebook.com/v18.0/oauth/access_token` (exchange using `fb_exchange_token` or long-lived token refresh)
- **Instagram (Basic Display / Graph API):** Platform-specific token refresh URLs via Meta Graph API.
- **LinkedIn:** `POST https://www.linkedin.com/oauth/v2/accessToken`

All calls include client credentials stored in environment secrets, not in the database.

## Operational Procedures

### Scheduled Rotation

1. `scheduler_service` scans MongoDB every 6 hours.
2. For each expiring token, define `job.attrs.nextRunAt = expiresAt - 4 hours`.
3. `agenda_worker` picks up the job and calls `auth_service`.
4. `auth_service` decrypts the `refreshToken` via `token_store`, calls the platform refresh endpoint.
5. On success, `token_store` atomically updates the document and resets `rotationAttempts`.
6. On failure, increment `rotationAttempts` and reschedule with exponential backoff (15 min, 1 hr, 4 hrs).

### Emergency Rotation (Suspected Breach or Key Rotation)

1. Admin triggers `POST /internal/auth/tokens/rotate` for all connections with `trigger: manual`.
2. `auth_service` processes in batches of 50 concurrent jobs to avoid platform rate limits.
3. If a platform refresh fails due to an invalid `refreshToken`, set `status: failed` and emit an event to `user_service` to notify the user to reconnect.

### Post-Rotation Verification

1. After updating tokens, `auth_service` performs a lightweight platform API call (e.g., `GET /2/users/me` for Twitter) to verify token validity.
2. If verification fails, rollback the token update (keep old tokens if still valid) and alert.

## Failure Modes & Mitigations

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Refresh token expired or revoked by user** | Permanent auth failure; publish jobs will fail indefinitely. | Set `status: failed`; stop scheduling new publish jobs for the connection; send re-authentication email via `user_service`. |
| **Platform API rate limit (HTTP 429)** during rotation | Rotation delayed; token may expire before next attempt. | Use Agenda.js backoff with jitter; `scheduler_service` pre-emptively staggers jobs; circuit breaker in `auth_service` pauses calls to that platform for 5 minutes. |
| **Race condition: two workers rotate same token** | One worker overwrites the other’s valid token; potential use of revoked refresh token. | `token_store` uses MongoDB `findOneAndUpdate` with `status: 'active'` → `rotating` as a lock; TTL on lock (5 minutes) with automatic unlock on worker crash. |
| **Encryption key mismatch** | `token_store` cannot decrypt tokens after a master key rotation. | Maintain a key version ID in each document; `token_store` tries current and N-1 key during decryption; re-encrypt on first successful read. |
| **Publisher 401 mid-flight after proactive rotation** | Publish job fails even though rotation succeeded. | `publisher_service` tolerates one on-demand rotation attempt per job; if still 401, mark job failed and alert. |
| **MongoDB write conflict** | `token_store` update fails under high concurrency. | Retry with exponential backoff; all updates are idempotent based on `connectionId` and `rotatedAt`. |

## Scaling Considerations

- **Job Uniqueness:** Agenda.js jobs for rotation use `unique` constraints on `connectionId` to prevent duplicate queue entries when `scheduler_service` and `publisher_service` trigger simultaneously.
- **Worker Concurrency:** Run `agenda_worker` instances with `processEvery: 30s` and `maxConcurrency: 20` per instance. Scale workers horizontally, but cap total concurrent rotation jobs per platform to respect API rate limits (e.g., max 50 concurrent Twitter refreshes cluster-wide).
- **Staggering:** When many tokens share the same `expiresAt` (e.g., all issued at 9:00 AM), `scheduler_service` adds random jitter (`Math.random() * 30 minutes`) to `nextRunAt` to flatten the request curve against platform OAuth endpoints.
- **Circuit Breakers:** `auth_service` maintains per-platform circuit breakers. If the Twitter refresh endpoint returns > 50% 5xx errors, new rotation attempts are queued but not executed for 2 minutes, preventing cascading overload.
- **Bulk Operations:** For administrative re-encryption or mass rotation, use cursor-based batching over the `platform_connections` collection. Avoid `skip()`/`limit()` pagination on large collections; use `lastId` range queries.

## Monitoring & Alerting

- **Metric:** `token_rotation_latency_ms` — histogram of time from job pickup to successful `token_store` update.
- **Alert:** `token_store_rotation_failed` > 5 failures in 10 minutes for any single platform.
- **Alert:** Any connection with `status: active` and `expiresAt < now + 2 hours` without a queued rotation job (indicates `scheduler_service` lag).
- **Alert:** `publisher_auth_error` rate > 1% of total publish jobs in a 5-minute window.
- **Dashboard:** Panel showing tokens by `status` and `platform`, plus a 24-hour expiry heatmap.

## Related Diagrams

- `diagrams/0350/iter1_overview.mmd` — System overview showing the relationship between `auth_service`, `token_store`, `scheduler_service`, `agenda_worker`, and `publisher_service`.