# Media Service

The Media Service handles ingestion, validation, storage, and platform-specific optimization of photos and videos for the social automation platform. It acts as the single source of truth for all binary content, ensuring that every file is safe, correctly formatted, and pre-sized for its target social network before publication.

## Responsibilities

- **Ingestion & Validation**
  - Accept uploads via multipart streams or presigned URL callbacks from the API Gateway.
  - Enforce file-type restrictions (JPEG, PNG, MP4, MOV), maximum file sizes (e.g., 100 MB video, 8 MB image), and container sanity checks.
  - Strip EXIF GPS and camera metadata to prevent unintentional data leakage.
  - Generate SHA-256 checksums to detect corruption and deduplicate storage.

- **Metadata Extraction**
  - Extract image dimensions, color profiles, and video duration, resolution, frame rate, and codec information using Sharp/libvips and FFmpeg.
  - Store extracted metadata in MongoDB for fast querying without touching object storage.

- **Platform-Specific Processing**
  - Transcode videos to platform-safe codecs (H.264 + AAC in MP4) and constrain bitrates to match Instagram, Twitter, Facebook, and TikTok requirements.
  - Resize and crop images to target aspect ratios (e.g., Instagram 4:5 or 1:1, Twitter 16:9) while preserving focal points.
  - Generate video thumbnails and low-resolution preview variants.
  - Produce alt-text-ready image descriptors where supported.

- **Storage Management**
  - Persist original files and processed variants in the S3-compatible object storage backend.
  - Enforce per-user storage quotas by aggregating `sizeBytes` in MongoDB before accepting new uploads.
  - Issue time-limited presigned URLs for downstream services (Post Service, Platform Connector) instead of proxying bytes through Node.js.

- **Lifecycle & Cleanup**
  - Run scheduled Agenda.js jobs (`media:cleanup`) to purge orphaned temp files, soft-deleted media, and expired draft assets.
  - Maintain TTL indexes on temporary upload records in MongoDB to auto-expire incomplete ingestion sessions.

## APIs and Interfaces

### Internal REST Endpoints
Exposed to the API Gateway and sibling services over the internal VPC/network.

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/internal/media/upload` | Stream or register a completed upload; returns `mediaId`. |
| `GET` | `/internal/media/:mediaId` | Retrieve metadata, variant list, and presigned download URLs. |
| `DELETE` | `/internal/media/:mediaId` | Soft-delete a media record and queue its objects for removal. |
| `POST` | `/internal/media/:mediaId/process` | Trigger platform-specific transcoding/resizing for a list of target platforms. |
| `GET` | `/internal/media/:mediaId/variants/:variant` | Redirect to a presigned URL for a specific processed variant. |

### Programmatic Service Interface
Used by the Scheduler and Post Services via direct module import or internal HTTP client.

```typescript
interface MediaService {
  uploadMedia(
    stream: Readable,
    metadata: { userId: string; filename: string; contentType: string }
  ): Promise<MediaDocument>;

  processMedia(
    mediaId: string,
    targets: Array<{ platform: string; maxWidth: number; maxHeight: number; maxDurationSec?: number }>
  ): Promise<Variant[]>;

  getPresignedUrl(
    mediaId: string,
    variant: 'original' | string,
    expirySeconds: number
  ): Promise<string>;

  deleteMedia(mediaId: string, permanent?: boolean): Promise<void>;
}
```

### Job Handlers (Agenda.js)
The service defines and consumes the following background job definitions:

- **`media:process`** — Picked up by dedicated worker pods. Performs CPU-heavy transcoding and resizing, then updates the MongoDB record status to `ready`.
- **`media:cleanup`** — Daily sweep that hard-deletes object storage blobs for records marked `deleted` > 7 days and removes temp uploads that never reached `validated`.

## Data Ownership

### MongoDB Collections

**Collection: `media`**
Each document represents a single uploaded asset.

| Field | Type | Description |
|---|---|---|
| `_id` | `ObjectId` | Primary identifier referenced by Post and Scheduler services. |
| `userId` | `ObjectId` | Owner reference; indexed for quota aggregation. |
| `status` | `String` | Enum: `pending`, `validated`, `processing`, `ready`, `failed`, `deleted`. |
| `original` | `Object` | `storageKey`, `mimeType`, `sizeBytes`, `sha256`, `width`, `height`, `durationSec`. |
| `variants` | `Array` | Objects containing `platform`, `storageKey`, `format`, `width`, `height`, `sizeBytes`, `bitrate`. |
| `uploadedAt` | `Date` | Index for TTL expiration of temp records. |
| `lastAccessedAt` | `Date` | Used to LRU-evict cold preview variants from edge caches. |

### Object Storage Layout
Keys are prefixed to support lifecycle rules and per-user billing analytics.

```
users/{userId}/media/{mediaId}/original.{ext}
users/{userId}/media/{mediaId}/variants/{platform}-{width}x{height}.{ext}
users/{userId}/media/{mediaId}/thumbnails/{sec}-poster.{ext}
```

## Failure Modes

| Failure | Impact | Mitigation |
|---|---|---|
| **Corrupt or unsupported codec** | FFmpeg/Sharp crashes during processing. | Wrap processing in subprocess sandboxes with timeouts; on failure, mark record `failed` and emit an event to the Notification Service. |
| **Object storage outage or 5xx** | Upload or variant write fails. | Retry with exponential backoff inside the Agenda job; after 3 attempts, surface failure to the Scheduler so the publish job can be rescheduled. |
| **Storage quota exceeded** | New uploads rejected, user experience degraded. | Pre-check aggregate `sizeBytes` per `userId` before stream consumption; return `413 Payload Too Large` or `402 Quota Exceeded`. |
| **Concurrent processing race** | Two workers process the same `media:process` job, wasting CPU and creating duplicate variants. | Rely on Agenda.js job locking (`unique` job constraints) and idempotent storage keys (deterministic variant filenames). |
| **Large video timeout** | Transcoding exceeds the default Node/Agenda job timeout. | Set per-job TTLs proportional to file duration (e.g., `max(5 min, duration * 3)`); offload work to external transcoders if latency grows. |
| **Orphaned temp uploads** | User abandons upload mid-stream; storage leaks. | Apply a 24-hour MongoDB TTL index on `status: pending` and a matching S3 lifecycle rule on the temp prefix. |

## Scaling Considerations

- **CPU-Bound Workload Isolation** — Video transcoding and batch image resizing must run on dedicated worker nodes (separate from the Express API Gateway pods). Autoscale these workers based on Agenda queue depth, not HTTP request rate.
- **Lazy vs. Eager Variant Generation** — For posts scheduled far in the future, defer `media:process` until `T-minus 30 minutes` to avoid storing unused variants. For immediate posts, process eagerly.
- **Presigned URL Offloading** — Never proxy media bytes through the Media Service in production. Generate presigned GET/PUT URLs and let clients and Platform Connectors talk directly to object storage.
- **Horizontal Read Scaling** — MongoDB metadata queries are indexed by `userId` and `status`; they are lightweight. If read load grows, add secondary read replicas for the `media` collection.
- **Storage Tiering** — Move original files to infrequent-access storage after 30 days, keeping only hot variants on standard tier, since originals are rarely re-processed.
- **Noisy-Neighbor Throttling** — Cap concurrent `media:process` jobs per `userId` to prevent a single heavy uploader from monopolizing the worker pool.

## Related Diagrams

- Component diagram: `diagrams/0320/iter1_component-media-service.mmd`