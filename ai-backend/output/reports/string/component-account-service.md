# Account Service

The Account Service is a dedicated persistence and lifecycle manager for user-linked social media platform credentials. It stores encrypted OAuth tokens, tracks connection health, and serves as the single source of truth for authentication material required by the publishing pipeline.

## Responsibilities

- **OAuth Token Vaulting**: Securely persist `access_token`, `refresh_token`, and expiry metadata for every connected social platform account.
- **Account Lifecycle Management**: Handle platform connection, re-authorization, disconnection, and status tracking (`active`, `expired`, `revoked`).
- **Token Refresh Orchestration**: Proactively refresh expiring access tokens using platform-specific OAuth flows and atomically update stored credentials.
- **Credential Serving**: Provide decrypted, valid access tokens to the `publisherService` on demand so it can execute authenticated API calls on behalf of users.
- **Account Metadata Storage**: Cache platform-specific profile data—such as platform user IDs, handles, profile URLs, and granted scopes—to avoid repeated upstream API lookups.
- **Platform Constraint Enforcement**: Apply per-user platform limits (e.g., one Instagram Business account per user) at the time of connection.

## APIs and Interfaces

### REST Endpoints (Consumed via API Gateway)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/accounts` | Store a new connection after a successful OAuth callback. Accepts encrypted tokens, platform name, platform account ID, and expiry. |
| `GET` | `/v1/accounts?userId={userId}` | List all active and inactive connections for a user. Returns metadata with tokens redacted. |
| `GET` | `/v1/accounts/{accountId}` | Retrieve a single connection record. Tokens remain redacted in the response. |
| `DELETE` | `/v1/accounts/{accountId}` | Disconnect an account. Deletes tokens from the database and updates status to `revoked`. |
| `POST` | `/v1/accounts/{accountId}/refresh` | Force an immediate token refresh. Returns `204` on success or `422` if the refresh grant is invalid. |

### Internal Service Interface

Downstream services—primarily `publisherService`—consume these programmatic interfaces:

- `getValidAccessToken(accountId: string): Promise<string>`  
  Returns a decrypted, non-expired access token. If the token is within a configurable expiry window (e.g., 5 minutes), the service performs a blocking refresh before returning.

- `getAccountMetadata(accountId: string): Promise<AccountMetadata>`  
  Returns the platform account ID, username, granted scopes, and status without exposing token fields.

- `bulkGetAccounts(userId: string, platforms: string[]): Promise<Account[]>`  
  Returns connection records for all requested platforms in a single query to minimize round-trips during multi-platform publishing.

## Data Ownership

The service owns the **`social_accounts`** collection in MongoDB.

### Core Schema

```javascript
{
  _id: ObjectId,
  userId: ObjectId,                 // Indexed
  platform: String,                 // e.g., "instagram", "twitter", "tiktok"
  platformAccountId: String,        // Platform-native user/page ID
  username: String,
  accessToken: String,              // AES-256-GCM encrypted at rest
  refreshToken: String,             // AES-256-GCM encrypted at rest
  tokenExpiry: Date,
  status: String,                   // Enum: "active", "refreshing", "expired", "revoked"
  scopes: [String],
  connectedAt: Date,
  updatedAt: Date,
  metadata: {
    profilePictureUrl: String,
    followerCount: Number
  }
}
```

### Indexes

- `{ userId: 1, platform: 1 }` – Unique sparse index to enforce a single active connection per platform per user where required.
- `{ userId: 1 }` – Supports account list queries from the API Gateway.
- `{ tokenExpiry: 1 }` – Enables time-range scans for proactive batch refresh jobs.
- `{ platformAccountId: 1 }` – Supports idempotent reconnections and platform webhook lookups.

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Invalid / Revoked Refresh Token** | User-initiated revocation on the platform side causes all publish jobs to fail with `401`. | Catch platform-specific OAuth errors (`invalid_grant`). Atomically set `status: "revoked"` and surface a disconnect event to the API Gateway so the UI can prompt re-authorization. |
| **Concurrent Token Refresh** | Two `publisherService` workers processing jobs for the same account race to refresh, invalidating each other’s tokens. | Acquire a distributed lock (e.g., MongoDB `findOneAndUpdate` setting `status: "refreshing"`) before refresh. Reject or spin-wait on secondary callers until the lock clears. |
| **MongoDB Unavailability** | Token reads fail, halting the publishing pipeline. | Implement connection-pool retry logic with exponential backoff. The API Gateway should return `503 Service Unavailable` for user-facing routes. `publisherService` jobs should defer via Agenda.js backoff rather than failing permanently. |
| **Encryption Key Rotation** | Tokens encrypted with an old key fail decryption after rotation. | Version ciphertexts with a `keyVersion` field. Maintain a decryption key ring so the service can re-encrypt on first read after rotation. |
| **Provider Rate Limiting on Refresh** | Aggressive platform rate limits block token renewal. | Use jittered exponential backoff for refresh attempts. If a refresh fails, allow the existing token to be used until it is clinically expired, reducing urgency. |
| **Sensitive Data Leakage** | Decrypted tokens accidentally logged or serialized in error traces. | Redact `accessToken` and `refreshToken` from all `JSON.stringify`, `util.inspect`, and structured log outputs using a centralized serializer. |

## Scaling Considerations

- **Token Read Throughput**: The `publisherService` queries this service for every scheduled publish job. Use MongoDB projection (`{ accessToken: 1, tokenExpiry: 1 }`) to avoid transferring heavy metadata documents. Consider a short-lived, encrypted external cache (e.g., Redis with 60-second TTL) for access tokens to absorb publish bursts, with explicit invalidation on refresh.
- **Bursty Write Patterns**: Token refreshes generate sudden spikes of updates. Rely on atomic `$set` updates rather than full-document replacements to reduce oplog pressure and write lock contention.
- **Stateless Deployment**: All Node.js instances must be stateless. No in-process token caches without a shared eviction mechanism. Load-balance evenly across instances without sticky sessions.
- **Security at Scale**: Encryption keys must be injected at runtime from a secret manager (e.g., HashiCorp Vault or AWS Secrets Manager), never baked into deployment artifacts. Run the service under a dedicated MongoDB user with read/write access limited to the `social_accounts` collection.
- **Database Growth and Sharding**: Token records are small but numerous. If the user base exceeds single-replica capacity, shard the `social_accounts` collection by `userId` to ensure collocation of a user’s accounts and predictable query routing.