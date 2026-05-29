## Token Rotation Runbook

### Scope and Applicability
This runbook covers the rotation of all cryptographic credentials within the social media automation platform:
- **Social media OAuth tokens** (access and refresh tokens) stored in the `token_store`
- **JWT signing and validation keys** used by the `auth_service`
- **Field-level encryption keys** used by the `token_store` to protect OAuth secrets at rest in MongoDB

Rotation may be triggered by scheduled expiry, security incidents, or platform-mandated credential updates.

---

### Prerequisites
- Administrative access to the MongoDB `tokens` collection
- `token_store` service health endpoint and internal API access
- Valid OAuth app credentials (`client_id`, `client_secret`) registered with each social media platform
- Deployment privileges to update environment variables for `auth_service`, `api_gateway`, and `token_store`
- A defined maintenance window or active blue/green deployment capability to avoid session disruption

---

### Rotation Procedures

#### 1. OAuth Access Token Rotation (Platform-Initiated Expiry)
Access tokens expire on platform-defined schedules and must be refreshed using stored refresh tokens.

**Detection**
- Query MongoDB for imminent expiry:
  ```javascript
  db.tokens.find({
    platform: { $in: ["instagram", "twitter", "facebook", "tiktok"] },
    accessTokenExpiresAt: { $lt: new Date(Date.now() + 24 * 60 * 60 * 1000) }
  })
  ```
- Monitor `platform_publisher` logs for HTTP `401`/`403` responses classified as token expiry errors.

**Procedure**
1. `token_store` decrypts the user's stored refresh token using the active data encryption key (DEK).
2. `auth_service` or `token_store` executes the platform-specific OAuth refresh flow:
   - POST to platform token endpoint with `grant_type=refresh_token`.
   - Authenticate using the platform app credentials.
3. On success, the platform returns a new `access_token`, expiry time, and optionally a new `refresh_token`.
4. `token_store` encrypts the new credentials and updates the MongoDB document:
   ```javascript
   // Internal token_store API
   PATCH /internal/tokens/{userId}/{platform}
   {
     "encryptedAccessToken": "<ciphertext>",
     "encryptedRefreshToken": "<ciphertext>",
     "accessTokenExpiresAt": "2024-12-31T23:59:59Z",
     "tokenVersion": 3
   }
   ```
5. `platform_publisher` job queue automatically picks up the updated token for the next scheduled publish attempt.

**Rollback / Failure Handling**
- If the platform returns `invalid_grant`, the refresh token is revoked or expired. Update the document status:
  ```javascript
  db.tokens.updateOne(
    { userId: UUID, platform: "twitter" },
    { $set: { connectionStatus: "REAUTH_REQUIRED", lastError: "invalid_grant" } }
  )
  ```
- Trigger `notification_service` to send a re-authorization email to the user.
- `user_service` flags the platform connection as inactive until the user completes the OAuth flow again.

#### 2. OAuth Refresh Token Rotation (Security or Platform Policy)
Some platforms rotate refresh tokens on every use or require periodic rotation.

**Procedure**
1. During any access token refresh, inspect the platform response for a new `refresh_token`.
2. If present, `token_store` immediately overwrites the old encrypted refresh token. The old value must not be retained.
3. Increment `tokenVersion` to invalidate any in-memory caches in `platform_publisher` or `job_scheduler`.

#### 3. JWT Signing Key Rotation (`auth_service`)
`auth_service` issues RS256-signed JWTs consumed by `api_gateway` and downstream services.

**Procedure**
1. Generate a new RSA key pair: `jwt_private_v2.pem`, `jwt_public_v2.pem`.
2. Deploy `jwt_public_v2.pem` to `api_gateway` and `auth_service` as `JWT_PUBLIC_KEY_V2`.
3. Update `auth_service` to sign all new tokens with `JWT_PRIVATE_KEY_V2`.
4. Retain `JWT_PRIVATE_KEY_V1` and `JWT_PUBLIC_KEY_V1` in both services for validation only.
5. Set the grace period to the maximum JWT TTL (e.g., 24 hours).
6. After the grace period expires, remove V1 keys from environment variables and redeploy.

**Verification**
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $(./issue-test-jwt.sh)" \
  https://api-gateway.internal/v1/health/auth
# Expected: 200
```

#### 4. Token Store Encryption Key Rotation (Data Encryption Key — DEK)
The `token_store` uses AES-256-GCM envelope encryption. The DEK protects OAuth tokens stored in MongoDB.

**Procedure**
1. Generate a new DEK in the key management service (KMS) or HSM. Label it `dek-v2`.
2. Update `token_store` configuration to load `dek-v2` as the active encryption key; mark the previous DEK (`dek-v1`) as decrypt-only.
3. Create an Agenda.js background job named `reencrypt-tokens` via `job_scheduler`:
   - **Query:** `db.tokens.find({ dekVersion: { $ne: "v2" } })`
   - **Batch size:** 100 documents per job tick to avoid long-running MongoDB cursors.
   - **Concurrency:** 5 concurrent workers to limit `token_store` CPU load.
4. For each batch:
   - Decrypt `encryptedPayload` using `dek-v1`.
   - Re-encrypt with `dek-v2`.
   - Update `dekVersion` to `"v2"` and write the new ciphertext back to MongoDB.
5. Monitor migration progress via MongoDB aggregation:
   ```javascript
   db.tokens.aggregate([
     { $group: { _id: "$dekVersion", count: { $sum: 1 } } }
   ])
   ```
6. Once 100% of documents report `dekVersion: "v2"`, retire `dek-v1` and remove it from `token_store` memory.

**Race Condition Mitigation**
If `token_store` receives a read request for a document still encrypted with `dek-v1`, it inspects the `dekVersion` field and selects the correct key. Writes always use the active `dek-v2`.

---

### Verification and Health Checks

| Check | Command / Action | Expected Result |
|-------|------------------|-----------------|
| `token_store` key status | `GET /health/keys` | `activeDekVersion: "v2"`, `decryptOnlyVersions: ["v1"]` |
| OAuth refresh flow | Execute manual refresh for one test user per platform | New `accessTokenExpiresAt` > `now()` |
| `platform_publisher` dry-run | Publish test post to private account using rotated token | HTTP 200 from platform API |
| JWT validation | Authenticate via `api_gateway` with token signed by new key | `x-auth-service: v2` header present, 200 response |
| MongoDB migration completeness | Aggregation on `dekVersion` | Zero documents with old version |

---

### Failure Modes and Remediation

| Failure Mode | Symptom | Remediation |
|--------------|---------|-------------|
| **Refresh token revoked by end-user** | Platform returns `invalid_grant`; `platform_publisher` jobs fail | Update MongoDB status to `REAUTH_REQUIRED`. Halt related Agenda.js jobs for that user. Trigger `notification_service` re-auth email. |
| **Bulk rotation triggers platform rate limit** | HTTP 429 from platform token endpoints | Pause `job_scheduler` token-refresh queue. Apply exponential backoff (start at 60s, cap at 15min). Reduce batch concurrency to 1. |
| **Encryption key mismatch during read** | `token_store` throws decryption integrity errors | Verify `dekVersion` on the document matches loaded keys. If rollback is required, reactivate `dek-v1` as the active key in `token_store` config. |
| **JWT key rotation without grace period** | Valid user sessions rejected with `401 Unauthorized` across `api_gateway` | Emergency rollback: redeploy V1 public/private keys to `auth_service` and `api_gateway`. Re-issue tokens if necessary. |
| **Agenda.js job duplication during DEK migration** | Duplicate `reencrypt-tokens` jobs running; MongoDB write conflicts | Ensure job definition uses unique `jobName` with idempotent batch updates (`$match: { dekVersion: { $ne: "v2" } }`). |

---

### Scaling Considerations
- **Staggered Execution:** Schedule bulk OAuth refresh jobs during off-peak hours. Use Agenda.js `priority: 'low'` and `concurrency: 5` to prevent `token_store` and MongoDB primary overload.
- **Read Replicas:** Run DEK migration queries and expiry detection against MongoDB secondary nodes. Perform writes only against the primary.
- **Platform Quotas:** Respect per-app rate limits (e.g., Twitter 300 requests per 15-minute window). Token refresh attempts must include jittered backoff to avoid thundering herd when many tokens expire simultaneously.
- **Memory Overhead:** During JWT or DEK rotation windows, `token_store` and `api_gateway` may hold two keys in memory. Ensure container memory limits account for a 2x key buffer (e.g., 64MB additional headroom for RSA keys and DEK caches).
- **Job Queue Depth:** If >10,000 tokens require simultaneous rotation, shard the Agenda.js job queue by `userId` modulo to parallelize across multiple `job_scheduler` worker instances.

---

## Related Diagrams
- `diagrams/001/iter1_overview.mmd`