## OAuth Token Refresh Runbook

### Purpose
This runbook defines the operational procedures for maintaining valid OAuth 2.0 access tokens across all connected social media accounts. It covers proactive refresh scheduling, reactive recovery during publish failures, manual intervention workflows, and mass-revocation incident response. The goal is to minimize publish job failures due to expired credentials while preventing thundering-herd refresh storms against platform rate limits.

### Scope & Affected Components
- **Auth Service**: Encrypts, stores, and exchanges refresh tokens; source of truth for credential state.
- **User Service**: Owns account connection metadata and user-facing connection status.
- **Publish Service**: Consumes tokens to call external Platform APIs; triggers reactive refresh on 401/403.
- **Job Service / Agenda Queue**: Schedules and executes the recurring `oauth-token-refresh` background job.
- **Redis Cache**: Hot storage for decrypted access tokens and distributed refresh locks.
- **MongoDB**: Persistent storage for encrypted tokens, expiry times, and account status.
- **Notification Service**: Alerts users when re-authentication is required.

### Prerequisites
- VPN / bastion access to the production cluster.
- MongoDB shell or `mongosh` connection to the primary replica set.
- `redis-cli` access to the Redis Cluster.
- A valid service-to-service JWT for internal API endpoints.
- Read access to Agenda.js job collection (`agendaJobs`) for inspection and cancellation.
- Platform developer dashboard access (Meta, X/Twitter, LinkedIn, TikTok) to verify app-level rate limits.

---

### Data & State Ownership

#### MongoDB Schema (`socialAccounts` collection)
Auth Service owns the following document shape for each connected account:

```json
{
  "_id": ObjectId("..."),
  "userId": ObjectId("..."),
  "platform": "instagram|twitter|facebook|linkedin|tiktok",
  "platformAccountId": "178414057...",
  "status": "active|refreshing|expired|revoked",
  "credentials": {
    "accessToken": "ENC(...)",
    "refreshToken": "ENC(...)",
    "expiresAt": ISODate("2024-05-20T14:00:00Z"),
    "scope": ["instagram_basic", "instagram_content_publish"]
  },
  "lastRefreshedAt": ISODate("2024-05-20T08:00:00Z"),
  "failureCount": 0
}
```

- **Encryption**: Both tokens are encrypted at rest with AES-256-GCM. The encryption key is held in Auth Service memory (via secret injection) and never persisted to MongoDB.
- **TTL Index**: A non-unique index on `credentials.expiresAt` supports fast range queries for proactive refresh.

#### Redis Keyspace
| Key Pattern | Type | TTL | Purpose |
|---|---|---|---|
| `oauth:at:{platform}:{accountId}` | String | `expiresAt - now - 300s` | Cached decrypted access token for Publish Service |
| `refresh:lock:{platform}:{accountId}` | String | 30 s | Distributed lock to prevent concurrent refresh attempts |
| `refresh:singleflight:{platform}:{accountId}` | String | 15 s | Request coalescing key for in-flight refresh operations |

---

### Procedures

#### 1. Scheduled Proactive Refresh
An Agenda.js job named `oauth-token-refresh` is defined in Job Service and runs every **6 hours** with a concurrency limit of **10 workers**.

**Steps:**

1. **Query expiring tokens**
   ```javascript
   db.socialAccounts.find({
     "status": "active",
     "credentials.expiresAt": { $lt: new Date(Date.now() + 60 * 60 * 1000) }
   }).limit(500);
   ```

2. **Acquire distributed lock**
   ```bash
   SET refresh:lock:instagram:178414057... NX EX 30
   ```
   If lock exists, skip and move to next account.

3. **Exchange refresh token**
   - **Meta**: `GET https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&...`
   - **X/Twitter**: `POST https://api.twitter.com/2/oauth2/token` (Basic auth header)
   - **LinkedIn**: `POST https://www.linkedin.com/oauth/v2/accessToken`
   - **TikTok**: `POST https://open.tiktokapis.com/oauth/refresh_token/`

4. **Update state on success**
   - Update MongoDB: new encrypted `accessToken`, new `expiresAt`, `status: "active"`, `failureCount: 0`.
   - Write to Redis:
     ```bash
     SET oauth:at:instagram:178414057... "NEW_TOKEN" EX 3300
     ```

5. **Handle failure**
   - **`invalid_grant` / `account_disabled`**: Set `status: "revoked"`, delete Redis key, enqueue user notification via `POST /internal/notifications/send` with template `ACCOUNT_DISCONNECTED`.
   - **Platform rate limit (429)**: Reschedule the individual job `job.schedule('in 15 minutes')` and increment `failureCount`. Alert on-call if `failureCount > 3`.
   - **Network / timeout**: Standard Agenda retry with exponential backoff (2^N minutes, N < 5).

6. **Release lock** (automatic via TTL if process crashes).

#### 2. Reactive Refresh During Publish
Publish Service detects an auth failure mid-flight.

**Steps:**

1. Publish Service receives HTTP `401 Unauthorized` or `403` with auth-specific error code from Platform API.
2. It calls Auth Service:
   ```bash
   curl -X POST https://auth.internal/token/refresh \
     -H "Authorization: Bearer $S2S_JWT" \
     -d '{"accountId": "...", "reason": "publish_401"}'
   ```
3. Auth Service attempts refresh using the same lock-and-exchange logic as the proactive job.
4. On success, Auth Service returns the new access token in the response body.
5. Publish Service replaces the token in its local request context and **retries the publish exactly once**.
6. On failure (e.g., refresh token revoked):
   - Publish Service aborts the job.
   - It patches User Service:
     ```bash
     PATCH /internal/users/accounts/{accountId}/status
     Body: { "status": "revoked", "reason": "refresh_failed" }
     ```
   - Job Service marks pending publish jobs for this account as `failed` with code `AUTH_REVOKED`.

#### 3. Manual Force Refresh (On-Call / Admin)
Use this when a platform announces token invalidation ahead of time or when debugging a specific account.

```bash
curl -X POST https://auth.internal/admin/force-refresh \
  -H "Authorization: Bearer $ADMIN_S2S_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "178414057...",
    "platform": "instagram",
    "auditContext": { "ticket": "INC-4721", "operator": "oncall@company.com" }
  }'
```

The endpoint bypasses the `expiresAt` check but still respects the Redis lock to avoid collision with scheduled jobs.

#### 4. Emergency Mass Revocation
If a platform invalidates all tokens for the app (e.g., security incident):

1. **Pause all outbound publish jobs** for the affected platform:
   ```javascript
   db.agendaJobs.updateMany(
     { name: "publish-content", "data.platform": "instagram", nextRunAt: { $ne: null } },
     { $set: { disabled: true } }
   );
   ```

2. **Bulk-update MongoDB**:
   ```javascript
   db.socialAccounts.updateMany(
     { platform: "instagram", status: "active" },
     { $set: { status: "revoked" }, $unset: { "credentials.accessToken": "" } }
   );
   ```

3. **Invalidate Redis**:
   ```bash
   redis-cli --scan --pattern 'oauth:at:instagram:*' | xargs redis-cli DEL
   ```

4. **Notify users** via Notification Service broadcast and real-time WebSocket push.

5. **Re-enable jobs** only after user reconnections drive `status` back to `active`.

---

### APIs / Interfaces

| Endpoint | Method | Service | Caller | Purpose |
|---|---|---|---|---|
| `/internal/auth/token/refresh` | `POST` | Auth Service | Publish Service | Reactive refresh on 401 |
| `/internal/auth/token/:platform/:accountId` | `GET` | Auth Service | Publish Service | Fetch cached token (Redis-first) |
| `/internal/auth/admin/force-refresh` | `POST` | Auth Service | Admin / On-call | Bypass proactive schedule |
| `/internal/users/accounts/:id/status` | `PATCH` | User Service | Auth, Publish | Update connection status |
| `/internal/notifications/send` | `POST` | Notification Service | Auth, Publish | Alert user of auth issues |
| `/{platform}/oauth/access_token` | varies | External | Auth Service | Token exchange |

---

### Failure Modes & Troubleshooting

| Symptom | Root Cause | Resolution |
|---|---|---|
| `invalid_grant` during proactive refresh | User revoked app or changed password | Set `status: revoked`, stop jobs, notify user |
| `refresh:lock` key persists > 60s | Auth Service OOMkill mid-refresh | Lock TTL is 30s; investigate if it reappears (zombie job) |
| Publish 401 *after* successful refresh | Clock skew; token cached with wrong TTL | Ensure Auth Service uses NTP; pad Redis TTL by 5 minutes |
| Duplicate platform refresh calls | Multiple Publish workers hit 401 simultaneously | Verify single-flight key `refresh:singleflight:*` is checked before network call |
| 429 from platform refresh endpoint | App-level rate limit exceeded | Reduce Agenda concurrency; implement per-app token bucket |
| `accessToken` decrypt failure | Encryption key rotation mismatch | Confirm `credentials.keyVersion` field exists; fallback to previous key version if rotation is mid-deploy |
| Empty result from proactive query | TTL index not hit | Ensure `credentials.expiresAt` index exists; run `db.socialAccounts.createIndex({ "credentials.expiresAt": 1 })` |

---

### Scaling Considerations

- **Batching & Cursors**: The proactive job must use MongoDB cursor iteration with `batchSize(100)` rather than `toArray()` to keep Node.js heap stable when tens of thousands of tokens expire in the same window.
- **Concurrency Limits**: Bind the Agenda `lockLimit` for `oauth-token-refresh` to the strictest platform rate limit (e.g., X allows 10 refresh requests per 15-minute window per app). Use separate Agenda definitions per platform if limits diverge significantly.
- **Single-Flight Coalescing**: In a horizontally scaled Auth Service, 20 Publish Service pods may simultaneously request a refresh for the same revoked account. The `refresh:singleflight:*` Redis key ensures only one upstream platform call is made; others wait or receive the same error.
- **Encryption CPU**: Decrypting refresh tokens for every reactive refresh adds CPU load. Keep Auth Service CPU limits ≥ 500m per pod and scale replicas based on p95 refresh latency > 200ms.
- **Regional Redis**: If Auth Service runs in multiple regions, use Redis Cluster or a regional proxy so that `oauth:at:*` reads from Publish Service stay local. The distributed lock must be CP; use Redlock or a single regional leader for refresh orchestration.
- **Observability**: Emit metrics `oauth_refresh_total`, `oauth_refresh_failed_total`, and `oauth_refresh_duration_seconds` with labels for `platform` and `status`. Alert when `failed_total` rate > 5% for a single platform over 10 minutes.

---

## Related Diagrams

- `diagrams/002/iter1_overview.mmd`