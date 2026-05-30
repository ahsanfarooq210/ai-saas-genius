# API Gateway

## Responsibilities
- **Ingress Control**: Terminates TLS and serves as the sole public entry point for all client traffic destined for the Node.js/Express backend tier.
- **Request Routing**: Dispatches HTTP requests to downstream service replicas based on path prefixes:
  - `/api/v1/auth/*` → `auth_service`
  - `/api/v1/users/*` → `user_service`
  - `/api/v1/content/*` → `content_service`
  - `/api/v1/media/*` → `media_service`
  - `/api/v1/schedule/*` → `scheduler_service`
- **Edge Caching**: Caches GET responses for public media metadata, static dashboard assets, and read-only user preference endpoints to reduce query load against `mongodb_ops`.
- **Load Balancing**: Distributes inbound connections across horizontally scaled replicas of each Express service using a round-robin or least-connections strategy.
- **Authentication Header Handling**: Extracts `Authorization: Bearer <JWT>` headers and forwards them intact to upstream services; signature verification is delegated to `auth_service`.
- **Edge Rate Limiting**: Enforces per-IP and per-API-key request quotas before traffic reaches the application servers, protecting the downstream Node.js event loop from abuse.
- **Observability**: Injects a unique `X-Request-ID` correlation ID into every request and emits structured access logs containing upstream service name, latency, status code, and bytes transferred.
- **CORS & Security**: Handles `OPTIONS` preflight requests for browser-based dashboard clients, applies allowed-origin policies, and strips internal headers (e.g., `X-Internal-Token`) from responses.

## APIs and Interfaces
- **Client-Facing Ingress**: HTTPS on port 443, supporting HTTP/1.1 and HTTP/2. WebSocket upgrade requests are passed through to `scheduler_service` for real-time job status feeds.
- **Internal Upstream Proxy**: Maintains persistent HTTP keep-alive connections to downstream Express services over the internal VPC/network. Example routing table:
  ```json
  {
    "/api/v1/auth": "http://auth-service.internal:3000",
    "/api/v1/users": "http://user-service.internal:3000",
    "/api/v1/content": "http://content-service.internal:3000",
    "/api/v1/media": "http://media-service.internal:3000",
    "/api/v1/schedule": "http://scheduler-service.internal:3000"
  }
  ```
- **Cache Interface**: Integrates with the edge cache layer using cache-key rules derived from the URL path and `Accept` header. Authenticated endpoints are explicitly marked `Cache-Control: private` to prevent cross-user leakage.
- **Health Check Endpoint**: Exposes `/health` for load balancer target group probes, returning `200 OK` when the gateway process is operational. This endpoint does not perform deep health checks of downstream services.

## Data Ownership
The API Gateway is **stateless** and holds no persistent business data.
- **Transient Data**:
  - Access logs streamed to the centralized logging pipeline (typically retained for 7–30 days).
  - Active request/response buffers during proxying, cleared immediately after the transaction completes or times out.
  - Edge-cached payloads with configurable TTLs: 60–300 seconds for dynamic API responses (e.g., content metadata) and up to 24 hours for static assets.
- **Configuration Data**:
  - TLS certificates and private keys.
  - Routing table definitions, upstream replica lists, and path-based rewrite rules.
  - IP blocklists/allowlists and edge rate limit thresholds (requests per second per source).
  - CORS allowed-origins and permitted HTTP methods.

## Failure Modes
- **Downstream Service Timeout**: If `media_service` stalls during a large video upload or `scheduler_service` hangs during complex job creation, the gateway must enforce a **hard timeout** (e.g., 30 seconds) and return `504 Gateway Timeout`. Without this, TCP connection pools exhaust and the gateway rejects all new ingress.
- **Upstream Unavailability**: When a downstream Express service returns `503` or refuses TCP connections, the gateway returns `502 Bad Gateway` and temporarily removes the failed replica from the rotation via passive health checks.
- **TLS Certificate Expiry**: An expired or misconfigured certificate causes a **total ingress failure**, rejecting all HTTPS traffic. Automated rotation (e.g., via Let’s Encrypt or AWS ACM) is mandatory.
- **Cache Poisoning**: A misconfigured cache rule that caches user-specific JSON responses without a user-scoped cache key can leak account data (e.g., OAuth connection status) between sessions.
- **Request Body Overflow**: Unbounded photo/video uploads to `/api/v1/media/*` can exhaust gateway memory or temporary disk. The gateway must enforce a maximum request body size (e.g., 100 MB) and stream large payloads directly to `media_service` without full buffering.
- **Routing Misconfiguration**: An incorrect path mapping—such as sending auth requests to `content_service`—results in functional errors and risks writing authentication events to the wrong database collections.
- **DDoS / Volumetric Attack**: A sudden traffic spike can saturate the gateway’s connection table and cascade into downstream service degradation. Edge rate limiting and connection count caps must be in place.

## Scaling Considerations
- **Horizontal Replicas**: The gateway layer scales horizontally behind a Layer 4/7 load balancer. Because it is fully stateless, new instances can join the pool without session affinity for standard HTTP requests.
- **CPU & TLS Offloading**: TLS handshakes are CPU-intensive. In high-traffic scenarios, terminate TLS at the network load balancer (e.g., AWS NLB) or use CPU-optimized gateway instances to free application CPU for request routing.
- **Connection Pooling**: Maintain persistent HTTP keep-alive pools to each downstream Node.js service to minimize TCP setup overhead and reduce latency on subsequent requests.
- **Edge Cache Offload**: Cache hit ratio directly impacts load on `user_service` and `content_service`. Monitor and tune cache keys so that read-heavy endpoints—such as fetching scheduled post lists or platform preferences—rarely hit the Express tier.
- **Geographic Distribution**: Deploy gateway replicas in multiple regions with Anycast or GeoDNS routing to minimize latency for global users uploading media or configuring posting schedules.
- **Autoscaling Metrics**: Scale gateway instances based on:
  - Requests per second (RPS)
  - Active connection count
  - p99 latency
  - CPU utilization driven by TLS and header processing
- **Upload Streaming**: For video/photo uploads, use chunked transfer encoding and disable request buffering in the gateway to avoid memory pressure; proxy the byte stream directly to `media_service` replicas.

## Related Diagrams

No paired diagram was provided for this component document.