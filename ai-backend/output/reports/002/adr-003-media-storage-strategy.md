# ADR-003: Media Storage Strategy

## Status
Accepted

## Context
The social media automation platform must durably store, transcode, and deliver user-generated photos and videos. Media requirements include:
- **High-resolution originals** uploaded by users (up to 4K video and RAW photos).
- **Platform-optimized derivatives** (e.g., Instagram 1080×1080, TikTok 9:16 vertical video, LinkedIn horizontal carousel images).
- **Scheduled access patterns**: Assets may be created hours or days before an Agenda.js job triggers publication.
- **Global delivery**: Processed assets must be accessible by external Platform APIs with low latency and high availability.
- **Cost control**: Storage and egress costs must be predictable in a multi-tenant environment.

The architecture already defines a `Media_Service`, `S3_Storage`, `CDN`, and `MongoDB`. This ADR specifies how these components interact to fulfill the above requirements.

## Decision
We will implement a **dual-bucket S3 object store with CDN acceleration and MongoDB metadata authority**. All media mutations are gated through the Media Service; no client or downstream service interacts directly with S3 except via time-limited presigned URLs.

### Storage Tiers

| Bucket | Purpose | Storage Class | Lifecycle |
|--------|---------|---------------|-----------|
| `s3://<env>-media-raw` | Original uploads exactly as received from users | S3 Standard → IA after 30 days | Transition to Glacier after 90 days; delete after 1 year |
| `s3://<env>-media-processed` | Transcoded videos, resized images, platform-specific renditions | S3 Standard | Delete 7 days after the associated post's published date; delete abandoned/failed uploads after 24 hours |

**Rationale**: Separating raw and processed data allows independent lifecycle policies, cost optimization, and permission boundaries. Processed assets are ephemeral relative to originals because they can be re-generated deterministically from raw sources.

### Metadata Authority
MongoDB owns the canonical metadata schema for every media object. The `Media_Service` maintains a `media` collection with documents shaped as:

```javascript
{
  _id: ObjectId("..."),              // mediaId
  userId: ObjectId("..."),
  jobId: ObjectId("..."),            // originating Agenda.js job
  status: "pending|processing|ready|failed|deleted",
  original: {
    s3Key: "raw/user-123/uuid-original.mp4",
    etag: "\"abc123...\"",
    sizeBytes: 15728640,
    mimeType: "video/mp4",
    checksum: "sha256:..."
  },
  variants: {
    "instagram-feed": {
      s3Key: "processed/user-123/uuid-1080x1080.mp4",
      cdnUrl: "https://cdn.example.com/processed/user-123/uuid-1080x1080.mp4",
      width: 1080, height: 1080,
      sizeBytes: 4194304
    },
    "tiktok": { /* ... */ }
  },
  createdAt: ISODate("..."),
  expiresAt: ISODate("...")          // TTL index for automatic cleanup
}
```

**Immutability convention**: Once a processed variant is written, its S3 key and CDN URL never change. If re-processing occurs, a new variant entry with a new UUID is appended; old variants are garbage-collected asynchronously.

### Processing Pipeline
1. **Upload**: API Gateway returns a presigned S3 PUT URL (valid 15 minutes) via `Media_Service`. The client uploads directly to the raw bucket.
2. **Registry**: On upload initiation, `Media_Service` writes a MongoDB record with `status: "pending"` and enqueues an Agenda.js job (`media.process`) in `Agenda_Queue`.
3. **Transcode**: A worker node running `Job_Service` pulls the job. It streams the raw object from S3 through FFmpeg/Sharp, writes variants to the processed bucket, and updates MongoDB with `status: "ready"` and CDN URLs.
4. **Publish**: When `Publish_Service` executes a post, it reads the CDN URL from MongoDB via `Content_Service` and passes it to the external `Platform_APIs`.
5. **Cleanup**: A nightly Agenda.js reconciliation job compares MongoDB `expiresAt` with S3 inventory lists and deletes orphaned objects.

### APIs and Interfaces

**Media Service (Internal REST API)**
- `POST /media/presigned-upload` — Returns `{ uploadUrl, mediaId, s3Key }` for direct-to-S3 PUT.
- `GET /media/:mediaId` — Returns full metadata including all variant CDN URLs. Cached in `Redis_Cache` for 5 minutes.
- `POST /media/:mediaId/process` — Re-enqueues processing (used for retries or template changes).
- `DELETE /media/:mediaId` — Soft-delete in MongoDB (`status: "deleted"`); schedules S3 hard-delete via Agenda job.

**S3 Interface**
- **SDK**: AWS SDK for JavaScript v3 in Node.js.
- **Upload**: Multipart upload for objects >100 MB; single PUT for smaller images.
- **Security**: Server-side encryption (SSE-S3 AES-256); bucket policies block public read. All reads outside the CDN origin must use presigned URLs.
- **Monitoring**: S3 Event Notifications (optional) to an SQS queue if asynchronous upload confirmation is needed; otherwise we trust the client callback followed by a background `HEAD` validation.

**CDN Interface**
- **Origin**: `s3://<env>-media-processed` with an Origin Access Identity (OAI).
- **Cache behavior**: `Cache-Control: public, max-age=31536000, immutable` for processed variants (filename contains content hash).
- **Invalidation**: Explicit invalidation is rarely needed due to hash-based URLs. If required, `Media_Service` calls the CDN invalidation API by tag.

## Failure Modes and Mitigations

| Failure Mode | Impact | Mitigation |
|--------------|--------|------------|
| **S3 regional unavailability** | Uploads and reads fail; publish jobs cannot retrieve media | Cross-Region Replication (CRR) on raw bucket to a secondary region. `Media_Service` falls back to secondary region presigned URLs. Agenda jobs retry with exponential backoff (max 6 hours). |
| **Processing worker crash** | Variant partially written; MongoDB status inconsistent | Jobs are idempotent: they check S3 for existing variant ETag before re-transcoding. MongoDB updates use atomic find-and-modify on `status`. |
| **CDN origin timeout / cache miss storm** | Slow delivery to Platform APIs | Enable origin shield. `Publish_Service` implements a circuit breaker: if CDN URL fetch fails, it requests a temporary S3 presigned URL (15-minute TTL) and submits that to the platform instead. |
| **MongoDB metadata drift from S3** | Orphan S3 objects or 404s from stale CDN URLs | Weekly reconciliation Agenda job diffs S3 Inventory (CSV manifest in `s3://<env>-inventory`) against MongoDB `media` collection. Untracked objects >7 days old are deleted. |
| **Client uploads corrupt/incomplete file** | Publish job sends malformed media to social platforms | `Media_Service` runs ffprobe / image header validation during processing. If validation fails, status becomes `failed` and `Notification_Service` emails the user. |
| **Tenant storage abuse** | Runaway cost from a single user uploading massive files | Per-user quota enforced in `User_Service` (50 GB raw default). `Media_Service` checks quota before issuing presigned URLs. |

## Scaling Considerations

- **Ingress offload**: Presigned URLs allow clients to upload directly to S3, keeping Node.js/Express application servers stateless and free from high-bandwidth uploads.
- **Read scaling**: The CDN absorbs >95% of read traffic. MongoDB metadata queries are lightweight (indexed by `userId` and `_id`) and cached in `Redis_Cache`.
- **Write scaling**: S3 partitions automatically. To avoid MongoDB write hotspotting on the `media` collection, we shard by `userId` and use monotonically increasing `createdAt` as the shard key suffix.
- **Worker scaling**: Media processing is CPU-intensive. `Job_Service` workers that consume `media.process` jobs run on dedicated compute nodes (e.g., container instances with higher CPU/memory) and scale independently based on Agenda Queue depth.
- **Egress cost**: By delivering processed variants via CDN instead of presigned S3 URLs to platforms, we minimize S3 egress charges. AVIF/WebP transcoding further reduces per-request payload size.
- **Queue back-pressure**: If the `Agenda_Queue` depth exceeds 10,000 media jobs, `Media_Service` temporarily rejects new upload requests with HTTP 429 and instructs the client to retry later.

## Related Diagrams
- `diagrams/002/iter1_overview.mmd` — System overview illustrating the relationships between Media Service, S3 Storage, CDN, Content Service, and Job Service.