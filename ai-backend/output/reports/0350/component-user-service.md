# User Service

## Responsibilities

The User Service is the authoritative source for all user-specific configuration data in the social media automation platform. Its core responsibilities include:

- **User Profile Lifecycle**: Creating, reading, and updating user profiles (display name, email, timezone, locale, onboarding state).
- **Posting Preference Management**: Persisting and validating user-defined automation settings, including target platforms, posting frequency, media type preferences, caption templates, default hashtags, publishing time windows, and per-platform account settings.
- **Platform Connection Registry**: Maintaining a registry of which external social accounts a user has linked. It stores references to OAuth credentials managed by the `auth_service` / `token_store`, but never the tokens themselves.
- **Configuration Validation**: Enforcing business rules on preference updates (e.g., ensuring at least one target platform is selected, that publishing times are valid for the user's timezone, and that frequency caps are not exceeded).
- **Inter-Service Configuration Serving**: Exposing internal endpoints for the `scheduler_service` to retrieve normalized posting configurations when generating or updating Agenda.js jobs.
- **Connection State Synchronization**: Reflecting the active/expired/revoked status of platform connections based on feedback from the `auth_service`.

## APIs and Interfaces

### Public REST API (Express/Node.js)

All public routes require a valid JWT forwarded by the API Gateway. The service delegates token validation to the `auth_service` via an internal network call or shared middleware.

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/v1/users/:userId/profile` | Retrieve the user profile document. |
| `PATCH` | `/v1/users/:userId/profile` | Update mutable profile fields (e.g., `displayName`, `timezone`). |
| `GET` | `/v1/users/:userId/preferences` | Retrieve the full posting preference configuration. |
| `PUT` | `/v1/users/:userId/preferences` | Upsert posting preferences. Triggers validation and, on success, notifies downstream services. |
| `GET` | `/v1/users/:userId/connections` | List all connected platform accounts with status metadata. |
| `POST` | `/v1/users/:userId/connections` | Record a new platform connection reference after the `auth_service` completes an OAuth flow. |
| `DELETE` | `/v1/users/:userId/connections/:connectionId` | Mark a connection as revoked and remove its reference from active preferences. |
| `GET` | `/v1/users/:userId/preferences/validate` | Dry-run validation of the current preference set; returns readiness errors without persisting. |

**Example Request/Response:**

```json
// PUT /v1/users/507f1f77bcf86cd799439011/preferences
{
  "targetPlatforms": ["instagram", "twitter"],
  "mediaType": "mixed",
  "postingFrequency": {
    "type": "weekly",
    "days": ["monday", "wednesday", "friday"],
    "postsPerDay": 2
  },
  "publishingTimes": [
    { "hour": 9, "minute": 0, "timezone": "America/New_York" },
    { "hour": 17, "minute": 30, "timezone": "America/New_York" }
  ],
  "captionTemplate": "Check out our latest update! 🚀",
  "defaultHashtags": ["#automation", "#socialmedia"],
  "accountSpecificPreferences": {
    "instagram": { "contentFormat": "reel" },
    "twitter": { "threadMode": false }
  }
}
```

### Internal Service API

These endpoints are exposed on a separate internal port or network and are consumed by peer backend services only.

| Method | Route | Consumer | Description |
|--------|-------|----------|-------------|
| `GET` | `/internal/users/:userId/config` | `scheduler_service` | Returns a normalized, expanded preference object used to build Agenda.js job definitions. |
| `GET` | `/internal/users/:userId/connections/active` | `publisher_service`, `content_service` | Returns active platform connections with platform IDs and external account handles. |
| `POST` | `/internal/users/:userId/connections/:connectionId/sync-status` | `auth_service` | Webhook-style endpoint to update a connection's status (e.g., `expired` or `active`) after token refresh or revocation. |

## Data Ownership

The User Service owns the following MongoDB collections. All documents use `userId` (ObjectId) as the primary logical shard key.

### `users` Collection

```javascript
{
  _id: ObjectId,
  email: String,              // unique, indexed
  displayName: String,
  timezone: String,           // IANA timezone (e.g., "America/New_York")
  locale: String,
  onboardingStatus: String,   // enum: ["pending", "active", "paused"]
  createdAt: ISODate,
  updatedAt: ISODate
}
```

### `user_preferences` Collection

Stored as a separate collection (not embedded in `users`) to avoid unbounded document growth and to allow independent indexing.

```javascript
{
  _id: ObjectId,
  userId: ObjectId,           // indexed, unique
  targetPlatforms: [String],    // e.g., ["instagram", "linkedin"]
  mediaType: String,          // enum: ["photo", "video", "mixed"]
  postingFrequency: {
    type: String,             // enum: ["daily", "weekly", "custom"]
    days: [String],           // applicable for "weekly"
    postsPerDay: Number,
    maxPostsPerWeek: Number
  },
  publishingTimes: [{
    hour: Number,             // 0-23
    minute: Number,           // 0-59
    timezone: String
  }],
  captionTemplate: String,
  defaultHashtags: [String],
  accountSpecificPreferences: {
    // platform-scoped overrides
    instagram: { contentFormat: String, autoCrosspost: Boolean },
    twitter: { threadMode: Boolean },
    linkedin: { visibility: String }
  },
  isActive: Boolean,          // if false, scheduler_service skips job creation
  lastModified: ISODate
}
```

### `platform_connections` Collection

This collection stores linkage metadata only. OAuth tokens and refresh secrets are held in the `token_store` (managed by `auth_service`).

```javascript
{
  _id: ObjectId,
  userId: ObjectId,           // compound index with platform
  platform: String,           // enum: ["instagram", "twitter", "facebook", "linkedin"]
  tokenStoreRef: String,      // foreign reference to token_store entry
  platformAccountId: String,  // external platform user ID/handle
  platformAccountName: String,// human-readable label (e.g., "@handle")
  status: String,             // enum: ["active", "expired", "revoked"]
  connectedAt: ISODate,
  updatedAt: ISODate
}
```

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **MongoDB Primary Unavailability** | All profile and preference mutations fail. Reads may also stall if not routed to secondaries. | Implement retry logic with exponential backoff for writes. Use MongoDB read preferences (`secondaryPreferred`) for GET endpoints. Return `503 Service Unavailable` to the API Gateway after retries are exhausted. |
| **Auth Service Dependency Failure** | Cannot validate JWT ownership during sensitive mutations (e.g., updating preferences or deleting connections). | Cache recent `auth_service` validation results briefly (e.g., 60s TTL). For non-critical reads, proceed if the Gateway has already validated the JWT. For writes, fail fast with `401/503` rather than allow unverified changes. |
| **Stale Connection References** | A platform connection is deleted or expired in `token_store`, but `platform_connections` still lists it as `active`. The `scheduler_service` may create jobs that fail at publish time. | On read, perform a lightweight liveness check against `auth_service` for connections older than N hours. Additionally, consume `auth_service` sync events via the internal `/sync-status` endpoint to mark connections as `expired`. |
| **Invalid Preference Payloads** | Users submit contradictory rules (e.g., `postsPerDay: 50` or empty `targetPlatforms`). | Strict schema validation using Joi or Zod before MongoDB writes. Return `400 Bad Request` with a structured error code array (e.g., `{"code": "INVALID_FREQUENCY", "field": "postingFrequency.postsPerDay"}`). |
| **Concurrent Preference Updates** | Two simultaneous `PUT` requests from a client race, causing lost updates or inconsistent job states in `scheduler_service`. | Use MongoDB optimistic concurrency control: include a `version` or `lastModified` field in the `user_preferences` document and reject updates with an outdated timestamp, returning `409 Conflict`. |
| **Schema Drift on Reads** | Older preference documents lack newly introduced fields (e.g., a new `accountSpecificPreferences` key). | Apply defaults at the application layer during deserialization. Run background migration jobs for critical new indexes or required fields. |

## Scaling Considerations

- **Database Indexing**: Maintain a unique index on `users.email` and a compound index on `platform_connections` for `{ userId: 1, platform: 1, status: 1 }`. The `user_preferences` collection should have a unique index on `userId` to ensure one preference document per user.
- **Read Replicas and Caching**: The `scheduler_service` polls user configurations frequently to build Agenda.js jobs. Cache active `user_preferences` documents in an in-memory LRU or a Redis cluster keyed by `userId`, with a TTL of 5–15 minutes. Invalidate the cache on any successful `PUT /preferences` update.
- **Horizontal Pod Scaling**: The Express service is stateless. Scale based on CPU/memory thresholds and request latency. Ensure MongoDB connection pool sizes (`maxPoolSize`) are tuned to handle the increased connection count from new pods.
- **Sharding Strategy**: If the user base exceeds single-replica set limits, shard `users`, `user_preferences`, and `platform_connections` by `userId`. All queries are user-scoped, making this a natural, low-contention shard key.
- **Rate Limiting**: Preference update endpoints (`PUT`, `PATCH`) should be rate-limited per user at the API Gateway to prevent abuse that could trigger excessive cache invalidation and `scheduler_service` re-computation.
- **Eventual Consistency with Scheduler**: After a preference update, the service should emit an internal event (or make a synchronous internal call) to the `scheduler_service` to re-evaluate the user's job queue. If the event bus is down, the `scheduler_service` must gracefully degrade by reading preferences directly from the User Service at the next job evaluation cycle.

## Related Diagrams

No paired Mermaid diagram was provided for this document.