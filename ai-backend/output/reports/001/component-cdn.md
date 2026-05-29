# CDN (Content Delivery Network)

## Responsibilities

- **Edge Distribution of Processed Media**  
  Serve optimized photos and videos from geographically distributed edge nodes to social media platform APIs (e.g., Instagram, Facebook, X/Twitter, TikTok). The CDN ensures that publish-time fetches by platform ingest servers encounter minimal latency and high throughput.

- **Public URL Generation**  
  Produce stable, publicly resolvable HTTPS URLs for every processed asset. `platform_publisher` references these URLs in platform API calls instead of streaming raw binary payloads, satisfying platform requirements for remote media attachments.

- **Decoupling Storage from Publishers**  
  Act as a caching layer between `media_storage` (origin) and external platform APIs. This insulates the origin blob store from direct traffic spikes when posts go live or platforms retry ingest requests.

- **Cache Invalidation on Re-processing**  
  When `media_processor` regenerates an asset (e.g., new aspect ratio, codec, or watermark), the CDN must stop serving the old version so that `platform_publisher` never submits stale media.

## Interfaces & APIs

- **Origin Interface**  
  - **Pull-through**: If configured with `media_storage` as origin, the CDN fetches processed objects on first request using standard HTTP `GET` / `HEAD`.  
  - **Push upload**: `media_processor` uploads finalized assets directly via the CDN provider’s object-storage API (e.g., S3-compatible `PutObject`) immediately after processing completes.

- **Consumer Interface**  
  - `GET https://cdn.<domain>/v1/{userId}/{contentHash}.{ext}`  
    Immutable public endpoint consumed by `platform_publisher`. The path includes a content-derived hash so that any re-process generates a new URL.  
  - Response headers: `Cache-Control: public, max-age=31536000, immutable` for versioned assets; `Content-Type` and `Content-Length` derived from `media_processor` metadata.

- **Management Interface**  
  - **Cache invalidation API**: Triggered by `media_processor` or `job_scheduler` when mutable paths must be purged (if content-addressable naming is not used).  
  - **Origin health checks**: Automated probes to `media_storage` endpoints; failed probes trigger serving stale content (if enabled) rather than hard errors.

## Data Ownership

The CDN is a **transient distribution tier** and does not own canonical data.

- **Cached Object Copies**: Processed media blobs temporarily held at edge PoPs. Eviction is governed by TTL policies and LRU behavior at the provider level.
- **No Metadata Authority**: Job state, user preferences, platform tokens, and media provenance remain in `mongodb`. The CDN holds only the binary object and its HTTP headers.

## Failure Modes

| Failure | Impact | Mitigation |
|---|---|---|
| **Origin Unreachable** | Cache misses return `502`/`503`, causing `platform_publisher` to fail the publish job because the platform API cannot fetch the media. | Deploy an origin shield; replicate `media_storage` across availability zones; configure fallback to serve stale content briefly. |
| **Stale Cache** | `platform_publisher` submits an outdated asset because a re-processed version was uploaded but the CDN still serves the old object. | Prefer immutable, content-addressable filenames (`{hash}`) over in-place overwrites; if mutable paths are required, execute invalidation and poll for propagation before marking the job ready. |
| **Cache Miss Stampede** | A viral post or batch job schedules thousands of publishes for the same new asset simultaneously, overwhelming the origin. | Use origin shield; have `media_processor` push assets to the CDN before the job is marked ready, ensuring the first platform fetch is a cache hit. |
| **SSL/TLS Certificate Expiry** | HTTPS URLs become untrusted; platform APIs reject the media attachment. | Use managed certificates (e.g., AWS ACM, Cloudflare Universal SSL) with automated renewal and 30-day expiry alerting. |
| **Provider Invalidation Limits** | Burst re-processing exhausts daily invalidation quotas, delaying propagation of new assets. | Rely on immutable URL versioning; reserve invalidation APIs only for emergency takedowns. |
| **Geographic Latency** | Platform ingest servers are far from the nearest PoP, causing slow fetches and publish timeouts. | Select a CDN with PoPs near major platform data centers (e.g., US-East for Meta/Twitter) or configure regional origins. |

## Scaling Considerations

- **Egress Bandwidth**  
  Outbound traffic scales with the number of scheduled posts and the size of processed media. Use a CDN plan with unmetered egress or committed-use discounts; monitor 95th-percentile bandwidth to avoid bill shock.

- **Object Cardinality**  
  Millions of processed assets require efficient cache-key indexing. Keep paths flat (`/{version}/{hash}.{ext}`) rather than deeply nested to avoid performance degradation in edge indexes.

- **Write Throughput**  
  `media_processor` must upload optimized assets without queuing. If the provider imposes per-second PUT limits, batch uploads or pre-warm via origin-pull with `media_storage` instead.

- **TTL and Storage Cost Trade-off**  
  Processed media is typically consumed once by a platform API shortly after scheduling. Use moderate TTLs (24–72 hours) to balance edge storage cost against the need to absorb retries. Avoid long-term CDN storage for archival; keep originals in `media_storage`.

- **Regional Compliance**  
  Some social platforms require media to be hosted in specific jurisdictions. Configure CDN caching rules and origin locations to respect data-residency constraints when applicable.