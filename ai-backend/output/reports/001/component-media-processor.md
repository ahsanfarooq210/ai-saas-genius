# Media Processor

## Responsibilities

The Media Processor is a background compute worker responsible for transforming raw user uploads into platform-ready media assets. Its specific duties include:

- **Video Transcoding** — Converting source videos to platform-compliant codecs (H.264 video / AAC audio in MP4 containers), adjusting bitrates, and enforcing maximum duration/file-size limits imposed by target social APIs.
- **Image Resizing & Formatting** — Generating platform-specific variants (e.g., Instagram 1080×1080 square, Twitter 1200×675 landscape, TikTok 1080×1920 vertical) using Sharp or GraphicsMagick, and converting to optimal formats (JPEG, PNG, WebP).
- **Compression & Optimization** — Applying quality settings and chroma subsampling to reduce payload size without breaching platform minimum quality thresholds.
- **Thumbnail Generation** — Extracting keyframe thumbnails for video previews and generating reduced-resolution placeholders.
- **Integrity Validation** — Running `ffprobe` on video sources and header validation on images to detect corruption before processing begins.
- **Caption/Overlay Rendering** — Optionally burning user-defined captions, watermarks, or safe-zone padding into image/video frames when configured in user preferences.
- **Artifact Persistence** — Storing processed files in `media_storage`, promoting them to the `cdn`, and recording canonical metadata in MongoDB so downstream publishers can reference them by URL.
- **Status Reporting** — Updating the parent Agenda.js job state (processed, failed, retried) and emitting structured logs for the `job_scheduler` and `notification_service`.

## APIs / Interfaces

The Media Processor does not expose public REST endpoints. All interaction is through internal interfaces:

### Input: Agenda.js Job Consumer
The worker polls MongoDB via Agenda.js for jobs of type `media.process`. The job payload includes:

```json
{
  "jobId": "agenda_job_uuid",
  "userId": "user_uuid",
  "originalMediaKey": "users/{userId}/uploads/{filename}",
  "mediaType": "image|video",
  "mimeType": "video/mp4",
  "targetPlatforms": ["instagram", "twitter", "tiktok"],
  "preferences": {
    "imageQuality": 85,
    "videoMaxBitrate": "5000k",
    "aspectRatioOverride": "1:1",
    "generateThumbnail": true,
    "burnCaptions": false
  }
}
```

### Output: Downstream Systems
- **Media Storage** — Writes processed variants to paths like `processed/{jobId}/{platform}/{filename}` via the blob storage SDK.
- **CDN** — Triggers cache upload/invalidation and retrieves public HTTPS URLs for each variant.
- **MongoDB** — Upserts documents in the `processed_media` collection with artifact metadata and CDN pointers.
- **Job Scheduler** — Calls Agenda.js `done()` or `fail()` on the job record, optionally scheduling a follow-up `publish` job via the scheduler’s internal queue API.

### Internal Control
- **Health Probe** — If deployed with a sidecar or lightweight HTTP wrapper, exposes `GET /health` returning `200 OK` and current queue backlog depth for orchestrator readiness checks.
- **Metrics Endpoint** — Optionally exposes Prometheus-style metrics (`media_jobs_total`, `media_processing_duration_seconds`, `media_failed_jobs`) on a private port for monitoring.

## Data Owned

The Media Processor owns the derived artifact metadata in MongoDB. It does **not** own original upload blobs (stored in `media_storage`) or user preference records (owned by `user_service`).

### `processed_media` Collection (MongoDB)
| Field | Type | Description |
|-------|------|-------------|
| `_id` | ObjectId | Unique identifier for the processed artifact record. |
| `jobId` | String | Agenda.js job UUID linking back to the scheduling record. |
| `userId` | ObjectId | Reference to the user. |
| `originalMediaKey` | String | Blob path to the unmodified source file. |
| `status` | String | `processing`, `completed`, `failed`. |
| `variants` | Array | Platform-specific outputs: `{ platform, format, width, height, storageKey, cdnUrl, sizeBytes, checksum }`. |
| `thumbnail` | Object | `{ storageKey, cdnUrl, width, height }` for video previews. |
| `processingStartedAt` | Date | Timestamp when the worker picked up the job. |
| `processingCompletedAt` | Date | Timestamp when all variants were persisted. |
| `durationMs` | Number | Wall-clock processing time for metrics. |
| `errorLog` | String | stderr capture from FFmpeg/Sharp on failure; null on success. |

### Ephemeral Local State
During active transcode, temporary files are written to a local scratch directory (e.g., `/tmp/media-worker/{jobId}/`). These files are strictly ephemeral and purged immediately after successful CDN upload or on job failure.

## Failure Modes

| Failure | Cause | Mitigation |
|---------|-------|------------|
| **Unsupported Codec** | Source video uses a codec (e.g., AV1, ProRes) that the pipeline cannot transcode. | Fail fast after `ffprobe` inspection; notify user via `notification_service` to re-upload in a supported format. |
| **Corrupt Source File** | Truncated upload or broken container headers. | Validate before transcoding; abort job and flag `originalMediaKey` for manual review. |
| **Processing Timeout** | FFmpeg hangs on malformed frames or extreme resolutions. | Enforce per-job wall-clock timeouts (120s images, 600s videos). Kill child process; Agenda.js retries with exponential backoff (max 3 attempts). |
| **Out of Memory (OOM)** | In-process decoding of 4K video or high-resolution burst images exhausts the Node.js heap. | Spawn FFmpeg and Sharp as external child processes, not native bindings in the main event loop. Container memory limits set to 4GiB+ with swap disabled to fail fast. |
| **Disk Exhaustion** | Multiple concurrent large video transcodes fill local ephemeral storage. | Monitor `/tmp` usage; limit concurrent jobs per worker based on scratch space (reserve 2× largest expected source file per active job). |
| **CDN Upload Failure** | Network partition or 5xx from CDN provider during PUT. | Retry upload up to 3 times with exponential jitter. If all retries fail, mark job failed but retain processed file in `media_storage` for manual recovery. |
| **Stale Job Lock** | Worker process crashes mid-transcode, leaving the Agenda.js job locked. | Agenda.js lock timeout (default 10 minutes) auto-releases the job; idempotency enforced via deterministic `processed_media` record upserts to prevent duplicate variants. |
| **Platform Spec Mismatch** | User settings request an unsupported combination (e.g., 60fps for a platform capped at 30fps). | Validate preferences against platform rule map before enqueueing; if invalid, fail immediately with a structured error code. |

## Scaling Considerations

- **Compute-Bound Isolation** — Media processing is CPU- and I/O-intensive. Workers must run on dedicated nodes or compute-optimized containers (e.g., AWS `c6i` or GCP `c2`) physically separate from the API Gateway and web-tier services.
- **Worker Concurrency Limits** — Cap concurrent jobs per instance to prevent resource contention. Recommended limits: 2–3 video jobs or 10–15 image jobs per worker, enforced via Agenda.js `lockLimit` and local semaphore.
- **Queue Segregation** — Maintain separate Agenda.js queues (`media.process.image` and `media.process.video`) so video workers can scale independently from lightweight image workers based on queue depth metrics.
- **Horizontal Pod Autoscaling** — Scale workers on custom metrics (Agenda.js queue depth or CPU > 70%). Stateless design allows rapid scale-out; ensure `media_storage` and MongoDB connection pools can absorb the added workers.
- **Connection Pool Pressure** — Each Agenda.js worker maintains persistent MongoDB connections for job locking. Size the MongoDB `maxPoolSize` to `(video_workers + image_workers) × 2` to avoid connection exhaustion.
- **Local Storage Provisioning** — Ephemeral volumes should be high-IOPS SSDs sized to 3× the largest expected source file per max concurrent job. Avoid network-attached storage for scratch to reduce I/O latency during FFmpeg operations.
- **Graceful Shutdown** — On `SIGTERM`, finish the active frame encode (if within a 30-second grace period) or kill the child process and release the Agenda.js lock so another worker can resume immediately.
- **CDN Rate Limiting** — Implement upload throttling (e.g., max 50 PUTs/minute per worker) to respect CDN provider API limits during bulk batch processing.

## Related Diagrams

- Component diagram: `diagrams/001/iter1_component-media-processor.mmd`