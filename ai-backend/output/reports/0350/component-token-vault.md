## component-token-vault

## Overview

The Token Vault is the system's secure credential repository. It persists encrypted OAuth tokens (access and refresh) for connected social media accounts, enforces atomic compare-and-swap (CAS) semantics to eliminate race conditions during token rotation, and guarantees that plaintext credentials never touch persistent storage or transport logs.

## Responsibilities

- **Encrypted Persistence**: Store OAuth access tokens, refresh tokens, expiry metadata, and scopes using AES-256-GCM encryption with per-record initialization vectors before writing to the backing store.
- **Versioned Token Records**: Maintain a monotonically increasing `tokenVersion` on every credential record to support optimistic concurrency control.
- **Atomic Compare-and-Swap (CAS)**: Expose a `rotate` primitive that succeeds only when the caller-supplied `expectedVersion` matches the current stored version, preventing lost updates during concurrent refresh flows.
- **On-Demand Decryption**: Decrypt token payloads in-memory only when requested by authenticated internal services (`auth_service`, `publisher_service`) and zero out buffers immediately after serialization.
- **Cache Invalidation**: Publish invalidation events to `redis_cache` whenever a token is rotated or deleted, ensuring hot cached credentials do not stale.
- **Audit Logging**: Emit structured audit events for every read, write, rotation, and deletion, including caller service identity, user ID, platform, and timestamp (never logging the token itself).
- **Key Rotation Support**: Track an `encryptionKeyId` per record so historical data can be re-encrypted under new keys without service downtime.

## APIs / Interfaces

### Internal Service Interface (gRPC / HTTP)

The Token Vault exposes an internal REST/gRPC API consumed only by cluster services. All endpoints require mTLS and a service identity header (`X-Service-Name`).

| Endpoint | Method | Description |
|---|---|---|
| `/tokens/{userId}/{platform}` | `GET` | Retrieve decrypted token bundle and current version. Returns `410 Gone` if the token has been revoked. |
| `/tokens/{userId}/{platform}` | `PUT` | Initial storage of a new token bundle. Idempotent by `requestId`. |
| `/tokens/{userId}/{platform}/rotate` | `POST` | CAS rotation. Body includes `expectedVersion`, `newAccessToken`, `newRefreshToken`, `newExpiresAt`. Returns `409 Conflict` if version mismatch. |
| `/tokens/{userId}/{platform}` | `DELETE` | Hard-delete a token record and purge associated cache entries. |
| `/tokens/{userId}/bulk` | `POST` | Retrieve decrypted tokens for multiple platforms in a single round-trip (used by `publisher_service` for multi-platform posts). |

### Node.js Module Interface

For co-located services, a thin SDK wraps the network API with local caching of encryption key metadata:

```javascript
const vault = require('@platform/token-vault-client');

// Store new credentials
await vault.store(userId, platform, {
  accessToken: '...',
  refreshToken: '...',
  expiresAt: Date,
  scopes: ['publish', 'read']
});

// Retrieve with automatic decryption
const bundle = await vault.get(userId, platform);

// Atomic rotation
const newVersion = await vault.rotate(userId, platform, {
  expectedVersion: 4,
  newAccessToken: '...',
  newRefreshToken: '...'
});
```

## Data Owned

The Token Vault owns the `social_tokens` collection (or dedicated encrypted partition). Each document represents a single user-platform credential pair.

**Schema (logical)**:

```javascript
{
  _id: ObjectId,
  userId: ObjectId,              // sharding key
  platform: String,               // e.g., "instagram", "twitter", "tiktok"
  encryptedAccessToken: Binary,  // AES-256-GCM ciphertext
  encryptedRefreshToken: Binary, // AES-256-GCM ciphertext
  accessTokenIV: Binary,          // 96-bit nonce
  refreshTokenIV: Binary,
  tokenVersion: Number,          // integer, incremented on every rotation
  expiresAt: Date,
  scopes: [String],
  encryptionKeyId: String,         // reference to KMS key version
  integrityHash: String,         // HMAC-SHA256 over ciphertext + metadata
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes**:
- `{ userId: 1, platform: 1 }` — unique, primary lookup.
- `{ expiresAt: 1 }` — TTL-like background reaper for cleanup (or queried by `auth_service` for proactive refresh).
- `{ encryptionKeyId: 1 }` — batch re-encryption jobs during key rotation.

## Failure Modes

| Failure | Impact | Mitigation |
|---|---|---|
| **Concurrent Refresh Race** | Two `auth_service` instances refresh the same OAuth token simultaneously; one update overwrites the other, causing the "loser" token to be invalid in the vault. | Enforce CAS rotation (`expectedVersion` check). The loser receives `409 Conflict`, discards its newly obtained token, and re-reads the winner's record. |
| **Encryption Key Unavailability** | KMS or key provider outage prevents decryption; publishing halts. | Cache recently used decrypted tokens in `redis_cache` with short TTL (e.g., 60s) to absorb transient KMS outages. Maintain a local read-only key replica for last-resort decryption. |
| **Stale Cache after Rotation** | `publisher_service` reads an old access token from `redis_cache` after a successful rotation, causing API rejections. | Vault emits a Redis pub/sub invalidation event on every successful `rotate` and `DELETE`. Cache clients subscribe and evict immediately. |
| **Database Write Failure during Rotation** | Platform has issued a new refresh token, but the vault fails to persist it. On next read, the old refresh token is used and rejected by the platform. | Treat vault persistence as the commit point. If the vault write fails, the `auth_service` must treat the OAuth flow as incomplete and retry. Never acknowledge a platform refresh until the vault CAS succeeds. |
| **Corrupted Ciphertext / Tampering** | Integrity check fails during decryption. | HMAC-SHA256 verification on every read. If mismatch, return `500` and alert. Do not return partial or suspected-corrupt data. |
| **Unauthorized Internal Access** | A compromised internal service attempts to bulk-extract tokens. | Enforce service-level ACLs: `publisher_service` may only read; `auth_service` may read/write/rotate. Reject unknown service identities. |

## Scaling Considerations

- **Read Amplification**: Every publish job reads a token. With thousands of concurrent jobs, direct vault queries would overwhelm the backing store. The `redis_cache` relation is critical: decrypted tokens may be cached for 1–5 minutes with aggressive invalidation, reducing vault read load by >90%.
- **Encryption CPU Cost**: AES-256-GCM in Node.js is fast but not free. Deploy the vault service on compute-optimized instances with AES-NI support. Avoid decrypting tokens for operations that only need metadata (e.g., checking expiry); expose a lightweight `GET /tokens/{userId}/{platform}/meta` that returns non-sensitive fields without decryption.
- **Sharding Strategy**: Shard the backing store by `userId` to ensure that a single high-activity user does not hotspot the database.
- **Connection Pooling**: Maintain a dedicated MongoDB connection pool sized to the vault service's worker count; do not share the generic application pool used by `mongodb_ops`.
- **Horizontal Scaling**: The vault service itself is stateless. Scale pods/replicas horizontally behind an internal load balancer. Because CAS operations rely on the backing store's atomicity (MongoDB find-and-modify), there is no inter-pod coordination penalty.
- **Key Rotation Throughput**: Scheduled key rotation can generate heavy write load. Implement a backpressure-controlled background worker that re-encrypts a limited batch of records per second to avoid I/O spikes.

## Related Diagrams

- Component diagram: `diagrams/0350/iter4_component-token-vault.mmd`