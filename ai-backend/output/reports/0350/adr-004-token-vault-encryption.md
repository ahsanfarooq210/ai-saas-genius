# ADR-004: Token Vault Encryption Strategy

## Status
Accepted

## Context
The platform stores OAuth access and refresh tokens for connected social media accounts. These tokens are high-value, long-lived credentials that grant publishing rights on behalf of users. A compromise of the token database would constitute a total account takeover for every connected user. MongoDB provides encryption-at-rest, but this only protects physical storage media and does not defend against logical database access, backup exfiltration, or insider threats. A dedicated application-layer encryption scheme is required for the Token Vault component to ensure tokens remain confidential even if the operational database is breached.

## Decision

We will implement **application-layer envelope encryption** inside the Token Vault using AES-256-GCM with a key hierarchy managed by an external Key Management Service (KMS).

### Encryption Scheme
- **Algorithm**: AES-256-GCM (authenticated encryption with associated data).
- **Key Hierarchy**:
  - **Master Key (KEK)**: A 256-bit key held exclusively in the external KMS (e.g., AWS KMS, HashiCorp Vault). It is never persisted to disk or exported to application memory beyond the brief unwrap operation.
  - **Data Encryption Key (DEK)**: A unique 256-bit key generated per token record via `crypto.randomBytes(32)`. The DEK encrypts the token payload. The DEK itself is encrypted by the KEK and stored alongside the ciphertext.
- **IV Generation**: A 96-bit random nonce (`crypto.randomBytes(12)`) is generated for every encryption operation. IV reuse under the same GCM key is catastrophic; per-record DEKs render collision probability negligible.
- **Persistent Payload Format** (stored in MongoDB `token_vault` collection):
  ```json
  {
    "userId": "uuid",
    "platform": "instagram",
    "keyVersion": "kv-2024-06",
    "schemaVersion": 1,
    "casVersion": 42,
    "kekId": "arn:aws:kms:region:account:key/12345",
    "encryptedDek": "base64(AES256(KEK, DEK))",
    "ciphertext": "base64(AES256GCM(DEK, plaintext))",
    "iv": "base64(12-byte-nonce)",
    "authTag": "base64(16-byte-tag)",
    "createdAt": "ISODate",
    "updatedAt": "ISODate"
  }
  ```

### Atomic Compare-and-Swap (CAS)
Token refresh is a read-modify-write operation vulnerable to race conditions when multiple workers or the Auth Service concurrently update a token. The vault exposes a rotate operation that translates to a MongoDB `findOneAndUpdate` with the filter `{ userId, platform, casVersion: expectedCasVersion }` and the update `{ $inc: { casVersion: 1 }, $set: { ciphertext, iv, authTag, encryptedDek, updatedAt } }`. If the expected version does not match, the update fails and the caller retries with jittered exponential backoff.

### Key Rotation
- **KEK Rotation**: The master key is rotated annually in the KMS. New token records automatically use the latest KEK. Existing records are lazily re-encrypted on the next retrieval (read-repair) or via a scheduled batch rotation job that runs during low-traffic windows.
- **DEK Rotation**: Each token record already uses a unique DEK. A token refresh automatically generates a new DEK, so explicit DEK rotation is unnecessary.

### Redis Cache Policy
- **Refresh Tokens**: Never cached in Redis. They remain exclusively in the encrypted vault.
- **Access Tokens**: May be cached in Redis only if the TTL is ≤ 3600 seconds. The cached value is encrypted with a **Cache Encryption Key** (CEK) that is derived and rotated daily by the Token Vault service and held only in service memory.
- **In-Transit**: All Redis connections use TLS 1.3.

## Responsibilities
- **Token Vault Service**:
  - Generate, wrap, and unwrap DEKs via KMS.
  - Encrypt and decrypt token payloads.
  - Enforce CAS semantics for token rotation.
  - Emit structured audit logs for every unwrap and decryption event (including `userId`, `platform`, `callerService`, and `timestamp`).
- **Auth Service**: Orchestrate OAuth flows and delegate all token persistence to the vault. It must never persist plaintext tokens in MongoDB, Redis, or application logs.
- **Job Worker / Publisher Service**: Request plaintext tokens from the vault at publish time. Hold them in Node.js `Buffer` objects in memory only for the duration of the external API request.

## APIs / Interfaces

### Internal HTTP Interface (Node.js/Express)
```javascript
// Store a new token pair
POST /internal/v1/tokens
Body: {
  userId: string,
  platform: string,
  accessToken: string,      // plaintext, encrypted in transit via mTLS
  refreshToken: string,     // plaintext, encrypted in transit via mTLS
  expiresAt: number
}
Response: { tokenId: string, casVersion: number }

// Retrieve plaintext tokens
GET /internal/v1/tokens/:userId/:platform
Headers: { X-Caller-Service: publisher-service }
Response: {
  accessToken: string,      // plaintext
  refreshToken: string,     // plaintext
  casVersion: number
}

// Atomic rotate (used during OAuth refresh)
PUT /internal/v1/tokens/:userId/:platform/rotate
Body: {
  newAccessToken: string,
  newRefreshToken: string,
  expectedCasVersion: number
}
Response: { casVersion: number, rotated: boolean }
```

### KMS Client Interface
- `generateDataKey(keyId) -> { Plaintext: Buffer, CiphertextBlob: Buffer }`
- `decrypt(keyId, CiphertextBlob) -> Plaintext`

All KMS calls are wrapped in a circuit breaker with a 500 ms timeout and a 3-attempt retry policy with full jitter.

## Data Ownership
- **Owned by Token Vault**:
  - Encrypted token payloads (`ciphertext`, `iv`, `authTag`)
  - Wrapped DEKs (`encryptedDek`)
  - CAS version counters (`casVersion`)
  - Key metadata (`kekId`, `keyVersion`, `schemaVersion`)
- **Not Owned**:
  - User profile data (owned by User Service / MongoDB ops)
  - OAuth authorization codes (ephemeral, owned by Auth Service)
  - Platform API client credentials (owned by Platform Config store)

## Failure Modes

| Failure | Impact | Mitigation |
|---|---|---|
| **KMS Unavailable** | Cannot encrypt new tokens or decrypt existing ones. Publishing and token refresh halt. | 1. Decrypted access tokens cached in Redis (short TTL) allow continued publishing briefly.<br>2. Auth Service queues token refresh jobs in Redis Streams for deferred retry.<br>3. Circuit breaker on KMS calls fails fast to avoid cascading latency across services. |
| **GCM IV Reuse** | Catastrophic confidentiality loss under the same DEK. | Enforce 96-bit CSPRNG IV per encryption. DEKs are unique per record, making collisions computationally infeasible. |
| **CAS Version Conflict** | Two concurrent refresh flows (e.g., scheduled job + user action) overwrite each other. | Auth Service implements idempotent refresh with jittered exponential backoff. Max 5 retries before surfacing a reconciliation alert. |
| **Ciphertext Tampering** | GCM authentication tag verification fails. | Vault rejects decryption and emits a security alert. Publisher Service treats this as an unrecoverable token error and triggers a user notification to reconnect the account. |
| **Memory Dump / Core Dump** | Plaintext tokens visible in Node.js heap during processing. | 1. Use `Buffer` for tokens and explicitly overwrite with zeros (`buffer.fill(0)`) after use.<br>2. Prohibit token logging via ESLint rules and runtime log sanitizers.<br>3. Node.js processes run in isolated containers with restricted shell and no core dump persistence. |

## Scaling Considerations
- **KMS Throughput**: Unwrapping a DEK on every token retrieval would saturate KMS at scale. Mitigation:
  - **DEK Unwrap Cache**: An in-memory LRU cache (max 1000 entries, 5-minute TTL) in each Token Vault instance caches unwrapped DEKs. Since DEKs are unique per record and immutable between rotations, this is safe and reduces KMS calls by ~85%.
  - **Access Token Cache**: Publisher Service caches decrypted access tokens in Redis (encrypted with the CEK) for up to 5 minutes, reducing vault read volume by an additional ~90%.
- **CPU Overhead**: AES-256-GCM is hardware-accelerated via AES-NI on modern x86_64 instances. Benchmarked overhead in the Node.js `crypto` module is <0.1 ms per encrypt/decrypt operation.
- **Storage Overhead**: Envelope encryption adds ~300 bytes per token record (wrapped DEK + IV + authTag + metadata). At 1 million connected accounts, this is approximately 300 MB—negligible against MongoDB cluster capacity.
- **Horizontal Scaling**: The Token Vault is stateless. Any instance can handle any request because all state resides in MongoDB and KMS. Services communicate with the vault via an internal load balancer backed by the Node.js/Express replicas.

## Related Diagrams
- `diagrams/0350/iter4_overview.mmd`