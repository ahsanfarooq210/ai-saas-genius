# ADR-003: Media Storage Strategy

## Status
Accepted

## Context
The social media automation platform must durably store user-uploaded photos and videos for an indefinite window between upload and scheduled publish time. Media assets range from platform-optimized images to high-resolution video files, and they must remain retrievable by background Agenda.js workers when executing publishing jobs. The storage layer must support:
- Binary durability for assets held hours to weeks before publication.
- Retrieval by the `publisher_service` and `agenda_worker` to stream bytes to external platform APIs (Twitter/X, Instagram, Facebook, LinkedIn).
- Async processing to generate platform-specific variants (aspect ratios, codecs, bitrate limits).
- Cost predictability as user-generated storage volume grows linearly with MAU.

## Decision
Adopt an external S3-compatible object storage provider (e.g., AWS S3 or Cloudflare R2) as the authoritative blob store. The `media_service` is the sole component permitted to interact directly with this store. MongoDB persists only lightweight metadata and state machine records that map a storage key to ownership, processing status, and scheduled jobs.

Local filesystem storage and MongoDB GridFS are explicitly rejected:
- **Local disk** prevents horizontal scaling of stateless Node.js/Express containers and risks data loss on pod eviction.
- **GridFS** couples storage capacity to MongoDB cluster sizing, increases working set memory pressure, and lacks native CDN integration.

## Technical Specification

### Responsibilities

| Layer | Responsibility |
|-------|--------------|
| **Object Storage** | Durability, availability, and byte-level storage of original uploads and derived variants. Enforces server-side encryption and bucket-level access policies. |
| **Media Service** | Upload coordination (presigned URL generation), content validation (MIME type, magic bytes, size enforcement), virus/malware scanning, async processing orchestration via Agenda.js, lifecycle cleanup, and platform-specific format compliance checks. |
| **MongoDB** | Metadata indexing, referential integrity between `MediaAsset` records and `Post`/`Job` documents, and queryable state for the scheduler to determine media readiness before enqueueing a publish job. |

### Data Ownership

**Object Storage owns the bytes:**
- Objects are stored under a deterministic key path: `/{userId}/{mediaId}/{filename}`.
- Processed variants use a suffix key: `/{userId}/{mediaId}/variants/{platform}-{filename}`.

**MongoDB `media.assets` collection owns the metadata:**
```javascript
{
  _id: ObjectId("..."),
  ownerUserId: ObjectId("..."),
  storageKey: "user123/media456/original.mp4",
  variants: [
    {
      platform: "instagram",
      storageKey: "user123/media456/variants/instagram-original.mp4",
      contentType: "video/mp4",
      width: 1080,
      height: 1080,
      sizeBytes: 20971520
    }
  ],
  contentType: "video/mp4",
  sizeBytes: 52428800,
  status: "ready", // uploading | processing | ready | failed | deleted
  checksum: "sha256:a1b2c3...",
  createdAt: ISODate("2024-01-15T10:00:00Z"),
  expiresAt: ISODate("2024-04-15T10:00:00Z"), // TTL for post-publish cleanup
  jobId: ObjectId("...") // optional reference to Agenda job
}
```

### APIs and Interfaces

**Client-Facing (via API Gateway → Media Service)**
- `POST /media/upload-init`
  - Request: `{ filename, contentType, sizeBytes }`
  - Response: `{ mediaId, presignedPutUrl, expiresIn: 300 }`
  - The client uploads bytes directly to object storage; the Media Service node does not proxy the body.

- `POST /media/confirm`
  - Request: `{ mediaId, checksum }`
  - Action: Media Service HEADs the object in object storage to verify size, then updates MongoDB `status` from `uploading` to `ready` (or `processing` if video transcoding is required).

- `DELETE /media/:mediaId`
  - Soft-deletes the MongoDB record immediately and enqueues an Agenda.js cleanup job to hard-delete the blob within 24 hours, allowing rollback if a scheduled post still references the asset.

**Internal Service-to-Service**
- `GET /internal/media/:mediaId/download-url`
  - Consumed by `agenda_worker` and `publisher_service`.
  - Returns a presigned GET URL valid for 15 minutes, scoped to the exact object key. No direct bucket access by workers.

- `POST /internal/media/process`
  - Consumed by `content_service` when assembling a post.
  - Payload: `{ mediaId, targetPlatforms: ["instagram", "twitter"] }`
  - Action: Enqueues an Agenda.js job to ffmpeg-transcode the original into platform-compliant variants.

### Failure Modes

1. **Orphaned Incomplete Multipart Uploads**
   - *Cause:* Client initiates upload but abandons the stream.
   - *Mitigation:* Bucket lifecycle rule to abort incomplete multipart uploads after 24 hours. A nightly Agenda.js sweeper job deletes MongoDB records still in `uploading` status older than 1 hour where the multipart upload is absent.

2. **Metadata-Storage Drift**
   - *Cause:* MongoDB record references a storage key that was manually deleted or lost.
   - *Mitigation:* All deletions flow through the Media Service API. A weekly integrity checker queries distinct `storageKey` values from MongoDB and issues batched S3 HEAD requests; mismatches are flagged for manual review and re-ingestion from platform backups if available.

3. **Async Processing Failure**
   - *Cause:* Corrupt video input or unsupported codec causes ffmpeg to exit non-zero.
   - *Mitigation:* Worker captures stderr, transitions MongoDB `status` to `failed`, and emits an event to the notification service so the user can re-upload. The original blob is retained for 7 days to support retry with adjusted codec parameters.

4. **Object Storage Provider Outage During Publish Window**
   - *Cause:* S3/R2 region unavailable when `agenda_worker` attempts to retrieve media for a scheduled post.
   - *Mitigation:* Publisher Service retries with exponential backoff (max 3 attempts over 90 seconds). If the outage persists, the Agenda job is marked `failed` with `shouldSaveResult: true` and Agenda’s default lock behavior re-queues it according to the job’s `priority` and `nextRunAt` configuration.

5. **Storage Quota / Rate Limiting**
   - *Cause:* Provider throttles PUT/GET requests per bucket.
   - *Mitigation:* S3 SDK configured with automatic exponential backoff. If throttling becomes chronic, shard users across `N` buckets using `userId % N` bucket routing logic inside the Media Service.

6. **Worker Memory Exhaustion on Large Video**
   - *Cause:* A 4GB video transcode loads the entire file into memory during ffmpeg processing.
   - *Mitigation:* Upload-init enforces a 500MB file size limit. Processing workers run as isolated containers with streaming ffmpeg pipelines writing to ephemeral disk, not RAM.

### Scaling Considerations

- **Presigned URL Offloading:** By returning presigned PUT/GET URLs to clients and workers, the Node.js/Express Media Service containers scale on metadata transaction throughput rather than network bandwidth. A single pod can handle thousands of concurrent upload initiations without proxying bytes.
- **Metadata Hotspots:** MongoDB queries for “all ready media for user X” must avoid collection scans. Required indexes:
  - `{ ownerUserId: 1, status: 1, createdAt: -1 }` — dashboard listing
  - `{ expiresAt: 1 }` — TTL cleanup sweeper
  - `{ storageKey: 1 }` — integrity checker
- **Variant Storage Growth:** Each video may generate 3–4 platform variants. Lifecycle policies transition original files to cold storage 30 days after `createdAt` and permanently delete processed variants 7 days after a successful publish (since platforms ingest media independently).
- **CDN Integration:** If the platform reuses the same asset across multiple posts, serve retrieval URLs through a CDN edge cache keyed by `storageKey`. This reduces origin GET charges and improves retrieval latency for `publisher_service`.
- **Regional Upload Latency:** For a global user base, route upload-init to the object storage region closest to the client. Store the region identifier in the MongoDB document so subsequent retrieval requests are directed to the correct origin.

## Related Diagrams

- `diagrams/0350/iter1_overview.mmd` — System overview illustrating the Media Service boundary with Object Storage and MongoDB.
- `diagrams/0350/iter1_component-media-service.mmd` — Component-level detail of upload, processing, and retrieval flows.
- `diagrams/0350/iter1_component-object-storage.mmd` — Blob storage interface and access patterns.