## Overview

The **Media Service** is a stateless Node.js/Express upload proxy and metadata tracker. Positioned behind the API Gateway, it handles all client-facing media ingestion and metadata retrieval. The service streams uploaded photos and videos directly to S3-compatible **Object Storage** to avoid memory pressure on the Node.js event loop, then writes canonical asset records to **MongoDB**. All CPU-bound work—transcoding, thumbnail generation, and format normalization—is delegated to the dedicated `media_processor` pipeline by transitioning asset state in the database, keeping HTTP responses fast and the service horizontally scalable.

---

## Responsibilities

- **Upload Proxy** – Accept `multipart/form-data` and binary streaming uploads. Pipe request streams directly to Object Storage without buffering entire files in application memory.
- **Input Validation** – Enforce allowlisted MIME types (e.g., `image/jpeg`, `image/png`, `video/mp4`, `video/quicktime`), magic-number inspection, and per-user size quotas before bytes reach storage.
- **Metadata Tracking** – Maintain the single source of truth for every media asset in MongoDB, including ownership, original storage keys, processing lineage, derived variants, and lifecycle timestamps.
- **Async Handoff to Processing** – On successful storage write, create the asset record with `processingStatus: "pending"` in MongoDB. The `media_processor` consumes these state transitions (via polling or MongoDB change streams) to pick up CPU-bound work, decoupling ingestion from transcoding.
- **Status & Discovery API** – Allow clients to query processing progress (`pending` → `processing` → `completed`/`failed`) and retrieve manifests of derived assets (thumbnails, optimized MP4s).
- **Lifecycle Management** – Support soft deletes, user-initiated cancellation, and TTL-based expiration. Coordinate physical deletion from Object Storage once metadata records are purged.
- **Presigned URL Orchestration** – Generate time-limited, direct-to-storage presigned URLs so clients can download private media or, in high-scale scenarios, upload directly to Object Storage without transiting this service.

---

## API & Interfaces

### Client-Facing (via API Gateway)

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/v1/media/upload` | Ingest a new photo or video. Accepts streaming multipart or binary body. Returns `assetId`, `status`, and `expiresAt`. |
| `GET`  | `/v1/media/:assetId` | Retrieve canonical metadata for an asset. Returns dimensions, duration, derived-asset manifest, and original filename. |
| `GET`  | `/v1/media/:assetId/status` | Lightweight polling endpoint returning only `processingStatus` and `completedAt`. |
| `DELETE` | `/v1/media/:assetId` | Soft-delete the asset. Sets `deletedAt` and schedules physical cleanup. |

### Internal / System

- **MongoDB Change Stream / Polling Contract** – The `media_processor` observes the `media_assets` collection for documents where `processingStatus: "pending"` and `createdAt` is within the retention window. The Media Service does not open a direct network connection to the processor; handoff is purely data-driven through MongoDB.
- **Agenda.js Cleanup Jobs** – An internal scheduled job (co-located in the service or in the `scheduler_service`) queries for `expiresAt < now()` or `deletedAt != null`, issues parallel delete requests to Object Storage, and hard-deletes the metadata records.

---

## Data It Owns

All data resides in the **MongoDB Ops** cluster in the `media_assets` collection.

```javascript
// media_assets schema (simplified)
{
  assetId: UUID,                 // unique, indexed
  userId: ObjectId,              // indexed
  originalFilename: String,
  contentType: String,           // e.g., "video/mp4"
  sizeBytes: Number,
  storage: {
    bucket: String,
    objectKey: String            // path in Object Storage
  },
  processingStatus: String,      // enum: ["pending", "processing", "completed", "failed"]
  processingJobId: String,       // optional correlation ID
  derivedAssets: [
    {
      type: String,              // "thumbnail", "transcoded", "optimized"
      objectKey: String,
      contentType: String,
      width: Number,
      height: Number,
      duration: Number           // seconds, for video variants
    }
  ],
  metadata: {
    width: Number,
    height: Number,
    duration: Number,
    codec: String,
    bitrate: Number
  },
  createdAt: Date,               // indexed
  updatedAt: Date,
  deletedAt: Date,               // soft delete marker
  expiresAt: Date                // TTL index for auto-cleanup
}
```

**Indexes**
- `{ assetId: 1 }` – unique lookup
- `{ userId: 1, createdAt: -1 }` – user gallery pagination
- `{ processingStatus: 1, createdAt: 1 }` – efficient polling by `media_processor`
- `{ expiresAt: 1 }` – TTL-driven orphan cleanup

---

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Mid-upload disconnect** | Partial object written to Object Storage; client retries create garbage. | Use S3 multipart upload with abort-incomplete rules. A nightly Agenda.js reconciler lists multipart uploads older than 24h and aborts them. |
| **Storage success, DB write failure** | Orphan object exists in Object Storage with no metadata record. | Generate `assetId` deterministically (UUIDv4) at request start. Retry MongoDB insert with exponential backoff. A background sweeper maps storage objects against DB records and deletes orphans. |
| **Memory exhaustion on large video** | Node.js process crashes if middleware buffers the request. | Disable `express.json()` / `express.urlencoded()` and `multer` disk/memory storage on this route. Pipe the raw `req` stream through a validation transform directly into the Object Storage SDK upload. |
| **Invalid / malicious file type** | User uploads executable masquerading as media. | Inspect file magic numbers before streaming. Reject non-allowlisted signatures immediately. Optionally mark unknown types for quarantine rather than processing. |
| **Processing pipeline backpressure** | `media_processor` lag causes `pending` queue to grow; users see stale status. | Monitor age-of-oldest-pending with a threshold alert. If SLA is breached, return `429 Too Many Requests` on new uploads to apply backpressure. Expose an admin `retry` endpoint to re-queue stuck jobs. |
| **MongoDB primary unavailability** | Uploads cannot persist metadata; service must fail gracefully. | Return `503 Service Unavailable` when MongoDB writes time out. Object Storage writes are idempotent, so retries from the client are safe. |

---

## Scaling Considerations

- **Stateless Replicas** – The service is fully stateless; scale horizontally behind the API Gateway with no sticky sessions. Deploy additional pods/containers based on upload throughput (requests per second) and Node.js event-loop latency.
- **Zero-Buffer Streaming** – Memory usage must remain flat regardless of file size (10 MB vs. 2 GB). Profile with clinic.js or 0x to ensure no accidental buffering in middleware or logging pipelines.
- **Direct-to-Storage Offload** – At high scale, shift the data path off this service entirely: generate presigned `POST` or `PUT` URLs for Object Storage, let clients upload directly, and accept a lightweight callback/webhook to create the metadata record. This eliminates bandwidth bottlenecks from the Node.js tier.
- **Database Pool Sizing** – Tune the MongoDB driver `maxPoolSize` per replica. If running 50 pods, avoid exhausting the database connection limit; set pool size to ~10–20 per instance and use `waitQueueTimeoutMS`.
- **Read Offloading** – Route `GET /media/:assetId` and status queries to MongoDB secondary nodes. All write operations (upload completion, soft delete) must remain directed to the primary.
- **Rate & Quota Enforcement** – Integrate with the platform `rate_limiter` (per-user token buckets in Redis) at the API Gateway layer to prevent storage abuse and downstream pipeline saturation.
- **Cleanup Worker Isolation** – The Agenda.js cleanup job that hard-deletes expired media should run on a dedicated singleton instance or be sharded by date range to avoid competing with user-facing request workers.

---

## Related Diagrams

No paired Mermaid diagram was provided for this document.