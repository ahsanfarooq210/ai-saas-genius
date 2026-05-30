# System Architecture Overview

## Executive Summary

This document describes the architecture of a social media automation platform built on **Node.js** and **Express**. The system enables end-users to link social media accounts through OAuth, configure detailed posting preferences—including target platforms, publishing frequency, media type (photo or video), captions, hashtags, and time windows—and delegate automated publishing to a background job infrastructure powered by **Agenda.js** and **MongoDB**.

The platform is organized into twelve discrete components. Client traffic enters through an Express-based API Gateway and flows through stateless services responsible for identity, user configuration, media processing, post composition, job scheduling, and external platform integration. **MongoDB** acts as the primary document store for users, jobs, posts, metadata, and platform settings, while an **S3-compatible object storage** tier holds original and processed media blobs. A dedicated **Token Vault** encrypts OAuth credentials, and a **Rate Limiter** guards against external API throttling. **Agenda.js** workers orchestrate the asynchronous lifecycle of content generation, scheduling, and platform publishing.

## Component Catalog

### API & Entry Point
| Component | Responsibility | Document |
|-----------|----------------|----------|
| **API Gateway** | Express.js REST API entry point handling all client requests, routing, and edge validation. | [API Gateway](./component-api-gateway.md) |

### Core Business Services
| Component | Responsibility | Document |
|-----------|----------------|----------|
| **Auth Service** | User authentication, JWT token lifecycle, and OAuth initiation/handshake for linking social accounts. | [Auth Service](./component-auth-service.md) |
| **User Service** | User profile management, posting preferences, account configurations, and settings persistence. | [User Service](./component-user-service.md) |
| **Scheduler Service** | Agenda.js job queue manager; responsible for creating, scheduling, monitoring, and retrying background publishing jobs. | [Scheduler Service](./component-scheduler-service.md) |
| **Media Service** | Validation, processing, storage, and platform-specific optimization of photos and videos. | [Media Service](./component-media-service.md) |
| **Post Service** | Composition of post payloads, including caption assembly, hashtag injection, and metadata binding to media assets. | [Post Service](./component-post-service.md) |
| **Platform Connector** | OAuth-integrated adapter that publishes composed posts to external social media APIs (Instagram, Twitter, Facebook, etc.). | [Platform Connector](./component-platform-connector.md) |
| **Notification Service** | Delivery of email and push alerts for job failures, successful publishes, and account-level issues. | [Notification Service](./component-notification-service.md) |

### Data & Infrastructure
| Component | Responsibility | Document |
|-----------|----------------|----------|
| **MongoDB** | Primary document database storing users, Agenda.js jobs, posts, media metadata, rate-limit counters, and platform settings. | [MongoDB](./component-mongodb.md) |
| **Object Storage** | Scalable blob storage for original uploads and processed media variants; S3-compatible interface. | [Object Storage](./component-object-storage.md) |
| **Token Vault** | Secure encrypted storage for OAuth access tokens, refresh tokens, and social media API credentials. | [Token Vault](./component-token-vault.md) |
| **Rate Limiter** | Per-platform API quota tracking and enforcement to prevent throttling, suspension, or bans by upstream providers. | [Rate Limiter](./component-rate-limiter.md) |

## Key Architectural Flows

### Authentication & Authorization
Users authenticate via the **Auth Service**, which issues JWTs for session management and manages OAuth flows against external platforms. Secured tokens are persisted in the **Token Vault**. See the authentication flow diagram for the exact handshake sequence.

### Content Publishing Pipeline
1. A user defines posting rules in the **User Service** (platform targets, frequency, captions, hashtags, media preferences).
2. The **Scheduler Service** materializes these rules into Agenda.js jobs, computing the next run time based on the user’s publishing windows.
3. At execution time, the job triggers the **Media Service** to validate and optimize the selected photo or video for each target platform.
4. The **Post Service** assembles the final payload, merging captions, hashtags, and media references.
5. The **Platform Connector** executes the publish call, gated by the **Rate Limiter**.
6. Outcomes (success or failure) are persisted to MongoDB and pushed to the user via the **Notification Service**.

### Event & Alerting Flow
Agenda.js job state transitions emit lifecycle events consumed by the **Notification Service** to deliver real-time feedback on scheduling drift, processing errors, or successful publication.

## Technology Stack

- **Runtime / Framework**: Node.js with Express.js
- **Job Queue / Scheduler**: Agenda.js (MongoDB-backed)
- **Primary Database**: MongoDB
- **Object Storage**: S3-compatible blob store
- **Authentication**: JWT (application sessions), OAuth 2.0 (platform linking)
- **Credential Security**: Encrypted Token Vault (AES-256 or equivalent)

## Operational Considerations

- **Scalability**: The API Gateway and business services are stateless and can scale horizontally. Agenda.js worker concurrency is tunable per Node.js process, allowing the **Scheduler Service** to scale independently from web-tier request handling. MongoDB and object storage scale on their own infrastructure planes.
- **Failure Modes**: Background publishing jobs may fail due to expired OAuth tokens, platform API outages, or rate-limit breaches. Agenda.js provides built-in retry semantics; persistent failures escalate through the **Notification Service**. Media processing failures are isolated to the **Media Service** and do not corrupt downstream post records.
- **Observability**: Because publishing is heavily asynchronous, operational visibility depends on correlating Agenda.js job IDs, platform request IDs from the **Rate Limiter**, and trace headers propagated through the **API Gateway**.

## Related Diagrams

- `diagrams/0320/iter1_overview.mmd`
- `diagrams/0320/iter1_auth-flow.mmd`
- `diagrams/0320/iter1_data-pipeline.mmd`
- `diagrams/0320/iter1_event-flow.mmd`
- `diagrams/0320/iter1_deployment.mmd`