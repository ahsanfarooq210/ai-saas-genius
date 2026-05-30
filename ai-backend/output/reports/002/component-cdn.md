## CDN (Content Delivery Network)

### Overview
The CDN is the global edge distribution layer for all media assets processed by the platform. It sits in front of `S3_Storage` to serve optimized photos and videos to external social media platform APIs and end-users with low latency, high availability, and reduced origin load. Every public media URL that the `Publish_Service` submits to `Platform_APIs` (Instagram, Twitter/X, Facebook, LinkedIn, TikTok) is a CDN-backed endpoint.

---

### Responsibilities

- **Edge Caching & Global Distribution**: Cache processed media blobs (photos, videos, thumbnails) at geographically distributed Points of Presence (PoPs) to minimize latency for platform webhooks, crawler bots, and end-user views.
- **Origin Pull from S3**: On cache miss, fetch assets from `S3_Storage` using a secure origin configuration (e.g., Origin Access Identity, presigned origin requests, or static website endpoint).
- **Platform-Optimized URL Delivery**: Serve rendition-specific URLs (e.g., `1080x1080.jpg`, `1080x1920.mp4`) that `Media_Service` generates for each target platform’s requirements.
- **HTTP/HTTPS Termination**: Handle TLS handshakes, support HTTP/2 and HTTP/3, and enforce HTTPS for all media URLs to meet platform security policies.
- **Range Request Support**: Honor HTTP `Range` requests for large video files, enabling platforms to scan or stream partial content without downloading the full object.
- **Cache Invalidation**: Execute purges or invalidations when `Media_Service` reprocesses or replaces an asset, ensuring stale renditions are not published.
- **Response Header Control**: Serve correct `Content-Type`, `Cache-Control`, and `ETag` headers so that `Platform_APIs` and downstream clients handle media accurately.

---

### APIs and Interfaces

| Interface | Type | Consumers / Origin | Purpose |
|-----------|------|-------------------|---------|
| **Distribution Endpoint** | HTTPS (Public) | `Publish_Service`, `Platform_APIs`, client browsers | Canonical URL for every media asset; embedded in publish payloads and post metadata. |
| **Origin Pull** | S3 REST / HTTP | `S3_Storage` | CDN fetches uncached objects from the configured S3 bucket and path prefix (e.g., `/processed/{userId}/{contentId}/`). |
| **Cache Invalidation API** | Provider-specific REST | `Media_Service`, operational jobs | Trigger object or path purges (e.g., CloudFront `CreateInvalidation`, Cloudflare `Purge Cache`) when renditions are updated. |
| **Configuration API** | IaC / Provider API | DevOps / Infrastructure pipelines | Define cache behaviors, TTL rules, custom domains, TLS certificates, geo-restrictions, and origin failover. |

**URL Convention Example**:
```
https://cdn.example.com/media/{userId}/{contentId}/{platform}-{width}x{height}.{ext}
```

---

### Data Ownership

- **Ephemeral Cache Objects**: Temporary copies of media files stored at edge nodes. Not authoritative; evicted based on TTL or LRU policy.
- **Access Logs** (optional): HTTP request logs containing timestamp, edge location, request path, bytes transferred, cache hit/miss status, and HTTP status code. Used for traffic analysis and billing reconciliation.
- **Cache Policies & Behaviors**: Rules governing query string forwarding, cookie handling, allowed HTTP methods, TTL bounds, and compression settings.
- **TLS Certificate State**: Domain-validated certificates and SAN mappings for custom CDN domains.
- **Geographic/Network ACLs**: IP allowlists or blocklists and geo-restriction settings if media must be limited to certain regions.

> **Note**: The CDN does **not** own the canonical media. All durable assets reside in `S3_Storage`; the CDN is a read-only, ephemeral cache layer.

---

### Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Cache Staleness** | `Platform_APIs` receive outdated photos/videos if a post is edited and the CDN serves an old rendition. | Use content-addressed filenames (hash or UUID in path) so each version is immutable; rely on long TTLs instead of invalidation. |
| **Invalidation Lag** | Even after a purge request, edge nodes may serve the stale asset for seconds to minutes, causing the wrong media to go live. | Immutability strategy above; if mutability is required, invalidate immediately after `Media_Service` commits to S3 and before `Job_Service` triggers publish. |
| **Origin Unreachable** | S3 bucket or origin endpoint failure causes CDN to return `503`/`504` when cache misses occur. | Enable `stale-if-error` serving where the CDN delivers expired cached content temporarily; configure origin failover or redundant buckets. |
| **Cache Miss Stampede** | A scheduled publishing window (e.g., hundreds of `Agenda_Queue` jobs firing at 9:00 AM) can flood the origin with simultaneous requests for newly uploaded assets. | Use an origin shield or mid-tier cache to collapse concurrent requests; pre-warm cache for expected high-traffic posts. |
| **SSL/TLS Expiry** | Custom domain certificate expiration breaks HTTPS delivery, causing platforms to reject media URLs. | Automated certificate rotation via ACM or CDN-provider tooling with expiration alerting. |
| **Incorrect Content-Type** | If the origin S3 object lacks a proper `Content-Type` metadata, the CDN may cache and serve it as `application/octet-stream`, leading platforms to reject the media. | Enforce `Content-Type` tagging in `Media_Service` at upload time; configure the CDN to override or default headers if missing. |
| **Regional Edge Degradation** | A specific PoP outage or network partition increases latency for users/platforms in that region. | Multi-region origin with anycast routing; health-checked origin failover. |

---

### Scaling Considerations

- **Egress Bandwidth Bursts**: Automated publishing creates traffic spikes aligned with user-defined schedules (e.g., every hour on the hour). Provision sufficient CDN egress capacity or use a provider with automatic burst scaling to avoid throttling.
- **Immutable Asset Strategy**: Because `Media_Service` generates platform-specific renditions that rarely change after creation, set aggressive cache TTLs (`max-age=31536000`) and rely on unique filenames. This maximizes cache hit ratio and minimizes S3 `GET` costs.
- **Tiered Caching / Origin Shield**: Place a shield cache between the global edges and `S3_Storage` to reduce origin request volume and improve hit ratios for long-tail or large video objects.
- **Separate Behaviors by Media Type**: Configure distinct cache behaviors for images (small, high request rate) and videos (large, range-request heavy). Images can use shorter read timeouts and aggressive compression; videos need larger object sizes and partial-content support.
- **Cache Key Optimization**: Include rendition parameters (e.g., `?w=1080&h=1080`) in the cache key so that platform-specific optimizations are cached independently without additional origin fetches.
- **Cost Controls**: Monitor cache hit ratio (target > 95%). S3 origin pull incurs per-request and data-transfer charges; reduce origin hits through immutability and shielding. Log delivery to S3 for analysis should itself use a separate, infrequently accessed bucket.
- **Pre-warming for Critical Posts**: For high-priority scheduled campaigns, proactively request the CDN URL from multiple edge locations after `Media_Service` uploads to ensure the asset is cached before `Publish_Service` dispatches to `Platform_APIs`.

---

### Related Diagrams

No paired Mermaid diagram is provided for this component.