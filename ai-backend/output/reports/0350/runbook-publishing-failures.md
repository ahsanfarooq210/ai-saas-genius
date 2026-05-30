# Runbook: Publishing Failures

## Scope
This runbook covers the automated content publishing pipeline from job creation in `scheduler_service` through execution by `agenda_worker`, media retrieval via `media_service`, credential resolution from `token_store`, and final dispatch by `publisher_service` to external `platform_apis`. It applies to failures detected in Agenda.js job state, platform API errors, media unavailability, and duplicate or missing posts.

---

## Failure Taxonomy

### 1. Scheduling Layer Failures
- **Job Creation Failure**: `scheduler_service` fails to insert an Agenda job into MongoDB due to a schema validation error or a replica set failover. Symptom: user preference change does not result in a new document in the `agendaJobs` collection within 60 seconds.
- **Stuck Job Locks**: An `agenda_worker` process crashes or is SIGKILLed after acquiring a job lock. Symptom: the job document shows `lockedAt` older than 10 minutes and `lastFinishedAt` is not updated, with no active worker processing it.
- **Lost Job Execution**: Agenda’s `processEvery` interval is too long or MongoDB polling misses a `nextRunAt` window due to clock skew. Symptom: `nextRunAt` is in the past and `lastRunAt` never updates.

### 2. Media & Content Assembly Failures
- **Expired Pre-Signed URL**: `media_service` generated an object storage URL with a 15-minute expiry, but the `agenda_worker` executes the job after delay or retry. Symptom: `publisher_service` receives a 403/404 from the media URL when attempting to read the stream or pass it to a platform.
- **Incomplete Upload**: The user upload stream terminated before `object_storage` confirmed the object. Symptom: `media_service` metadata record exists with `processingStatus: 'pending'` but the `storageKey` is absent or zero-byte in object storage.
- **Null Content Payload**: `content_service` returns an empty caption or hashtag array due to a template rendering bug. Symptom: `publisher_service` dispatches a post missing required text fields, causing platform API rejection (e.g., Instagram Graph API `caption` required).

### 3. Identity & Credential Failures
- **Expired or Revoked OAuth Token**: The refresh token in `token_store` was revoked by the user or expired past the refresh window. Symptom: `publisher_service` receives HTTP 401/403 and the internal token refresh call returns `invalid_grant`.
- **Decryption Failure**: `token_store` cannot decrypt the credential blob because the `ENCRYPTION_KEY` environment variable was rotated without a re-encryption migration. Symptom: `publisher_service` throws a decryption exception before any outbound network call.
- **Scope Reduction**: The user removed a permission (e.g., Instagram `instagram_content_publish`) after connection. Symptom: platform API returns OAuth scope errors mid-publish.

### 4. Execution & Platform Failures
- **Rate Limiting**: `platform_apis` return HTTP 429. Twitter/X, LinkedIn, and Facebook Graph API use different windowing (15-min vs daily). Symptom: `publisher_service` logs 429 with no `Retry-After` or variable headers.
- **Platform Degradation**: Timeouts >30s from Instagram Graph API during container creation. Symptom: `publisher_service` Node.js HTTP client aborts with `ETIMEDOUT`; the job is marked failed but the platform may have partially created the media object.
- **Multi-Step Publish Partial Failure**: Instagram requires `media_container` creation followed by `media_publish`. If step 1 succeeds but step 2 fails, the container ID is orphaned. Symptom: retry attempts create duplicate containers unless the ID is reused.
- **Idempotency Collision**: `publisher_service` retries a job after a MongoDB write concern timeout, but the platform already accepted the first request. Symptom: duplicate posts appear on the user’s timeline.

### 5. Infrastructure & Database Failures
- **Missing Agenda Index**: MongoDB lacks a compound index on `{ nextRunAt: 1, lockedAt: 1, disabled: 1 }`. Symptom: `agenda_worker` CPU spikes polling the collection and job throughput drops to near zero.
- **Write Concern Timeout**: `agenda_worker` finishes publishing and updates the job document with `lastFinishedAt`, but the MongoDB primary steps down. Symptom: the job is re-executed by another worker because the lock release was not durably recorded.
- **Object Storage Egress Limit**: Cloudflare R2 or S3 bucket policy throttles read requests during a burst. Symptom: `media_service` returns 503/429 to `publisher_service`, cascading into job failure.

---

## Detection & Alerting

| Alert Name | Source / Query | Threshold |
|---|---|---|
| `agenda_job_failures` | `db.agendaJobs.countDocuments({ failCount: { $gt: 0 }, lastFinishedAt: { $gte: ... } })` | > 0 in 5 min |
| `agenda_stuck_locks` | `db.agendaJobs.countDocuments({ lockedAt: { $lt: new Date(Date.now() - 10*60*1000) } })` | > 0 |
| `publisher_4xx_rate` | `publisher_service` logs grouped by `platform`, `statusCode` 400-499 | > 1% of requests |
| `publisher_429_rate` | `publisher_service` logs `statusCode: 429` | > 5% of requests |
| `media_url_404` | `media_service` or `object_storage` access logs `status: 404` for presigned GET | > 0 |
| `token_refresh_fail` | `auth_service` logs `error: 'invalid_grant'` | > 0 in 15 min |

Log correlation: All `publisher_service` outbound requests must emit a `requestId` shared with `agenda_worker` job `attrs._id` so that a single job failure can be traced through `scheduler_service` -> `agenda_worker` -> `publisher_service` -> `platform_apis`.

---

## Diagnostic Procedures

### Step 1: Locate the Failed Job
```javascript
// MongoDB shell against the application database
db.agendaJobs.findOne(
  { _id: ObjectId("<jobId from alert>") },
  { name: 1, data: 1, failReason: 1, failCount: 1, lockedAt: 1, lastRunAt: 1, lastFinishedAt: 1 }
)
```
- If `failReason` exists, read the stack trace to identify the layer (media, token, platform).
- If `lockedAt` is stale and `lastFinishedAt` is older, the worker died mid-flight.

### Step 2: Verify Media Readiness
```javascript
// Check media metadata
db.media.findOne({ _id: ObjectId("<mediaId from job.data.mediaId>") })

// Verify object existence (via media_service internal health endpoint or direct storage head request)
curl -I "<presignedUrl from job.data.mediaUrl>"
```
- If the HEAD returns 403/404, the URL expired or the upload is incomplete.

### Step 3: Verify Token State
```javascript
db.tokens.findOne(
  { userId: "<job.data.userId>", platform: "<job.data.platform>" },
  { encryptedBlob: 0 } // exclude sensitive payload
)
```
- Check `expiresAt`. If `expiresAt` is in the past and `refreshToken` is null or marked invalid, the connection is dead.

### Step 4: Inspect Platform Interaction
In `publisher_service` logs, filter by `requestId`:
```json
{ "service": "publisher_service", "requestId": "<jobId>", "platform": "instagram", "statusCode": 429, "responseBody": "...", "url": "https://graph.facebook.com/v18.0/..." }
```
- Record `statusCode`, `responseBody`, and any `Retry-After` header value.

---

## Mitigation & Recovery

### Recover Stuck Locks
If the worker pod/container is confirmed dead (not in `kubectl get pods` or ECS task list):
```javascript
db.agendaJobs.updateOne(
  { _id: ObjectId("<jobId>"), lockedAt: { $lt: new Date(Date.now() - 15*60*1000) } },
  { $set: { lockedAt: null, lastFinishedAt: new Date(), failReason: "Recovered from stuck lock by runbook" } }
)
```
Then allow Agenda to re-pick it up, or manually re-enqueue:
```javascript
await agenda.now('publish-post', job.data);
```

### Regenerate Expired Media URLs
Do not retry with the stale URL. Call `media_service` to create a new pre-signed URL and spawn a replacement job:
```javascript
const newUrl = await mediaService.getPresignedUrl(mediaId, { expirySeconds: 3600 });
await agenda.cancel({ _id: jobId }); // prevent duplicate if original is still scheduled
await agenda.now('publish-post', { ...job.data, mediaUrl: newUrl });
```

### Handle Token Expiration
If `auth_service` token refresh returns `invalid_grant`:
1. Update `user_service` account connection record: `connectionStatus: 'disconnected'`, `lastError: 'token_revoked'`.
2. Cancel all pending Agenda jobs for that `(userId, platform)` to avoid noise:
   ```javascript
   await agenda.cancel({ 'data.userId': userId, 'data.platform': platform });
   ```
3. Emit a user-facing notification via the notification queue; do not auto-retry publishing.

### Rate Limit Backoff
When `publisher_service` receives HTTP 429:
1. Parse `Retry-After` (seconds). If present, compute `nextRunAt = now + Retry-After * 1000`.
2. If absent, apply exponential backoff based on `failCount`: `delay = Math.pow(5, failCount) * 60 * 1000` ms, capped at 6 hours.
3. Update the job document directly:
   ```javascript
   db.agendaJobs.updateOne(
     { _id: jobId },
     { $set: { nextRunAt: new Date(Date.now() + delay), lockedAt: null } }
   );
   ```
4. If `failCount >= 3`, move the job to a quarantine collection `quarantined_jobs` for manual review and cancel the original.

### Multi-Step Publish Recovery (Instagram)
Store the container ID in `job.data.containerId` immediately after step 1 succeeds:
```javascript
// On retry, publisher_service checks:
if (job.data.containerId) {
  await instagramApi.publishContainer(userId, job.data.containerId);
} else {
  const containerId = await instagramApi.createContainer(...);
  await agendaJobs.updateOne({ _id: jobId }, { $set: { 'data.containerId': containerId } });
  await instagramApi.publishContainer(userId, containerId);
}
```

### Prevent Duplicate Posts
Enforce an idempotency key in `publisher_service`:
- Generate `idempotencyKey = jobId + '_' + failCount` before each platform request.
- Persist the successful platform post ID in `db.publishedPosts` with a unique index on `(jobId, platform)`:
  ```javascript
  db.publishedPosts.createIndex({ jobId: 1, platform: 1 }, { unique: true });
  ```
- On job start, if a `publishedPosts` record exists for this `jobId` and `platform`, mark the job complete immediately (no-op).

---

## Scaling Considerations

- **Agenda.js Polling Bottleneck**: Default `processEvery: 5000` limits job pickup to roughly one scan every 5 seconds. At scale, reduce to `processEvery: 1000` and ensure the MongoDB compound index on `{ nextRunAt: 1, lockedAt: 1, disabled: 1 }` is in RAM. If throughput exceeds ~50 jobs/sec, shard the `agendaJobs` collection or run multiple Agenda instances with distinct `collection` names partitioned by user segment.
- **Worker Lock Confusion**: When scaling `agenda_worker` horizontally, ensure each instance has a unique `process.env.WORKER_ID` passed to Agenda’s `name` option. Without this, monitoring cannot distinguish which worker owns a lock.
- **Per-User Rate Limit Serialization**: Platform limits are often per-user. Distributing a single user’s jobs across many `publisher_service` instances can cause self-throttling. Use a consistent hash (e.g., `userId % N`) to route all jobs for a given user to the same worker partition, or implement a Redis token bucket per `(platform, userId)` before dispatch.
- **Object Storage URL Strategy**: Pre-signed URLs shift expiry risk to the job queue. For high-volume accounts, stream media directly from `object_storage` through `media_service` to the platform API using chunked upload buffers, eliminating URL expiry entirely. Monitor egress costs; if platforms support media ingestion by URL (e.g., Twitter `media_url`), use a CDN-backed public URL with a long cache TTL instead of short-lived presigned URLs.
- **MongoDB Growth**: Completed Agenda jobs are never deleted by default. Deploy a nightly cron that calls `agenda.purge({ completedBefore: new Date(Date.now() - 7*24*60*60*1000) })` or use a TTL index on `lastFinishedAt` for documents where `failCount: 0` to prevent unbounded collection growth.

---

## Related Diagrams

- `diagrams/0350/iter1_overview.mmd`