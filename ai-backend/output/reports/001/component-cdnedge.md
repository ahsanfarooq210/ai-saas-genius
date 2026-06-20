## CDNEdge

### Responsibilities
- **Redirect Traffic Absorption**: Serve cached HTTP 301 redirects for `/:shortCode` requests directly from global PoP caches, shielding the `RedirectEdge` and `URLService` from the vast majority of read traffic.
- **Static Asset Delivery**: Cache and serve immutable React SPA bundles (JS/CSS) and `index.html` from object storage origins with aggressive, long-lived cache policies.
- **TLS Termination**: Handle SSL/TLS handshakes at the edge closest to end users, supporting modern cipher suites and HTTP/2 (or HTTP/3) where available.
- **Origin Proxy on Cache Miss**: Forward uncached short-code lookups to the `RedirectEdge` origin with the original request headers preserved.
- **Cache Invalidation**: React to purge commands issued by `URLService` (on URL creation, update, or deletion) to evict stale redirect mappings from edge caches globally.

### APIs / Interfaces
- **Public Edge Interface (HTTP/HTTPS)**
  - `GET /:shortCode`
    - **Cache hit**: Returns `301 Moved Permanently` with `Location: <longUrl>` and a long `Cache-Control` header (e.g., `public, max-age=86400`).
    - **Cache miss**: Proxies the request to the `RedirectEdge` origin, then caches the origin’s 301 response before returning it to the client.
  - `GET /static/<hash>.js` | `GET /static/<hash>.css` | `GET /index.html`
    - Serves React SPA assets sourced from backing object storage. Hashed asset files are treated as immutable; `index.html` uses a shorter TTL to allow deployment rollouts.
- **Origin-Facing Interface**
  - **Upstream Proxy**: Maintains persistent connections (keep-alive) to `RedirectEdge` for cache-miss redirect resolution, reducing connection-establishment overhead.
  - **Cache Purge Endpoint / Webhook**: Accepts authenticated purge requests triggered by `URLService` mutations. Supports both single-URL purges (by `shortCode`) and surrogate-key/tag purges for bulk invalidation.
- **Object Storage Pull**
  - Configured origin for static asset paths pointing to the object storage bucket hosting the compiled React SPA output. Pull-through caching is enabled so only the first request per PoP fetches from storage.

### Data It Owns
CDNEdge does not own durable data; it maintains volatile, reconstructible cache state:
- **Redirect Response Cache**: Keyed by request path (`/:shortCode`). Stores HTTP 301 response metadata including the `Location` header and cache-control directives. Reconstructible by re-querying `RedirectEdge`.
- **Static Asset Cache**: Keyed by hashed asset filename. Stores immutable JS/CSS payloads and the `index.html` entrypoint. Reconstructible from object storage.
- **Edge TLS State**: Ephemeral session tickets and OCSP stapling caches bound to the PoP.

### Failure Modes

| Failure Scenario | Impact | Mitigation |
|---|---|---|
| **Cache Poisoning** | A corrupt or malicious 301 mapping is served globally for a popular `shortCode`. | Enforce strict cache-key normalization; validate that origin 301 responses include a whitelisted domain header; use signed purge tokens; reject upstream responses with unexpected status codes (e.g., 500) from being cached. |
| **Regional PoP Degradation** | Users routed to an unhealthy edge location experience timeouts or elevated latency. | Geo-DNS or anycast traffic steering to shift users to neighboring healthy PoPs; health-check-driven automatic origin failover. |
| **Redirect Cache-Miss Stampede** | A viral short URL expires from cache or is never cached, causing a thundering herd against `RedirectEdge`. | Implement origin shield (a mid-tier cache layer) to collapse misses geographically; use high default TTLs for known redirects; pre-warm cache for anticipated viral campaigns via `URLService` triggers. |
| **Stale Redirect After Mutation** | A user clicks a modified or deleted short code and is sent to the old destination due to stale CDN cache. | `URLService` emits a synchronous purge immediately after any write/delete commits; pair with short `stale-while-revalidate` windows only for non-critical redirects. |
| **Static Asset Cache Desync** | Post-deployment, some edge nodes serve an old `index.html` while others serve new hashed chunks, causing runtime errors. | Build pipeline must content-hash all JS/CSS bundles and never overwrite files in-place; `index.html` is the only non-immutable file and receives a coordinated global purge on each deployment. |

### Scaling Considerations
- **Traffic Offload**: The CDN is architected to absorb >95% of redirect requests and 100% of static asset requests, reducing origin ingress to `RedirectEdge` and object storage by multiple orders of magnitude during viral traffic spikes.
- **TTL Strategy**:
  - **Hashed static assets**: `Cache-Control: public, max-age=31536000, immutable` because filenames change on every build.
  - **301 redirects**: `Cache-Control: public, max-age=86400` (or longer for stable mappings) to balance hit rate against freshness requirements.
  - **Index.html**: `Cache-Control: public, max-age=0, s-maxage=60` (or similar) to allow fast global rollout of new SPA versions while still caching briefly at the edge.
- **Origin Shield / Mid-Tier Cache**: Deploy a shield PoP (or designated regional cache) between the global edge and `RedirectEdge` so that a cache miss in one region does not necessarily trigger a request all the way back to the origin datacenter.
- **Egress Cost Control**: Serving redirects and static files from edge caches eliminates repeated object-storage egress charges and cross-region data-transfer costs for the MERN backend.
- **Purge Rate Limits**: CDN purge APIs typically have per-second quotas. For bulk invalidation scenarios (e.g., banning a domain and purging millions of short codes), rely on TTL expiration or surrogate-key/tag purging rather than iterating millions of individual cache keys.