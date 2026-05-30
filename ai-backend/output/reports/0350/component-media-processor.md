## component-media-processor

### Responsibilities

- **CPU-bound transcoding**: Execute FFmpeg pipelines to convert raw photo and video uploads into platform-compliant renditions (e.g., H.264/MP4, AAC audio, resolution-specific crops).
- **Derivative generation**: Produce thumbnails, story-format crops, square crops, muted preview loops, and poster frames.
- **Technical metadata extraction**: Run `ffprobe` to capture codec, bitrate, duration, resolution, color space, and frame rate, storing structured output for downstream validation.
- **Job lifecycle management**: Maintain state machine transitions—`queued` → `downloading` → `transcoding` → `uploading` → `completed` / `failed`—updating MongoDB and Redis atomically.
- **Object Storage writes**: Persist processed artifacts to S3-compatible storage under deterministic keys (`processed/{tenantId}/{contentId}/{variant}.{ext}`).
- **Per-user concurrency enforcement**: Use Redis-backed distributed counters and locks to prevent a single user from monopolizing CPU workers.
- **Input sanitization**: Validate and sanitize media before FFmpeg ingestion to block exploit payloads (e.g., SSRF via HLS playlists, path traversal in metadata).
- **Progress streaming**: Publish real-time completion percentages to Redis for API Gateway WebSocket fan-out.

### APIs / Interfaces

- **Redis Streams Consumer**: Reads from `stream:media:processing` via `XREADGROUP` as part of consumer group `ffmpeg-workers`. Claims stalled messages with `XCLAIM` and acknowledges completed jobs with `XACK`.
- **FFmpeg Child Process Interface**: Spawns sandboxed FFmpeg processes with configurable `ulimit` timeouts (default 10 minutes). Communicates through local temp files and stderr capture.
- **Object Storage Sink**: S3-compatible SDK (`PutObject`, `CreateMultipartUpload`, `UploadPart`, `CompleteMultipartUpload`). Infers MIME types and sets cache-control headers per variant.
- **MongoDB Metadata Sink**: Atomic `findOneAndUpdate` operations on `content.assets` and `media_jobs` collections to append variant documents and update job status with optimistic locking (`version` field).
- **Redis Cache Interface**:
  - `SET media:job:{jobId}:status` with 24-hour TTL for transient state.
  - `INCR/DECR media:user:{userId}:concurrent` for slot accounting.
  - `SET media:job:{jobId}:lock` with 5-minute TTL and heartbeat renewal.
- **Progress Pub/Sub**: `PUBLISH media:progress:{jobId} {percent}` to Redis Pub/Sub channel.
- **Observability Endpoint**: Exposes `GET /healthz` (HTTP 200/503) and `/metrics` (Prometheus) on port `8080` for Kubernetes liveness/readiness probes.

### Data Owned

- **Ephemeral local scratch**: `/tmp/media-processor/{jobId}/` directories containing downloaded source files, intermediate frames, and output renditions. Lifecycle is strictly bound to the executing job; cleaned up via `finally` blocks and SIGTERM handlers.
- **Redis transient state**:
  - Job status and progress strings.
  - Distributed locks (`media:job:{jobId}:lock`).
  - Per-user concurrent job counters (`media:user:{userId}:concurrent`).
- **MongoDB `media_jobs` collection**: Canonical job records including input spec, output variant array, captured `ffprobe` JSON, FFmpeg stderr logs, retry count, failure reason, and final artifact pointers.
- **Object Storage `processed/` prefix**: Immutable output renditions. Media Processor is the sole writer for this prefix; ownership of the bucket is shared with the Object Storage service.

### Failure Modes

- **FFmpeg OOM / segfault**: Complex filtergraphs on high-resolution input can exhaust memory even on CPU-optimized instances. Mitigation: pre-validate resolution and bitrate via `ffprobe`; reject or pre-downscale before applying filters.
- **Poison messages / bad media**: Malformed files causing infinite hangs or repeated crashes. Mitigation: enforce strict input validation, max execution time (`ulimit -t`), and dead-letter to `stream:media:processing:dlq` after 3 failed attempts.
- **Disk pressure**: Concurrent 4K transcodes fill ephemeral volumes. Mitigation: disk-usage pre-check before accepting a job; aggressive cleanup on success/failure; cap concurrent jobs per instance based on `max_file_size * 2`.
- **Object Storage rate limiting**: S3 `503 Slow Down` on high-volume upload. Mitigation: SDK retry with exponential backoff and jitter; fallback to multipart upload for files > 100 MB; circuit breaker on persistent throttling.
- **Redis unavailability**: Worker cannot claim or acknowledge jobs. Mitigation: fail open with local backoff; do not process jobs without stream acknowledgement capability to prevent duplicate work.
- **Stale distributed locks**: Worker evicted by Kubernetes during a long transcode. Mitigation: lock TTL (5 min) shorter than pod termination grace period (30 s); background heartbeat renews lock every 30 s.
- **Platform codec mismatch**: Transcode succeeds but output violates target platform constraints (e.g., unsupported audio codec). Mitigation: maintain platform-specific encoding matrices and validate output specs before marking the job `completed`.

### Scaling Considerations

- **CPU-optimized node affinity**: Schedule pods exclusively on compute-optimized instance types (e.g., AWS c6i, GCP c2) with dedicated vCPUs. Use `nodeSelector` and taints to prevent co-location with memory or I/O-bound services.
- **Concurrency per pod**: Set `CONCURRENT_JOBS` to `CPU_CORES` during pure encode phases and `CPU_CORES * 1.5` during I/O-bound download/upload phases to maximize throughput without thrashing.
- **Stream sharding**: If a single Redis stream becomes a bottleneck, partition jobs by `contentId` hash across `media:processing:0`..`media:processing:N` streams and run independent consumer groups.
- **Autoscaling triggers**: Scale on custom metric `redis_streams_pending_messages` (threshold > 100 per consumer) combined with CPU > 80%. Avoid memory-based scaling for this workload.
- **Warm artifact pools**: Bundle FFmpeg binaries, font configs, and LUTs inside the container image to eliminate init-container latency. Avoid runtime downloads of codecs.
- **Cross-AZ traffic minimization**: Co-locate workers and Object Storage buckets in the same region and availability zone. Use VPC endpoints for S3 to bypass NAT gateway charges on large multipart uploads.
- **Orphaned artifact reconciliation**: Implement S3 lifecycle rules to abort incomplete multipart uploads after 1 day. Run a nightly reconciliation scanner against MongoDB `failed` jobs to delete orphaned `processed/` objects and reclaim storage.

## Related Diagrams

- `diagrams/0350/iter4_component-media-processor.mmd`