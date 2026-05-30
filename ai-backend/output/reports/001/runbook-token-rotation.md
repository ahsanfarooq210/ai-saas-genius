## Token Rotation Runbook

### Scope and Responsibilities

This runbook governs the operational rotation of OAuth 2.0 access and refresh tokens for connected social media accounts (Instagram, Twitter/X, Facebook, TikTok, LinkedIn). It covers both automated refresh failures and emergency scenarios such as credential compromise or platform-mandated revocation.

- **auth_service**: Initiates OAuth refresh flows, validates connection state, and updates token metadata in MongoDB.
- **token_store**: Provides encrypted at-rest storage for access and refresh tokens; handles atomic read-write operations during rotation.
- **platform_api_clients**: Executes platform-specific token refresh HTTP requests and normalizes error responses.
- **publisher_service**: Retrieves tokens from `token_store` at publish time; must gracefully handle tokens rotated mid-flight.
- **agenda_worker**: Hosts background publish jobs that depend on valid tokens; may be paused during mass rotation events.
- **notification_service**: Alerts end users when a refresh fails and manual re-authentication is required.

### Rotation Triggers

1. **Scheduled expiry**: Access tokens approaching platform-specific expiry thresholds (e.g., LinkedIn 60 days, Instagram Basic Display 60 days).
2. **Platform revocation**: User changes password, revokes app permissions, or the platform invalidates tokens due to policy changes.
3. **Security incident**: Suspected compromise of the `token_store` encryption key or platform application secret.
4. **Key rotation event**: Planned rotation of the `TOKEN_STORE_MASTER_KEY` requiring re-encryption of all stored tokens.

### Prerequisites

- Admin bearer token for `auth_service` internal endpoints.
- Read/write access to the MongoDB collections owned by `auth_service` (`platformConnections`) and `token_store`.
- Shell access to the Node.js/Express runtime environment to verify `TOKEN_STORE_MASTER_KEY` and platform app secrets (`INSTAGRAM_APP_SECRET`, `TWITTER_CLIENT_SECRET`, `FACEBOOK_APP_SECRET`, `TIKTOK_CLIENT_SECRET`, `LINKEDIN_CLIENT_SECRET`).
- Ability to scale `agenda_worker` replicas via deployment orchestration (e.g., `kubectl`).

### Automated Refresh Path

Under normal operations, `auth_service` runs an Agenda.js job (`token-refresh-queue`) that queries MongoDB for connections with `expiresAt` within the next 24 hours.

```javascript
// Monitoring query run by auth_service
db.platformConnections.find({
  expiresAt: { $lt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
  isActive: true
}, { userId: 1, platform: 1, expiresAt: 1, "tokens.keyVersion": 1 })
```

For each candidate, `auth_service` invokes `platform_api_clients` to call the platform’s token endpoint. On success, `token_store` atomically writes the new ciphertext and `auth_service` updates `expiresAt` and `lastRotatedAt`. If this automated path fails, proceed to manual intervention below.

### Manual Intervention Procedures

#### Routine Refresh Token Rotation

Use this procedure when automated refresh fails for a subset of users but refresh tokens remain valid.

**Step 1: Identify affected connections**
```javascript
db.platformConnections.find({
  platform: "instagram",
  "tokens.refreshTokenExpiresAt": { $lt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
  isActive: true
})
```

**Step 2: Temporarily disable pending publish jobs for the target platform**
Prevent `publisher_service` from attempting publishes with stale tokens during the rotation window.
```javascript
db.agendaJobs.updateMany(
  { name: /publish-.*/, "data.platform": "instagram", nextRunAt: { $lt: new Date(Date.now() + 60 * 60 * 1000) } },
  { $set: { disabled: true } }
)
```

**Step 3: Force refresh via auth_service admin endpoint**
```bash
curl -X POST https://auth-service.internal/admin/connections/refresh \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "instagram",
    "userIds": ["uuid-1", "uuid-2"],
    "syncToTokenStore": true
  }'
```

This triggers `platform_api_clients` to POST to the platform OAuth token endpoint (e.g., `https://graph.instagram.com/refresh_access_token`, `https://api.twitter.com/2/oauth2/token`, `https://graph.facebook.com/v18.0/oauth/access_token`).

**Step 4: Verify persistence**
```javascript
const conn = db.platformConnections.findOne({ userId: "uuid-1", platform: "instagram" });
// Assert:
// conn.tokens.accessTokenCiphertext is updated
// conn.tokens.keyVersion matches current master key
// conn.expiresAt > Date.now() + (24 * 60 * 60 * 1000)
// conn.lastRotatedAt is recent
```

**Step 5: Re-enable Agenda jobs**
```javascript
db.agendaJobs.updateMany(
  { name: /publish-.*/, "data.platform": "instagram" },
  { $set: { disabled: false } }
)
```

**Step 6: Smoke test**
Trigger a low-priority test publish via `publisher_service`:
```bash
curl -X POST https://publisher-service.internal/test-publish \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"userId":"uuid-1","platform":"instagram","contentId":"test-content-id"}'
```

#### Emergency Mass Rotation (Compromise or Revocation)

Use this procedure when the `token_store` master key or a platform app secret is compromised, or when a platform mass-revokes tokens.

**Step 1: Halt all background publishing**
```bash
kubectl scale deployment agenda-worker --replicas=0
```

**Step 2: Revoke tokens at the platform developer console**
Manually revoke all application tokens for the affected platform(s) to invalidate outstanding access and refresh tokens.

**Step 3: Rotate `token_store` encryption key**
- Export existing ciphertexts using the old `TOKEN_STORE_MASTER_KEY`.
- Re-encrypt with the new key.
- Update the environment variable / Kubernetes secret.
- Rolling restart `auth_service` and `token_store` processes to pick up the new key.

**Step 4: Mark all affected connections inactive**
```javascript
db.platformConnections.updateMany(
  { platform: "instagram" },
  { $set: { isActive: false, rotationRequired: true, lastRotatedAt: new Date() } }
)
```

**Step 5: Notify users to re-authenticate**
Invoke `notification_service` to enqueue reconnection emails/pushes:
```bash
curl -X POST https://notification-service.internal/send-batch \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "template": "PLATFORM_RECONNECT_REQUIRED",
    "platform": "instagram",
    "deeplink": "/auth/instagram/connect"
  }'
```

**Step 6: Scale infrastructure for OAuth callback load**
Temporarily scale `auth_service` and `api_gateway` replicas to absorb the inbound OAuth callback traffic as users reconnect.

**Step 7: Restore publishing**
Once re-authentication rate drops and `platformConnections.isActive` returns to `true` for the majority:
```bash
kubectl scale deployment agenda-worker --replicas=3
```

### APIs and Interfaces

| Interface | Type | Owner | Purpose |
|-----------|------|-------|---------|
| `POST /admin/connections/refresh` | Internal HTTP | auth_service | Forces token refresh for a list of user/platform pairs. |
| `GET /admin/connections/health` | Internal HTTP | auth_service | Returns token expiry metrics, refresh queue depth, and failure counts. |
| `token_store.get(userId, platform)` | Internal module call | token_store | Decrypts and returns the current access/refresh token pair. |
| `token_store.set(userId, platform, ciphertext, keyVersion)` | Internal module call | token_store | Atomically persists rotated encrypted tokens. |
| Platform OAuth token endpoints | External HTTP | platform_api_clients | `graph.instagram.com/refresh_access_token`, `api.twitter.com/2/oauth2/token`, `graph.facebook.com/v18.0/oauth/access_token`, `open-api.tiktok.com/oauth/refresh_token/`, `www.linkedin.com/oauth/v2/accessToken`. |
| `POST /internal/publisher/test` | Internal HTTP | publisher_service | Validates end-to-end publish capability using the current token for a user. |

### Data and State Ownership

- **token_store**: Owns the encrypted token payloads (`accessTokenCiphertext`, `refreshTokenCiphertext`) and the `keyVersion` used for decryption.
- **MongoDB (auth_service / platformConnections)**: Owns connection state metadata:
  - `isActive`: Boolean indicating whether the connection can be used for publishing.
  - `expiresAt`: Timestamp of access token expiry.
  - `lastRotatedAt`: Timestamp of the last successful rotation.
  - `rotationRequired`: Boolean flag set when manual re-authentication is needed.
  - `platform`: Target social platform identifier.
- **MongoDB (agendaJobs)**: Owns job scheduling state; `disabled` flags are toggled during rotation to prevent publish failures.
- **Audit logs**: Structured JSON logs (or a dedicated `tokenRotationLogs` collection) capturing `userId`, `platform`, `trigger`, `oldKeyVersion`, `newKeyVersion`, and `rotatedAt`.

### Failure Modes and Remediation

| Failure | Symptom | Remediation |
|---------|---------|-------------|
| **Invalid refresh token** | Platform returns `invalid_grant` or `invalid_refresh_token`. | Set `isActive=false` and `rotationRequired=true`. Trigger `notification_service` to request user re-authentication via OAuth flow. |
| **Race condition during rotation** | `publisher_service` reads a token that is invalidated mid-request by `auth_service`. | `publisher_service` must catch `401 Unauthorized` from platform APIs and retry once by calling `token_store.get()` again before failing the Agenda job. |
| **Rate limiting on token endpoint** | HTTP 429 from platform during mass rotation. | Enforce per-platform concurrency limits in `platform_api_clients` (max 5 concurrent refreshes). Add jittered exponential backoff starting at 2 seconds. |
| **Encryption key mismatch** | `token_store` decryption failure after master key rotation. | Store `keyVersion` alongside every ciphertext. `token_store` must attempt decryption with the version-matched key and, if successful, re-encrypt with the current master key on read. |
| **Agenda job storm** | Thousands of publish jobs fail simultaneously due to mass token expiry, generating noise in logs and notifications. | Disable job processing before mass rotation. Use bulk MongoDB writes rather than per-document updates. |

### Scaling Considerations

- **Platform rate limits**: Instagram Basic Display restricts token refresh to approximately 200 calls per hour per app. LinkedIn and Twitter/X enforce separate OAuth rate pools. The runbook mandates that `platform_api_clients` maintain a per-platform semaphore (max 5 concurrent) and a global token-refresh Agenda job concurrency of 10 to avoid throttling.
- **Database write pressure**: Bulk-rotating 100,000 connections generates heavy WiredTiger write load. Use `db.platformConnections.bulkWrite()` with unordered operations in batches of 1,000. Monitor MongoDB `oplatencies` and `cache dirty percentage` during the operation.
- **Queue backpressure**: When `agenda_worker` is scaled to zero during emergency rotation, the `agendaJobs` collection accumulates delayed jobs. After restoring workers, watch the `lockedAt` field to ensure job processing resumes without deadlocks. Scale `agenda_worker` replicas to 5+ temporarily to drain the backlog.
- **Node.js memory during re-encryption**: Streaming the entire `token_store` dataset for master key rotation can exhaust the Node.js heap. Process records in cursor-based batches of 1,000 with `cursor.batchSize(100)` and allow GC cycles between batches.

### Related Diagrams

- `diagrams/001/iter1_overview.mmd`