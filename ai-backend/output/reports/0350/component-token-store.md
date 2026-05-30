# Token Store

## Responsibilities

- **Encrypted Credential Persistence**: Receives plaintext OAuth tokens and platform credentials from `auth_service` after user connection flows, encrypts them using AES-256-GCM, and persists the ciphertext to MongoDB.
- **Decrypted Credential Serving**: Retrieves and decrypts stored credentials exclusively for `auth_service` (during token refresh) and `publisher_service` (during post publishing).
- **Token Metadata Tracking**: Maintains non-sensitive metadata—including platform type, account identifier, granted scopes, token expiration, and encryption key version—alongside encrypted payloads to support querying without decryption.
- **Credential Lifecycle Management**: Supports explicit deletion when users disconnect an account and supports in-place updates when `auth_service` rotates access or refresh tokens.
- **Encryption Hygiene**: Enforces per-record random IVs, AES-GCM authentication tags, and key versioning to prevent replay and tampering.

## APIs / Interfaces

`token_store` is an internal Node.js module; it is not exposed through the API Gateway. Services interact with it via programmatic interfaces:

```typescript
interface TokenStore {
  /**
   * Encrypts and stores credentials after a successful OAuth callback.
   * Called by: auth_service
   */
  async saveCredentials(
    userId: ObjectId,
    platform: 'twitter' | 'instagram' | 'facebook' | 'linkedin',
    accountId: string,
    plaintext: {
      accessToken: string;
      refreshToken?: string;
      tokenType: string;
      scopes: string[];
      expiresAt?: Date;
    }
  ): Promise<void>;

  /**
   * Retrieves and decrypts credentials for publishing or refresh flows.
   * Called by: auth_service, publisher_service
   */
  async getCredentials(
    userId: ObjectId,
    platform: string,
    accountId: string
  ): Promise<PlaintextCredential>;

  /**
   * Re-encrypts and overwrites tokens after a refresh rotation.
   * Called by: auth_service
   */
  async updateTokens(
    userId: ObjectId,
    platform: string,
    accountId: string,
    newAccessToken: string,
    newRefreshToken?: string,
    newExpiresAt?: Date
  ): Promise<void>;

  /**
   * Hard-deletes credentials on account disconnection or user deletion.
   * Called by: auth_service (on OAuth revoke), user_service (on account cleanup)
   */
  async deleteCredentials(
    userId: ObjectId,
    platform: string,
    accountId: string
  ): Promise<void>;
}
```

## Data It Owns

MongoDB collection: `platform_credentials`

Each document owns the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | Primary key |
| `userId` | ObjectId | Indexed. Owner of the social account |
| `platform` | String | Platform key: `twitter`, `instagram`, `facebook`, `linkedin` |
| `accountId` | String | Platform-native account identifier |
| `payload` | Binary / String | Encrypted JSON blob containing `accessToken`, `refreshToken`, `tokenType`, `scopes`, `expiresAt` |
| `iv` | Binary | 16-byte AES-GCM initialization vector |
| `authTag` | Binary | 16-byte AES-GCM authentication tag |
| `keyVersion` | String | Encryption key identifier (e.g., `v2024-06`) |
| `createdAt` | Date | Initial storage timestamp |
| `updatedAt` | Date | Last mutation timestamp |

- **Plaintext indexes**: `userId`, `platform`, and `accountId` remain unencrypted to allow `publisher_service` and `auth_service` to query without decrypting the entire collection.
- **Sensitive payload**: The `payload` field is the only encrypted segment; all other fields are operational metadata.

## Failure Modes

- **Master Key / KMS Unavailability**: If the master encryption key cannot be retrieved from the secrets manager (e.g., Vault or AWS KMS outage), decryption fails with a `MasterKeyUnavailableError`. `publisher_service` must catch this, fail the Agenda job with a transient error, and rely on Agenda’s configured retry backoff. `auth_service` must reject new OAuth connections with HTTP 503.
- **MongoDB Connection Timeout**: Token reads/writes surface `MongoTimeoutError`. Upstream services should treat this as transient and retry; `publisher_service` must not mark the job as permanently failed.
- **Authentication Tag Mismatch (Tampering/Corruption)**: AES-GCM decryption fails when the auth tag does not verify. The store logs a `SECURITY` level event containing `userId`, `platform`, and `accountId` (never the payload), sets a `corrupted: true` flag on the document to quarantine it, and throws a non-retryable error. Operations must be alerted.
- **Token Expiration Race Condition**: A token retrieved by `publisher_service` may expire before the platform API call completes. The platform returns 401. `publisher_service` must not retry the same token blindly; instead, it should request `auth_service` to perform a refresh flow and then call `token_store.updateTokens()` before re-attempting publish.
- **Unauthorized Caller**: If an untrusted service (e.g., `content_service` or `scheduler_service`) attempts to invoke `token_store`, the module must reject the call. Enforcement relies on service identity (mTLS or internal signed JWTs) because `token_store` has no public HTTP surface.
- **Orphaned Credentials on User Deletion**: If `user_service` deletes an account but the cascade to `token_store` fails, encrypted tokens remain in MongoDB. Mitigate with an idempotent cleanup worker or by ensuring `deleteCredentials()` is called in the same transaction or saga step that removes the user record.

## Scaling Considerations

- **Database Indexing**: Maintain a unique compound index on `{ userId: 1, platform: 1, accountId: 1 }` to guarantee one credential set per user-platform-account tuple. Add a secondary index on `{ platform: 1, accountId: 1 }` to support `publisher_service` batch lookups during high-volume publishing windows.
- **Encryption Compute**: Node.js `crypto` cipher operations are CPU-bound and can block the event loop under heavy concurrent load (e.g., thousands of Agenda jobs triggering decrypt simultaneously). If throughput exceeds ~500 decrypt operations per second per core, offload AES-GCM work to Node.js `worker_threads` or use a dedicated crypto worker pool.
- **No Plaintext Caching Policy**: Decrypted tokens must never be cached in Redis or in-memory. Ciphertext reads from MongoDB are fast enough when using a connection pool size of at least 20 per service instance. Avoid adding a caching layer that could leak credentials.
- **Encryption Key Rotation**: Support online rotation without downtime. New records write with the latest `keyVersion`. Existing records can be lazily re-encrypted during the next `getCredentials` call (read-decrypt-reencrypt-write in a single logical operation) or via a background Agenda job that scans for stale `keyVersion` values.
- **Sharding Strategy**: If the `platform_credentials` collection outgrows a single MongoDB replica set, shard by `userId`. All access patterns are user-scoped, so `userId` is a low-cardinality, evenly distributed shard key that avoids cross-shard queries.
- **Backup and Recovery**: MongoDB backups contain only ciphertext and are safe to store in standard object storage. The master encryption key must reside in a separate KMS/HSM and must never be included in the same backup set as the database.

## Related Diagrams

No paired Mermaid diagram was provided for this component document.