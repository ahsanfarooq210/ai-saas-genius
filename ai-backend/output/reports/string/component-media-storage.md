# Media Storage

## Responsibilities

- **Binary Object Persistence**: Store user-uploaded photos and videos in a dedicated object-store layer outside MongoDB, ensuring that large media assets do not bloat the primary database.
- **Upload Ingestion**: Accept write streams from the API Gateway during the content-creation phase, validate file type and size constraints, and compute checksums before acknowledging success.
- **Read Fulfillment**: Serve media streams to the Content Builder during Agenda.js job execution so that post payloads can be assembled and forwarded to social platform APIs.
- **Lifecycle Management**: Track object status through `pending` → `attached_to_job` → `published` → `purged`, apply automated retention policies, and garbage-collect orphaned uploads.
- **Access Control**: Enforce user-scoped isolation via namespaced object keys and signed URLs, preventing cross-tenant access or public enumeration.
- **Integrity Assurance**: Verify upload completeness and detect bit-rot through checksum/ETag validation on both write and read paths.

## APIs and Interfaces

### Internal Upload API
- **`POST /internal/v1/media`**
  - Accepts a `multipart/form-data` stream from the API Gateway.
  - Enforces per-user quotas and content-type allow lists (`image/jpeg`, `image/png`, `video/mp4`, etc.).
  - Returns structured metadata on success:
    ```json
    {
      "mediaKey": "users/507f1f77bcf86cd799439011/pending/a1b2c3d4.jpg",
      "contentType": "image/jpeg",
      "sizeBytes": 2048000,
      "checksum": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    }
    ```

### Internal Download API
- **`GET /internal/v1/media/:mediaKey`**
  - Returns the binary stream with `Content-Type`, `Content-Length`, and `ETag` headers.
  - Supports HTTP `Range` requests so the Content Builder can stream large videos without loading entire files into the Node.js heap.

### Internal Metadata API
- **`HEAD /internal/v1/media/:mediaKey`**
  - Returns object metadata (size, checksum, content type, status) without transmitting the payload body.

### Internal Delete API
- **`DELETE /internal/v1/media/:mediaKey`**
  - Hard-deletes the object and invalidates any cached presigned URLs. Used when a user deletes a draft or when the lifecycle sweeper purges expired media.

### Presigned URL Generator
- **`generatePresignedUrl(mediaKey, operation, expirySeconds)`**
  - Internal SDK method invoked by the API Gateway to offload direct browser-to-storage uploads for files larger than 10 MB, preventing memory exhaustion on the Express server.

### Event Interface
- Emits async domain events (consumed via an internal message bus or webhooks) for:
  - `media.upload.completed`
  - `media.upload.failed`
  - `media.lifecycle.deleted`
  - These events allow the Preference Service and Job Scheduler to update job documents and audit trails in MongoDB without polling.

## Data Ownership

- **Binary Artifacts**: The actual photo and video files.
- **Object Metadata** (stored in the object store’s metadata index or a parallel metadata collection):
  ```json
  {
    "mediaKey": "string",
    "ownerUserId": "ObjectId",
    "contentType": "string",
    "sizeBytes": "number",
    "checksum": "string",
    "uploadedAt": "ISODate",
    "modifiedAt": "ISODate",
    "status": "pending | attached_to_job | published | orphaned",
    "associatedJobId": "ObjectId | null",
    "retentionUntil": "ISODate"
  }
  ```
- **Access Policies**: IAM-style or bucket-policy rules that map `ownerUserId` to read/write permissions on the key prefix `users/{ownerUserId}/*`.

## Failure Modes

- **Upload Interruption or Timeout**: Large video files may fail mid-stream, leaving incomplete multipart parts.  
  *Mitigation*: Use resumable multipart uploads with automatic abortion and cleanup of incomplete parts after 24 hours.

- **Storage Quota Exhaustion**: A user exceeds the per-account byte limit.  
  *Mitigation*: Query aggregate usage from metadata before accepting the stream; reject with HTTP `413 Payload Too Large` or `507 Insufficient Storage` if the quota is breached.

- **Corrupted Object**: Checksum mismatch detected when the Content Builder reads the file for publishing.  
  *Mitigation*: Validate checksum on upload completion; if a read mismatch occurs, log the error, fail the Agenda.js job, and trigger a retry after alerting operations.

- **Orphaned Media Accumulation**: A user abandons a draft, deletes a scheduled job, or closes their account, leaving unreferenced objects in storage.  
  *Mitigation*: A nightly sweeper task scans for objects with `status = orphaned` or a missing `associatedJobId` reference in MongoDB, then hard-deletes them.

- **Unauthorized Access / Key Enumeration**: Predictable keys or misconfigured bucket policies expose private media.  
  *Mitigation*: Use random UUID suffixes, prefix keys with `ownerUserId`, deny all public access at the bucket level, and scope presigned URLs to specific operations with short expiry windows (≤15 minutes).

- **Content Builder Read Failure**: Transient network partition or object-store outage prevents media retrieval during a publishing job.  
  *Mitigation*: Agenda.js retries the job with exponential backoff; after exhausting retries, move the job to a dead-letter queue and surface a user-visible failure reason.

- **Region or Availability Zone Outage**: The object store becomes unreachable.  
  *Mitigation*: For critical published media, enable cross-region replication; for pending uploads, defer job execution until the store recovers rather than failing permanently.

## Scaling Considerations

- **Decoupled Backend**: Use an S3-compatible object store (AWS S3, MinIO cluster, or GCS) instead of the local filesystem or MongoDB GridFS, so storage capacity and throughput scale independently of the Express compute tier.
- **Direct Upload Offload**: For assets larger than 10 MB, return presigned PUT URLs to the client via the API Gateway so the binary payload never transits the Node.js application server. This eliminates body-parser memory pressure and reduces bandwidth costs.
- **Streaming Architecture**: The Content Builder must pipe storage download streams directly into social platform upload APIs using Node.js `PassThrough` or `Readable` streams, avoiding loading multi-hundred-megabyte video files into RAM.
- **Hierarchical Key Namespacing**: Adopt a key scheme such as `users/{userId}/pending/{uuid}` and `users/{userId}/published/{uuid}`. This simplifies per-user lifecycle rules, cost allocation, and bulk deletion when an account is closed.
- **Tiered Storage & Lifecycle Rules**: Transition `published` objects to infrequent-access or archive storage after 7 days, and expire `pending` objects after 30 days if they are never attached to an Agenda.js job. This controls per-user cost as the platform scales.
- **Concurrency & Rate Limiting**: While the object store itself handles massive concurrency, the internal API layer should enforce per-user upload rate limits (e.g., 100 uploads per minute) and total upload bandwidth caps to prevent abuse and runaway egress charges.
- **CDN Integration**: If the platform serves media previews or thumbnails back to users, place a CDN in front of the read endpoint with short TTLs to reduce origin load and improve global latency.
- **Monitoring & Alerting**: Track p99 upload latency, multipart failure rate, storage capacity growth rate, orphan-object count, and per-user egress. Alert when daily storage growth exceeds provisioned thresholds or when read-error rates spike.

## Related Diagrams

No paired Mermaid diagram is provided for this document.