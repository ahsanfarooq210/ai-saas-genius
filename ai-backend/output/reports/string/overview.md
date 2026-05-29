# System Overview

## Executive Summary

The Social Media Automation Platform is a backend system built on **Node.js and Express** that allows users to connect third-party social media accounts, define posting preferences, and schedule automated publishing of photos and videos. **MongoDB** acts as the primary database, storing user records, OAuth credentials, per-user scheduling rules, and **Agenda.js** job definitions. The platform separates concerns across an API Gateway, domain services, a content assembly pipeline, and a background job system that executes publishing tasks against external social platform APIs.

Key capabilities include:
- **Account linking** via OAuth, with tokens persisted securely for offline publishing.
- **Preference-driven scheduling**, where users specify target platforms, posting frequency, publishing windows, captions, hashtags, and media-type filters.
- **Automated job creation**, where the `jobScheduler` (Agenda.js) generates and persists background jobs based on preference rules.
- **Platform-specific payload assembly**, handled by the `contentBuilder`, which retrieves raw media from `mediaStorage` and formatting rules from `preferenceService`.
- **Unattended publishing**, executed by the `publisherService` using stored OAuth tokens and assembled post payloads.

---

## Component Catalog

### API & Ingress Layer
- **API Gateway** — An Express.js web server that handles HTTP request routing, middleware composition (authentication, validation, rate limiting), and request dispatch to downstream services. It is the sole ingress point for client traffic.  
  [→ API Gateway Documentation](./component-api-gateway.md)

### Identity & Access Management
- **Auth Service** — Manages user registration, password-based login, and JWT token issuance/validation. All authenticated routes are validated against this service.  
  [→ Auth Service Documentation](./component-auth-service.md)

### Social Account Management
- **Account Service** — Persists OAuth access tokens and refresh tokens for linked social media accounts. It manages account connectivity state and provides token retrieval for the publishing pipeline.  
  [→ Account Service Documentation](./component-account-service.md)

### Scheduling & Rules Engine
- **Preference Service** — Stores per-user posting configurations, including target platforms, posting frequency, media type (photo/video), caption templates, hashtag sets, and publishing time windows. These records drive job generation logic.  
  [→ Preference Service Documentation](./component-preference-service.md)

### Media Handling
- **Media Storage** — An object store that holds uploaded photos and videos. It serves pending media to the `contentBuilder` and retains published assets for audit or replay scenarios.  
  [→ Media Storage Documentation](./component-media-storage.md)

### Post Composition
- **Content Builder** — Assembles platform-specific post payloads by combining media assets from `mediaStorage` with captions, hashtags, and metadata rules from `preferenceService`. It resolves platform formatting constraints before handing off to the publisher.  
  [→ Content Builder Documentation](./component-content-builder.md)

### Job Orchestration
- **Job Scheduler** — An Agenda.js engine backed by MongoDB. It queues, persists, and triggers background publishing jobs according to user-defined schedules. Job state (queued, running, failed, completed) is stored in MongoDB and processed by worker processes.  
  [→ Job Scheduler Documentation](./component-job-scheduler.md)

### Platform Integration
- **Publisher Service** — Executes outbound API calls to external social media platforms (e.g., Twitter, Instagram, Facebook). It consumes assembled payloads from `contentBuilder` and retrieves account tokens from `accountService` to publish on behalf of users.  
  [→ Publisher Service Documentation](./component-publisher-service.md)

### Data Persistence
- **MongoDB** — The primary database. It hosts collections for users, OAuth accounts, preference documents, and Agenda.js job collections (`agendaJobs`). It is the single source of truth for all transactional and job state data.  
  [→ MongoDB Documentation](./component-mongo-db.md)

---

## Cross-Cutting Interaction Patterns

| Concern | Description | Reference |
|---|---|---|
| **Authentication Flow** | End-to-end flow covering user login, JWT issuance, and authenticated request propagation through the API Gateway. | [→ Auth Flow](./auth-flow.md) |
| **Data Pipeline** | Lifecycle of a media asset from upload in `mediaStorage`, through payload assembly in `contentBuilder`, to final publication via `publisherService`. | [→ Data Pipeline](./data-pipeline.md) |
| **Event Flow** | Choreography between `preferenceService`, `jobScheduler`, and `publisherService` as schedule changes trigger job creation, updates, or cancellations. | [→ Event Flow](./event-flow.md) |

---

## Resilience & Scaling Considerations

- **Horizontal Scaling**: The API Gateway scales by adding Express.js process instances behind a load balancer. Agenda.js workers in the `jobScheduler` scale by running additional worker nodes against the shared MongoDB job collection.
- **Database Scaling**: MongoDB is the central bottleneck. User and preference data can be sharded by `userId`. Agenda.js collections should reside on a replica set to ensure job durability and failover.
- **Failure Modes**:
  - **OAuth Expiry**: If a platform token expires or is revoked, the `accountService` marks the account as disconnected; the `publisherService` surfaces the failure, and the `jobScheduler` records the job state as failed without infinite retry.
  - **Media Unavailability**: If `mediaStorage` is unreachable, the `contentBuilder` cannot assemble payloads, causing dependent jobs to fail fast and await operator intervention or object store recovery.
  - **Downstream API Rate Limits**: The `publisherService` must handle platform rate-limit responses (HTTP 429) and defer jobs via Agenda.js retry policies with exponential backoff.
- **Security**: OAuth tokens are encrypted at rest in MongoDB. JWT secrets are isolated to the `authService` and API Gateway middleware. Platform API keys used by `publisherService` are injected via environment variables and never committed to source control.

---

## Related Diagrams

- **Overview**: `diagrams/string/iter1_overview.mmd`
- **API Gateway**: `diagrams/string/iter1_component-api-gateway.mmd`
- **Auth Service**: `diagrams/string/iter1_component-auth-service.mmd`
- **Account Service**: `diagrams/string/iter1_component-account-service.mmd`
- **Preference Service**: `diagrams/string/iter1_component-preference-service.mmd`
- **Media Storage**: `diagrams/string/iter1_component-media-storage.mmd`
- **Content Builder**: `diagrams/string/iter1_component-content-builder.mmd`
- **Job Scheduler**: `diagrams/string/iter1_component-job-scheduler.mmd`
- **Publisher Service**: `diagrams/string/iter1_component-publisher-service.mmd`
- **MongoDB**: `diagrams/string/iter1_component-mongo-db.mmd`
- **Auth Flow**: `diagrams/string/iter1_auth-flow.mmd`
- **Data Pipeline**: `diagrams/string/iter1_data-pipeline.mmd`
- **Event Flow**: `diagrams/string/iter1_event-flow.mmd`