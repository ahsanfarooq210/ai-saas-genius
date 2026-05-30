# User Service

## Responsibilities

The User Service is the authoritative source for user identity metadata, linked social platform accounts, and posting preference configurations within the social media automation platform. It operates as an Express.js microservice and persists all state to MongoDB.

- **User Profile Management**: Maintains core identity records including display name, email, timezone, locale, and account status. Handles profile updates and enforces uniqueness constraints on email addresses.
- **Platform Connection Registry**: Tracks which social platforms (Instagram, Twitter/X, Facebook, TikTok, LinkedIn) a user has connected. Stores references to OAuth credentials managed by the `auth_service` and `token_store`, along with per-platform metadata such as page IDs, handles, and connection health status.
- **Posting Preference Configuration**: Manages the scheduling and content parameters that drive the `scheduler_service`. This includes target platforms, posting frequency (e.g., posts per day or explicit intervals), preferred media types (photo vs. video), default caption templates, hashtag sets, publishing time windows with day-of-week granularity, and account-specific overrides per platform.
- **Settings Validation**: Enforces business rules on preference documents before persistence. Examples include: ensuring time windows are logically valid (start < end), rejecting unsupported platform combinations, capping maximum daily post frequencies to prevent abuse, and validating timezone strings against the IANA database.
- **Account Lifecycle**: Orchestrates user deletion and deactivation flows. On deletion, initiates cascading cleanup of connections and preferences, and coordinates with downstream services (via eventual consistency or explicit hooks) to cancel pending scheduled jobs.

## APIs and Interfaces

### REST API (HTTP/JSON)

The service exposes an internal REST API consumed exclusively by the `api_gateway`. All endpoints require a valid user-scoped bearer token, which is validated via the `auth_service`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/users/:userId/profile` | Retrieve user profile by ID. |
| `PATCH` | `/v1/users/:userId/profile` | Update mutable profile fields (display name, timezone, locale). |
| `GET` | `/v1/users/:userId/connections` | List all active and inactive platform connections. |
| `POST` | `/v1/users/:userId/connections` | Register a new platform connection after OAuth completion. Accepts `platform`, `platformUserId`, and `tokenStoreRef`. |
| `DELETE` | `/v1/users/:userId/connections/:platform` | Mark a platform connection as disconnected. Triggers preference validation to remove the platform from active targets. |
| `GET` | `/v1/users/:userId/preferences` | Retrieve the user's master posting preferences document. |
| `PUT` | `/v1/users/:userId/preferences` | Idempotently replace the entire posting preferences configuration. |
| `PATCH` | `/v1/users/:userId/preferences` | Partially update preferences (e.g., adjust time windows only). |
| `GET` | `/v1/users/:userId/preferences/:platform` | Retrieve account-specific overrides for a single platform. |
| `DELETE` | `/v1/users/:userId` | Initiate hard deletion of the user and all owned data. |

**Request/Response Contracts**

- `PostingPreferences` (request body for `PUT /v1/users/:userId/preferences`):
  ```json
  {
    "targetPlatforms": ["instagram", "twitter"],
    "postingFrequency": { "type": "interval", "minutes": 360 },
    "mediaTypePreferences": ["photo", "video"],
    "defaultCaptionTemplate": "Check out our latest update!",
    "defaultHashtagSets": [["#tech", "#innovation"], ["#startup"]],
    "publishingTimeWindows": [
      { "day": "monday", "startTime": "09:00", "endTime": "17:00", "timezone": "America/New_York" }
    ],
    "accountSpecificPreferences": {
      "instagram": { "aspectRatio": "1:1", "requireThumbnail": true }
    }
  }
  ```

- Error responses use standard HTTP status codes:
  - `400` — Validation failure (malformed timezone, invalid time window).
  - `404` — User or connection not found.
  - `409` — Conflict (duplicate connection for the same platform account).
  - `422` — Business rule violation (e.g., frequency exceeds platform rate limits defined in user tier).

### Internal Service Interfaces

- **`auth_service`**: The User Service calls `auth_service` to verify token ownership and resolve the principal `userId` from JWT claims during internal request processing. It also queries `auth_service` to validate that a completed OAuth flow exists before persisting a new `platform_connection` record.
- **`mongodb`**: Direct Mongoose/MongoDB driver connections. Uses replica-set aware connection strings with `w: majority` write concern for preference updates to ensure the `scheduler_service` reads consistent data.
- **`scheduler_service` (indirect)**: The User Service does not call the scheduler directly. Instead, preference documents are designed to be polled or change-streamed by the `scheduler_service` to generate Agenda.js job definitions.

## Data Owned

All data is stored in MongoDB under a dedicated service database (e.g., `user_service_db`).

### `users` Collection
Core identity and account metadata.
```javascript
{
  _id: ObjectId("..."),
  email: "user@example.com",           // unique, indexed
  displayName: "Jane Doe",
  timezone: "America/Los_Angeles",
  locale: "en-US",
  accountStatus: "active",             // enum: active | suspended | deleting
  createdAt: ISODate("2024-01-15T10:00:00Z"),
  updatedAt: ISODate("2024-06-01T12:30:00Z"),
  preferencesRef: ObjectId("...")      // reference to posting_preferences
}
```

### `platform_connections` Collection
Links users to external social accounts. Stores no secrets; references tokens in `token_store`.
```javascript
{
  _id: ObjectId("..."),
  userId: ObjectId("..."),             // indexed
  platform: "instagram",             // indexed
  platformUserId: "123456789",
  tokenStoreRef: "secure-ref-uuid",  // opaque handle for token_store
  connectionStatus: "active",        // active | revoked | expired | error
  platformMetadata: {
    username: "jane_doe",
    pageId: null,
    profilePictureUrl: "https://..."
  },
  connectedAt: ISODate("2024-02-01T08:00:00Z"),
  lastVerifiedAt: ISODate("2024-06-01T09:00:00Z"),
  disconnectedAt: null
}
```

### `posting_preferences` Collection
The master configuration document consumed by the scheduling pipeline.
```javascript
{
  _id: ObjectId("..."),
  userId: ObjectId("..."),             // unique, indexed
  targetPlatforms: ["instagram", "twitter"],
  postingFrequency: {
    type: "fixed_count",               // fixed_count | interval
    postsPerDay: 3
  },
  mediaTypePreferences: ["photo", "video"],
  defaultCaptionTemplate: "New drop!",
  defaultHashtagSets: [["#style", "#fashion"]],
  publishingTimeWindows: [
    {
      day: "tuesday",
      startTime: "10:00",
      endTime: "14:00",
      timezone: "Europe/London"
    }
  ],
  accountSpecificPreferences: {
    "twitter": { "threadMode": false, "maxChars": 280 }
  },
  isActive: true,                      // master kill-switch for scheduling
  version: 4,                          // optimistic concurrency control
  updatedAt: ISODate("2024-06-10T15:00:00Z")
}
```

## Failure Modes

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Stale Platform Connection** | User revokes OAuth externally; platform API returns auth errors during publish. | `connectionStatus` is updated to `revoked` via webhook or polling from `auth_service`. The service rejects new scheduler jobs for revoked platforms and forces preference re-validation. |
| **Preference Validation Error** | Invalid schedule (e.g., `startTime` after `endTime`) causes `scheduler_service` to create malformed Agenda.js jobs. | Strict schema validation at the API layer using `Joi` or Zod. Time windows are normalized to UTC and checked for zero-duration intervals before persistence. |
| **Concurrent Preference Update** | Two simultaneous `PATCH` requests overwrite each other, causing lost updates to posting frequency. | Optimistic locking via an integer `version` field on `posting_preferences`. Updates are rejected with `409 Conflict` if the provided version does not match the stored document. |
| **`auth_service` Unavailability** | Token validation or user resolution fails; profile reads/writes block. | Circuit breaker on `auth_service` calls. Read-only profile endpoints may degrade to cached claims from the API Gateway if the user document was recently accessed. Write endpoints fail fast with `503`. |
| **MongoDB Replication Lag** | `scheduler_service` reads a stale preference document immediately after a user update, scheduling posts with old settings. | Write concern `w: majority` and read preference `primary` for preference mutations. Alternatively, expose a change stream that `scheduler_service` consumes to guarantee eventual consistency. |
| **Account Deletion Orphans** | Hard deletion of a user leaves `platform_connections` or `posting_preferences` documents behind due to non-transactional cleanup. | Wrap deletion in a MongoDB multi-document ACID transaction spanning `users`, `platform_connections`, and `posting_preferences` collections. |
| **Timezone DST Ambiguity** | A preference specifies `02:30` in `America/New_York` during the spring-forward transition, resulting in an invalid local time. | Normalize all time windows to UTC at write time based on the user's current timezone rules. Re-calculate UTC boundaries nightly for users in zones with upcoming DST changes. |

## Scaling Considerations

- **Read-heavy Profile Access**: User profiles and preferences are read on nearly every authenticated request. Deploy secondary-read caching (e.g., an in-memory LRU cache for hot preference documents, or a dedicated Redis layer) to reduce MongoDB query load, with cache invalidation keyed on `preferences.version`.
- **Database Indexing**: Maintain compound indexes on `{ userId: 1, platform: 1 }` in `platform_connections` and `{ userId: 1 }` with a partial filter `{ isActive: true }` in `posting_preferences` to accelerate scheduler polling queries.
- **Sharding Strategy**: Shard `posting_preferences` and `platform_connections` by `userId` hash to distribute write load as the user base grows. `users` should remain a smaller collection but can also shard by `userId` for symmetry.
- **Scheduler Decoupling**: The `scheduler_service` should not query the User Service synchronously for every job tick. Instead, preference documents should be snapshotted or replicated into the scheduler's domain at write-time to eliminate runtime coupling and allow the User Service to scale independently.
- **Connection State Polling**: Avoid polling every external platform from the User Service. Connection health should be driven by events (webhooks from platforms processed via `auth_service`) or by the `publisher_service` reporting failures back through the system, rather than active health checks within this service.
- **Rate Limiting on Preference Mutations**: Aggressive updates to posting preferences can churn Agenda.js job definitions. Enforce a minimum cooldown (e.g., 30 seconds) between preference `PUT` operations for the same user to dampen scheduler re-computation.

## Related Diagrams

No paired diagram is provided for this component.