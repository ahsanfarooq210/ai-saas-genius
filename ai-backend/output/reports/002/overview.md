# Social Media Automation Platform — System Overview

## Executive Summary

This platform is a social media automation system that enables users to connect multiple social accounts, configure detailed posting preferences, and schedule automated publishing of photos and videos. The backend is implemented in Node.js and Express, using MongoDB as the primary transactional database and Agenda.js as the job scheduling engine. Users define per-platform settings—target networks, posting frequency, media type, caption templates, hashtag sets, publishing time windows, and account-specific preferences—which the system translates into durable background jobs. These jobs automatically prepare media assets and publish them at the scheduled time via native social platform APIs, including Instagram, Twitter/X, Facebook, LinkedIn, and TikTok. Real-time progress, completion events, and failure alerts are pushed to clients through persistent WebSocket connections and email.

## Architectural Layers

The system is organized into four functional layers:

| Layer | Responsibility | Components |
|---|---|---|
| **Ingress & Real-Time** | Receive external traffic, enforce global rate limits, and maintain persistent client connections | API Gateway, WebSocket Gateway |
| **Core Domain Services** | Implement business logic for identity, profiles, content, media processing, scheduling, publishing, and alerting | Auth Service, User Service, Content Service, Job Service, Media Service, Publish Service, Notification Service |
| **Data & Job Infrastructure** | Provide primary persistence, cached session state, and durable background job queuing | MongoDB, Redis Cache, Agenda Queue |
| **External Integrations** | Store and deliver media at scale, interface with social networks, and send transactional email | S3 Storage, CDN, Platform APIs, Email Provider |

## Component Catalog

### Ingress & Real-Time
- **[API Gateway](./component-api-gateway.md)** — Entry point for all client requests. Routes HTTP traffic to downstream services, enforces global rate limiting, and terminates TLS.
- **[WebSocket Gateway](./component-websocket-gateway.md)** — Maintains persistent Socket.io/WebSocket connections to push real-time job status, publish confirmations, and account alerts to connected clients.

### Core Domain Services
- **[Auth Service](./component-auth-service.md)** — Handles user registration and login, manages OAuth 2.0 authorization flows for social platforms, rotates access and refresh tokens, and stores encrypted credentials.
- **[User Service](./component-user-service.md)** — Owns user profiles, connected social account metadata, and posting preference configuration such as platform selection, frequency caps, time windows, and default captions.
- **[Content Service](./component-content-service.md)** — Manages post creation and drafting, caption and hashtag generation, content template libraries, and post lifecycle state transitions.
- **[Job Service](./component-job-service.md)** — Orchestrates Agenda.js background jobs. Generates scheduling records, defines retry policies, triggers publish workflows, and tracks job execution state.
- **[Media Service](./component-media-service.md)** — Ingests, processes, and optimizes photos and videos. Generates platform-specific renditions and thumbnails, stores derivatives, and produces CDN-ready URLs.
- **[Publish Service](./component-publish-service.md)** — Executes outbound API calls to social media platforms. Constructs platform-native payloads, attaches optimized media, and publishes scheduled content on behalf of users.
- **[Notification Service](./component-notification-service.md)** — Composes and dispatches real-time and email notifications for job completions, publish failures, OAuth token expirations, and account health issues.

### Data & Job Infrastructure
- **[MongoDB](./component-mongodb.md)** — Primary database persisting user records, social account tokens, post definitions, media metadata, job configurations, and Agenda.js job documents.
- **[Redis Cache](./component-redis-cache.md)** — Caches active user sessions, ephemeral OAuth state parameters, recent job status snapshots, and real-time presence data to reduce MongoDB load.
- **[Agenda Queue](./component-agenda-queue.md)** — MongoDB-backed job queue managed by Agenda.js. Stores scheduled, recurring, and ad-hoc jobs; manages locking and concurrency; and persists job execution history.

### External Integrations
- **[S3 Storage](./component-s3-storage.md)** — Object storage for original user uploads and processed media derivatives (compressed images, transcoded video renditions, thumbnail sprites).
- **[CDN](./component-cdn.md)** — Content delivery network serving platform-optimized media URLs with edge caching, global distribution, and signed access controls.
- **[Platform APIs](./component-platform-apis.md)** — External social media APIs including Instagram Graph API, Twitter/X API, Facebook Graph API, LinkedIn REST API, and TikTok for Business API.
- **[Email Provider](./component-email-provider.md)** — External transactional email service used for onboarding verification, weekly digests, failure alerts, and account reconnection prompts.

## Critical System Flows

### 1. Onboarding & Account Linking
A client authenticates through the Auth Service using local credentials or social SSO. To enable automated publishing, the client initiates an OAuth flow managed by the Auth Service, which stores encrypted tokens in MongoDB and caches active sessions in Redis. The User Service persists linked account metadata and posting preferences.

### 2. Content Drafting & Media Preparation
Users create posts via the Content Service, supplying captions, hashtags, and media uploads. The Media Service ingests files into S3, generates platform-specific renditions (e.g., 1080×1080 images, 720p MP4 videos under platform size limits), and returns CDN URLs. The Content Service links the finalized assets to the post record and marks it ready for scheduling.

### 3. Scheduling & Job Orchestration
When a user schedules a post, the Job Service creates an Agenda.js job definition encoding the publish time, target platforms, and post ID, then persists it to the Agenda Queue. At the designated execution time, Agenda locks the job and invokes the Job Service worker, which initiates the publish pipeline.

### 4. Publishing & Feedback
The Job Service delegates execution to the Publish Service, which retrieves the user’s current OAuth tokens from the Auth Service, assembles platform-native payloads, and calls the relevant Platform APIs. On success or failure, the Publish Service records the outcome. The Notification Service consumes these outcomes to push real-time status updates through the WebSocket Gateway and dispatches email alerts for hard failures or authentication errors.

## Operational Considerations

- **Statelessness** — All Express-based domain services are stateless, enabling horizontal scaling behind the API Gateway without session affinity.
- **Job Durability** — Agenda.js stores job definitions, locks, and repeat intervals in MongoDB, ensuring scheduled publishes survive process restarts and deploys.
- **Rate Limiting & Backpressure** — The API Gateway enforces per-user rate limits on ingress. The Publish Service respects per-platform API quotas and implements exponential backoff to avoid throttling or account suspension.
- **Token Resilience** — The Auth Service proactively refreshes short-lived OAuth tokens before expiry and surfaces disconnected accounts to the User Service and Notification Service.
- **Media Scalability** — CPU-intensive video transcoding in the Media Service is isolated from request-serving paths and can be scaled independently via dedicated worker pools.
- **Observability** — The Job Service and Publish Service emit structured logs and metrics for every job stage (queued, processing, publishing, completed/failed), enabling end-to-end tracing from schedule time to platform confirmation ID.

## Related Diagrams

- **System Architecture Overview:** `diagrams/002/iter1_overview.mmd`