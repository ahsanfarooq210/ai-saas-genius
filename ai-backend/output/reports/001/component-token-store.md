## component-token-store

### Overview
The Token Store is an internal encryption boundary responsible for persisting OAuth 2.0 credentials for third-party social platforms. It ensures that access tokens, refresh tokens, and bearer credentials never exist in plaintext inside MongoDB, application logs, or heap dumps. The component is consumed directly as a library module by `auth_service` (during connection and refresh flows) and by `platform_api_clients` (during publish execution).

### Responsibilities
- **At-Rest Encryption**: Encrypt access and refresh tokens using AES-256-GCM with a dedicated root key before writing to MongoDB.
- **Token Lifecycle Management**: Store newly issued tokens after initial OAuth consent, atomically update credentials after a refresh-token exchange, and permanently delete records when a user disconnects an account or revokes platform consent.
- **Secure Retrieval**: Decrypt and return plaintext credentials only to authorized internal callers; reject direct database access patterns from other services.
- **Metadata Exposure**: Keep non-sensitive fields—`platform`, `accountId`, `expiresAt`, and `scope`—in plaintext so that `scheduler_service` and `auth_service` can query and schedule without decryption overhead.
- **Audit Logging**: Record every read, write, and delete operation with `userId`, `platform`, `accountId`, consuming service identity, and timestamp.

### APIs and Interfaces
The Token Store exposes an internal asynchronous API consumed as a Node.js module. It does not surface HTTP endpoints.

```javascript
class TokenStore {
  /**
   * Encrypt and persist a new token set after initial OAuth flow.
   */
  async storeTokens({
    userId,
    platform,      // 'instagram' | 'twitter' | 'facebook' | 'tiktok' | 'linkedin'
    accountId,     // Platform-specific user or page ID
    accessToken,
    refreshToken,
    expiresAt,     // Date
    scope          // Array<String>
  }): Promise<{ insertedId: string }>;

  /**
   * Retrieve and decrypt tokens for publishing or refresh.
   */
  async getTokens({
    userId,
    platform,
    accountId
  }): Promise<{
    accessToken: string,
    refreshToken: string,
    expiresAt: Date,
    scope: string[]
  }>;

  /**
   * Atomic update after a refresh token exchange.
   */
  async updateTokens({
    userId,
    platform,
    accountId,
    newAccessToken,
    newRefreshToken, // optional; some platforms rotate it
    newExpiresAt
  }): Promise<void>;

  /**
   * Remove credentials on disconnect, revocation, or account deletion.
   */
  async deleteTokens({
    userId,
    platform,
    accountId
  }): Promise<void>;

  /**
   * List connected accounts for a user without returning secrets.
   */
  async listAccounts(userId: string): Promise<{
    platform: string,
    accountId: string,
    expiresAt: Date,
    scope: string[]
  }[]>;
}
```

### Data Ownership
All records live in the MongoDB collection `platform_tokens`. The schema isolates ciphertext from queryable metadata.

```javascript
{
  _id: ObjectId,
  userId: ObjectId,              // Indexed. Candidate shard key.
  platform: String,                // Indexed. Enum: instagram, twitter, facebook, tiktok, linkedin.
  accountId: String,               // Indexed. Composite unique with userId + platform.
  
  // Encrypted payload (AES-256-GCM)
  accessCipher: String,            // Base64 ciphertext.
  refreshCipher: String,           // Base64 ciphertext.
  iv: String,                      // 16-byte initialization vector, Base64.
  authTag: String,                 // 128-bit GCM authentication tag, Base64.
  encVersion: String,              // Key version identifier (e.g., "kv-2024-06").
  
  // Plaintext metadata
  expiresAt: Date,                 // Indexed. Enables proactive refresh scheduling.
  scope: [String],
  
  // Audit fields
  createdAt: Date,
  updatedAt: Date,
  lastAccessedAt: Date,
  lastRefreshedAt: Date
}
```

**Indexes**
- `{ userId: 1, platform: 1, accountId: 1 }` — unique, primary lookup.
- `{ userId: 1 }` — supports account listing.
- `{ expiresAt: 1 }` — allows `scheduler_service` to find tokens nearing expiration.

### Failure Modes
| Failure | Impact | Mitigation |
|---|---|---|
| **Encryption key loss** | All stored tokens become permanently undecipherable; users must re-authenticate every connected platform. | Store the root key in an external KMS (e.g., AWS KMS, HashiCorp Vault) or HSM. Never commit keys to source control. Maintain an immutable key rotation log. |
| **Race condition on refresh** | Two concurrent `agenda_worker` jobs refresh the same token simultaneously. The platform invalidates the first issued refresh token, causing the second caller to fail with an invalid grant. | Use an atomic find-and-update in MongoDB with an `encVersion` check, or acquire a distributed lock (e.g., Redis Redlock) in `auth_service` before initiating the platform refresh request. |
| **Stale or revoked refresh token** | A user revokes access from the platform's native security settings. The system can no longer refresh access, and scheduled publishes fail indefinitely. | Catch OAuth `invalid_grant` errors in `platform_api_clients`. Surface the failure via `notification_service`, then invoke `deleteTokens` to scrub the dead credential and mark the account as disconnected. |
| **MongoDB unavailability** | `publisher_service` cannot retrieve tokens; publish jobs fail. `auth_service` cannot persist new connections. | Return explicit, non-retryable errors to callers so Agenda.js marks jobs failed and applies backoff. Do not swallow connection timeouts as authentication failures. |
| **Decryption corruption** | A document is tampered with or suffers bit-rot; the GCM authentication tag fails verification. | Throw a fatal decryption error, log the incident with document metadata (never the ciphertext), and surface a notification. Do not proceed with a suspected credential. |
| **Memory exposure** | Plaintext tokens linger in the Node.js heap after retrieval, risking exposure in crash dumps or heap snapshots. | Nullify token variables immediately after use in `platform_api_clients`; disable heap dump endpoints in production; run the Token Store module in a separate worker thread if the threat model requires process isolation. |

### Scaling Considerations
- **CPU-Bound Cryptography**: AES-256-GCM operations in Node.js `crypto` are synchronous and run on the main thread. Under high concurrency—when hundreds of `agenda_worker` jobs publish simultaneously—decryption can stall the event loop. If profiling reveals event-loop lag, offload encryption/decryption to a `worker_threads` pool or a dedicated sidecar.
- **Database Read Hotspot**: Every publish job triggers at least one token read. As daily post volume grows into the hundreds of thousands, the `platform_tokens` collection becomes a read hotspot. Shard MongoDB by `userId` to distribute load. An encrypted in-memory cache (e.g., Redis with ciphertext values and TTL under five minutes) may be introduced only if the threat model accepts transient plaintext in memory.
- **Refresh Storms**: Platform tokens often share fixed expiration windows (e.g., 60 days from issuance). Without jitter, thousands of tokens expire at the same moment, creating a thundering herd against both the Token Store and the social platforms' token endpoints. `scheduler_service` must stagger refresh jobs with randomized delays.
- **Key Rotation at Scale**: Rotating the encryption root key requires re-encrypting existing records. The `encVersion` field supports lazy migration: decrypt with the old key on read, re-encrypt with the new key on the next write, and run a background batch job for cold records that are not accessed frequently.
- **Connection Pool Sizing**: The MongoDB driver connection pool used by the Token Store must be sized independently from other services because `platform_api_clients` bursts connections during parallel publish waves. Monitor `waitingQueueSize` and adjust `minPoolSize` / `maxPoolSize` accordingly.