## Token Store

### Responsibilities
- Persist OAuth 2.0 access tokens and refresh tokens for connected social media accounts (e.g., Instagram, Twitter/X, Facebook, TikTok) in an encrypted state at rest inside MongoDB.
- Decrypt and return plaintext credentials to authorized internal consumers (`auth_service` and `platform_publisher`) on demand.
- Atomically replace token pairs during OAuth refresh flows, preventing race conditions where concurrent jobs use an invalidated refresh token.
- Bind every credential set to a composite identity of `userId`, `platform`, and `platformAccountId` to enforce strict isolation and auditability.
- Support complete credential revocation on account disconnection or user deletion, ensuring no stale tokens remain available for automated publishing.

### APIs / Interfaces
The Token Store is an internal Node.js service/module; it is not exposed directly to the public API gateway. All consumers interact through the following programmatic interface:

```typescript
interface TokenStore {
  upsertTokenSet(params: {
    userId: ObjectId;
    platform: string;
    platformAccountId: string;
    accessToken: string;
    refreshToken: string | null;
    scopes: string[];
    expiresAt: Date | null;
  }): Promise<TokenRecord>;

  getDecryptedTokenSet(params: {
    userId: ObjectId;
    platform: string;
    platformAccountId: string;
  }): Promise<{
    accessToken: string;
    refreshToken: string | null;
    scopes: string[];
    expiresAt: Date | null;
  }>;

  rotateTokens(params: {
    userId: ObjectId;
    platform: string;
    platformAccountId: string;
    newAccessToken: string;
    newRefreshToken: string | null;
    newExpiresAt: Date | null;
  }): Promise<void>;

  revokeTokenSet(params: {
    userId: ObjectId;
    platform: string;
    platformAccountId: string;
  }): Promise<void>;

  purgeUserTokens(userId: ObjectId): Promise<number>; // returns deleted count

  listAccountsByUser(userId: ObjectId): Promise<AccountSummary[]>;
}
```

**Encryption contract:**
- All token strings are encrypted with AES-256-GCM before being written to MongoDB.
- The master data-encryption key (DEK) is loaded from a KMS or secure environment secret at process startup; the DEK is never persisted in the database.
- Each ciphertext is accompanied by a random 96-bit IV and a 128-bit authentication tag stored as hex in dedicated document fields, ensuring confidentiality and tamper detection.

### Data It Owns
**MongoDB Collection:** `platform_tokens`

| Field | Type | Purpose |
|-------|------|---------|
| `_id` | ObjectId | Primary key |
| `userId` | ObjectId | Owner reference; shard key candidate |
| `platform` | String | Platform identifier (e.g., `instagram`, `twitter`) |
| `platformAccountId` | String | Platform-native user or page ID |
| `accessTokenCipher` | String | AES-256-GCM ciphertext (hex) |
| `accessTokenIv` | String | 96-bit nonce (hex) |
| `accessTokenTag` | String | 128-bit GCM auth tag (hex) |
| `refreshTokenCipher` | String | AES-256-GCM ciphertext (hex) |
| `refreshTokenIv` | String | 96-bit nonce (hex) |
| `refreshTokenTag` | String | 128-bit GCM auth tag (hex) |
| `scopes` | [String] | Granted OAuth scopes |
| `expiresAt` | Date | Access token expiration; nullable |
| `encryptionVersion` | String | DEK version for rotation tracking |
| `createdAt` | Date | Record creation timestamp |
| `updatedAt` | Date | Last mutation timestamp |
| `lastRefreshedAt` | Date | Last successful refresh timestamp |

**Indexes:**
- Unique compound index: `{ userId: 1, platform: 1, platformAccountId: 1 }` — prevents duplicate connections.
- `{ userId: 1 }` — supports user-scoped lookups and cascading deletes.
- `{ expiresAt: 1 }` — enables proactive expiry queries by background refresh jobs.
- `{ platform: 1 }` — operational index for platform-wide maintenance or deprecation.

### Failure Modes
- **Concurrent refresh collisions:** If two `platform_publisher` jobs detect expiry simultaneously and both initiate an OAuth refresh, the platform provider may invalidate the shared refresh token. The Token Store must serialize writes per account using MongoDB `findOneAndUpdate` with a predicate on a known token value, or acquire a distributed lock via the `job_scheduler`’s MongoDB-backed locking mechanism.
- **Decryption failure on corrupted ciphertext:** Bit-rot, manual DB edits, or mismatched encryption keys can cause AES-GCM decryption to fail. The store must catch these errors, emit structured logs with `userId` and `platformAccountId` (never the token), and return a `TOKEN_UNRECOVERABLE` error to force re-authentication via `auth_service`.
- **MongoDB read-your-writes lag:** Reading from a secondary after a token rotation may return the old invalidated token, causing the publish job to fail with an authentication error from the platform. All token reads must use `readPreference: 'primary'` to guarantee freshness.
- **Credential leakage via internal compromise:** Because `platform_publisher` and `auth_service` both consume decrypted tokens, a compromised internal service could exfiltrate credentials. Mitigation: deploy the Token Store as an isolated process or sidecar, enforce mTLS and short-lived internal JWTs between services, and restrict decryption to the Token Store runtime only.
- **Orphaned tokens after user deletion:** If `user_service` deletes a profile without cascading to `platform_tokens`, zombie credentials remain. The store exposes `purgeUserTokens` and must be invoked transactionally or via an outbox pattern to guarantee eventual consistency.
- **KMS/secret provider outage:** If the DEK cannot be fetched at startup, the process must fail-fast (exit with non-zero code) rather than start in a degraded mode that could write unencrypted tokens or return misleading errors.

### Scaling Considerations
- **Read-heavy publish path:** Every scheduled publish job triggers at least one token fetch. Under thousands of concurrent Agenda.js jobs, MongoDB primary read throughput becomes the bottleneck.
  - Maintain an appropriately sized MongoDB connection pool (e.g., `maxPoolSize: 50–100`) tuned to the Node.js event loop.
  - Do not cache decrypted tokens in an external Redis cache; if read latency is critical, cache ciphertext only with a TTL under 30 seconds and decrypt on every retrieval.
- **Thundering herd on mass expiry:** Platform-mandated refresh cycles (e.g., 60-day Facebook token expiry) can cause write spikes.
  - Coordinate with `job_scheduler` to schedule refresh jobs with randomized jitter (0–3600s) to spread the load.
  - Use bulk-write patterns when performing maintenance re-encryption during key rotation.
- **Shard key selection:** If the collection outgrows a single replica set, shard by `userId` to keep a user’s tokens on a single chunk, avoiding scatter-gather queries.
- **Encryption CPU overhead:** AES-256-GCM in Node.js is efficient but measurable at very high concurrency. If profiling reveals encryption as a bottleneck, offload bulk re-encryption tasks to Node.js worker threads.
- **Backup and compliance:** MongoDB backups contain ciphertext only; KMS keys must be backed up independently. Provide a hard-delete API (`purgeUserTokens`) for GDPR/CCPA right-to-erasure requests, because retaining encrypted credentials still constitutes possession of personal data.

## Related Diagrams

No paired diagram was provided for this document.