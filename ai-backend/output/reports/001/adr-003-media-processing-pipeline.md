# ADR-003: Media Processing Pipeline

## Status
Accepted

## Context
The social media automation platform must ingest user-uploaded photos and videos, transform them into platform-compliant formats, and deliver them to external social media APIs at scheduled times. Each target platform enforces distinct media requirements—such as Instagram’s 1080×1080 image limit, Twitter’s 1200×675 card preference, TikTok’s 9:16 vertical video constraint, and varying video codec support. Without a dedicated pipeline, publishing logic would need to handle transcoding, resizing, and format validation inline, introducing unpredictable latency and high failure rates during the critical publish window.

## Decision
Adopt a dedicated, asynchronous media processing pipeline that decouples ingestion, optimization, and delivery. The pipeline consists of four architectural elements:

1. **media_storage**: Immutable blob storage for original uploads and processed artifacts.
2. **media_processor**: Stateless background workers that consume Agenda.js jobs to transcode, resize, and optimize media per target platform.
3. **cdn**: Public edge cache for serving finalized assets to `platform_publisher` APIs.
4. **mongodb**: Canonical store for media metadata, variant indexes, and job state tracking.

The pipeline follows a **write-once, process-many** model. Original files are preserved indefinitely as the source of truth. Processed variants are generated eagerly after upload or at schedule time, cached in blob storage, and invalidated only when user preferences change or the original is deleted.

## Responsibilities

### Ingestion & Storage
- Accept original uploads via pre-signed URLs that allow direct browser-to-blob uploads, bypassing the Node.js API Gateway for large binaries.
- Store originals under deterministic paths: `/{userId}/{mediaId}/original.{ext}`.
- Record immutable metadata in MongoDB through the `user_service`: MIME type, original dimensions, file size, SHA-256 checksum, and upload timestamp.

### Processing
- Consume `process-media` Agenda.js jobs queued by the `job_scheduler`.
- Generate per-platform variants based on the user’s configured `platform_publisher` targets:
  - **Images**: resize to platform-specific dimensions, compress to quality 85 (JPEG), convert to WebP when supported, strip EXIF metadata, and apply optional user-configured watermarks.
  - **Videos**: transcode to H.264/AAC MP4 (baseline for universal compatibility), constrain bitrate to platform limits (e.g., 5 Mbps for Instagram, 25 Mbps for Twitter), adjust aspect ratio via letterboxing or cropping based on user preference, generate thumbnail posters, and enforce maximum duration splits if needed.
- Write processed outputs to `media_storage` under `/{userId}/{mediaId}/processed/{platform}/{variant}.{ext}`.
- Update the corresponding job document in MongoDB with variant CDN URLs, dimensions, file size, codec, and checksum.

### Delivery
- All processed variants are fronted by the `cdn`. The `platform_publisher` never accesses `media_storage` directly; it receives CDN URLs in the publish job payload.
- Original files are never exposed publicly; they remain internal source assets for re-processing if requirements change.

## APIs and Interfaces

### Job Scheduler → Media Processor
Agenda.js job definition `process-media`:
```json
{
  "name": "process-media",
  "data": {
    "jobId": "550e8400-e29b-41d4-a716-446655440000",
    "userId": "user-123",
    "mediaId": "media-456",
    "sourcePath": "s3://media-storage/user-123/media-456/original.mov",
    "targets": ["instagram", "twitter", "tiktok"],
    "scheduleId": "sched-789",
    "options": {
      "watermark": true,
      "captionOverlay": null,
      "videoBitrateCap": 5000000
    }
  }
}
```

### Media Processor → Media Storage
Blob storage interface via S3-compatible SDK:
- `putObject(Bucket, Key, Body, ContentType, Metadata)` for writing processed variants.
- `getObject(Bucket, Key)` for reading originals into temporary processing volumes.
- Key convention for outputs: `processed/{platform}/{mediaId}-{variant}.{ext}`.

### Media Processor → MongoDB
Updates the `MediaJobs` collection:
```javascript
{
  jobId: UUID,
  status: 'processing' | 'completed' | 'failed',
  variants: [
    {
      platform: 'instagram',
      cdnUrl: 'https://cdn.example.com/user-123/media-456/processed/instagram/primary.jpg',
      width: 1080,
      height: 1080,
      sizeBytes: 245000,
      checksum: 'sha256:abc123...',
      format: 'jpeg'
    }
  ],
  errorCode: 'INVALID_CODEC' | 'TIMEOUT' | null,
  errorLog: 'ffmpeg exited with code 1...',
  startedAt: ISODate,
  completedAt: ISODate
}
```

### Platform Publisher → CDN
The `platform_publisher` receives a publish job containing an array of `{ platform, cdnUrl, format }`. For platforms that accept remote URLs (e.g., Facebook Graph API, Twitter media upload init with URL), the publisher passes the CDN URL directly. For platforms requiring multipart upload, the publisher streams the binary from the CDN URL into the platform API request without persisting it locally.

## Data Ownership

| Data | Owner | Storage | Retention Policy |
|------|-------|---------|------------------|
| Original media files | `media_storage` | Blob store (S3-compatible) | Retained until user deletion + 30-day soft-delete grace period |
| Processed variants | `media_storage` | Blob store | 90 days after successful publish; deleted immediately if processing fails and user does not retry within 7 days |
| Media metadata, variant index, processing state | `mongodb` (written by `media_processor` and `user_service`) | `media` and `mediaJobs` collections | Aligned with user account lifecycle; anonymized 30 days after account deletion |
| CDN access logs | `cdn` provider | Edge logs | 30 days for operational debugging |

## Failure Modes

### Ingestion Failures
- **Large file timeout**: Direct-to-storage uploads mitigate API Gateway 30-second timeouts. If pre-signed URL generation fails due to IAM or bucket policy errors, the upload is rejected with HTTP 503 and the user is prompted to retry.
- **Corrupted or malicious original**: Format validation and malware scanning run before processing. Failures set `MediaJobs.status = 'failed'` with `errorCode: 'INVALID_FORMAT'` and trigger the `notification_service` to alert the user.

### Processing Failures
- **Memory exhaustion during video transcode**: FFmpeg processing of 4K or long-duration videos can exhaust a standard worker. Mitigation: enforce a 1080p input limit for automated jobs; run video jobs on a dedicated worker pool with 8 GB RAM and a concurrency of 2 per instance; enforce a hard Agenda.js job timeout of 30 minutes for video and 5 minutes for images.
- **Unsupported codec**: If FFmpeg cannot decode the source (e.g., AV1, ProRes), the job fails with `errorCode: 'INVALID_CODEC'`. The user must re-upload in H.264/MOV or MP4.
- **Disk pressure**: Workers use ephemeral `/tmp` volumes. Each job cleans its working directory in a `finally` block. If disk usage exceeds 85%, the worker pod is terminated and the job is re-queued to a healthy instance.

### Storage and Delivery Failures
- **Blob store unavailability**: The `media_processor` retries S3 writes with exponential backoff (3 attempts, 1s/5s/25s). Persistent failures dead-letter the job and page on-call.
- **CDN cache miss at publish time**: If a variant was written but the CDN edge returns 404 when the `platform_publisher` accesses it, the publisher implements a retry loop (3 attempts, 60-second backoff) before failing the publish job.

### Publishing Failures
- **Platform rejects processed media**: Even optimized media may violate platform policies (e.g., copyrighted audio detection, aspect ratio changes after platform policy updates). The `platform_publisher` records the failure to the `analytics_collector` and `notification_service`. No automatic media re-processing is attempted because the content itself is invalid.

## Scaling Considerations

### Worker Scaling
- `media_processor` workers are stateless and horizontally scalable behind an Agenda.js MongoDB-backed queue.
- Segregate job queues by workload to prevent video jobs from starving image jobs:
  - `process-image`: 2 vCPU / 4 GB workers, concurrency 20 per instance.
  - `process-video`: 4 vCPU / 8 GB workers, concurrency 2 per instance; GPU-accelerated instances (e.g., AWS EC2 G4dn) optional for high-volume TikTok/Reels transcoding.
- Auto-scale based on Agenda.js queue depth: scale out when `process-video` queue depth > 10 or `process-image` > 50.

### Storage Scaling
- `media_storage` leverages object storage with automatic tiering. Originals transition to infrequent-access storage after 30 days.
- Processed variants are high-churn; a lifecycle rule deletes them 90 days after publish to control costs. If a user reschedules a re-publish of the same media, the pipeline regenerates the variant on demand.

### Database Scaling
- Required MongoDB indexes:
  - `media.userId`: 1 — for user gallery queries.
  - `mediaJobs.status`: 1, `mediaJobs.nextRunAt`: 1 — for Agenda.js polling.
  - `mediaJobs.mediaId`: 1 — for processor status lookups.
  - `mediaJobs.errorCode`: 1 — for operational dashboards.
- If daily `mediaJobs` volume exceeds 1 million, shard the collection by `userId` to distribute Agenda.js lock contention.

### CDN Scaling
- The CDN is externally managed and scales automatically.
- Use filename-based cache busting (`primary-v2.jpg`) rather than query strings to maximize edge cache hit ratios and avoid stale content during re-processing.

## Related Diagrams
- `diagrams/001/iter1_overview.mmd`