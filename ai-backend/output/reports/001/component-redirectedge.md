## RedirectEdge

**RedirectEdge** is an OpenResty/Nginx hot-path edge layer that resolves short-code lookups into HTTP 301 redirects. It sits immediately behind CDNEdge and serves as the authoritative origin for redirect cache misses. Every request flows through in-process singleflight coalescing, a RedisCluster lookup, and—only on miss—a guarded fallback to URLService. Clickstream telemetry is emitted asynchronously to KafkaCluster without blocking the response path.

---

### Responsibilities

* **301 Redirect Resolution** — Accept `GET /{shortCode}` requests (typically forwarded by CDNEdge on cache miss) and return a permanent `301 Moved Permanently` response carrying the destination `Location` header.
* **In-Process Singleflight Coalescing** — Within each Nginx worker process, deduplicate concurrent requests for the same short code so that only one backend lookup reaches RedisCluster or URLService at any given moment.
* **Layered Lookup Orchestration** — Resolve mappings in strict priority:  
  1. In-flight coalesced request (worker-local).  
  2. RedisCluster key (`url:{shortCode}`).  
  3. URLService origin API on Redis miss.
* **Cache-Control Generation** — Attach long-lived, cacheable headers (e.g., `Cache-Control: max-age=86400, public`) plus a `Surrogate-Key: url-{shortCode}` header so CDNEdge can durably cache the 301 and support fine-grained purges.
* **Input Validation** — Reject malformed short codes (wrong Base58 alphabet, illegal length) with `404 Not Found` before any backend I/O occurs.
* **Async Clickstream Emission** — Publish redirect events to `clickstream.redirects` in KafkaCluster containing short code, destination URL, timestamp, edge PoP identifier, and anonymized client metadata. Emission is fully asynchronous and must not delay the 301 response.

---

### APIs / Interfaces

* **Public Ingress — `GET /{shortCode}`**
  * **Success (301)** — Returns `Location: <destination>` with long `Cache-Control` and `Surrogate-Key` headers.
  * **Unknown / Inactive (404)** — Returns `404 Not Found` when the code does not exist or has been soft-deleted.
  * **Origin Degraded (503)** — Returns `503 Service Unavailable` with `Retry-After: 10` when RedisCluster and URLService are both unreachable, signaling CDNEdge to retry rather than cache the error.

* **RedisCluster Lookup**
  * Uses the Redis Cluster binary protocol via a pooled client (`lua-resty-redis` or equivalent).
  * Queries key pattern `url:{shortCode}` (string or hash) for the destination and active state.
  * Enforces a 10 ms socket timeout; on timeout or `CLUSTERDOWN`, immediately falls back to URLService.

* **URLService Fallback**
  * Internal HTTP `GET /internal/resolve/{shortCode}` invoked only on Redis miss.
  * Connection timeout: 50 ms. Read timeout: 100 ms.
  * Expected JSON response: `{"destination":"https://...","expiresAt":"..."}`.

* **Kafka Producer**
  * Publishes to topic `clickstream.redirects` using a fire-and-forget async producer (sidecar or `lua-resty-kafka`).
  * Configured with `acks=1`, Snappy compression, and a memory-capped outbound queue (e.g., 10 000 events). Overflow events are dropped.

* **Health Probe — `GET /health`**
  * Returns `200 OK` when the Nginx worker is ready, RedisCluster topology is cached, and the Kafka producer is initialized. Used by container orchestration and load-balancer health checks.

---

### Data Ownership

RedirectEdge is **stateless** and holds no durable URL mapping data. Transient runtime artifacts include:

* **Singleflight Pending Map** — Per-worker Lua table keyed by `shortCode`, storing coroutines or callback queues awaiting the result of an in-flight Redis or URLService lookup. Cleared automatically on request completion, timeout, or error.
* **Kafka Producer Buffer** — In-memory batch queue of clickstream events awaiting flush to KafkaCluster. Bounded to prevent unbounded growth under back-pressure.
* **Redis Topology Cache** — Short-lived client-side cache of Redis Cluster slot-to-node mappings to reduce `CLUSTER SLOTS` command overhead.

---

### Failure Modes and Mitigations

| Failure | Impact | Mitigation |
|---|---|---|
| **RedisCluster Latency or Unavailability** | All lookups degrade to URLService fallback, increasing P99 latency and origin load. | Enforce ≤10 ms Redis timeouts; skip retries on the hot path. Alert on `redirectedge_redis_timeout_rate`. |
| **URLService Fallback Failure** | Cache-miss requests cannot be resolved; users may see 503s. | Apply a circuit breaker (50% error threshold, 30 s half-open) and 100 ms total timeout on URLService calls. Return 503 with `Retry-After` so CDNEdge retries. |
| **KafkaCluster Back-Pressure** | Clickstream events accumulate; producer buffer overflow causes silent data loss. | Hard-cap the producer queue. Expose metric `redirectedge_kafka_dropped_events`. Events must never block the 301 response. |
| **Per-Worker Singleflight Exhaustion** | High cardinality of unique short codes under an attack inflates the worker-local pending map, risking LuaJIT OOM (2 GiB ceiling per worker). | Cap map entries with LRU eviction; exceedance forces independent uncached lookups. |
| **Cross-Worker Thundering Herd** | Singleflight is per-worker; a viral short code can still generate up to *N* concurrent backend requests (one per worker). | Acceptable because CDNEdge caching absorbs >99% of viral traffic. Add ±5% jitter to Redis TTLs to prevent simultaneous mass expiration. |
| **Stale 301 in CDNEdge After Mutation** | Users redirected to obsolete destinations until CDN cache expires or is purged. | RedirectEdge returns `Surrogate-Key` headers. URLService triggers purge on write; RedirectEdge never serves stale data intentionally. |
| **Nginx Worker Crash (LuaJIT OOM)** | Loss of in-flight requests on the affected worker. | Run multiple workers per pod; orchestration restarts the container on health-check failure. Pre-allocate regex matchers at init phase to reduce runtime allocation. |

---

### Scaling Considerations

* **Horizontal Pod Autoscaling** — Scale on CPU >60% or P99 latency >10 ms. RedirectEdge pods are fully stateless; no session affinity or sticky routing is required.
* **Redis Hot-Key Mitigation** — Viral short codes map to a single Redis slot. Ensure the RedisCluster client routes reads to replicas where acceptable (URLService guarantees eventual consistency for reads). The in-process singleflight eliminates redundant concurrent queries within each pod.
* **Connection Pooling** — Maintain persistent keep-alive HTTP connections to URLService and persistent Redis connections via a pool sized to the Nginx worker count, eliminating TCP handshake overhead on every cache miss.
* **Kafka Throughput** — If redirect volume exceeds per-pod producer flush bandwidth, scale Kafka partition count and add RedirectEdge pods so each producer handles a smaller event share. Avoid `acks=all` on the critical redirect path.
* **Regional Deployment** — Deploy RedirectEdge in compute regions aligned with CDNEdge origins to keep cache-miss latency low. Use anycast or GeoDNS to steer CDNEdge miss traffic to the nearest pool.
* **LuaJIT Memory Discipline** — Minimize per-request allocations in the hot path; avoid serializing large objects in Lua. Validate short codes with compiled regexes cached in the Lua VM registry at Nginx init.

---

### Related Diagrams

- `diagrams/001/iter4_component-redirectedge.mmd`