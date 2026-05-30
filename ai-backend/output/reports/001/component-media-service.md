## Media Service

The Media Service is a Node.js/Express subsystem responsible for ingesting, validating, processing, and persisting user-generated photos and videos. It generates thumbnails and compressed variants, writes metadata to MongoDB, stores blobs in S3-compatible object storage, and exposes CDN-backed URLs to downstream services (primarily the Content Service).

---

## Responsibilities

- **Upload Ingestion**: Accept multipart/form-data uploads via HTTP; enforce file-type allowlists (JPEG, PNG, MP4, MOV, etc.) and per-file size limits (e.g., 50 MB images, 500 MB videos).
- **Validation & Sanitization**: Inspect magic numbers/headers; reject mismatched extensions or malformed files before storage.
- **Synchronous Metadata Capture**: Create a `media` document in MongoDB immediately on upload start so that the Content Service can reference a stable ID before processing completes.
- **Media Processing**: Generate thumbnails (Sharp for images, FFmpeg for video frames), create compressed proxies for internal preview, and extract basic metadata (dimensions, duration, codec, file hash).
- **Object Storage Persistence**: Stream original and processed variants to the S3-compatible object storage bucket under a `users/{userId}/media/{mediaId}/` prefix.
- **CDN URL Management**: Return CDN-facing URLs for ready variants; avoid serving binary payloads through the Express process.
- **Quota Enforcement**: Track per-user storage consumption in MongoDB and reject uploads that would exceed the configured limit.
- **Lifecycle & Cleanup**: Soft-delete records on API request; hard-delete objects from storage and reclaim quota asynchronously.

---

## APIs / Interfaces

### REST Endpoints (internal & gateway-exposed)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/media/upload` | Multipart upload. Returns `201` with `{ mediaId, status, originalUrl }` on acceptance. |
| `GET` | `/media/:mediaId` | Returns metadata JSON including variant list, MIME type, dimensions, and processing status. |
| `GET` | `/media/:mediaId/download?variant=` | Redirects (`302`) to a time-limited presigned object-storage URL for the requested variant (`original`, `thumbnail`, `preview`). |
| `DELETE` | `/media/:mediaId` | Soft-deletes the MongoDB record and queues background cleanup of the storage objects. |
| `GET` | `/media/:mediaId/thumbnail` | Redirects to the thumbnail CDN URL; returns `404` if still processing. |

### Internal Service Interface

```typescript
interface MediaService {
  // Ingest a readable stream; returns the created media record.
  ingest(stream: Readable, meta: UploadMeta): Promise<MediaRecord>;

  // Start async processing pipeline (thumbnail, transcoding).
  // Called internally or by an Agenda job after upload completes.
  processMedia(mediaId: string): Promise<void>;

  // Generate a presigned URL valid for `ttlSeconds`.
  getSignedUrl(storageKey: string, variant: string, ttlSeconds: number): Promise<string>;

  // Permanently remove media and all variants; updates user quota.
  purge(mediaId: string): Promise<void>;

  // Atomic quota check before accepting bytes.
  checkQuota(userId: string, incomingBytes: number): Promise<boolean>;
}
```

### Downstream Dependencies

- **MongoDB**: Primary store for `media` documents and quota counters.
- **Object Storage**: S3-compatible bucket for durable blob storage.
- **Content Service**: Consumes `mediaId` references and polls `GET /media/:mediaId` to confirm assets are `ready` before attaching them to post drafts.

---

## Data Ownership

### MongoDB Collections

**`media`**
```javascript
{
  _id: ObjectId,
  userId: ObjectId,              // indexed
  status: "uploading" | "processing" | "ready" | "failed",
  original: {
    filename: string,
    sizeBytes: number,
    mimeType: string,
    storageKey: string,          // e.g., users/123/media/abc/original.mp4
    checksum: string             // sha256
  },
  variants: [
    {
      type: "thumbnail" | "preview" | "1080p",
      width: number,
      height: number,
      sizeBytes: number,
      storageKey: string,
      cdnUrl: string
    }
  ],
  metadata: {
    durationSec: number,         // video only
    codec: string,
    captureTime: ISODate
  },
  createdAt: ISODate,            // indexed (TTL considerations)
  updatedAt: ISODate,
  deletedAt: ISODate             // soft-delete marker
}
```

**`user_storage_quotas`**
```javascript
{
  userId: ObjectId,              // unique index
  usedBytes: number,
  maxBytes: number,
  lastUpdated: ISODate
}
```

### Object Storage Layout

```
bucket-name/
├── users/{userId}/media/{mediaId}/original.{ext}
├── users/{userId}/media/{mediaId}/thumbnail.jpg
├── users/{userId}/media/{mediaId}/preview.mp4
└── users/{userId}/media/{mediaId}/1080p.mp4
```

All read access is served via CDN origin-pull or direct signed-URL redirects; the Express service never proxies bytes.

---

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Client disconnect during upload** | Partial multipart chunk in object storage | Abort multipart upload via S3 SDK after a timeout; cron job sweeps orphaned multipart parts older than 24 h. |
| **Corrupt or unsupported codec** | FFmpeg/Sharp throws; processing halts | Catch error, set `status: "failed"`, store `failureReason`, and emit a failure event so the Content Service can detach the asset. |
| **Object storage write succeeds but MongoDB commit fails** | Orphan blob with no referencing record | Nightly reconciliation job lists storage keys and diff-checks against `media` collection; deletes unmatched objects and decrements quota. |
| **Thumbnail generation timeout** | Video thumbnail stalls publishing pipeline | Enforce a max processing time (e.g., 60 s); on timeout, fall back to a generic placeholder image and mark the record `ready` with a warning flag. |
| **Quota race condition** | Two concurrent uploads exceed limit | Update `user_storage_quotas.usedBytes` with an atomic `$inc` after successful storage; reject upload if `usedBytes + incoming > maxBytes` in the same atomic transaction (MongoDB 4.0+ multi-doc ACID or single-document atomic update). |
| **CDN cache staleness after reprocessing** | Users see old thumbnails | Use immutable variant URLs that include a content hash or processing timestamp (e.g., `thumbnail.jpg?v=1699459200`) rather than relying on CDN invalidation. |

---

## Scaling Considerations

- **Do not block the event loop**: Image resizing and video transcoding are CPU-intensive. The Media Service API nodes should accept uploads and stream them to object storage, then enqueue an Agenda.js background job (or a dedicated worker pool) to run FFmpeg/Sharp on separate compute. API containers remain I/O-bound and horizontally scalable.
- **Streaming uploads**: Pipe the incoming HTTP stream directly to S3 multipart upload streams. Never buffer multi-hundred-megabyte videos in Node.js heap.
- **Database indexing**: Maintain compound indexes on `{ userId: 1, status: 1, createdAt: -1 }` to support fast dashboard queries and quota aggregation.
- **Storage lifecycle**: Configure object-storage lifecycle rules to expire objects in `deletedAt` prefixes after 30 days, and set MongoDB TTL indexes on soft-deleted `media` records to match.
- **Horizontal scaling of processors**: If using Agenda.js for processing, run dedicated `agenda_worker` pods that subscribe only to `media-processing` jobs and auto-scale based on queue depth. Keep these workers separate from publishing workers.
- **Rate limiting**: Apply per-user upload rate limits (e.g., 10 uploads/minute, 100/hour) at the API Gateway to prevent storage flooding and quota exhaustion.

---

## Related Diagrams

No paired Mermaid diagram was provided for this component document.