## component-object-storage

### Responsibilities

- **Durable blob storage** for all binary media in the platform, acting as the system-wide source of truth for photo and video bytes.
- **Immutable object retention**: Stores original user uploads and processed derivatives (transcoded videos, resized images, thumbnails) under versioned, non-overwritable keys.
- **CDN origin**: Serves as the authoritative origin for the CDN distribution; no public-facing traffic hits the storage layer directly except via origin pull or time-limited presigned URLs.
- **Multipart upload facilitation**: Supports resumable, multipart uploads for large video files (>100 MB) to prevent network-restart failures during ingestion from `media_service`.
- **Encryption and compliance**: Enforces server-side encryption (SSE-S3 or SSE-KMS) at rest and blocks all public access at the bucket/policy level.
- **Lifecycle and cost governance**: Automatically expires temporary multipart chunks and transitions aged processed media to cheaper storage classes after defined retention periods.

### APIs and Interfaces

Internal services interact with the store via an S3-compatible SDK (AWS SDK for JavaScript v3) configured with signature Version 4 and a custom endpoint. The primary operations are:

- **`PutObject`** — Used by `media_service` for small original media (<100 MB) and by `media_processor` for processed output artifacts.
- **`CreateMultipartUpload` / `UploadPart` / `CompleteMultipartUpload`** — Used by `media_service` for large video ingestion. `media_service` tracks `UploadId` and part ETags in `mongodb_ops` until completion.
- **`AbortMultipartUpload`** — Triggered by `media_service` on client-cancelled or timed-out uploads to prevent orphaned chunks.
- **`GetObject`** — Used by `media_processor` to fetch original blobs into CPU-optimized instances for transcoding; also used by CDN for origin pull on cache miss.
- **`HeadObject`** — Called before processing pipelines start to verify `Content-Length`, `Content-Type`, and ETag without downloading the full object.
- **`CopyObject`** — Used by `media_processor` to move finalized outputs from a staging prefix to the canonical `processed/` prefix without re-uploading bytes over the network.
- **`DeleteObject` / `DeleteObjects`** — Invoked by nightly cleanup jobs (coordinated via `scheduler_service`) to remove expired temporary data and execute user-initiated media deletion requests.
- **Presigned URLs (`GetObject`, `PutObject`)** — Generated on demand by `media_service` using IAM credentials scoped to a specific key and HTTP verb. These URLs are cached in `redis_cache` with TTLs matching their expiration (15 minutes for uploads, 1 hour for reads) to avoid redundant signature computation.

No direct database-style querying is supported; all metadata lookups (ownership, captions, processing status) are handled by `mongodb_ops`.

### Data Ownership

The component owns **only the binary object payloads**. It does not own relational metadata, job state, or user preferences.

**Key namespace conventions:**

| Prefix | Owner | Content | Lifecycle |
|--------|-------|---------|-----------|
| `raw/{userId}/{contentId}/` | `media_service` | Original uploaded photos and videos | Retained for 90 days after publishing, then transitioned to IA |
| `processed/{contentId}/{variant}/` | `media_processor` | Transcoded MP4s, resized JPEGs/PNGs, thumbnails | Retained for 30 days after schedule completion, then expired |
| `tmp/{uploadId}/` | `media_service` | In-progress multipart upload parts | Expired after 7 days if multipart upload not completed |

**Data not owned by this component:**
- Media metadata (file names, captions, hashtags, MIME type mappings) → `mongodb_ops`
- Processing job state and queue entries → `redis_streams_queue`
- Presigned URL tokens and rate-limit counters → `redis_cache`

### Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Incomplete multipart upload** | Orphaned parts accumulate storage cost and exhaust bucket quotas. | `media_service` calls `AbortMultipartUpload` on client disconnect or timeout. A bucket lifecycle rule auto-deletes objects under `tmp/` after 7 days. |
| **503 Slow Down / rate limit** | `media_processor` or CDN origin pull receives throttling errors during viral traffic spikes. | Retry with exponential backoff and jitter in SDK configuration. Ensure CDN cache-hit ratio stays >95% to shield origin GET load. |
| **Checksum/ETag mismatch** | Silent corruption risk if a truncated upload completes. | `media_service` computes MD5/SHA256 client-side and validates against the ETag returned by `CompleteMultipartUpload`. Mismatches trigger a retry and alert. |
| **Bucket policy drift (public access)** | Media becomes publicly listable or readable, violating privacy. | Infrastructure-as-Code (Terraform/Pulumi) enforces `BlockPublicAcls`, `BlockPublicPolicy`, `IgnorePublicAcls`, `RestrictPublicBuckets`. Periodic compliance scans alert on drift. |
| **Presigned URL clock skew** | URLs appear expired or not yet valid due to time drift between Node.js workers and storage nodes. | All compute instances synchronize via NTP. Presigned URL TTL is set to 15 minutes (uploads) to absorb minor skew. |
| **Storage cost explosion** | Unbounded growth of `processed/` variants (e.g., multiple resolutions per video). | Enforce a strict variant policy (max 3 per contentId). Lifecycle transitions move non-active media to infrequent access after 30 days and delete after 90 days. |
| **Region-level outage** | Total unavailability of media read/write in a single-region deployment. | For critical active schedules, configure cross-region replication on the `processed/` bucket to a secondary region. Failover DNS for CDN origin to the replica bucket. |

### Scaling Considerations

- **Key prefix distribution**: Keys are prefixed with randomized `contentId` UUIDs (e.g., `raw/a1b2c3d4/...`) rather than sequential timestamps. This prevents hot partitions on the object storage index and sustains high write throughput.
- **Multipart tuning**: For video files, use a part size of 50–100 MB. This limits the total part count (max 1,000 parts AWS S3) to support files up to ~5 TB while keeping the completion payload small.
- **Horizontal scalability**: The S3-compatible layer scales transparently for read and write throughput. If self-hosting (e.g., MinIO), scale out by adding server pools and ensuring the load balancer distributes requests evenly across nodes using erasure-coded sets.
- **CDN offloading**: Processed media URLs served to end users (and embedded in publish payloads) must reference the CDN domain, not the storage endpoint. Origin shield or a dedicated origin-pull subnet prevents storage egress charges and latency from compute-region round trips.
- **KMS throttling (if SSE-KMS)**: If using SSE-KMS, encryption operations share the KMS request quota. For high-throughput ingest, prefer SSE-S3 to avoid KMS throttling during batch upload peaks.
- **Cost optimization**: Enable storage-class analytics to verify that lifecycle transitions are effective. Monitor `BytesUploaded` and `BytesDownloaded` per prefix to detect runaway growth in `tmp/` or `processed/` namespaces.

## Related Diagrams

- Component diagram: `diagrams/0350/iter4_component-object-storage.mmd`