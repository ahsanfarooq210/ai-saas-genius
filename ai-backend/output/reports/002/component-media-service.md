# Media Service

## Responsibilities

The Media Service handles the ingestion, storage, optimization, and retrieval of all photo and video assets in the automation platform. Its core duties include:

- **Ingestion**: Accepting multipart uploads from clients (via API Gateway) and raw asset references from internal services (Content Service).
- **Storage Management**: Persisting original files in S3 and maintaining an immutable catalog of metadata and processed variants in MongoDB.
- **Platform Optimization**: Transcoding videos and resizing/compressing images to meet the format, dimension, bitrate, and duration constraints of each target social platform (e.g., Instagram Feed, Twitter/X, TikTok).
- **URL Provisioning**: Generating CDN-backed, public (or signed) URLs for downstream services—primarily Content Service and Publish Service—to embed in posts and API payloads.
- **Cleanup & Lifecycle**: Enforcing retention policies, deduplicating uploads via checksum, and removing orphaned S3 objects when a media record is deleted.

## APIs and Interfaces

### Client-Facing (via API Gateway)

- `POST /media/upload`
  - Accepts `multipart/form-data` with streaming file data.
  - Headers: `x-user-id`, `Content-Length`.
  - Returns `201 Created` with `{ mediaId, originalUrl, status: "uploaded" }`.
  - Enforces per-user file-size limits (images ≤ 20 MB, videos ≤ 1 GB) and MIME-type allowlists.

- `GET /media/:mediaId`
  - Returns the full metadata document, including original and variant CDN URLs.
  - Supports `?platform=` query param to filter variants (e.g., `?platform=instagram`).

- `DELETE /media/:mediaId`
  - Soft-deletes the MongoDB record and schedules S3 object removal via a background Agenda job.

### Internal Service Endpoints

- `POST /internal/media/:mediaId/process`
  - Called by Content Service or Job Service to trigger platform-specific optimization.
  - Body: `{ targetPlatforms: ["instagram", "twitter"], priority?: "high" | "normal" }`.
  - Returns `{ processingJobId }` immediately; processing is asynchronous.

- `GET /internal/media/:mediaId/status`
  - Used by Job Service to poll or verify that all requested variants are `ready` before scheduling a publish job.

### External Interfaces

- **S3 Storage** (AWS SDK v3)
  - `PutObject` / `CreateMultipartUpload` for original and processed writes.
  - `GetObject` for read-back during transcoding.
  - `DeleteObject` for lifecycle cleanup.

- **MongoDB** (Mongoose)
  - Primary write model for `media_assets` collection.
  - Read-heavy queries for CDN URL lookups and user media listings.

- **CDN**
  - Origin-pull from S3. The service constructs immutable public URLs (`https://cdn.example.com/{processedKey}`) and sets aggressive `Cache-Control` headers (`max-age=31536000, immutable`) on processed objects.

## Data Ownership

### MongoDB — `media_assets` Collection

```json
{
  "_id": ObjectId,
  "userId": ObjectId,
  "filename": "campaign_launch.mp4",
  "mimeType": "video/mp4",
  "status": "uploaded" | "processing" | "ready" | "failed",
  "checksum": "sha256:a1b2c3...",
  "original": {
    "s3Key": "originals/{userId}/{mediaId}/campaign_launch.mp4",
    "sizeBytes": 52428800,
    "width": 1920,
    "height": 1080,
    "duration": 45.2
  },
  "variants": [
    {
      "platform": "instagram",
      "purpose": "reel",
      "format": "mp4",
      "codec": "h264",
      "width": 1080,
      "height": 1920,
      "bitrateKbps": 3500,
      "s3Key": "processed/{userId}/{mediaId}/instagram-reel.mp4",
      "cdnUrl": "https://cdn.example.com/processed/...",
      "sizeBytes": 12582912,
      "createdAt": ISODate
    }
  ],
  "processing": {
    "requestedPlatforms": ["instagram"],
    "completedAt": ISODate,
    "error": null
  },
  "createdAt": ISODate,
  "updatedAt": ISODate,
  "ttlExpiresAt": ISODate
}
```

**Indexes**
- `{ userId: 1, createdAt: -1 }` — user media listings.
- `{ status: 1, "processing.requestedAt": 1 }` — worker polling for pending jobs.
- `{ checksum: 1 }` — duplicate detection.

### S3 Storage Layout

- **Originals**: `s3://bucket/originals/{userId}/{mediaId}/{filename}`
- **Processed Variants**: `s3://bucket/processed/{userId}/{mediaId}/{platform}-{purpose}.{ext}`
- **Thumbnails** (video): `s3://bucket/processed/{userId}/{mediaId}/{platform}-thumb.jpg`

## Failure Modes

| Failure | Cause | Mitigation |
|---|---|---|
| **Orphaned S3 Object** | MongoDB write fails after S3 upload succeeds. | Two-phase commit: write MongoDB doc with `status: "pending"` first, then upload to S3, then update to `"uploaded"`. A nightly sweeper deletes S3 objects with no matching MongoDB record. |
| **Corrupt/Unsupported Media** | Invalid codec, truncated file, or exotic container. | Validate MIME type and probe with FFmpeg/libvips before queuing. On error, set `status: "failed"`, capture stderr, and emit an event to Notification Service. |
| **Processing Timeout** | Video > 500 MB or high-resolution transcoding exceeds job TTL. | Job Service (Agenda) enforces a `lockLifetime` of 10 minutes for image jobs and 30 minutes for video jobs. After two retries, the job moves to a dead-letter collection and alerts the user. |
| **Memory Exhaustion** | Buffering an entire video file in the Node.js process. | Use Node.js streams for all upload, download, and transcoding pipelines. For video, spawn FFmpeg as a child process with file-descriptor pipes rather than in-memory buffers. |
| **Concurrent Duplicate Processing** | Content Service retries while a prior process job is still running. | Idempotency key based on `(mediaId, platform, purpose)`; subsequent requests return `200 OK` with the existing processing job ID. |
| **CDN Stale Cache on Reprocess** | Overwriting an S3 key in-place and serving old bytes. | Processed variants are immutable. Any reprocess generates a new S3 key with a timestamp or version slug, invalidating old CDN URLs naturally. |

## Scaling Considerations

- **Separate Compute Tiers**: The API layer (Express, metadata handling) should scale horizontally via pods/VMs independently from the processing workers. Video transcoding is CPU-bound and can starve HTTP handlers. Run Sharp image operations in worker threads or separate microservices, and offload heavy video transcoding to AWS Elemental MediaConvert or a dedicated FFmpeg farm.
- **Streaming & Multipart Uploads**: For videos approaching 1 GB, use S3 multipart upload with signed URLs so the client streams directly to S3, or proxy through the service using chunked streams. Never accumulate the full payload in memory.
- **Autoscaling Triggers**: HPA on API pods at 70 % CPU and 80 % memory. Worker pods scale on queue depth (Agenda job count for `media.process` jobs) rather than CPU, ensuring backlog does not overwhelm available transcoding capacity.
- **Database Hotspots**: High-volume users generating thousands of assets can create hot shards on `userId`. If MongoDB sharding is introduced, shard the `media_assets` collection by `userId` with zone sharding.
- **Storage Lifecycle**: Implement S3 Lifecycle rules to transition original files to Glacier after 30 days and delete failed multipart uploads after 1 day. Processed variants remain in Standard-IA for fast origin-pull.
- **Rate Limiting & Quotas**: While API Gateway provides coarse rate limiting, Media Service enforces per-user concurrent upload slots (max 3 simultaneous uploads) and daily processing minutes to prevent abuse of FFmpeg workers.

## Related Diagrams

No paired Mermaid diagram was provided for this document.