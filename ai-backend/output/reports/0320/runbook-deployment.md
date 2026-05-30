# Deployment Runbook

## Deployment Overview

This runbook covers the end-to-end provisioning, configuration, and release of the social media automation platform. The system consists of eleven backend services and two data stores, all deployed behind an Express.js API Gateway. The critical path for a successful release is: (1) establishing the MongoDB replica set and object storage, (2) initializing the encrypted Token Vault and rate-limiting schema, (3) deploying stateless core services, (4) bootstrapping Agenda.js job definitions in the Scheduler Service, and (5) validating OAuth flows and platform publishing end-to-end. This document assumes a containerized deployment orchestrated by Kubernetes or Docker Swarm, but the configuration variables apply equally to bare-metal or VM-based releases.

---

## Prerequisites & Dependencies

| Dependency | Minimum Version | Purpose |
|------------|----------------|---------|
| Node.js | 20 LTS | Runtime for all Express.js services |
| MongoDB | 6.0+ | Primary document database; **must run as a replica set** because Agenda.js relies on MongoDB's oplog and document-level locking for job queueing |
| Object Storage | S3 API compatible | Blob storage for original and transcoded media |
| Nginx / ALB | Latest | Edge load balancer and TLS termination for the API Gateway |
| OpenSSL | 3.0+ | Generating the Token Vault master key and JWT signing key pairs |

---

## Infrastructure Provisioning

1. **Network**
   - Create a dedicated VPC or private network segment.
   - Ensure all services can reach MongoDB on port `27017` and object storage on HTTPS (`443`).

2. **MongoDB Cluster**
   - Deploy a 3-node replica set. A single-node instance will cause Agenda.js to fail or deadlock under concurrency.
   - Enable authentication (`SCRAM-SHA-256`).
   - Create a single database (e.g., `social_automation`) with dedicated users for:
     - Application services (`readWrite`)
     - Agenda.js (`readWrite` on `social_automation.agendaJobs`)

3. **Object Storage**
   - Provision two distinct buckets or prefixes:
     - `raw-media-uploads`: Temporary landing zone for user uploads.
     - `processed-media-assets`: Final, platform-optimized files served to social APIs.
   - Configure CORS to allow presigned PUT from the web client and GET from platform connector webhooks if required.
   - Enable lifecycle rules to expire objects in `raw-media-uploads` after 7 days.

4. **Token Vault**
   - If using HashiCorp Vault: deploy in HA mode with auto-unseal (e.g., AWS KMS or cloud HSM).
   - If using a managed cloud secret manager (AWS Secrets Manager, GCP Secret Manager): provision the store and IAM roles before any service starts.

---

## Service Deployment Order

Deploy in five waves to respect initialization dependencies:

1. **Data Layer**
   - MongoDB replica set
   - Object Storage buckets
   - Token Vault / Secret Manager

2. **Schema & Policy Layer**
   - Rate Limiter (creates MongoDB collections/indexes)
   - Token Vault initialization (unseal, generate transit encryption key)

3. **Core Business Services**
   - `auth_service`
   - `user_service`
   - `media_service`
   - `post_service`
   - `notification_service`

4. **Integration & Job Layer**
   - `platform_connector`
   - `scheduler_service`

5. **Edge Layer**
   - `api_gateway`

---

## Configuration & Secrets Management

Each service consumes environment variables at startup. Do not commit values; inject via the Token Vault or secret manager.

### Global Secrets
| Secret | Consumers | Notes |
|--------|-----------|-------|
| `MONGODB_URI` | All services except Token Vault | Include `replicaSet` and `authSource` parameters |
| `OBJECT_STORAGE_ENDPOINT` | `media_service`, `platform_connector` | S3-compatible endpoint URL |
| `OBJECT_STORAGE_ACCESS_KEY` / `SECRET_KEY` | `media_service`, `platform_connector` | |
| `TOKEN_VAULT_ADDR` / `TOKEN_VAULT_TOKEN` | `auth_service`, `platform_connector` | |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | `auth_service`, `api_gateway` | RS256 key pair |
| `AGENDA_MONGO_COLLECTION` | `scheduler_service` | Default: `agendaJobs` |

### Service-Specific Configuration
- **`scheduler_service`**
  - `AGENDA_POOL_SIZE`: Number of concurrent jobs (default `20`). Tune based on platform rate limits.
  - `JOB_CREATION_LOCK_ID`: A static UUID used with a distributed lock (e.g., MongoDB unique index or Redis Redlock) so that only one replica creates recurring schedule definitions.
- **`media_service`**
  - `MAX_UPLOAD_SIZE_MB`: Hard limit enforced before streaming to object storage.
  - `FFMPEG_THREADS`: CPU thread cap for video transcoding containers.
- **`platform_connector`**
  - `OAUTH_REDIRECT_BASE_URL`: Must exactly match registered redirect URIs at each social platform (e.g., `https://api.example.com/v1/auth/callback`).
  - `PLATFORM_API_TIMEOUT_MS`: Default `30000`.
- **`rate_limiter`**
  - `RATE_LIMIT_WINDOW_MS`: Sliding window duration per platform (e.g., `900000` for 15-minute Twitter windows).
  - `RATE_LIMIT_COLLECTION`: MongoDB collection name for counters.

---

## Database Initialization

Run these steps **once** before the first service pod starts.

1. **Replica Set Initiation**
   ```javascript
   rs.initiate({
     _id: "rs0",
     members: [
       { _id: 0, host: "mongo-0:27017" },
       { _id: 1, host: "mongo-1:27017" },
       { _id: 2, host: "mongo-2:27017" }
     ]
   })
   ```

2. **Application Indexes**
   Execute via `mongosh` against the application database:
   ```javascript
   // user_service
   db.users.createIndex({ email: 1 }, { unique: true });
   db.users.createIndex({ "oauth_profiles.platform_id": 1, "oauth_profiles.platform": 1 });
   db.user_settings.createIndex({ user_id: 1 }, { unique: true });

   // post_service
   db.posts.createIndex({ user_id: 1, scheduled_at: -1 });
   db.posts.createIndex({ status: 1, scheduled_at: 1 }); // for querying pending publishes

   // media_service
   db.media.createIndex({ user_id: 1, created_at: -1 });
   db.media.createIndex({ storage_key: 1 }, { unique: true });

   // notification_service
   db.notifications.createIndex({ user_id: 1, read: 1, created_at: -1 });
   db.notifications.createIndex({ created_at: 1 }, { expireAfterSeconds: 2592000 }); // 30-day TTL

   // rate_limiter
   db.rate_limits.createIndex({ platform: 1, window_start: -1 });
   ```

3. **Agenda.js Collection**
   The `scheduler_service` creates the `agendaJobs` collection automatically on first start, but verify that the MongoDB user has `readWrite` privileges on it. No manual index creation is required; Agenda.js manages its own compound index on `{ name: 1, nextRunAt: 1, priority: -1, lockedAt: 1 }`.

---

## Object Storage & CDN Setup

1. **Bucket Policies**
   - `processed-media-assets`: Allow public read only if the platform connector requires direct CDN URLs. Otherwise, keep private and generate presigned GET URLs valid for 1 hour.
   - `raw-media-uploads`: Private. Presigned PUT URLs generated by `media_service` should expire after 15 minutes.

2. **CORS Configuration**
   ```xml
   <CORSConfiguration>
     <CORSRule>
       <AllowedOrigin>https://app.example.com</AllowedOrigin>
       <AllowedMethod>PUT</AllowedMethod>
       <AllowedMethod>GET</AllowedMethod>
       <AllowedHeader>*</AllowedHeader>
     </CORSRule>
   </CORSConfiguration>
   ```

3. **Lifecycle**
   - Transition raw uploads to infrequent access after 1 day, then delete after 7 days.
   - Retain processed assets indefinitely or archive to cold storage after 90 days based on compliance needs.

---

## Scheduler (Agenda.js) Bootstrap

The `scheduler_service` is the most sensitive deployment target because Agenda.js state lives in MongoDB and job processor definitions live in application memory.

1. **Job Definition Registration**
   On startup, the service must register handlers **before** calling `agenda.start()`:
   ```javascript
   agenda.define('prepare-media', { concurrency: 5 }, async (job) => { ... });
   agenda.define('publish-post', { concurrency: 2 }, async (job) => { ... });
   agenda.define('notify-failure', { priority: 10 }, async (job) => { ... });
   ```

2. **Singleton Recurring Job Creator**
   To prevent duplicate recurring jobs when scaling the `scheduler_service` horizontally, gate the `agenda.every()` calls behind a distributed lock:
   ```javascript
   // Pseudocode for startup
   const lock = await mongoDb.collection('scheduler_locks').findOneAndUpdate(
     { _id: 'recurring-job-definitions', lockedBy: null },
     { $set: { lockedBy: instanceId, lockedAt: new Date() } },
     { upsert: true }
   );
   if (lock) {
     await agenda.every('*/5 * * * *', 'health-check-jobs');
   }
   ```

3. **Graceful Shutdown**
   Configure the container's `preStop` hook to call `agenda.stop()` with a 30-second timeout so in-flight publishing jobs complete before the pod terminates.

---

## OAuth Application Registration

Before deploying `auth_service` and `platform_connector`, register OAuth 2.0 applications at each target social network.

| Platform | Required Redirect URI | Critical Scopes |
|----------|----------------------|-----------------|
| Instagram Basic Display / Graph API | `https://<api_gateway>/v1/auth/callback/instagram` | `instagram_basic`, `instagram_content_publish`, `pages_read_engagement` |
| Twitter / X | `https://<api_gateway>/v1/auth/callback/twitter` | `tweet.read`, `tweet.write`, `users.read`, `offline.access` |
| Facebook | `https://<api_gateway>/v1/auth/callback/facebook` | `pages_manage_posts`, `pages_read_engagement` |

Store the resulting `client_id` and `client_secret` in the Token Vault under the paths:
- `secret/platform/instagram/client-credentials`
- `secret/platform/twitter/client-credentials`
- `secret/platform/facebook/client-credentials`

---

## Deployment Verification

Execute this smoke test suite immediately after release.

1. **Health Checks**
   - `GET /health` on `api_gateway` → `200 OK`
   - `GET /health` on each downstream service via gateway → `200 OK`
   - MongoDB replica set status: `rs.status()` shows one primary and two secondaries.
   - Object storage: upload a 1 MB test blob via `media_service` presigned URL and verify retrieval.

2. **End-to-End Publishing Flow**
   - Register a test user via `auth_service`.
   - Link a sandbox social account through the OAuth flow; confirm tokens are encrypted in the Token Vault and referenced in MongoDB.
   - Create posting preferences in `user_service` (frequency: once, platform: sandbox target).
   - Upload a test image to `media_service`.
   - Compose a post in `post_service` scheduled 2 minutes in the future.
   - Confirm `scheduler_service` creates an Agenda.js job with `nextRunAt` populated.
   - Wait for execution; verify the post appears in the sandbox social account.
   - Verify `notification_service` emits a success event (check logs or webhook sink).

3. **Failure Injection**
   - Revoke the OAuth token externally and reschedule a post; confirm the job fails, the error is persisted in the job document, and `notification_service` triggers an alert.

---

## Rollback Procedures

| Failure Scenario | Rollback Action |
|------------------|-----------------|
| Critical bug in `platform_connector` | Revert container image to previous tag. Agenda.js jobs will retry automatically based on `failCount` and backoff settings. |
| Corrupt database migration or index | Restore MongoDB from pre-deployment snapshot. Re-run index creation script if reverting to an older schema version. |
| Token Vault seal or key rotation failure | Unseal Vault using shamir keys or restore from cloud auto-unseal. Restart all services to clear stale Vault tokens. |
| Scheduler logic error causing duplicate jobs | Stop `scheduler_service`, manually deduplicate `agendaJobs` by `name` + `data.user_id` + `data.post_id`, then restart. |
| Object storage permission change breaking uploads | Re-apply previous IAM policy or bucket ACL; no data loss if raw uploads are client-retryable. |

---

## Scaling Considerations

- **API Gateway**: Stateless; scale horizontally behind a load balancer. Use sticky sessions only if OAuth callback state validation is stored in local memory (recommended: use encrypted cookies or Redis instead, so no stickiness required).
- **Media Service**: CPU-bound during video transcoding. Scale based on container CPU > 70%. Consider dedicated nodes with higher CPU limits.
- **Scheduler Service**: Agenda.js supports multiple workers, but job creation logic (recurring schedules) should remain a singleton or use distributed locks. If job throughput exceeds 100 jobs/minute, shard by job type across separate Agenda.js instances.
- **Platform Connector**: Scale cautiously. Each platform replica consumes rate-limit quota from the shared `rate_limiter` MongoDB collection. Excessive replicas can cause lock contention on the rate-limit counters. Scale vertically first, then horizontally only if rate limits allow.
- **MongoDB**: The `agendaJobs` collection grows unbounded with job history. Create a nightly cron or TTL index to prune completed jobs older than 30 days. If the jobs collection exceeds 10 million documents, consider archiving to a separate cluster or S3 before pruning.
- **Object Storage**: No scaling limit, but monitor for hot partitions if using a single bucket prefix. Use UUIDv4 prefixes for keys to distribute load.

---

## Failure Modes & Mitigation

| Failure | Cause | Mitigation |
|---------|-------|------------|
| Agenda.js jobs never run | MongoDB deployed as standalone, not replica set | Enforce replica set mode; Agenda.js requires cluster-wide logical clocks for its locking protocol. |
| Jobs stuck in `lockedAt` state | `scheduler_service` pod killed mid-job | Agenda.js has a default lock timeout of 10 minutes. For long video processing, set `lockLifetime` to 5 minutes and call `job.touch()` periodically. |
| Token Vault unreachable | Network partition or seal event | All services must implement circuit-breaker logic on Vault requests. If Vault is down, `platform_connector` cannot decrypt OAuth tokens and should fail fast with `503` rather than hang. |
| Rate limit exceeded despite `rate_limiter` | Clock skew between service instances | Ensure NTP/chronyd is active on all nodes. Store rate-limit windows as absolute UTC timestamps in MongoDB. |
| Object storage URL expiration | Presigned GET for processed media expires before platform download | Set platform-connector presigned URL TTL to at least 1 hour, or re-generate URLs at publish time rather than at job creation time. |
| Notification loss | `notification_service` crash before SMTP send | Persist notification queue in MongoDB with a `processing` flag. Process notifications idempotently by `notification_id`. |

---

## Related Diagrams

- `diagrams/0320/iter1_overview.mmd` — System architecture overview showing all services, data stores, and their interconnections.