## component-token-vault

### Responsibilities
- **Encrypt Credentials at Rest**: Accept plaintext OAuth 2.0 access tokens, refresh tokens, and platform-specific API secrets from `auth_service` during account linking; encrypt each payload with AES-256-GCM and a unique data encryption key (DEK) before persisting the ciphertext.
- **Scoped Decryption for Publishing**: On request from `platform_connector`, decrypt and return plaintext credentials only for the exact `userId` + `platform` tuple requested, ensuring tokens are exposed solely at the moment of use.
- **Service-Identity Access Control**: Restrict all read/write operations to whitelisted internal callers (`auth_service`, `platform_connector`) enforced via mutual TLS (mTLS) and short-lived service-account JWTs.
- **Key Lifecycle & Rotation**: Maintain a registry of active and retired DEKs; support scheduled DEK rotation and asynchronous re-encryption of existing records without forcing users to re-authenticate.
- **Immutable Audit Logging**: Append an access-log entry for every storage, retrieval, update, and deletion event, capturing caller identity, target user/platform, operation type, timestamp, and outcome.

### APIs / Interfaces

The vault exposes an internal REST contract consumed over a private VPC/network by authorized backend services.

| Endpoint | Method | Authorized Caller | Purpose |
|---|---|---|---|
| `/v1/credentials` | `POST` | `auth_service` | Store newly encrypted credentials. |
| `/v1/credentials/:userId/:platform` | `GET` | `platform_connector` | Retrieve decrypted credentials for a publishing job. |
| `/v1/credentials/:userId/:platform` | `PATCH` | `auth_service` | Update credentials (e.g., after OAuth refresh-token exchange). |
| `/v1/credentials/:userId/:platform` | `DELETE` | `auth_service` | Permanently purge credentials on account unlink. |
| `/v1/admin/rotate` | `POST` | Admin / cron job | Trigger asynchronous DEK rotation and record re-encryption. |

**Request/Response Examples**

Store credentials:
```json
// POST /v1/credentials
{
  "userId": "usr_abc123",
  "platform": "instagram",
  "plaintext": {
    "accessToken": "EAAJ...",
    "refreshToken": "AQB...",
    "expiresAt": "2024-12-31T23:59:59Z"
  }
}

// 201 Created
{
  "credentialId": "cred_inst_usr_abc123",
  "dekId": "dek_2024_q4_07",
  "createdAt": "2024-03-20T14:00:00Z"
}
```

Retrieve credentials:
```json
// GET /v1/credentials/usr_abc123/instagram
// Headers: X-Caller-Service: platform_connector

// 200 OK
{
  "userId": "usr_abc123",
  "platform": "instagram",
  "plaintext": {
    "accessToken": "EAAJ...",
    "refreshToken": "AQB...",
    "expiresAt": "2024-12-31T23:59:59Z"
  },
  "dekId": "dek_2024_q4_07"
}
```

### Data It Owns

- **`credential_records`** — Per-user, per-platform encrypted documents containing:
  - `userId` (indexed) and `platform` (indexed)
  - `ciphertext` — AES-256-GCM encrypted token payload
  - `iv` — 16-byte initialization vector
  - `authTag` — 16-byte GCM authentication tag for integrity verification
  - `dekId` — reference to the DEK used for encryption
  - `version` — optimistic-locking integer to prevent stale overwrites during concurrent refreshes
  - `createdAt`, `updatedAt`, `expiresAt`

- **`key_registry`** — Envelope-encryption metadata:
  - `dekId` — unique identifier
  - `encryptedDek` — the DEK itself, encrypted by the platform master key
  - `status` — `active` | `rotating` | `retired`
  - `createdAt`, `rotatedAt`

- **`access_audit_log`** — Immutable append-only events:
  - `eventId`, `timestamp`, `callerService`, `callerIp`
  - `userId`, `platform`, `operation` (`STORE` | `RETRIEVE` | `UPDATE` | `DELETE`)
  - `success` boolean and optional `errorCode`

### Failure Modes

- **Master Key Provider Outage**  
  If the external KMS or HSM hosting the master key is unreachable, DEK unwrapping fails and all `GET` operations return `503 Service Unavailable`. `platform_connector` publish jobs must treat this as a non-retryable infrastructure failure for that window and surface it to the `notification_service`.

- **Optimistic Locking Conflict (Stale Refresh)**  
  During rapid OAuth refresh-token rotation, concurrent `PATCH` requests from `auth_service` may collide. The vault detects `version` mismatches and returns `409 Conflict`. Callers must re-fetch the latest record, merge the new token, and retry.

- **Ciphertext Tampering or Corruption**  
  Bit-rot or malicious modification causes AES-GCM auth-tag verification to fail. The vault returns `422 Unprocessable Entity`, emits a `SECURITY_ALERT`, and forces the user to re-link the account via `auth_service` because the tokens are unrecoverable.

- **Unauthorized Internal Enumeration**  
  A compromised internal service sweeping `GET` endpoints without valid mTLS/JWT claims is blocked at the network edge. Repeated violations trigger automatic IP blocking and on-call paging.

- **Memory Exposure of Plaintext**  
  Node.js `Buffer` objects holding decrypted tokens must be explicitly zeroed (`buf.fill(0)`) after the HTTP response is dispatched. Failure to do so leaves secrets in the V8 heap, increasing exposure if the process is dumped or inspected.

### Scaling Considerations

- **Decryption Burst Load**  
  `scheduler_service` dispatches hundreds of concurrent Agenda.js jobs during publishing windows, creating read spikes. The vault service tier must be stateless and horizontally scalable. CPU is the primary bottleneck due to AES-GCM operations; provision nodes with high CPU allocation and AES-NI hardware support.

- **KMS Rate-Limiting**  
  Unwrapping DEKs via the external master key for every read would exhaust KMS quotas. Instead, unwrap DEKs once per service instance startup and cache unwrapped DEKs in process memory for up to 5 minutes. New DEKs introduced after startup are unwrapped on first use.

- **Background Re-Encryption Load**  
  DEK rotation can generate heavy write I/O. Implement a batched, rate-limited worker that re-encrypts no more than 100 records per minute to avoid starving live traffic.

- **Storage Isolation**  
  Because `token_vault` declares no downstream dependencies, its persistence must reside on isolated volumes or a dedicated database cluster. Do not share connection pools with the application data tier to prevent noisy-neighbor issues.

- **Regional Deployment**  
  In multi-region setups, replicate the encrypted credential store so `platform_connector` instances decrypt tokens locally. Replicate the `key_registry` read-only; perform DEK creation and rotation in a single primary region to maintain consistency.