# System Overview

## Executive Summary

This social media automation platform enables users to connect third-party social accounts, configure posting preferences—such as target platforms, posting frequency, media type, captions, hashtags, and publishing windows—and schedule automated publishing of photos and videos. The backend is built on Node.js and Express, with MongoDB serving as the primary operational database. Agenda.js provides cron-based scheduling semantics, while Redis Streams functions as the durable execution backbone for background jobs. The architecture decouples scheduling, media processing, and publishing into independent tiers that scale horizontally. The Scheduler Service uses an outbox pattern to ensure atomicity between persisting job definitions in MongoDB and enqueueing execution tasks to Redis Streams. Media assets are stored in S3-compatible object storage and served through a CDN. All outbound publishing is guarded by per-account, per-platform token-bucket rate limiters and circuit breakers to prevent cascading failures against external APIs.

## Design Principles

- **Decoupled pipeline stages**: Scheduling, transcoding, and publishing communicate exclusively through Redis Streams, allowing each tier to scale based on its own bottleneck.
- **Atomic job handoff**: The outbox pattern in the Scheduler Service guarantees that a job is either fully recorded in MongoDB and written to the stream, or not at all.
- **Secrets isolation**: OAuth tokens are encrypted at rest in the Token Vault, fetched at runtime by the Job Worker and Publisher Service, and never stored in the operational cache in plaintext.
- **Horizontal worker scaling**: Job Workers and Media Processors run as stateless consumer groups that can be scaled independently based on stream lag and CPU utilization.
- **Resilience by default**: Every external platform call passes through a circuit breaker and a distributed rate limiter; publish operations carry idempotency keys to ensure exactly-once semantics.

## Component Directory

### Edge & API Layer
- **[API Gateway](api-gateway.md)**: TLS-terminating entry point that routes client requests to backend services, applies edge caching rules, and load-balances across Node.js instances.
- **[CDN](cdn.md)**: Edge cache layer for media delivery and presigned URL optimization. Reduces origin load on Object Storage and improves download latency for end users.

### Identity & Secrets Management
- **[Auth Service](auth-service.md)**: Orchestrates OAuth 2.0 connection flows, token refresh lifecycles, and session management for social platform integrations. Uses Redis Cache for ephemeral session state.
- **[Token Vault](token-vault.md)**: Secure, encrypted store for OAuth access and refresh tokens. Supports versioning and atomic compare-and-swap updates to eliminate race conditions during concurrent refreshes.

### Data & Storage Layer
- **[MongoDB Ops](mongodb-ops.md)**: Primary operational database. Owns user profiles, content metadata, platform connection settings, Agenda.js job documents, and scheduler configurations.
- **[Redis Cache](redis-cache.md)**: Distributed cache for user preferences, presigned URL metadata, rate-limit counters, and ephemeral auth data. Separated from the job stream to prevent operational query load from affecting queue throughput.
- **[Redis Streams Queue](redis-streams-queue.md)**: Dedicated stream buffer for publish tasks and media processing jobs. Decoupled from Redis Cache to isolate queue backpressure from application caching.
- **[Object Storage](object-storage.md)**: S3-compatible store for original uploads and processed media variants (transcoded videos, thumbnails). Integrated with CDN for public read access.

### Automation & Job Processing
- **[Scheduler Service](scheduler-service.md)**: Translates user posting preferences into scheduled jobs using Agenda.js for cron expression evaluation. Persists job definitions in MongoDB and applies the outbox pattern to push execution tasks into Redis Streams atomically.
- **[Job Worker](job-worker.md)**: Horizontally scalable consumer group reading from Redis Streams. Enforces per-user concurrency limits to respect downstream platform rate limits. Coordinates token retrieval from the Token Vault, media assembly via the Media Service, and publish delegation to the Publisher Service.

### Media Pipeline
- **[Media Service](media-service.md)**: Upload proxy and metadata tracker. Accepts incoming photos and videos, records upload metadata in MongoDB, and delegates CPU-intensive transcoding work to the Media Processor by writing jobs to Redis Streams.
- **[Media Processor](media-processor.md)**: Dedicated FFmpeg workers running on CPU-optimized instances. Consume from Redis Streams to transcode videos, generate thumbnails, apply format normalization, and write processed assets back to Object Storage.

### Publishing & External Integration
- **[Publisher Service](publisher-service.md)**: Platform-specific publish orchestrator. Formats payloads per social network, injects idempotency keys, retrieves tokens from the Token Vault, and verifies rate-limit capacity before dispatching requests.
- **[Platform APIs](platform-apis.md)**: External social media APIs (e.g., Instagram, Twitter/X, TikTok, LinkedIn). The system respects platform-specific rate limits, retry policies, payload size restrictions, and authentication schemes.

### Resilience & Rate Control
- **[Rate Limiter](rate-limiter.md)**: Distributed token-bucket rate limiter backed by Redis. Enforces limits per external platform and per connected user account before any outbound request is issued.
- **[Circuit Breaker](circuit-breaker.md)**: Monitors Platform API health metrics stored in Redis. Opens during upstream outages to fail fast, shed load, and prevent retry storms from exhausting rate-limit budgets.

## Cross-Cutting Data Flows

End-to-end flows spanning multiple components are documented in dedicated flow diagrams:
- **[Authentication Flow](auth-flow.md)**: OAuth connection, session establishment, and token refresh lifecycle.
- **[Data Pipeline](data-pipeline.md)**: Media upload, metadata tracking, asynchronous transcoding, and CDN delivery.
- **[Event Flow](event-flow.md)**: Job creation, stream enqueueing, worker consumption, publishing, and completion acknowledgment.
- **[Deployment](deployment.md)**: Infrastructure topology, network segmentation, and service placement.

## Related Diagrams

- `diagrams/0350/iter4_overview.mmd`: High-level system context diagram showing all components, external platforms, and primary data flows.