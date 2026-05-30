# Social Media Automation Platform — Architecture Overview

## Executive Summary

This platform automates social media publishing across Instagram, Twitter/X, Facebook, TikTok, and LinkedIn. The backend is built with Node.js and Express, using MongoDB as the primary document database and Agenda.js for background job orchestration. Users authenticate via OAuth, connect platform accounts, and configure posting preferences—target platforms, media type (photo or video), captions, hashtags, posting frequency, and time slots. The system translates these preferences into durable Agenda.js jobs stored in MongoDB. At scheduled times, background workers prepare media assets and execute authenticated API calls to publish content on behalf of the user. All OAuth tokens are encrypted at rest in a dedicated token store, and media files are persisted in S3-compatible object storage with CDN delivery.

## Component Catalog

### Client Entry Point
- **[API Gateway](api-gateway.md)** — Express.js HTTP entry point serving web and mobile clients. Validates requests, enforces rate limits, routes traffic to domain services, and aggregates downstream responses.

### Identity & Account Management
- **[Auth Service](auth-service.md)** — Handles user registration, login, JWT issuance/validation, and OAuth authorization-code flows for connecting social platform accounts.
- **[User Service](user-service.md)** — Owns user profiles, linked platform accounts, and posting preference configurations (frequency, time windows, platform selection).
- **[Token Store](token-store.md)** — Secure encrypted vault for OAuth access and refresh tokens. Provides decryption-on-read APIs to ensure tokens never appear in plaintext in application logs or database dumps.

### Content & Media Pipeline
- **[Content Service](content-service.md)** — Manages post drafts, caption text, hashtag sets, and media references. Maintains draft state (draft, scheduled, published, failed) before hand-off to the scheduler.
- **[Media Service](media-service.md)** — Accepts photo and video uploads, generates thumbnails, transcodes video variants, and manages upload/download URLs for S3-compatible object storage.

### Scheduling & Publishing Execution
- **[Scheduler Service](scheduler-service.md)** — Reads user posting preferences and generates or updates recurring Agenda.js job definitions in MongoDB. Handles preference changes by rescheduling or canceling existing jobs.
- **[Agenda Worker](agenda-worker.md)** — Background Node.js process running Agenda.js. Locks jobs in MongoDB, fetches prepared content, delegates publishing, and records job outcomes.
- **[Publisher Service](publisher-service.md)** — Formats platform-specific payloads, attaches media URLs, and executes publish calls. Handles retries, idempotency keys, and per-platform error mapping.
- **[Platform API Clients](platform-api-clients.md)** — OAuth-authenticated HTTP clients for Instagram, Twitter/X, Facebook, TikTok, and LinkedIn. Manages request signing, rate-limit tracking, and token refresh via the Token Store.

### Observability & Notifications
- **[Notification Service](notification-service.md)** — Dispatches email and push notifications for successful publishes, permanent failures, OAuth token expiry, and account-level issues (e.g., revoked permissions).

### Data & Storage Infrastructure
- **[MongoDB](mongodb.md)** — Primary database for users, posts, job definitions, job execution logs, media metadata, platform connection states, and Agenda.js’s internal job queue collections.
- **[Object Storage](object-storage.md)** — S3-compatible blob storage for original uploads, transcoded videos, thumbnails, and CDN origin assets.

## End-to-End Flow

1. **Onboarding**: A user signs up via the **Auth Service** and connects one or more social accounts through OAuth. Tokens are encrypted and stored in the **Token Store**; connection state is saved in **MongoDB**.
2. **Preference Configuration**: The user defines posting preferences through the **User Service** (e.g., “Post photos to Instagram and Twitter every Tuesday and Thursday at 9:00 AM with caption template X”).
3. **Job Generation**: The **Scheduler Service** creates recurring Agenda.js jobs in **MongoDB** based on these preferences.
4. **Content Preparation**: Before a scheduled run, the user (or system) creates a draft in the **Content Service** linking captions and media references. The **Media Service** ensures the required photo/video files and thumbnails exist in **Object Storage**.
5. **Execution**: The **Agenda Worker** locks the job, assembles the publish request, and calls the **Publisher Service**.
6. **Platform Publish**: The **Publisher Service** uses the appropriate **Platform API Client** to upload or publish the content via the native platform API.
7. **Outcome**: On success or failure, the job state is updated in **MongoDB**, and the **Notification Service** alerts the user. Permanent failures (e.g., revoked OAuth) pause future jobs for that account until re-authentication.

## Operational Considerations

- **Horizontal Scaling**: The API Gateway and Agenda Worker are stateless and scale behind a load balancer. Multiple Agenda Worker instances coordinate via MongoDB’s distributed job locking to prevent duplicate publishes.
- **Rate Limiting**: Platform API Clients enforce per-platform rate limits (e.g., Instagram Graph API, Twitter API v2) with token-bucket or sliding-window counters to avoid account bans.
- **Media Processing**: CPU-intensive transcoding in the Media Service is offloaded to background queues so that API Gateway threads are never blocked.
- **Database Load**: Agenda.js writes heavily to MongoDB for job locking, logging, and state transitions. The cluster must be provisioned with sufficient IOPS and replica-set members to handle write-heavy workloads.
- **Storage Lifecycle**: Object Storage should implement lifecycle policies to transition published media to infrequent-access tiers and expire temporary upload buffers after 24 hours.
- **Security**: The Token Store encrypts OAuth secrets with AES-256 (or equivalent) before persistence. Encryption keys are managed via a key-management service separate from the database.

## Failure Modes

- **OAuth Token Expiry / Revocation**: Platform API Clients detect 401/403 errors, surface them to the Publisher Service, and trigger the Notification Service. The Scheduler Service pauses affected jobs to prevent repeated failed attempts.
- **Platform API Outages**: Publisher Service retries with exponential backoff and jitter. After a configurable threshold, the job is marked failed and the user is notified.
- **Media Processing Failures**: Corrupt files or unsupported codecs are caught in the Media Service, blocking the draft from scheduling and returning a validation error to the client.
- **Job Queue Lag**: If Agenda Workers cannot keep up with the job volume, MongoDB queue depth grows. Mitigation requires scaling worker instances and, if necessary, sharding the Agenda.js job collection.

## Related Diagrams

- [System Overview](diagrams/001/iter1_overview.mmd)