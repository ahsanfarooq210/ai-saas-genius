## CDN (Content Delivery Network)

### Responsibilities

- **Edge Caching for Media Assets**: Cache original uploads and processed derivatives (transcoded videos, resized images, thumbnails) from `object_storage` to reduce origin load and latency for end-users and downstream platform APIs.
- **Media Delivery for Publishing**: Serve processed media via HTTPS to external social media platform APIs when platforms fetch media by URL during publish workflows orchestrated by `publisher_service`.
- **Dashboard Preview Delivery**: Serve user-uploaded and processed media to the web frontend for content calendar previews and configuration UIs routed through `api_gateway`.
- **Presigned URL Optimization**: Act as the public-facing endpoint for media access, offloading S3 presigned URL generation and signature validation from `object_storage`. The CDN either uses origin-access identity to authenticate privately to S3 or generates its own edge-signed URLs, allowing longer cache TTLs without expiry mismatches.
- **Cache Invalidation Coordination**: Accept purge commands from `media_service` and `media_processor` when assets are reprocessed or deleted, ensuring stale derivatives are not served to platforms or users.
- **Origin Shield / Regional Aggregation**: Optionally consolidate cache misses through a single regional shield cache to minimize request volume and egress costs against the S3-compatible `object_storage`.

### APIs / Interfaces

- **Origin Pull Interface**
  - Configured origin: `object_storage` (S3-compatible API).
  - Protocol: HTTPS with TLS 1.3.
  - Authentication: Origin-access identity or presigned headers injected by the CDN edge so that `object_storage` requests are authenticated without exposing query parameters to the client.
  - Supported methods: `GET`, `HEAD`. `Range` requests must be supported for video streaming and partial downloads.

- **Cache Key Schema**
  - Path-based: `/original/{userId}/{contentId}/{filename}` or `/processed/{userId}/{contentId}/{variant}/{filename}`.
  - Query string handling: Signature parameters (`X-Amz-Signature`, `Expires`, etc.) are stripped from the client-facing URL and re-injected at the edge/origin layer. The cache key uses only the object path and an optional immutable version identifier (e.g., `?v={processingJobId}`).
  - Variants differentiated by path segment, not query string, to maximize cache hit ratio.

- **Client-Facing HTTP Interface**
  - `GET /media/{type}/{userId}/{contentId}/{...path}`: Public edge endpoint served by the CDN. `media_service` and `publisher_service` construct these URLs instead of direct S3 URLs.
  - Response headers: `Cache-Control: public, max-age=31536000, immutable` for processed assets; `ETag`; `Content-Type` passed through from origin; `X-Cache: HIT/MISS`.

- **Invalidation / Purge API**
  - Called by `media_processor` or `media_service` via CDN provider API (e.g., `CreateInvalidation` or surrogate key purge).
  - Accepts path patterns or surrogate keys tied to `contentId` to purge all variants of a media object when reprocessing occurs.

### Data Owned

- **Ephemeral Media Cache**: Temporary copies of original and processed media objects. Authoritative source remains `object_storage`; cache is discardable.
- **Edge Access Logs**: HTTP request logs including cache status (`hit`, `miss`, `pass`), bytes transferred, client geography, and referrer. Used for bandwidth accounting and cache efficiency analysis.
- **Cache Configuration & Rules**: Path-based TTL policies, origin shield settings, query string normalization rules, and edge certificate bindings.
- **Signed URL Policies**: Edge authentication secrets (e.g., CloudFront private keys, Fastly VCL tokens) if the CDN generates its own signed URLs rather than proxying S3 presigned requests.

### Failure Modes

| Failure | Impact | Mitigation |
|---|---|---|
| **Cache Stampede on Viral Content** | Sudden traffic spike for a newly published post causes a flood of cache misses, overwhelming `object_storage` and increasing latency. | Use origin shield to absorb misses; configure `media_processor` to push/warm critical processed assets to the CDN after job completion; enable request coalescing at the edge. |
| **Stale Content After Reprocessing** | Users or platforms see old video/image versions because the CDN serves cached derivatives after `media_processor` outputs new variants. | Adopt immutable, content-addressed paths (include processing job hash in filename/path) so new variants are new URLs; use surrogate-key purge as a fallback for mutable paths. |
| **Presigned URL Expiry in Cache** | If S3 query parameters are part of the cache key or forwarded to origin, cached objects become inaccessible after signature expiry, returning 403s. | Use origin-access identity / authenticated origin pull so the CDN fetches from S3 with hidden, non-expiring credentials; strip signature params from client URLs entirely. |
| **Origin Unavailability** | `object_storage` outage prevents cache misses from being served; new or expired content fails to load. | Serve stale content (`stale-while-revalidate`, `stale-if-error` headers); maintain high TTLs for processed assets; use multi-region origin failover if supported by storage backend. |
| **Invalidation API Throttling** | CDN providers limit purge requests (e.g., 1000 invalidation paths per call, limited calls per month). Bulk reprocessing triggers invalidation failures. | Immutable path strategy eliminates routine invalidations; reserve purge API only for deletion events or emergency corrections. |
| **Large Object Transfer Interruption** | Video files (potentially hundreds of MB) fail mid-transfer due to edge timeouts or TCP issues. | Enable chunked transfer encoding; support HTTP `Range` requests; configure origin and edge timeouts appropriate for media size (e.g., >60s). |

### Scaling Considerations

- **Automatic Edge Scaling**: The CDN scales horizontally and geographically without platform intervention. Capacity planning focuses on origin egress and cache hit ratio, not edge node count.
- **Origin Shield / Tiered Caching**: Deploy a single regional shield cache between global edge PoPs and `object_storage`. This dramatically reduces origin request count and improves hit ratio for long-tail content accessed from multiple geographies.
- **Immutable Asset Naming**: Store processed media using content-derived or job-derived identifiers in the path (e.g., `/processed/u123/c456/v_a7f3b2/video_720p.mp4`). This makes assets effectively immutable, allowing infinite TTLs, eliminating invalidation overhead, and preventing stale-content race conditions.
- **Bandwidth Cost Optimization**: Ensure all client and platform API traffic is routed through the CDN. Direct `object_storage` egress is significantly more expensive. Enforce URL generation in `media_service` to always return CDN hostnames, never direct S3 endpoints.
- **Presigned URL Offloading**: Shift presigned URL generation from `object_storage` to the CDN edge. This reduces cryptographic load on the origin, avoids S3 signature expiry windows, and allows the platform to issue short-duration edge-signed cookies/URLs while caching the underlying object indefinitely.
- **Cache Warming for Scheduled Content**: Because posts are scheduled in advance, `scheduler_service` or `job_worker` can pre-fetch or "warm" processed media URLs at the CDN shortly before publish time, ensuring cache hits when social platforms fetch the media during the publish window.

## Related Diagrams

- `diagrams/0350/iter4_component-cdn.mmd`