## Overview

This document describes the architecture of a high-traffic URL shortener built on the MERN stack (MongoDB, Express, React, Node.js). The system is optimized for a massively read-skewed workload in which short-link redirects dominate traffic. To handle viral spikes without origin overload, the design pushes redirect resolution as close to the user as possible—using a global CDN edge for cached 301 responses, an OpenResty/Nginx hot-path layer with in-process singleflight coalescing, and a distributed Redis Cluster for sub-millisecond lookups. All stateful coordination is isolated behind clear boundaries: MongoDB serves OLTP, ClickHouse serves OLAP, and Kafka brokers durably buffer clickstream events between the two.

---

## Architecture Tenets

* **Edge-First Redirects** — The vast majority of `GET /:shortCode` requests never reach the origin. Long-lived `Cache-Control` headers on 301 responses at the CDN absorb viral traffic.
* **Hot / Cold Path Separation** — Redirect resolution (RedirectEdge → RedisCluster → URLService fallback) is physically and logically isolated from URL management APIs (ReactSPA → APIGateway → URLService).
* **Coalesced Origin Access** — Singleflight request coalescing in both RedirectEdge and URLService prevents thundering-herd database hits when the CDN or Redis cache misses.
* **Stateless Authentication** — AuthService issues JWTs at login/registration time but is removed from the request validation path. The APIGateway validates tokens statelessly using a local JWKS cache and enforces rate limits via RedisCluster without an auth hop.
* **OLTP / OLAP Isolation** — Click streams are emitted asynchronously to Kafka and drained by AnalyticsConsumerGroup into ClickHouse, keeping MongoDB I/O reserved for transactional URL and user data.

---

## Component Inventory

### Edge & Ingress
* **[CDNEdge](./component-cdnedge.md)** — Global edge PoP network serving 301 redirects with long `Cache-Control` headers and React static assets.
* **[APIGateway](./component-apigateway.md)** — Managed auto-scaling L7 ingress validating JWTs, enforcing Redis-backed rate limits, and routing to backend APIs.
* **[RedirectEdge](./component-redirectedge.md)** — OpenResty/Nginx hot-path edge layer performing 301 resolution, in-process singleflight, Redis checks, and fallback to URLService on cache miss.

### Application Services
* **[ReactSPA](./component-reactspa.md)** — React frontend. Static JS/CSS bundles are hosted on object storage and served through CDNEdge; dynamic API calls go to APIGateway.
* **[URLService](./component-urlservice.md)** — Express/Node API for URL creation, update, and deletion. Handles rare origin redirect cache-misses with singleflight coalescing and circuit-breaker protected reads from MongoDB secondaries. Writes new mappings to RedisCluster and purges CDNEdge on mutations.
* **[AuthService](./component-authservice.md)** — Express/Node service exclusively for login, registration, and JWT issuance.
* **[KGS](./component-kgs.md)** — Key Generation Service (Node.js) that atomically allocates pre-defined Base58 counter ranges from MongoDB, guaranteeing unique short codes without generation races.

### Data & Messaging
* **[MongoDBCluster](./component-mongodbcluster.md)** — Sharded MongoDB replica set fronted by mongos routers. Dedicated to OLTP workloads with read preferences routing cache-miss lookups to secondaries.
* **[RedisCluster](./component-rediscluster.md)** — Distributed Redis Cluster caching hot URL mappings, sharded rate-limit counters, and revoked-token bloom filters.
* **[KafkaCluster](./component-kafkacluster.md)** — Replicated Kafka broker cluster ingesting clickstream events from RedirectEdge and cache-invalidation topics with partitioned, at-least-once delivery.
* **[AnalyticsDB](./component-analyticsdb.md)** — ClickHouse columnar OLAP store physically isolated from MongoDB for real-time analytics.

### Stream Processing
* **[AnalyticsConsumerGroup](./component-analyticsconsumergroup.md)** — Horizontally-scalable Node.js consumer group reading from Kafka partitions and processing click events idempotently into AnalyticsDB.

---

## Request Flows

### Redirect Resolution (Hot Path)
1. Client requests `/:shortCode`.
2. **CDNEdge** returns a cached 301 immediately if the redirect is present in the edge cache.
3. On cache miss, traffic reaches **RedirectEdge** (OpenResty/Nginx).
4. RedirectEdge applies in-process **singleflight coalescing** and queries **RedisCluster** for the mapping.
5. If Redis hits, RedirectEdge responds with a 301, emits an async click event to **KafkaCluster**, and the CDN caches the response for subsequent requests.
6. If Redis misses, RedirectEdge falls back to **URLService** under a circuit breaker.
7. URLService reads from a **MongoDB secondary** (isolating write pressure), returns the long URL, and RedirectEdge populates RedisCluster before issuing the 301.

### URL Management (Cold Path)
1. Authenticated users interact with the **ReactSPA**.
2. API calls traverse **APIGateway**, which statelessly validates JWTs against its local JWKS cache, checks revoked-token bloom filters and sharded rate-limit counters in **RedisCluster**, and routes to **URLService**.
3. URLService writes new mappings to the **MongoDBCluster** primary, pushes the mapping into **RedisCluster**, and issues a purge to **CDNEdge** so the next redirect fetch sees fresh data.
4. Updates and deletions follow the same pattern: MongoDB commit → Redis update → CDN purge.

### Authentication
1. The ReactSPA calls login/registration endpoints via APIGateway to **AuthService**.
2. AuthService issues a signed JWT persisted in **MongoDBCluster** (user record) and returns it to the client.
3. All subsequent requests carry the JWT; APIGateway validates it locally without contacting AuthService.

### Analytics Pipeline
1. **RedirectEdge** emits clickstream events (timestamp, short code, geo, UA) asynchronously to **KafkaCluster**.
2. **AnalyticsConsumerGroup** drains these partitions in parallel.
3. Consumers write idempotently into **AnalyticsDB** (ClickHouse) for dashboard aggregations and reporting.

---

## Cross-Cutting Concerns

* **Rate Limiting** — APIGateway maintains sharded counters in RedisCluster, rejecting abuse before it reaches Node.js services.
* **Cache Invalidation** — Mutations in URLService trigger a write-through to RedisCluster and an explicit CDNEdge purge; Kafka also carries cache-invalidation topics for edge state reconciliation if needed.
* **Token Revocation** — A revoked-token Bloom filter stored in RedisCluster allows APIGateway to reject compromised JWTs without a round-trip to AuthService.
* **Unique Key Generation** — KGS pre-allocates non-overlapping Base58 counter ranges atomically from MongoDB. URLService consumes these ranges in-memory, eliminating cross-shard unique-index contention during high-volume short-code creation.

---

## Failure Modes & Resilience

* **RedisCluster Partition** — RedirectEdge falls back directly to URLService → MongoDB secondaries. Redirect latency degrades from sub-millisecond to single-digit milliseconds, but the service remains available.
* **KafkaCluster Unavailability** — RedirectEdge emits click events asynchronously. If Kafka is unreachable, the emit is best-effort dropped rather than blocking the 301 response; analytics temporarily loses fidelity but redirect availability is preserved.
* **MongoDB Primary Failure** — Write operations (URL creation, KGS range allocation) stall until failover completes. Read operations for cache misses continue against secondaries.
* **CDNEdge PoP Failure** — Traffic automatically shifts to an alternate PoP or back to the origin RedirectEdge. Static React assets may be served from object storage origin directly if necessary.

---

## Related Diagrams

* [System Overview Diagram](./diagrams/001/iter4_overview.mmd) — End-to-end component topology and traffic flow for the URL shortener platform.