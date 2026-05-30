# Runbook: Media Processing Backlog

## Scope
This runbook covers detection, triage, and remediation of backlog events in the asynchronous media processing pipeline. It applies when the `media_processor` FFmpeg workers—running on CPU-optimized instances and consuming from the dedicated `redis_streams_queue`—fall behind scheduled SLA, causing delayed publishes to social platforms.

## Prerequisites
- `redis-cli` access to both `redis_streams_queue` and `redis_cache` clusters.
- `kubectl` access to the `media-processor` namespace and its CPU-optimized node pool.
- S3-compatible CLI (`aws s3api`) for `object_storage` bucket and multipart upload inspection.
- MongoDB shell access to `mongodb_ops` (read-only for triage; write access for recovery operations).
- Grafana dashboards: `Media Processor Lag`, `Redis Streams Consumer Groups`, `Object Storage Write Errors`.

## Detection & Alerting Criteria
Initiate this runbook if any of the following conditions persist for more than 5 minutes:
- `redis_streams_queue` consumer group `media-proc` pending count on stream `media:jobs` exceeds **5,000** messages.
- `media_processor` p99 job duration exceeds **15 minutes** for video transcoding jobs.
- `media_processor` HorizontalPodAutoscaler `desiredReplicas` equals `maxReplicas` (default **40**) for > 10 minutes.
- `object_storage` PUT 5xx error rate > **1%**, or `SlowDown` errors are logged by FFmpeg workers.
- `mongodb_ops` replication lag > **5 seconds**, causing job status updates to stall.

## Triage Procedure

### 1. Verify Queue State
Inspect the dedicated job stream on `redis_streams_queue`:
```bash
redis-cli -h $REDIS_STREAMS_HOST XINFO STREAM media:jobs
redis-cli -h $REDIS_STREAMS_HOST XPENDING media:jobs media-proc
```
Key fields to evaluate:
- `length`: Total unprocessed messages.
- `pending`: Delivered but unacknowledged messages.
- `last-generated-id` vs `entries-read`: A growing gap indicates the consumer group is falling behind.

### 2. Inspect Worker Health
```bash
kubectl get hpa media-processor -n processing
kubectl top pods -l app=media-processor -n processing
kubectl describe nodes -l nodepool=cpu-optimized | grep -A 5 "Allocated resources"
```
Check for:
- Pods in `CrashLoopBackOff` or `Evicted` (likely FFmpeg OOM or ephemeral storage pressure).
- CPU throttling despite running on CPU-optimized instances (indicates incorrect CPU limits in the pod spec).
- `/tmp` disk usage > 80% on worker nodes (FFmpeg intermediate files).

### 3. Classify the Bottleneck
- **CPU Bound**: FFmpeg processes at 100% of allocated cores; node CPU > 80%; job duration scales linearly with video bitrate.
- **I/O Bound**: High `object_storage` TTFB on PUT; FFmpeg logs indicate waiting on disk/network.
- **Queue Logic**: Per-user concurrency semaphore in `redis_cache` (`user:{userId}:media:concurrency`) is saturated for a small set of users, causing head-of-line blocking.
- **Poison Message**: A specific `jobId` appears in `XPENDING` with a high delivery count (> 5) and an `idle` time that resets briefly but never clears.

## Remediation Procedures

### Scale FFmpeg Workers Horizontally
The `media_processor` is horizontally scalable within its CPU-optimized node pool. Raise the HPA ceiling if the bottleneck is CPU:
```bash
kubectl patch hpa media-processor -n processing \
  --patch '{"spec":{"maxReplicas":60}}'
```
Constraints:
- Do not exceed the `object_storage` account-wide write TPS limit or per-prefix throughput limits.
- Ensure `redis_cache` connection pool (default **10,000** connections) is not exhausted; each `media_processor` pod maintains **20** persistent connections.
- Scaling is ineffective if the root cause is I/O saturation or `object_storage` rate limiting.

### Reclaim Stalled Jobs
Claim jobs that have been idle longer than the processing SLA (10 minutes):
```bash
redis-cli -h $REDIS_STREAMS_HOST XCLAIM media:jobs media-proc <consumer-name> 600000 <job-id>
```
If a job is unprocessable (e.g., missing or corrupt source object in `object_storage`):
1. Acknowledge it to remove from the pending queue:
   ```bash
   redis-cli -h $REDIS_STREAMS_HOST XACK media:jobs media-proc <job-id>
   ```
2. Write the `jobId` to the dead-letter stream:
   ```bash
   redis-cli -h $REDIS_STREAMS_HOST XADD media:jobs:dlq * jobId <job-id> reason CORRUPT_SOURCE
   ```
3. Update `mongodb_ops` in the `media_jobs` collection:
   ```javascript
   db.media_jobs.updateOne(
     { _id: ObjectId("<jobId>") },
     { $set: { status: "FAILED_DLQ", failedAt: new Date() }, $inc: { __v: 1 } }
   )
   ```

### Resolve Per-User Concurrency Head-of-Line Blocking
The `job_worker` enforces per-user limits via a sorted-set semaphore in `redis_cache`.
- Inspect active locks for a user:
  ```bash
  redis-cli -h $REDIS_CACHE_HOST ZRANGE user:{userId}:media:concurrency 0 -1 WITHSCORES
  ```
- If a single user's bulk submission is blocking the queue:
  - **Option A**: Temporarily raise the user's concurrency limit via the admin CLI endpoint `POST /admin/concurrency-limit/{userId}/override`.
  - **Option B**: Reprioritize the user's remaining jobs to the bulk stream `media:jobs:bulk`, which is consumed by a separate, lower-priority worker pool to protect the main pipeline.

### Refresh Expired Presigned URLs
`media_processor` workers fetch source-media presigned URLs from `redis_cache` (TTL **1 hour**). If a job stalls and the URL expires:
1. The worker detects a 403/404 on source fetch from `object_storage`.
2. The worker calls `POST /internal/media/refresh-url` on `media_service` with the `mediaId`.
3. `media_service` generates a new presigned URL, writes it to `redis_cache`, and returns the updated URL.
4. The worker resumes the FFmpeg transcoding step without requiring a full requeue.

### Handle Object Storage SlowDown
If `object_storage` returns HTTP 503 `SlowDown`:
1. Reduce per-worker upload concurrency by patching the `media_processor` deployment:
   ```bash
   kubectl set env deployment/media-processor FFMPEG_UPLOAD_CONCURRENCY=1 -n processing
   ```
2. Enable exponential backoff (base 2, max 60s) on S3 multipart upload retries in the worker config.
3. If sustained, pause non-critical job types (e.g., thumbnail generation) by filtering stream entries so only `jobType: PUBLISH_MEDIA` is processed.

## Failure Modes

### FFmpeg OOM During Transcode
- **Symptom**: Worker pod exits with code 137 during 4K or high-bitrate video jobs.
- **Root Cause**: FFmpeg memory usage exceeds the pod memory limit (default **4 Gi**).
- **Remediation**: Reschedule the specific job onto a high-memory CPU-optimized node (e.g., **16 Gi** limit). Cap FFmpeg threads to **2** (`-threads 2`) to limit memory parallelism. Update the job document in `mongodb_ops` to tag `requiresHighMem: true` so the `scheduler_service` routes similar future jobs to the high-memory pool.

### Redis Streams Consumer Group Rebalance Storm
- **Symptom**: `XPENDING` count increases despite new pods scaling in; `redis_streams_queue` CPU spikes from `XREADGROUP` commands.
- **Root Cause**: Rapid HPA scale-up causes continuous consumer group rebalancing as pods join and leave the group.
- **Remediation**: Ensure consumer groups are pre-created (`XGROUP CREATE` on stream initialization). Use deterministic consumer names based on pod IP. Set the worker idle timeout (`MEDIA_PROC_IDLE_TIMEOUT`) to **600 seconds** so transient disconnects do not trigger immediate rebalances.

### MongoDB Write Conflict on Status Update
- **Symptom**: `media_processor` logs `MongoWriteConflictException` when updating `media_jobs.status` from `PROCESSING` to `COMPLETED`.
- **Root Cause**: Contention between the transcoding worker, `scheduler_service` outbox pattern updates, and `job_worker` heartbeat writes.
- **Remediation**: Retry with exponential backoff using `findOneAndUpdate` with `__v` versioning. Use write concern `w: 1` for heartbeat updates; reserve `w: majority` only for final state transitions (`COMPLETED`, `FAILED_DLQ`).

### Orphaned Multipart Uploads
- **Symptom**: `object_storage` bucket size grows; incomplete multipart uploads accumulate.
- **Root Cause**: A `media_processor` worker crashes mid-upload.
- **Remediation**: Abort the specific multipart upload using the `uploadId` stored in `mongodb_ops` at `media_jobs.transcode.uploadId`. The bucket lifecycle policy auto-aborts incomplete uploads after **24 hours**, but manual cleanup prevents immediate cost impact.

## Scaling Considerations
- **CPU-Optimized Instances**: `media_processor` must run on dedicated-core instances (e.g., AWS c6i/c7i). Shared tenancy causes FFmpeg CPU contention and unpredictable transcoding duration.
- **Ephemeral Storage**: Each job requires up to **3x** the source file size in `/tmp` for intermediate segments. Worker nodes must have NVMe ephemeral volumes ≥ **100 GB**.
- **Redis Streams Memory**: Never store media binaries in `redis_streams_queue`. Stream entries must contain only `jobId`, `userId`, `sourceS3Key`, `targetFormat`, and `presignedUrlPointer`. Enforce `MAXLEN ~ 50000` to prevent unbounded Redis memory growth.
- **Worker Pool Isolation**: Keep `media_processor` workers physically separate from `job_worker` (publish orchestration) pods. FFmpeg CPU saturation must not starve the publish path, which relies on `publisher_service` and `platform_apis` latency.

## Post-Incident Verification
1. Confirm `XPENDING media:jobs media-proc` returns a value at or below baseline (**< 50**).
2. Verify `media_processor` p99 job duration returns to **< 5 minutes** for standard 1080p video.
3. Audit `mongodb_ops` `media_jobs` collection for any documents with `status: PROCESSING` and `updatedAt` older than 30 minutes; reconcile to `STALLED` and trigger the `scheduler_service` to requeue if necessary.
4. If the HPA `maxReplicas` was manually raised, reset it to the default (**40**).

## Related Diagrams
- `diagrams/0350/iter4_overview.mmd`