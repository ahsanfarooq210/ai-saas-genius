# Social Media Automation Platform — System Overview

## Executive Summary

This platform automates the end-to-end lifecycle of social media content publishing. Users connect their social media accounts, define posting preferences—such as target platforms, media type, captions, hashtags, publishing windows, and account-specific settings—and the system handles the rest. Built on Node.js and Express, with MongoDB as the primary database and Agenda.js for background job orchestration, the platform creates durable, scheduled jobs that prepare media assets and publish them automatically to connected platforms on behalf of each user.

The architecture is split into twelve discrete backend components. The API Gateway serves as the single entry point for all client traffic, delegating to specialized services for authentication, user configuration, job scheduling, media processing, and platform publishing. All OAuth credentials are isolated in an encrypted Token Store, while the Job Scheduler coordinates the asynchronous pipeline that moves media from raw storage through processing and ultimately to live publication.

## Component Catalog

Each component below is documented in detail in its own architecture specification.

| Component | Responsibility | Architecture Document |
|---|---|---|
| **API Gateway** | Express.js REST API handling authentication, user settings, and job management endpoints. | [api-gateway.md](./components/api-gateway.md) |
| **Auth Service** | User registration, login, JWT token management, and OAuth flows for social media account connections. | [auth-service.md](./components/auth-service.md) |
| **Token Store** | Secure encrypted storage for social media platform OAuth tokens and refresh tokens. | [token-store.md](./components/token-store.md) |
| **User Service** | Management of user profiles, posting preferences, platform configurations, and account-specific settings. | [user-service.md](./components/user-service.md) |
| **Job Scheduler** | Agenda.js-based creation, queuing, and monitoring of background jobs for content generation and publishing. | [job-scheduler.md](./components/job-scheduler.md) |
| **Media Processor** | Background worker that prepares, resizes, formats, and optimizes photos and videos for target platforms. | [media-processor.md](./components/media-processor.md) |
| **Media Storage** | Blob storage for original and processed user media files awaiting scheduled publication. | [media-storage.md](./components/media-storage.md) |
| **CDN** | Content delivery network for serving optimized media to social media platform APIs. | [cdn.md](./components/cdn.md) |
| **Platform Publisher** | Execution of API calls to publish prepared content to connected social media platforms at scheduled times. | [platform-publisher.md](./components/platform-publisher.md) |
| **Notification Service** | Delivery of email and push notifications for job status, failures, and publishing confirmations. | [notification-service.md](./components/notification-service.md) |
| **Analytics Collector** | Tracking of post performance metrics, engagement data, and job execution statistics from platforms. | [analytics-collector.md](./components/analytics-collector.md) |
| **MongoDB** | Primary database storing users, preferences, jobs, posts, tokens, and analytics data. | [mongodb.md](./components/mongodb.md) |

## End-to-End Data Flow

The lifecycle of an automated post follows a deterministic pipeline across the component boundaries:

1. **Account Connection & Configuration**  
   The user initiates OAuth flows through the Auth Service, which persists encrypted tokens in the Token Store. The user then defines posting preferences—platform selection, frequency, media type, captions, hashtags, and publishing windows—via the User Service, which stores the configuration in MongoDB.

2. **Job Generation**  
   The Job Scheduler evaluates user preferences and creates Agenda.js jobs in MongoDB. Each job captures a scheduled execution time, references to the user’s media assets in Media Storage, and target platform identifiers.

3. **Media Preparation**  
   When a job’s execution time arrives, the Job Scheduler dispatches a work order to the Media Processor. The processor retrieves the original asset from Media Storage, applies platform-specific transformations (e.g., resolution, codec, aspect ratio, file size limits), and writes the optimized output back to Media Storage. The CDN then makes the processed asset available via a public or signed URL.

4. **Platform Publication**  
   The Job Scheduler triggers the Platform Publisher. The publisher retrieves the encrypted OAuth token from the Token Store, fetches the processed media URL from the CDN, and executes the target platform’s publishing API. The job status is updated in MongoDB upon completion or failure.

5. **Feedback & Analytics**  
   The Platform Publisher reports execution outcomes to the Notification Service, which delivers email or push alerts to the user. Concurrently, the Analytics Collector records job-level metadata (latency, retry count, success/failure) and later ingests platform-specific engagement metrics (likes, shares, impressions) into MongoDB for reporting.

## Cross-Cutting Concerns

- **Security & Token Isolation**  
  OAuth tokens are encrypted at rest in the Token Store and decrypted only by the Auth Service and Platform Publisher at runtime. The API Gateway validates JWTs for every request but never handles platform credentials.

- **Resilience & Retry**  
  Media processing failures are retried with exponential backoff at the worker level. Platform publishing failures are retried via Agenda.js’s built-in job retry semantics. Jobs that exhaust their retry budget transition to a failed state and trigger a user notification.

- **Observability**  
  The Analytics Collector aggregates job execution statistics and platform API latency. The Job Scheduler exposes job queue depth and state distributions (queued, running, completed, failed) for operational monitoring.

- **Scalability**  
  The API Gateway, Media Processor, and Platform Publisher are stateless and horizontally scalable. MongoDB serves as the single source of truth for job state and user data, allowing worker pools to scale independently based on queue depth.

## Related Diagrams

- [System Overview Diagram](./diagrams/001/iter1_overview.mmd)