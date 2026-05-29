## Media Storage

`component-media-storage`

## Responsibilities

Media Storage provides durable, blob-level persistence for all binary assets in the publishing pipeline. Its specific duties are:

* **Ingest and durably store original uploads.** Accepts photo and video files uploaded by users (proxied through the API Gateway and validated by the User Service) and persists them with high durability before any background processing begins.
* **Store processed renditions.** Receives optimized outputs from the Media Processor—resized images, transcoded videos, platform-specific aspect-ratio crops—and retains them as the authoritative copies awaiting scheduled publication.
* **Isolate tenant and job data.** Enforces a strict object key hierarchy (`users/{userId}/jobs/{jobId}/{variant}/{filename}`) so that no two jobs or users can collide on namespace, and so bulk lifecycle operations can target a single job prefix.
* **Preserve integrity until pipeline completion.** Acts as the source of truth for media existence; processed objects are only removed after successful platform publication (or explicit user deletion), ensuring the Publisher can retry failed posts without re-processing.
* **Support metadata tagging.** Persists system metadata alongside blobs—`content-type`, `content-length`, SHA-256 checksum, `userId`, `jobId`, `variant` (`original` | `processed`), and `uploadedAt`—so consumers can validate objects without downloading full streams.

## APIs / Interfaces

Media Storage is consumed as an internal Node.js service abstraction over an S3-compatible object store (e.g., AWS S3, Cloudflare R2, or MinIO). No public REST surface is exposed; only backend services interact with it.

### Internal Service Interface

```typescript
interface MediaStorageClient {
  // Store a new blob. Returns a stable StorageRef containing the object key, 
  // ETag, and content hash.
  putObject(
    key: string,
    stream: ReadableStream | Buffer,
    metadata: ObjectMetadata
  ): Promise<StorageRef>;

  // Retrieve a readable stream for downstream processing or verification.
  getObjectStream(key: string): Promise<Readable>;

  // Retrieve full buffer for small assets (thumbnails, JSON sidecars).
  getObjectBuffer(key: string): Promise<Buffer>;

  // Remove a single object permanently.
  deleteObject(key: string): Promise<void>;

  // Bulk-remove all objects under a job prefix (used on job cancellation 
  // or post-publish cleanup).
  deletePrefix(userId: string, jobId: string): Promise<void>;

  // Return stored metadata without fetching the body.
  headObject(key: string): Promise<ObjectMetadata>;

  // Generate a time-limited presigned URL for direct client uploads or 
  // temporary third-party access.
  getPresignedUploadUrl(
    key: string, 
    contentType: string, 
    expirySeconds: number
  ): Promise<string>;
}
```

### Key Naming Convention

All objects are stored under a deterministic path:

```
users/{userId}/jobs/{jobId}/{variant}/{uuid}_{filename}.{ext}
```

* `variant`: `original` | `processed` | `thumbnail`
* `uuid`: short random suffix to prevent filename collisions across re-uploads
* Example: `users/507f1f77bcf86cd799439011/jobs/job_9fa2/original/a1b2_photo.jpg`

## Data It Owns

Media Storage is the sole owner of the following binary artifacts:

* **Original media blobs** — unmodified photos and videos as uploaded by the user.
* **Processed media blobs** — resized, compressed, or transcoded renditions produced by the Media Processor.
* **Thumbnail previews** — small static proxies generated for dashboard previews.
* **Object metadata** — HTTP-style headers and custom tags: `Content-Type`, `Content-Length`, `ETag`, `x-amz-meta-user-id`, `x-amz-meta-job-id`, `x-amz-meta-variant`, `x-amz-meta-sha256`.
* **Multipart upload state** — incomplete multipart upload IDs and parts held during large video ingestion (ephemeral, cleaned via bucket lifecycle rules).

Other services (User Service, Job Scheduler) maintain *pointers* to these objects in MongoDB documents, but the bits-on-disk are owned exclusively by Media Storage.

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Upload corruption / truncation** | Incomplete object stored, causing processing errors or publish failures. | Enforce client-side SHA-256; verify ETag on `putObject` completion; reject mismatches before acknowledging upload success. |
| **Key collision / overwrite** | Two jobs or retries write to the same path, losing prior data. | Mandate UUID suffix in every key; never rely on user-provided filenames alone. |
| **Orphaned objects** | Job deleted or abandoned in MongoDB, but blobs remain in storage indefinitely. | Run a nightly garbage-collector job that lists prefixes by `jobId`, cross-references the Job Scheduler database, and deletes objects for non-existent jobs. |
| **Storage quota exhaustion** | User exceeds per-tenant byte limit; new uploads fail. | User Service enforces a pre-upload quota check against aggregated `Content-Length` sums; return `413 Payload Too Large` before stream reaches the store. |
| **Object-store API throttling** | Media Processor bulk-reads trigger rate limits, stalling the pipeline. | Implement exponential backoff with jitter in the storage client; scale Media Processor workers horizontally rather than increasing per-worker concurrency. |
| **Permission leakage** | Bucket ACL or IAM policy misconfiguration exposes private user media. | Default-deny bucket policy; block all public access at the infrastructure level; use IAM roles scoped to `media_storage` service only; never expose permanent public URLs. |
| **Region / AZ outage** | Object store becomes unavailable; uploads and retrievals fail. | Deploy multi-AZ bucket replication; fallback to read-replica bucket in secondary region if primary is impaired. |

## Scaling Considerations

* **Backend selection.** Use an S3-compatible object store rather than GridFS or local disk. This decouples storage capacity from MongoDB compute and leverages virtually infinite horizontal scaling of cloud object storage.
* **Multipart streaming for video.** Videos larger than 100 MB must be ingested via multipart upload. The API Gateway should stream request bodies directly to the object store (via presigned multipart URLs or streaming `putObject`) rather than buffering in Node.js memory, preventing heap exhaustion under concurrent uploads.
* **Partitioning by prefix.** The `users/{userId}` prefix ensures objects are naturally distributed across the object store’s index partitions. Avoid listing operations (`ListObjectsV2`) across the entire bucket; all lookups must be exact key retrievals based on MongoDB references.
* **Lifecycle and cost tiers.** Apply automated lifecycle policies:
  * Move `original` objects to Infrequent Access after 7 days.
  * Delete `processed` and `thumbnail` variants 30 days after confirmed publication (or immediately on job cancellation).
  * Abort incomplete multipart uploads after 24 hours.
* **Regional co-location.** Host the storage bucket in the same region as the Kubernetes cluster / EC2 instances running the Media Processor to minimize inter-region egress charges and read latency.
* **CDN decoupling.** Media Storage is *not* responsible for edge delivery; the CDN component handles that. Media Processor writes optimized renditions to both Media Storage (authoritative archive) and CDN (edge cache). This separation prevents the Publisher from hammering the origin object store during high-volume publish windows.