# ADR-002: Data Storage Strategy

## Status
Accepted

## Context
The social media automation platform must persist:
- User identity and nested posting preferences (platforms, frequencies, captions, hashtags, time windows).
- OAuth tokens and refresh tokens for connected social accounts.
- Job definitions, schedules, and execution state for Agenda.js background workers.
- Original and processed photo/video binaries.
- Published post metadata and platform engagement analytics.

The backend is Node.js/Express. All components require low-latency access to structured data, while media binaries require high-throughput object storage and CDN delivery.

## Decision
We will adopt a **polyglot persistence model** with MongoDB as the primary operational database and dedicated blob storage for media binaries.

1. **MongoDB** is the sole primary database. It stores all relational and document-oriented data: users, preferences, tokens (encrypted at the application layer), job state, post metadata, and analytics.
2. **Agenda.js** will use the same MongoDB cluster for its job queue collections (`agendaJobs`). This eliminates the operational burden of a separate message broker or queue database.
3. **Blob storage** (e.g., S3-compatible object store) will back the `media_storage` component. MongoDB will store only lightweight media metadata (storage keys, MIME types, processing variants, CDN URLs).
4. **CDN** will serve processed media to social platform APIs and public consumers; no media is served directly from blob storage or the API gateway.
5. **Application-layer encryption** for OAuth tokens: the `token_store` will encrypt `access_token` and `refresh_token` fields before writing to MongoDB and decrypt them on read. MongoDB will only see ciphertext.

## Consequences

- **Operational simplicity**: One primary database cluster to monitor, back up, and replicate.
- **Schema flexibility**: MongoDB documents accommodate heterogeneous platform preferences without migrations.
- **Agenda.js coupling**: Job queue throughput is bounded by MongoDB write capacity. Heavy job churn can pressure the same cluster serving API requests.
- **16 MB document limit**: By offloading media binaries to blob storage, we avoid BSON size limits and keep documents small.
- **Encryption key management**: Token security depends on key rotation and access control outside MongoDB.

## Data Ownership by Component

| Component | MongoDB Collections / Data | Blob Storage Paths | Notes |
|---|---|---|---|
| `auth_service` | `users` (hashed passwords, emails, profile data) | — | Owns identity root documents. |
| `token_store` | `platform_tokens` (encrypted `access_token`, `refresh_token`, `expiry`, `platform`, `user_id`) | — | Encryption/decryption logic lives in this service. |
| `user_service` | `user_preferences`, `platform_settings` (frequency rules, caption templates, hashtag sets, timezone, active hours) | — | Deeply nested documents; indexed by `user_id`. |
| `job_scheduler` | `agendaJobs` (Agenda.js-managed), `job_audit` (high-level lineage, `status`, `nextRunAt`, `failCount`) | — | `agendaJobs` is managed by the Agenda.js library directly. |
| `media_processor` | `media_assets` (`storage_key`, `cdn_url`, `variants`, `format`, `resolution`, `processing_status`, `user_id`) | `/originals/{userId}/{uuid}`<br>`/processed/{userId}/{uuid}/{variant}` | Writes binaries to blob storage; persists metadata to MongoDB. |
| `platform_publisher` | `published_posts` (`post_id`, `platform_post_id`, `published_at`, `media_refs`, `job_id`, `platform`) | — | Reads `cdn_url` from `media_assets` and tokens from `token_store`. |
| `analytics_collector` | `post_metrics`, `job_stats` (impressions, likes, shares, engagement rate, `collected_at`) | — | High-write collections; use unordered bulk inserts and TTL indexes. |
| `notification_service` | — | — | Stateless; no persistent storage owned. |

## Storage Interfaces & Contracts

### MongoDB Access
All Node.js services interact with MongoDB through Mongoose models. Shared connection pooling is configured at the process level with `maxPoolSize` tuned per service role.

```javascript
// Example: token_store interface
interface TokenStore {
  async storeTokens(userId: string, platform: string, tokens: OAuthTokens): Promise<void>;
  async getValidToken(userId: string, platform: string): Promise<DecryptedTokens>;
}
```

### Blob Storage Access
`media_processor` uses an S3-compatible SDK. The contract requires:
- **Write**: Upload original and processed variants; return `storage_key` and `cdn_url`.
- **Read**: `platform_publisher` and CDN consumers use the `cdn_url` recorded in `media_assets`; they never generate presigned URLs at publish time to avoid latency.

### Agenda.js Job Collection
`job_scheduler` defines jobs via `agenda.define()` and persists schedules via `agenda.schedule()`. The library directly reads/writes the `agendaJobs` collection. No other service writes to this collection.

## Failure Modes & Mitigations

| Failure | Impact | Mitigation |
|---|---|---|
| **MongoDB primary failover** | API writes stall; Agenda.js pauses job processing until replica set elects a new primary. | Use `retryWrites=true` and `w=majority` for critical paths. API requests should fail fast with `503` if MongoDB is unreachable. |
| **AgendaJobs collection bloat** | Completed job documents accumulate, degrading schedule query performance. | Nightly purge of Agenda.js completed jobs older than 30 days. Archival to `job_audit` if historical traceability is required. |
| **Blob storage unavailability** | `media_processor` cannot write processed files; downstream publish jobs fail. | Jobs transition to `failed-media-storage` state and retry with exponential backoff (max 6 hours). Originals remain in blob storage; idempotent re-processing is safe. |
| **Token decryption failure** | `platform_publisher` cannot authenticate to social APIs. | Versioned encryption keys. On `DecryptionError`, invalidate the token record and trigger a re-authentication notification via `notification_service`. |
| **Analytics write pressure** | Bulk ingestion of engagement metrics causes MongoDB CPU spikes. | Unordered bulk writes with `ordered: false`. Offload aggregation queries to secondary nodes (`readPreference: 'secondary'`). |
| **Large preference documents** | Unbounded caption/hashtag arrays approach the 16 MB BSON limit. | Application-level validation caps array lengths; split preference sets into referenced sub-documents if user-defined content grows. |

## Scaling Considerations

- **MongoDB Sharding**: Shard `media_assets`, `platform_tokens`, and `published_posts` by `user_id` to distribute write load evenly. Avoid sharding the `agendaJobs` collection under Agenda.js; instead, scale job workers horizontally against the same jobs database or partition tenants across independent Agenda.js MongoDB databases if queue throughput becomes a bottleneck.
- **Read Replicas**: Route analytics reporting and `job_audit` historical lookups to secondary nodes to spare the primary.
- **Blob Storage**: Enable multi-region replication if the user base is global. Store media in the region closest to the majority of a user’s target platforms to reduce egress latency.
- **CDN Immutability**: Processed media URLs must include a content hash or processing timestamp (e.g., `/processed/{userId}/{uuid}/{variant}-{timestamp}.mp4`). URLs are treated as immutable; updates generate new keys rather than overwriting existing objects. This eliminates cache invalidation storms.
- **Indexing Strategy**:
  - `platform_tokens`: `{ user_id: 1, platform: 1 }` (unique).
  - `media_assets`: `{ user_id: 1, processing_status: 1 }`, `{ storage_key: 1 }`.
  - `published_posts`: `{ job_id: 1 }`, `{ user_id: 1, published_at: -1 }`.
  - `post_metrics`: `{ post_id: 1, collected_at: -1 }` with a TTL index on `collected_at` for raw events (retain 90 days; aggregated metrics kept indefinitely).

## Related Diagrams

- `diagrams/001/iter1_overview.mmd`