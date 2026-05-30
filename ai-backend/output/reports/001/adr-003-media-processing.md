# ADR-003: Media Processing Strategy

## Status
Accepted

## Context
The social media automation platform must ingest user-generated photos and videos, normalize them for five distinct target platforms (Instagram, Twitter/X, Facebook, TikTok, LinkedIn), and deliver them reliably at scheduled publish times. Platform constraints vary significantly: Instagram requires specific aspect ratios and video codecs, TikTok enforces 9:16 vertical formats, and LinkedIn prefers high-resolution landscape images. Upload sizes range from 2 MB JPEGs to 500 MB 4K video files. Synchronously processing these files inside the Express API Gateway would block the Node.js event loop, risk HTTP timeouts, and couple binary data to the application database. A dedicated, decoupled media processing strategy is required to ensure throughput, durability, and platform compliance without compromising API responsiveness.

## Decision
We will implement a dedicated **`media_service`** that owns the entire media ingestion, validation, transformation, and delivery lifecycle.

- **Upload Path**: Clients upload media via the API Gateway to the `media_service`. The service streams bytes directly to S3-compatible **object_storage** using multipart uploads for files > 100 MB. It never buffers complete video files in the Node.js heap.
- **Metadata Registry**: The `media_service` persists asset metadata, processing state, and derived variant references in **MongoDB** via a `MediaAsset` collection.
- **Transformation**: CPU-bound work—thumbnail generation (Sharp for images, FFmpeg for video frames), format validation, and optional down-scaling—is executed by the `media_service` using Node.js worker threads and spawned child processes. This work is intentionally *not* routed through the platform's Agenda.js job queue to avoid serializing large binary payloads through MongoDB.
- **Delivery**: Processed assets and thumbnails are served through a CDN backed by object storage. The `content_service` and `publisher_service` reference stable CDN URLs stored in the `MediaAsset` document, eliminating the need for them to stream bytes through the application layer.
- **Cleanup**: A TTL-based lifecycle policy in object storage archives raw originals after 90 days, while the `media_service` runs a nightly MongoDB query against `expiresAt` indexes to delete orphaned metadata and trigger hard deletes in object storage.

## Responsibilities

- **Ingestion**: Accept multipart/form-data uploads, enforce per-file type size limits (images ≤ 20 MB, videos ≤ 500 MB), and verify magic numbers before streaming to object storage.
- **Validation**: Reject unsupported codecs (e.g., AV1 for Instagram pre-2024 compatibility) and malformed files before processing begins.
- **Transformation**: Generate 256×256 WebP thumbnails for images, 720p MP4 (H.264/AAC) proxies for videos, and platform-specific variants only when required by the publisher.
- **State Management**: Track processing lifecycle (`pending` → `processing` → `ready` / `failed`) in MongoDB and emit domain events consumed by the `content_service` to unblock draft publishing.
- **Quota Enforcement**: Enforce per-user storage caps by aggregating `sizeBytes` from the `MediaAsset` collection.
- **Secure Delivery**: Generate time-limited, signed CDN URLs for private previews and permanent public CDN URLs for published content.

## APIs and Interfaces

### Public REST API (via API Gateway)
| Endpoint | Method | Description |
|---|---|---|
| `/api/v1/media` | `POST` | Initiates upload. Returns `mediaId`, `uploadUrl` (presigned PUT), and `expectedMd5`. |
| `/api/v1/media/:mediaId` | `GET` | Returns metadata: `cdnUrl`, `thumbnailCdnUrl`, `dimensions`, `duration`, `processingStatus`. |
| `/api/v1/media/:mediaId` | `DELETE` | Soft-deletes metadata and schedules object storage cleanup. |

### Internal Interfaces
- **`media_service` → `object_storage`**: S3 SDK `PutObject`, `GetObject`, `DeleteObject`, and multipart `CreateMultipartUpload` operations. Bucket prefix: `/{userId}/{mediaId}/`.
- **`media_service` → `mongodb`**: CRUD on `MediaAsset` documents; indexes on `{ ownerId: 1, processingStatus: 1 }` and `{ expiresAt: 1 }`.
- **`content_service` → `media_service`**: Synchronous validation call (`HEAD /internal/media/:mediaId`) to verify `processingStatus === 'ready'` before attaching a media reference to a post draft.
- **`publisher_service` → `object_storage`**: Reads finalized bytes directly from CDN at publish time using the `cdnUrl` stored in the post draft; no direct coupling to `media_service`.

## Data Ownership

### MongoDB (`media_service` schema)
The `MediaAsset` collection is owned exclusively by `media_service`:

```javascript
{
  _id: ObjectId,
  ownerId: ObjectId,          // Indexed
  filename: String,
  mimeType: String,           // e.g., "video/mp4"
  sizeBytes: Number,
  storageKey: String,         // S3 key: "{userId}/{mediaId}/original.mp4"
  cdnUrl: String,
  thumbnailKey: String,
  thumbnailCdnUrl: String,
  dimensions: { width: Number, height: Number },
  duration: Number,         // Seconds, for video
  processingStatus: String,   // Enum: pending | processing | ready | failed
  platformVariants: [{ platform: String, storageKey: String, cdnUrl: String }],
  checksum: String,           // SHA-256 of original
  createdAt: Date,
  expiresAt: Date             // TTL index for draft-stage cleanup
}
```

### Object Storage
- **Originals**: `/{userId}/{mediaId}/original.{ext}`
- **Thumbnails**: `/{userId}/{mediaId}/thumb.webp`
- **Platform Variants**: `/{userId}/{mediaId}/variants/{platform}.{ext}`

Object storage owns the bytes; `media_service` owns the pointers and metadata.

## Failure Modes

| Failure | Impact | Mitigation |
|---|---|---|
| **Object storage partition outage** | New uploads fail; scheduled posts with ready media are unaffected due to CDN caching. | API returns `503 Service Unavailable` with `Retry-After: 300`. Client-side exponential backoff. |
| **FFmpeg/Sharp process crash** | Asset stuck in `processing` state; user draft cannot be published. | Worker thread crash is caught by parent process. Document transitions to `failed`. A compensating job (run via `scheduler_service` / `agenda_worker`) retries processing up to 3 times, then notifies the user via `notification_service`. |
| **Corrupted or malicious file** | Processing worker hangs or produces invalid output. | Magic-number validation at ingress. FFmpeg/Sharp executed in resource-constrained child processes (ulimit memory, CPU affinity). Timeout kill after 5 minutes. |
| **Client upload timeout** | Partial object written to S3, leaving orphaned multipart upload. | `media_service` initiates multipart uploads with 7-day expiration. A daily S3 batch abort job cleans incomplete uploads with no matching `MediaAsset` record. |
| **CDN cache poisoning/staleness** | Updated replacement media served with old thumbnail. | Storage keys are content-addressed (`{mediaId}-{sha256}.webp`). URLs are immutable; updates generate new keys and atomically update the `cdnUrl` in MongoDB. |

## Scaling Considerations

- **API Gateway / Media Service Ingress**: Stateless Express containers scale horizontally based on HTTP request rate. For video uploads, the service returns presigned S3 URLs so large payloads bypass application servers entirely, reducing network ingress costs and memory pressure.
- **Processing Workers**: CPU-intensive transformation is isolated to dedicated Node.js worker threads and external binary processes. In Kubernetes, these run in the same pod as the Express container (sidecar pattern) but on dedicated CPU-requested containers. If queue depth exceeds 100 pending assets, an HPA scales pod replicas based on a custom `media_processing_queue_depth` metric.
- **Object Storage**: Uses provider-native multipart parallelism (e.g., AWS S3 Transfer Acceleration). No application-level sharding is required.
- **Database**: The `MediaAsset` collection is read-heavy during draft editing and write-heavy during bulk imports. A compound index on `{ ownerId: 1, createdAt: -1 }` supports user gallery pagination. For deployments exceeding 10 million active users, the collection is sharded by `ownerId`.
- **Cost Optimization**: Platform-specific variants (e.g., TikTok 9:16, Instagram 4:5) are generated lazily by the `publisher_service` at publish time for users on the standard tier, and eagerly by the `media_service` only for high-volume enterprise tiers, trading latency for storage cost.

## Related Diagrams
- `diagrams/001/iter1_overview.mmd`